import type {
  ReceiveStockLinesInput,
  ReceiveStockLine,
  ReceiveStockResult,
  StockIntakeEntry,
} from "../../shared/storeTypes/inventory";
import type {
  StockIntakeRepository,
  StockIntakeRuntime,
  StockIntakeUnitOfWork,
} from "../repositories/stockIntakeRepository";
import { StoreError } from "../domain/storeError";
import { money, round2 } from "../domain/money";
import { allocateInventoryCost } from "../inventoryValuation";

/** Receive within the caller's existing transaction, including catalog creation. */
export function receiveStockLinesInTransaction(
  repository: StockIntakeRepository,
  input: ReceiveStockLinesInput,
  runtime: StockIntakeRuntime,
): ReceiveStockResult {
  const lines = (input.lines ?? []).filter(
    (line): line is ReceiveStockLine => line != null,
  );
  if (lines.length === 0)
    throw new StoreError("กรุณาระบุจำนวนที่รับเข้าอย่างน้อย 1 บรรทัด");
  for (const line of lines) {
    if (!Number.isInteger(line.qty) || line.qty <= 0)
      throw new StoreError("จำนวนต้องมากกว่า 0");
    if (line.cost !== undefined && !(line.cost >= 0))
      throw new StoreError("ต้นทุนต่อหน่วยต้องเป็นตัวเลข 0 ขึ้นไป");
  }
  const product = repository.findProduct(input.productId);
  if (!product || !product.active)
    throw new StoreError(`ไม่พบสินค้ารหัส ${input.productId} ในระบบ`);
  const parsed = lines.map((line) => ({
    qty: line.qty,
    cost: line.cost === undefined ? undefined : round2(line.cost),
  }));
  const totalQty = parsed.reduce((sum, line) => sum + line.qty, 0);
  const receiptValue =
    input.paidAmount === undefined
      ? Math.round(
          lines.reduce(
            (sum, line) => sum + line.qty * (line.cost ?? product.cost),
            0,
          ) * 100,
        )
      : Math.round(input.paidAmount * 100);
  if (!Number.isSafeInteger(receiptValue) || receiptValue < 0)
    throw new StoreError("มูลค่ารับเข้าไม่ถูกต้อง");
  const previousCost = product.cost;
  // บรรทัดที่ไม่ใส่ต้นทุน = ใช้ต้นทุนเฉลี่ยปัจจุบันของสินค้า (พฤติกรรมเดิม)
  const lineValue = receiptValue / 100;
  const oldQty = Math.max(0, Math.trunc(product.stock));
  const averageCost = round2(
    (oldQty * previousCost + lineValue) / (oldQty + totalQty),
  );
  let lotLabel = input.lot?.trim() || "";
  const createdAt = runtime.now();
  if (!lotLabel) {
    lotLabel = repository.nextLotNumber();
  }
  const receiptGroup = runtime.newReceiptGroup();
  let valueRemaining = BigInt(receiptValue);
  let qtyRemaining = totalQty;
  const lots = parsed.map((line) => {
    const allocation = allocateInventoryCost(
      valueRemaining,
      qtyRemaining,
      line.qty,
    );
    const value = Number(allocation.issuedValueSatang);
    valueRemaining = allocation.remainingValueSatang;
    qtyRemaining = allocation.remainingQuantity;
    return repository.insertLot({
      productId: input.productId,
      lot: lotLabel,
      expiry: input.expiryDate || null,
      qty: line.qty,
      cost: line.cost ?? previousCost,
      receivedAt: createdAt,
      receivedValueSatang: value,
      receiptGroup,
    });
  });
  repository.increaseStock(input.productId, totalQty, averageCost);
  for (const lot of lots) {
    repository.recordMovement({
      type: "RECEIVE",
      productId: input.productId,
      qtyDelta: lot.qty,
      unitCost: lot.cost,
      refType: "stock_lot",
      refId: lot.id,
      reason: `รับเข้า Lot ${lotLabel}`,
      actor: input.actor?.trim() || undefined,
      actorRole: input.actorRole ?? undefined,
    });
  }
  // Log: บรรทัดเดียวไม่ใส่ต้นทุน = ข้อความเดิม · มีต้นทุน/หลายบรรทัด = สรุปทุกบรรทัด + ต้นทุนเฉลี่ยใหม่
  const anyCost = parsed.some((line) => line.cost !== undefined);
  const lineSummary = anyCost
    ? ` · ${parsed.map((line) => `${line.qty}×${money(line.cost ?? previousCost)}${line.cost === 0 ? " แถม" : ""}`).join(" + ")}`
    : "";
  const avgSummary = anyCost
    ? ` · ต้นทุนเฉลี่ย ${money(averageCost)} (เดิม ${money(previousCost)})`
    : "";
  repository.appendAudit({
    action: "รับเข้าสินค้า",
    actor: input.actor?.trim() || "ระบบ",
    detail: `${product.name} · Lot ${lotLabel} · +${totalQty} ${product.unit}${lineSummary}${avgSummary}`,
    tone: "green",
    actorRole: input.actorRole ?? null,
    createdAt,
  });
  return {
    lots,
    lot: lots[0],
    product: repository.findProduct(input.productId)!,
    averageCost,
    previousCost,
  };
}

