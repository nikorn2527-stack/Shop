import { getRuntimePolicy } from "../runtimePolicy";
import type { Product } from "../../shared/storeTypes/inventory";
import type { Member } from "../../shared/storeTypes/members";
import type {
  CheckoutInput,
  CheckoutReceipt,
} from "../../shared/storeTypes/sales";
import { PAYMENT_METHODS } from "../../shared/storeTypes/sales";
import type { CheckoutRepository } from "../repositories/checkoutRepository";
import type {
  PaymentRuntime,
  PaymentUnitOfWork,
} from "../repositories/memberLedgerRepository";
import { StoreError } from "../domain/storeError";
import { money, round2 } from "../domain/money";

import { checkoutRequestFingerprint } from "../domain/checkoutRequest";
import { catalogLinePricing } from "../domain/checkoutPricing";

const WALLET_PAYMENT = "หักบัญชีสมาชิก";

function summarizeItems(items: { name: string; qty: number; unit: string }[]) {
  const head = items
    .slice(0, 3)
    .map((item) => `${item.name} ${item.qty} ${item.unit}`)
    .join(", ");
  return items.length > 3 ? `${head} และอีก ${items.length - 3} รายการ` : head;
}

export function checkoutInTransaction(
  repository: CheckoutRepository,
  input: CheckoutInput,
  runtime: PaymentRuntime,
): CheckoutReceipt {
  // P2-b (idempotency) — short-circuit a retried submit BEFORE touching stock
  // or wallet balance. The client is expected to send the SAME clientRequestId
  // for every retry of one logical checkout. We replay the original receipt
  // (items + totals + balanceAfter) so the UI shows the same slip again.
  const requestFingerprint = input.clientRequestId ? checkoutRequestFingerprint(input) : null;
  if (input.clientRequestId) {
    const existing = repository.findCheckoutByRequestId(input.clientRequestId);
    if (existing) {
      if (existing.voided) throw new StoreError(`บิล ${existing.receipt.orderNumber} ถูกยกเลิกแล้ว กรุณาตรวจสอบประวัติบิลก่อนทำรายการใหม่`);
      if (!existing.requestFingerprint) throw new StoreError(`พบรายการเดิม ${existing.receipt.orderNumber} แต่ยืนยันข้อมูลคำขอเก่าไม่ได้ กรุณาตรวจสอบประวัติบิลก่อนชำระซ้ำ`);
      if (existing.requestFingerprint !== requestFingerprint) throw new StoreError(`รหัสคำขอนี้ใช้กับบิล ${existing.receipt.orderNumber} แล้ว แต่ข้อมูลเปลี่ยนไป กรุณาตรวจสอบประวัติบิลก่อนทำรายการใหม่`);
      return existing.receipt;
    }
  }
  const policy = getRuntimePolicy();
  if (policy.channel === "windows-final" && !input.terminalDeviceId)
    throw new StoreError("กรุณากำหนดจุดขายก่อนชำระเงิน");
  const terminal =
    input.terminalDeviceId === undefined
      ? null
      : repository.findTerminal(input.terminalDeviceId);
  if (policy.requirePosRegistration && input.terminalDeviceId !== undefined && !terminal)
    throw new StoreError(
      "เครื่องนี้ยังไม่ได้กำหนดจุดขาย กรุณาให้ผู้บริหารตั้งค่าจุดขายก่อนชำระเงิน",
    );
  if (!input.items?.length) throw new StoreError("ยังไม่มีสินค้าในบิล");
  if (!PAYMENT_METHODS.includes(input.paymentMethod))
    throw new StoreError("วิธีชำระเงินไม่ถูกต้อง");
  // Catalog lines merge by productId+price+label (round 31-12: money-mode
  // tiers of the same product stay separate lines — น้ำแข็ง ฿1 / ฿5 / ฿10);
  // special ("รายการพิเศษ") lines merge by lowercased name+price+unit.
  type MergedLine = {
    productId: number;
    qty: number;
    price?: number;
    unit?: string;
    label?: string;
  };
  const merged = new Map<string, MergedLine>();
  const specials = new Map<
    string,
    { name: string; price: number; qty: number; unit: string }
  >();
  for (const item of input.items) {
    if (!Number.isSafeInteger(item.qty) || item.qty <= 0)
      throw new StoreError("จำนวนต้องมากกว่า 0");
    if ("productId" in item) {
      if (!Number.isInteger(item.productId) || item.productId <= 0)
        throw new StoreError("รหัสสินค้าไม่ถูกต้อง");
      const unitPrice =
        item.price !== undefined
          ? Math.round(item.price * 10000) / 10000
          : undefined;
      const key = `${item.productId}|${unitPrice ?? ""}|${item.label ?? ""}`;
      const existing = merged.get(key);
      merged.set(key, {
        productId: item.productId,
        qty: (existing?.qty ?? 0) + item.qty,
        price: unitPrice,
        unit: item.unit,
        label: item.label,
      });
    } else {
      const name = item.name.trim();
      if (!name) throw new StoreError("กรุณาระบุชื่อรายการพิเศษ");
      if (!Number.isFinite(item.price) || !(item.price > 0))
        throw new StoreError("ราคารายการพิเศษต้องมากกว่า 0");
      const unit = item.unit?.trim() || "รายการ";
      const key = `${name.toLowerCase()}|${item.price}|${unit}`;
      const existing = specials.get(key);
      specials.set(key, {
        name,
        price: item.price,
        qty: (existing?.qty ?? 0) + item.qty,
        unit,
      });
    }
  }
  const isWallet = input.paymentMethod === WALLET_PAYMENT;
  if (isWallet && !input.memberNumber?.trim())
    throw new StoreError("กรุณาเลือกสมาชิกก่อนชำระแบบหักบัญชีสมาชิก");

  const products = new Map<number, Product>();
  const qtyByProduct = new Map<number, number>();
  for (const line of Array.from(merged.values())) {
    qtyByProduct.set(
      line.productId,
      (qtyByProduct.get(line.productId) ?? 0) + line.qty,
    );
  }
  for (const [productId, totalQty] of Array.from(qtyByProduct.entries())) {
    const product = repository.findProduct(productId);
    if (!product || !product.active)
      throw new StoreError(`ไม่พบสินค้ารหัส ${productId} ในระบบ`);
    if (product.stock < totalQty)
      throw new StoreError(
        `สต็อกไม่พอ · ${product.name} เหลือ ${product.stock} ${product.unit}`,
      );
    products.set(productId, product);
  }

  const items: {
    productId: number | null;
    name: string;
    unit: string;
    qty: number;
    price: number;
    cost: number;
    amount: number;
  }[] = [
    ...Array.from(merged.values()).map((line) => {
      const product = products.get(line.productId)!;
      const pricing = catalogLinePricing(product, line);
      return {
        productId: line.productId,
        name: pricing.name,
        unit: pricing.unit,
        qty: line.qty,
        price: pricing.price,
        cost: product.cost,
        amount: pricing.amount,
      };
    }),
    ...Array.from(specials.values()).map((special) => ({
      ...special,
      productId: null,
      cost: 0,
      amount: round2(special.price * special.qty),
    })),
  ];
  const subtotal = round2(items.reduce((sum, item) => sum + item.amount, 0));
  if (!Number.isFinite(subtotal) || !Number.isFinite(input.discount ?? 0) || (input.discount ?? 0) < 0)
    throw new StoreError("ยอดรวมสินค้าหรือส่วนลดไม่ถูกต้อง");
  const discount = round2(input.discount ?? 0);
  if (discount > subtotal) throw new StoreError("ส่วนลดมากกว่ายอดรวมสินค้า");
  const total = round2(subtotal - discount);
  // Legacy internal callers may omit cash details. The public API requires them.
  const receivedCash = input.paymentMethod === "เงินสด" && input.receivedCash != null
    ? round2(input.receivedCash) : null;
  if (receivedCash !== null && (!Number.isFinite(receivedCash) || receivedCash < total || receivedCash < 0))
    throw new StoreError("ยอดรับเงินสดไม่เพียงพอหรือไม่ถูกต้อง");
  const changeDue = receivedCash === null ? null : round2(receivedCash - total);

  let member: Member | undefined;
  if (input.memberNumber?.trim())
    member = repository.requireUsableMember(input.memberNumber);
  if (isWallet && member) {
    if (member.balance < total)
      throw new StoreError(
        `ยอดเงินคงเหลือไม่พอ · ยอดชำระ ${money(total)} คงเหลือ ${money(member.balance)}`,
      );
  }

  const now = runtime.now();
  const createdAt = runtime.formatDateTime(now);
  const orderNumber = repository.nextOrderNumber(now);
  const cashier = input.cashier?.trim() || "เจ้าหน้าที่ร้านค้า";
  // ROUND 63 — แนบหลักฐานการชำระไปกับบิล (ส่วนใหญ่คือสลิป QR / สแกน) · จำกัดความยาวกัน URL ผิดปกติ
  const slipImage =
    typeof input.slipImage === "string" &&
    input.slipImage.startsWith("data:image/")
      ? input.slipImage.slice(0, 600_000)
      : null;

  const saleId = repository.insertSale({
    orderNumber,
    paymentMethod: input.paymentMethod,
    memberNumber: member?.memberNumber ?? (input.memberNumber?.trim() || null),
    subtotal,
    discount,
    total,
    cashier,
    createdAt,
    slipImage,
    clientRequestId: input.clientRequestId ?? null,
    requestFingerprint,
    receivedCash,
    changeDue,
    paymentVerified:
      input.paymentMethod === "QR / สแกน" ? !!input.paymentVerified : null,
    terminalId: terminal?.id ?? null,
    terminalNumber: terminal?.number ?? null,
  });
  const lotShortfalls: { name: string; unit: string; qty: number }[] = [];
  for (const item of items) {
    const saleItemId = repository.insertSaleItem(saleId, item);
    if (item.productId == null) continue; // รายการพิเศษ — no product/stock row behind it
    repository.decreaseStock(item.productId, item.qty);
    repository.recordMovement({
      type: "SALE",
      productId: item.productId,
      qtyDelta: -item.qty,
      unitCost: item.cost,
      refType: "sale",
      refId: saleId,
      reason: `บิล ${orderNumber}`,
      actor: input.cashier?.trim() || undefined,
      actorRole: input.actorRole ?? undefined,
    });
    const allocation = repository.deductLots(
      item.productId,
      item.qty,
      saleItemId,
    );
    const shortfall = allocation.shortfall;
    if (shortfall > 0 && repository.hasValuedLots(item.productId)) {
      throw new StoreError("จำนวนในล็อตไม่ตรงกับสต็อก กรุณาตรวจสอบล็อตก่อนขาย");
    }
    const costSatang =
      allocation.costSatang + Math.round(shortfall * item.cost * 100);
    repository.setSaleItemCost(saleItemId, costSatang);
    if (shortfall > 0)
      lotShortfalls.push({ name: item.name, unit: item.unit, qty: shortfall });
  }

  let balanceAfter: number | null = null;
  if (isWallet && member) {
    balanceAfter = round2(member.balance - total);
    repository.setMemberBalance(member.memberNumber, balanceAfter);
    repository.insertMemberTransaction({
      memberNumber: member.memberNumber,
      type: "purchase",
      detail: `บิล #${orderNumber} · ${summarizeItems(items)}`,
      amount: -total,
      paymentMethod: input.paymentMethod,
      balanceAfter,
      actor: cashier,
      createdAt,
      slipImage: null,
      clientRequestId: null,
    });
  } else if (member) {
    // Cash / QR member bill — snapshot the untouched balance for the slip.
    balanceAfter = round2(member.balance);
  }

  const lotNote = lotShortfalls.length
    ? ` · ตัดยอด Lot ไม่ครบ: ${lotShortfalls.map((row) => `${row.name} ${row.qty} ${row.unit}`).join(", ")} (แนะนำนับสต็อกแยกล็อต)`
    : "";
  repository.appendAudit({
    action: "ขายสินค้า",
    actor: cashier,
    detail: `บิล #${orderNumber} · ${money(total)}${member ? ` · หักบัญชี ${member.memberNumber}` : ""}${slipImage ? " · แนบหลักฐานการชำระแล้ว" : ""}${lotNote}`,
    tone: "blue",
    actorRole: input.actorRole ?? null,
    createdAt,
  });

  const receipt: CheckoutReceipt = {
    orderNumber,
    createdAt,
    items: items.map(({ productId, name, unit, qty, price, amount }) => ({
      productId,
      name,
      unit,
      qty,
      price,
      amount,
    })),
    subtotal,
    discount,
    total,
    paymentMethod: input.paymentMethod,
    memberNumber: member?.memberNumber ?? null,
    memberName: member
      ? [member.prename, member.firstName, member.lastName]
          .filter(Boolean)
          .join(" ")
      : null,
    balanceAfter,
    cashier,
    terminalId: terminal?.id ?? null,
    terminalNumber: terminal?.number ?? null,
    // FIX-7 — ส่งยอดเงินสด/ทอน และ flag ยืนยันกลับไปแสดงในใบเสร็จ
    receivedCash,
    changeDue,
    paymentVerified:
      input.paymentMethod === "QR / สแกน" ? !!input.paymentVerified : null,
  };
  if (input.clientRequestId) repository.saveCheckoutReceipt(saleId, receipt);
  return receipt;
}

export function checkout(
  unitOfWork: PaymentUnitOfWork<CheckoutRepository>,
  input: CheckoutInput,
  runtime: PaymentRuntime,
): CheckoutReceipt {
  return unitOfWork.transaction((repository) =>
    checkoutInTransaction(repository, input, runtime),
  );
}
