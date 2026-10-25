import { StoreError } from "../domain/storeError";
import type { SqliteDb } from "../sqliteStore";
import type { CheckoutReceipt } from "../../shared/storeTypes/sales";
import type { CheckoutRepository } from "./checkoutRepository";
import type { PaymentUnitOfWork } from "./memberLedgerRepository";
import {
  setMemberBalance,
  insertMemberTransaction,
} from "./sqliteMemberLedger";

export type SqliteCheckoutDelegates = Pick<
  CheckoutRepository,
  | "findTerminal"
  | "findProduct"
  | "requireUsableMember"
  | "nextOrderNumber"
  | "deductLots"
  | "recordMovement"
  | "appendAudit"
> & { transaction<T>(work: () => T): T };

export function createSqliteCheckoutRepository(
  db: SqliteDb,
  delegates: SqliteCheckoutDelegates,
): PaymentUnitOfWork<CheckoutRepository> {
  let itemInsert: ReturnType<SqliteDb["prepare"]> | undefined;
  const repository: CheckoutRepository = {
    findCheckoutByRequestId: (requestId) =>
      findCheckoutByRequestId(db, requestId),
    saveCheckoutReceipt: (saleId, receipt) => {
      db.prepare("UPDATE sales SET receipt_snapshot = ? WHERE id = ?").run(JSON.stringify(receipt), saleId);
    },
    findTerminal: delegates.findTerminal,
    findProduct: delegates.findProduct,
    requireUsableMember: delegates.requireUsableMember,
    nextOrderNumber: delegates.nextOrderNumber,
    deductLots: delegates.deductLots,
    recordMovement: delegates.recordMovement,
    appendAudit: delegates.appendAudit,
    setMemberBalance: (memberNumber, balance) =>
      setMemberBalance(db, memberNumber, balance),
    insertMemberTransaction: (input) => insertMemberTransaction(db, input),
    insertSale(input) {
      const result = db
        .prepare(
          `INSERT INTO sales (order_number, payment_method, member_number, subtotal, discount, total, cashier, created_at, slip_url, client_request_id, received_cash, change_due, payment_verified, terminal_id, terminal_number, request_fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.orderNumber,
          input.paymentMethod,
          input.memberNumber,
          input.subtotal,
          input.discount,
          input.total,
          input.cashier,
          input.createdAt,
          input.slipImage,
          input.clientRequestId,
          input.receivedCash ?? null,
          input.changeDue ?? null,
          input.paymentVerified == null ? null : input.paymentVerified ? 1 : 0,
          input.terminalId ?? null,
          input.terminalNumber ?? null,
          input.requestFingerprint,
        );
      return Number(result.lastInsertRowid);
    },
    insertSaleItem(saleId, item) {
      itemInsert ??= db.prepare(
        "INSERT INTO sale_items (sale_id, product_id, name, qty, price, cost, unit, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      );
      return Number(
        itemInsert.run(
          saleId,
          item.productId,
          item.name,
          item.qty,
          item.price,
          item.cost,
          item.unit,
          item.amount,
        ).lastInsertRowid,
      );
    },
    decreaseStock(productId, quantity) {
      db.prepare("UPDATE products SET stock = stock - ? WHERE id = ?").run(
        quantity,
        productId,
      );
    },
    hasValuedLots: (productId) =>
      Boolean(
        db
          .prepare(
            "SELECT 1 FROM stock_lots WHERE product_id = ? AND received_value_satang IS NOT NULL",
          )
          .get(productId),
      ),
    setSaleItemCost(saleItemId, costSatang) {
      db.prepare(
        "UPDATE sale_items SET cost_total_satang = ? WHERE id = ?",
      ).run(costSatang, saleItemId);
    },
  };
  return {
    transaction: (work) => delegates.transaction(() => work(repository)),
  };
}
function findCheckoutByRequestId(
  db: SqliteDb,
  requestId: string,
): ReturnType<CheckoutRepository["findCheckoutByRequestId"]> {
  const existing = db
    .prepare(
      `SELECT request_fingerprint AS requestFingerprint, receipt_snapshot AS receiptSnapshot, COALESCE(voided, 0) AS voided, id, order_number AS orderNumber, created_at AS createdAt, subtotal, discount, total, payment_method AS paymentMethod, member_number AS memberNumber, cashier, terminal_id AS terminalId, terminal_number AS terminalNumber, received_cash AS receivedCash, change_due AS changeDue, payment_verified AS paymentVerified FROM sales WHERE client_request_id = ? LIMIT 1`,
    )
    .get(requestId) as
    | {
        requestFingerprint: string | null;
        receiptSnapshot: string | null;
        voided: number;
        terminalId: string | null;
        terminalNumber: number | null;
        id: number;
        orderNumber: string;
        createdAt: string;
        subtotal: number;
        discount: number;
        total: number;
        paymentMethod: string;
        memberNumber: string | null;
        cashier: string | null;
        receivedCash: number | null;
        changeDue: number | null;
        paymentVerified: number | null;
      }
    | undefined;
  if (existing) {
    if (existing.receiptSnapshot) {
      let receipt: CheckoutReceipt;
      try {
        receipt = JSON.parse(existing.receiptSnapshot) as CheckoutReceipt;
        if (receipt.orderNumber !== existing.orderNumber || !Array.isArray(receipt.items)) throw new Error("Invalid snapshot");
      } catch { throw new StoreError("ข้อมูลบิลเดิมไม่สมบูรณ์ กรุณาตรวจสอบประวัติบิลก่อนชำระอีกครั้ง"); }
      return { receipt, requestFingerprint: existing.requestFingerprint, voided: existing.voided === 1 };
    }
    const itemRows = db
      .prepare(
        `SELECT product_id AS productId, name, COALESCE(unit, 'ชิ้น') AS unit, qty, price, COALESCE(amount, ROUND(qty * price, 2)) AS amount FROM sale_items WHERE sale_id = ?`,
      )
      .all(existing.id) as {
      productId: number | null;
      name: string;
      unit: string;
      qty: number;
      price: number;
      amount: number;
    }[];
    // Reconstruct legacy receipts for diagnosis. A public retry cannot trust
    // an old key without its original request fingerprint.
    let memberName: string | null = null;
    let balanceAfter: number | null = null;
    if (existing.memberNumber) {
      const memberRow = db
        .prepare(
          `SELECT prename, first_name, last_name FROM members WHERE member_number = ?`,
        )
        .get(existing.memberNumber) as
        | { prename: string | null; first_name: string; last_name: string }
        | undefined;
      if (memberRow) {
        memberName =
          [memberRow.prename, memberRow.first_name, memberRow.last_name]
            .filter(Boolean)
            .join(" ")
            .trim() || null;
      }
      const balanceRow = db
        .prepare(
          `SELECT balance_after AS balanceAfter FROM member_transactions WHERE member_number = ? AND detail LIKE ? ORDER BY id DESC LIMIT 1`,
        )
        .get(existing.memberNumber, `บิล #${existing.orderNumber} ·%`) as
        { balanceAfter: number | null } | undefined;
      balanceAfter = balanceRow?.balanceAfter ?? null;
    }
    return { requestFingerprint: existing.requestFingerprint, voided: existing.voided === 1, receipt: {
      orderNumber: existing.orderNumber,
      createdAt: existing.createdAt,
      items: itemRows,
      subtotal: existing.subtotal,
      discount: existing.discount,
      total: existing.total,
      paymentMethod: existing.paymentMethod,
      memberNumber: existing.memberNumber,
      memberName,
      balanceAfter,
      cashier: existing.cashier,
      terminalId: existing.terminalId,
      terminalNumber: existing.terminalNumber,
      // FIX-7 — replay ยอดเงินสด/ทอน และ flag ยืนยันด้วย (null/undefined สำหรับบิลเก่า)
      receivedCash: existing.receivedCash ?? null,
      changeDue: existing.changeDue ?? null,
      paymentVerified:
        existing.paymentVerified === 1
          ? true
          : existing.paymentVerified === 0
            ? false
            : null,
    } };
  }
}