export function receiveStockLines(
  unitOfWork: StockIntakeUnitOfWork,
  input: ReceiveStockLinesInput,
  runtime: StockIntakeRuntime,
): ReceiveStockResult {
  return unitOfWork.transaction((repository) =>
    receiveStockLinesInTransaction(repository, input, runtime),
  );
}

/** Create catalog entries and receipts together, or roll back the entire intake. */
export function receiveStockBatch(
  unitOfWork: StockIntakeUnitOfWork,
  entries: StockIntakeEntry[],
  actor: string,
  actorRole: string | undefined,
  runtime: StockIntakeRuntime,
) {
  if (entries.length === 0 || entries.length > 200)
    throw new StoreError("จำนวนรายการรับเข้าต้องอยู่ระหว่าง 1–200 รายการ");
  return unitOfWork.transaction((repository) => {
    const changes = new Map<number, number>();
    for (const entry of entries)
      if (entry.sellingPrice !== undefined) {
        if (
          !entry.productId ||
          entry.newProduct ||
          !Number.isFinite(entry.sellingPrice) ||
          entry.sellingPrice < 0 ||
          entry.expectedSellingPrice === undefined ||
          !Number.isFinite(entry.expectedSellingPrice)
        )
          throw new StoreError("ข้อมูลปรับราคาขายไม่ถูกต้อง");
        const product = repository.findProduct(entry.productId);
        if (!product || product.price !== entry.expectedSellingPrice)
          throw new StoreError(
            "ราคาขายเปลี่ยนระหว่างทำรายการ กรุณาโหลดสินค้าใหม่และตรวจราคาก่อนยืนยัน",
          );
        if (product.sellMode === "money")
          throw new StoreError(
            "สินค้าขายตามช่องราคาต้องปรับราคาที่ข้อมูลสินค้า",
          );
        const price = round2(entry.sellingPrice);
        if (
          changes.has(entry.productId) &&
          changes.get(entry.productId) !== price
        )
          throw new StoreError(
            "สินค้าเดียวกันระบุราคาขายใหม่ไม่ตรงกัน กรุณาตรวจรายการรับเข้า",
          );
        changes.set(entry.productId, price);
      }
    const results = entries.map((entry) => {
      if (Boolean(entry.productId) === Boolean(entry.newProduct))
        throw new StoreError(
          "เลือกรายการสินค้าเดิมหรือสินค้าใหม่อย่างใดอย่างหนึ่ง",
        );
      if (
        !Number.isInteger(entry.purchaseQty) ||
        entry.purchaseQty <= 0 ||
        !Number.isInteger(entry.freeQty ?? 0) ||
        (entry.freeQty ?? 0) < 0 ||
        !Number.isFinite(entry.paidAmount) ||
        entry.paidAmount < 0
      )
        throw new StoreError("จำนวนรับเข้าหรือยอดจ่ายไม่ถูกต้อง");
      if (entry.newProduct?.stock)
        throw new StoreError("สินค้าใหม่ต้องไม่มีสต็อกตั้งต้นในรายการรับเข้า");
      if (
        entry.newProduct?.barcode?.trim() &&
        repository.hasBarcodeOrSku(entry.newProduct.barcode.trim())
      )
        throw new StoreError(
          "บาร์โค้ดนี้มีสินค้าอยู่แล้ว กรุณาเลือกสินค้าเดิม",
        );
      const productId = entry.newProduct
        ? repository.createProduct({
            ...entry.newProduct,
            stock: 0,
            actor,
            actorRole,
          }).id
        : entry.productId!;
      return receiveStockLinesInTransaction(
        repository,
        {
          productId,
          lot: entry.lot,
          expiryDate: entry.expiryDate,
          paidAmount: entry.paidAmount,
          actor,
          actorRole,
          lines: [
            {
              qty: entry.purchaseQty,
              cost: entry.paidAmount / entry.purchaseQty,
            },
            ...((entry.freeQty ?? 0) > 0
              ? [{ qty: entry.freeQty!, cost: 0 }]
              : []),
          ],
        },
        runtime,
      );
    });
    for (const [productId, price] of Array.from(changes)) {
      const product = repository.findProduct(productId)!;
      if (product.price !== price) {
        repository.setSellingPrice(productId, price);
        repository.appendAudit({
          action: "ปรับราคาขายตอนรับเข้า",
          actor,
          detail: `${product.sku} · ${product.name} · ${money(product.price)} → ${money(price)} · ใช้กับสินค้าคงเหลือทั้งหมด`,
          tone: "blue",
          actorRole: actorRole ?? null,
          createdAt: runtime.now(),
        });
      }
    }
    for (const result of results)
      if (changes.has(result.product.id))
        result.product = repository.findProduct(result.product.id)!;
    return results;
  });
}
