import type { Product } from "@shared/storeTypes/inventory";
export type LabelProduct = Pick<Product, "id" | "name" | "sku" | "barcode" | "price" | "sellMode"> & { active?: number };
export const LABEL_FORMATS = {
  a4: { title: "A4 · 63 × 38 มม. · 21 ใบ", width: 63, height: 38, perPage: 21 },
  "58": { title: "ฉลากม้วน 58 × 40 มม.", width: 58, height: 40, perPage: 1 },
  "80": { title: "ฉลากม้วน 80 × 40 มม.", width: 80, height: 40, perPage: 1 },
} as const;
export type LabelFormat = keyof typeof LABEL_FORMATS;
export const MAX_PRODUCT_LABELS = 500;
export function productLabelCode(product: LabelProduct) {
  return product.barcode?.trim() || product.sku.trim();
}
export function barcodeWidthMm(code: string) {
  // Code128-B, including 10-module quiet zones per side; >=2 dots/module at 203dpi.
  return (55 + 11 * code.length) * 2 * 25.4 / 203;
}
export function productLabelIssue(product: LabelProduct, products: LabelProduct[], format: LabelFormat): string | null {
  const code = productLabelCode(product);
  if (!code || !/^[\x21-\x7e]+$/.test(code)) return "รหัสต้องเป็นตัวเลขหรืออักษรอังกฤษ ไม่มีช่องว่าง";
  // POS searches both barcode and SKU; a printed identifier must resolve to one product.
  if (products.some(other => other.id !== product.id && [other.barcode?.trim().toLowerCase(), other.sku.trim().toLowerCase()].includes(code.toLowerCase()))) return "รหัสตรงกับบาร์โค้ดหรือ SKU ของสินค้าอื่น กรุณาแก้รหัสก่อนพิมพ์";
  if (barcodeWidthMm(code) > LABEL_FORMATS[format].width - 4) return "รหัสยาวเกินพื้นที่ฉลาก กรุณาเลือกขนาดกว้างขึ้น";
  return null;
}
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
export type PrintableProductLabel = { product: LabelProduct; quantity: number; image: string };
export function buildProductLabelsHtml(rows: PrintableProductLabel[], format: LabelFormat, showPrice: boolean) {
  const spec = LABEL_FORMATS[format];
  const total = rows.reduce((sum, row) => sum + row.quantity, 0);
  if (total < 1 || total > MAX_PRODUCT_LABELS || rows.some(row => !Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 100 || !/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(row.image))) throw new Error("เลือกจำนวนฉลาก 1–100 ใบต่อสินค้า รวมไม่เกิน 500 ใบ");
  const labels = rows.flatMap(row => Array.from({ length: row.quantity }, () => {
    const code = productLabelCode(row.product);
    if (!/^[\x21-\x7e]+$/.test(code) || barcodeWidthMm(code) > spec.width - 4) throw new Error("รหัสไม่เหมาะกับพื้นที่พิมพ์");
    const price = row.product.sellMode === "money" ? "เลือกช่วงราคาที่ POS" : row.product.price > 0 ? `฿${row.product.price.toFixed(2)}` : "ยังไม่ตั้งราคา";
    return `<article class="label"><b>${escape(row.product.name)}</b><img alt="" src="${row.image}" style="width:${barcodeWidthMm(code)}mm"><span>${escape(code)}</span>${showPrice ? `<strong>${escape(price)}</strong>` : ""}</article>`;
  }));
  const pages = [];
  for (let i = 0; i < labels.length; i += spec.perPage) pages.push(`<section class="sheet">${labels.slice(i, i + spec.perPage).join("")}</section>`);
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>ฉลากสินค้า</title><style>
  @page{size:${format === "a4" ? "A4" : `${spec.width}mm ${spec.height}mm`};margin:${format === "a4" ? "8mm" : "0"}}
  *{box-sizing:border-box}body{margin:0;color:#111;background:#fff;font-family:Tahoma,Arial,sans-serif}
  .sheet{display:grid;grid-template-columns:repeat(${format === "a4" ? 3 : 1},${spec.width}mm);gap:${format === "a4" ? "2mm" : "0"};break-after:page}.sheet:last-child{break-after:auto}
  .label{width:${spec.width}mm;height:${spec.height}mm;padding:2mm;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1mm;overflow:hidden;break-inside:avoid;text-align:center}
  b{font-size:10pt;line-height:1.25;max-height:9mm;overflow:hidden;max-width:100%;overflow-wrap:anywhere}
  img{display:block;height:12mm;max-width:none;flex-shrink:0;image-rendering:pixelated}span{font:9pt monospace}strong{font-size:11pt;line-height:1.2}
  </style></head><body>${pages.join("")}</body></html>`;
}
