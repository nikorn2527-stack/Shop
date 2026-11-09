import type { SqliteDb } from "./sqliteStore";
import type {
  MemberStatement,
  MemberStatementInput,
  StatementEntry,
  StatementPurchase,
} from "../shared/storeTypes/statements";
import { StoreError } from "./domain/storeError";
import { bangkokParts, parseBangkokDate } from "../shared/storeTime";

const cents = (value: number) => Math.round(value * 100);
function dateBoundary(value: string | undefined, end = false) {
  const text = value?.trim() || "";
  if (!text) return "";
  const date = parseBangkokDate(text);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !date)
    throw new StoreError("รูปแบบวันที่ไม่ถูกต้อง");
  const parts = bangkokParts(date);
  if (
    `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}` !==
    text
  )
    throw new StoreError("วันที่ไม่มีอยู่ในปฏิทิน");
  if (!end) return `${text} 00:00:00`;
  const next = bangkokParts(new Date(date.getTime() + 86400000));
  return `${String(next.year).padStart(4, "0")}-${String(next.month).padStart(2, "0")}-${String(next.day).padStart(2, "0")} 00:00:00`;
}
/** A consistent read snapshot. No inserts, migrations, audit writes or balance adjustments. */
export function getMemberStatement(
  db: SqliteDb,
  input: MemberStatementInput
): MemberStatement {
  const from = input.from?.trim() || "",
    to = input.to?.trim() || "";
  const lower = dateBoundary(from),
    upper = dateBoundary(to, true);
  if (from && to && from > to)
    throw new StoreError("วันเริ่มต้นต้องไม่เกินวันสิ้นสุด");
  const inRange = (time: string) =>
    (!lower || time >= lower) && (!upper || time < upper);
  db.exec("BEGIN");
  try {
    const member = db
      .prepare(
        `SELECT member_number AS memberNumber,prename,first_name AS firstName,last_name AS lastName,card_number AS cardNumber,balance
   FROM members WHERE member_number=?`
      )
      .get(input.memberNumber.trim()) as
      (MemberStatement["member"] & { balance: number }) | undefined;
    if (!member) throw new StoreError("ไม่พบสมาชิกในระบบ");
    const txs = db
      .prepare(
        `SELECT t.id,t.type,t.detail,t.amount,t.created_at AS createdAt,t.payment_method AS paymentMethod,cs.card_number AS cardNumber
   FROM member_transactions t LEFT JOIN card_usage_sessions cs ON cs.id=t.card_usage_session_id AND cs.member_number=t.member_number
   WHERE t.member_number=? ORDER BY t.created_at,t.id`
      )
      .all(member.memberNumber) as unknown as {
      id: number;
      type: string;
      detail: string;
      amount: number;
      createdAt: string;
      paymentMethod: string | null;
      cardNumber: string | null;
    }[];
    const conditions = ["s.member_number=?"];
    const params: (string | number)[] = [member.memberNumber];
    if (lower) {
      conditions.push("s.created_at>=?");
      params.push(lower);
    }
    if (upper) {
      conditions.push("s.created_at<?");
      params.push(upper);
    }
    const sales = db
      .prepare(
        `SELECT s.id,s.order_number AS orderNumber,s.payment_method AS paymentMethod,s.subtotal,s.discount,s.total,s.voided,s.created_at AS createdAt,cs.card_number AS cardNumber
   FROM sales s LEFT JOIN card_usage_sessions cs ON cs.id=s.card_usage_session_id AND cs.member_number=s.member_number
   WHERE ${conditions.join(" AND ")} ORDER BY s.created_at,s.id`
      )
      .all(...params) as unknown as (Omit<
      StatementPurchase,
      "items" | "voided"
    > & { voided: number; createdAt: string; cardNumber: string | null })[];
    const items = db
      .prepare(
        `SELECT si.sale_id AS saleId,si.name,COALESCE(si.unit,p.unit,'ชิ้น') AS unit,si.qty,si.price,COALESCE(si.amount,ROUND(si.qty*si.price,2)) AS amount
   FROM sale_items si JOIN sales s ON s.id=si.sale_id LEFT JOIN products p ON p.id=si.product_id
   WHERE ${conditions.join(" AND ")} ORDER BY si.sale_id,si.id`
      )
      .all(...params) as unknown as (StatementPurchase["items"][number] & {
      saleId: number;
    })[];
    const bySale = new Map<number, StatementPurchase["items"]>();
    for (const { saleId, ...item } of items) {
      const list = bySale.get(saleId) ?? [];
      list.push(item);
      bySale.set(saleId, list);
    }
    const purchases = new Map(
      sales.map(s => [
        s.orderNumber,
        {
          id: s.id,
          orderNumber: s.orderNumber,
          paymentMethod: s.paymentMethod,
          subtotal: s.subtotal,
          discount: s.discount,
          total: s.total,
          voided: Boolean(s.voided),
          items: bySale.get(s.id) ?? [],
        } satisfies StatementPurchase,
      ])
    );
    const linked = new Set<string>();
    const entries: StatementEntry[] = [];
    const initial =
      cents(member.balance) - txs.reduce((sum, t) => sum + cents(t.amount), 0);
    let running = initial,
      opening = initial,
      closing = initial,
      incoming = 0,
      outgoing = 0,
      ledgerCount = 0;
    for (const tx of txs) {
      const amount = cents(tx.amount);
      running += amount;
      if (lower && tx.createdAt < lower) opening = running;
      if (!upper || tx.createdAt < upper) closing = running;
      if (!inRange(tx.createdAt)) continue;
      ledgerCount++;
      if (amount > 0) incoming += amount;
      else outgoing -= amount;
      const order =
        tx.type === "purchase"
          ? tx.detail.match(/^บิล #(.+?) · /)?.[1]
          : undefined;
      const purchase = order ? (purchases.get(order) ?? null) : null;
      if (purchase) linked.add(purchase.orderNumber);
      entries.push({
        ...tx,
        kind: "wallet",
        reference:
          purchase?.orderNumber ?? `TX-${String(tx.id).padStart(3, "0")}`,
        balanceAfter: running / 100,
        purchase,
      });
    }
    for (const sale of sales) {
      if (linked.has(sale.orderNumber)) continue;
      entries.push({
        id: sale.id,
        kind: "purchase",
        type: "purchase",
        createdAt: sale.createdAt,
        reference: sale.orderNumber,
        detail: "ข้อมูลการซื้อสินค้าตามบิล",
        cardNumber: sale.cardNumber,
        paymentMethod: sale.paymentMethod,
        amount: 0,
        balanceAfter: null,
        purchase: purchases.get(sale.orderNumber)!,
      });
    }
    entries.sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) ||
        (a.kind === b.kind ? a.id - b.id : a.kind === "wallet" ? -1 : 1)
    );
    const { balance: _, ...publicMember } = member;
    const result: MemberStatement = {
      member: publicMember,
      from,
      to,
      openingBalance: opening / 100,
      closingBalance: closing / 100,
      incoming: incoming / 100,
      outgoing: outgoing / 100,
      ledgerCount,
      purchaseCount: sales.length,
      purchaseTotal:
        sales
          .filter(s => !s.voided)
          .reduce((sum, s) => sum + cents(s.total), 0) / 100,
      entries,
    };
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
