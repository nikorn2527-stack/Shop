import { receiptPriceInsight } from "@/lib/receiptPriceInsight";
import { useState } from "react";
import { StockReceiptSourceDialog } from "./StockReceiptSourceDialog";

type Pricing = {
  previousCost: number | null;
  previousLot?: string | null;
  previousReceivedAt?: string | null;
  previousReceipt?: { id: number; reference: string } | null;
  sellingPrice: number;
  highestRemainingCost: number | null;
  unknownRemainingQty: number;
};
export function ReceivePriceInsight({
  name,
  unit,
  draft,
  pricing,
  catalogCost,
  currentSellingPrice,
  loading,
  error,
  newProduct = false,
}: {
  name: string;
  unit: string;
  draft: {
    purchaseQty: string;
    freeQty: string;
    paidAmount: string;
    sellingPrice: string;
  };
  pricing?: Pricing;
  catalogCost?: number;
  currentSellingPrice?: number;
  loading: boolean;
  error: boolean;
  newProduct?: boolean;
}) {
  const [sourceId, setSourceId] = useState<number | null>(null);
  const insight = receiptPriceInsight({
    ...draft,
    currentSellingPrice: newProduct
      ? undefined
      : (pricing?.sellingPrice ?? currentSellingPrice),
    previousCost: pricing?.previousCost,
  });
  const amount = (value: number, digits = 4) =>
    `฿${value.toLocaleString("th-TH", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  const signed = (value: number, digits = 4) =>
    `${value > 0 ? "+" : value < 0 ? "−" : ""}${amount(Math.abs(value), digits)}`;
  const receivedDate = pricing?.previousReceivedAt?.match(
    /^(\d{4})-(\d{2})-(\d{2})/
  );
  const dateLabel = receivedDate
    ? `${receivedDate[3]}/${receivedDate[2]}/${Number(receivedDate[1]) + 543}`
    : null;
  return (
    <section className="receive-price-insight" aria-label="ช่วยตั้งราคาขาย">
      <div className="receive-insight-heading">
        <div>
          <h3>ช่วยตั้งราคาขาย</h3>
          <p>{name || "สินค้าใหม่ที่กำลังกรอก"}</p>
        </div>
        <span>{newProduct ? "สินค้าใหม่" : "ข้อมูลก่อนบันทึก"}</span>
      </div>
      <div className="receive-insight-grid">
        <div className="receive-insight-previous">
          <small>ต้นทุนรับเข้ารอบก่อน / {unit}</small>
          <strong>
            {newProduct
              ? "สินค้าใหม่"
              : loading
                ? "กำลังโหลด…"
                : error
                  ? "โหลดข้อมูลไม่สำเร็จ"
                  : pricing?.previousCost == null
                    ? "ยังไม่มีประวัติต้นทุน"
                    : amount(pricing.previousCost)}
          </strong>
          {!newProduct &&
            !loading &&
            !error &&
            pricing?.previousCost != null && (
              <span>
                {dateLabel ? `รับเข้า ${dateLabel}` : "รับเข้าครั้งล่าสุด"}
                {pricing.previousLot ? ` · Lot ${pricing.previousLot}` : ""}
              </span>
            )}
          {!newProduct && !loading && !error && pricing?.previousReceipt && (
            <button type="button" className="receive-source-link" onClick={() => setSourceId(pricing.previousReceipt!.id)}>
              อ้างอิงรับเข้า {pricing.previousReceipt.reference} · ดูรายละเอียด
            </button>
          )}
          {!newProduct &&
            !loading &&
            !error &&
            pricing?.previousCost == null &&
            catalogCost !== undefined &&
            catalogCost > 0 && (
              <span>
                ต้นทุนในข้อมูลสินค้า {amount(catalogCost)} ·
                ยังไม่มีต้นทุนจากรอบรับเข้า
              </span>
            )}
        </div>
        <div className="receive-insight-current">
          <small>ต้นทุนรอบนี้ / {unit}</small>
          <strong>{insight.cost === null ? "—" : amount(insight.cost)}</strong>
          <span>
            {insight.delta !== null && !newProduct && !loading && !error ? (
              <>
                เทียบรอบก่อน {signed(insight.delta)}
                {insight.changePercent !== null
                  ? ` (${insight.changePercent > 0 ? "+" : ""}${insight.changePercent.toFixed(1)}%)`
                  : ""}
              </>
            ) : (
              "ยอดจ่าย ÷ (จำนวนซื้อ + จำนวนแถม)"
            )}
          </span>
        </div>
        <div className="receive-insight-selling" data-loss={(insight.grossProfit !== null && insight.grossProfit < 0) || undefined}>
          <small>ราคาขายที่จะใช้ / {unit}</small>
          <strong>
            {insight.price === null ? "—" : amount(insight.price, 2)}
          </strong>
          <span className="receive-current-selling-price">
            {!newProduct && currentSellingPrice !== undefined
              ? `ราคาขายปัจจุบัน ${amount(pricing?.sellingPrice ?? currentSellingPrice, 2)}`
              : "กำหนดราคาขายที่ช่องด้านซ้าย"}
          </span>
        </div>
      </div>
      <div
        className="receive-insight-margin"
        data-loss={
          (insight.grossProfit !== null && insight.grossProfit < 0) || undefined
        }
        aria-live="polite"
      >
        <span>
          กำไรขั้นต้น / {unit}{" "}
          <b>
            {insight.grossProfit === null
              ? "—"
              : signed(insight.grossProfit, 2)}
          </b>
        </span>
        <span>
          อัตรากำไรขั้นต้น{" "}
          <b>
            {insight.grossMargin === null
              ? "—"
              : `${insight.grossMargin.toFixed(1)}%`}
          </b>
        </span>
      </div>
      <small className="receive-insight-note">
        คำนวณจากต้นทุนรอบนี้ ยังไม่หักค่าใช้จ่ายอื่น
        {!newProduct && pricing?.unknownRemainingQty
          ? ` · ของเดิมไม่ทราบต้นทุน ${pricing.unknownRemainingQty} ${unit}`
          : ""}
      </small>
      {insight.grossProfit !== null && insight.grossProfit < 0 && (
        <p className="receive-price-warning" role="status">
          ราคาขายต่ำกว่าต้นทุนรอบนี้ ตรวจราคาก่อนเพิ่มลงรายการ
        </p>
      )}
      {sourceId !== null && <StockReceiptSourceDialog lotId={sourceId} onClose={() => setSourceId(null)} />}
    </section>
  );
}
