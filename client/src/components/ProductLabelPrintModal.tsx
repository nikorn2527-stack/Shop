import { useMemo, useState } from "react";
import { Printer, X } from "@/lib/icons";
import { code128DataUrl } from "@/barcode";
import { printHtmlDocument } from "@/lib/printHelper";
import { barcodeWidthMm, buildProductLabelsHtml, LABEL_FORMATS, MAX_PRODUCT_LABELS, productLabelCode, productLabelIssue, type LabelFormat, type LabelProduct } from "@/lib/productLabels";
import { WorkflowDialog } from "./WorkflowDialog";

export function ProductLabelPrintModal({ products, onClose }: { products: LabelProduct[]; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [format, setFormat] = useState<LabelFormat>("a4");
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [showPrice, setShowPrice] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const printableProducts = useMemo(() => products.filter(product => product.id > 0 && product.active !== 0), [products]);
  const visible = printableProducts.filter(product => `${product.name} ${product.sku} ${product.barcode ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  const selected = printableProducts.filter(product => quantities[product.id] > 0);
  const total = selected.reduce((sum, product) => sum + quantities[product.id], 0);
  const issues = useMemo(() => new Map(printableProducts.map(product => [product.id, productLabelIssue(product, products, format)])), [products, printableProducts, format]);
  const invalid = selected.find(product => issues.get(product.id));
  const images = useMemo(() => new Map(selected.map(product => [product.id, /^[\x21-\x7e]+$/.test(productLabelCode(product)) ? code128DataUrl(productLabelCode(product), { moduleWidth: 2, padding: 20, height: 96, showLabel: false }) : ""])), [products, quantities]);
  const first = selected[0];
  const change = (id: number, quantity: number) => { setQuantities(current => ({ ...current, [id]: Math.max(0, Math.min(100, Math.trunc(quantity) || 0)) })); setError(""); setMessage(""); };
  const print = async () => {
    if (busy || invalid || total < 1 || total > MAX_PRODUCT_LABELS) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await printHtmlDocument(buildProductLabelsHtml(selected.map(product => ({ product, quantity: quantities[product.id], image: images.get(product.id) || "" })), format, showPrice));
      setMessage("ปิดหน้าต่างพิมพ์แล้ว · ตรวจฉลากและลองสแกนก่อนพิมพ์จำนวนมาก");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "เตรียมฉลากไม่สำเร็จ"); }
    finally { setBusy(false); }
  };
  return <WorkflowDialog title="พิมพ์ฉลากสินค้า" description="เลือกสินค้า จำนวนใบ และขนาดฉลาก ก่อนเปิดหน้าต่างพิมพ์" onClose={onClose} busy={busy} className="form-modal product-label-modal">
    <header className="modal-heading"><h2>พิมพ์ฉลากสินค้า</h2><button className="icon-button" aria-label="ปิด" onClick={onClose} disabled={busy}><X size={18} /></button></header>
    <p className="product-label-hint">ใช้บาร์โค้ดเดิม หรือ SKU เมื่อไม่มีบาร์โค้ด · ไม่เปลี่ยนรหัสหรือสต็อกสินค้า</p>
    <div className="product-label-controls"><label>ขนาดกระดาษ<select aria-label="ขนาดกระดาษ" value={format} onChange={event => { setFormat(event.target.value as LabelFormat); setMessage(""); }} disabled={busy}>{Object.entries(LABEL_FORMATS).map(([value, spec]) => <option key={value} value={value}>{spec.title}</option>)}</select></label><label className="product-label-price"><input type="checkbox" checked={showPrice} onChange={event => setShowPrice(event.target.checked)} disabled={busy} />แสดงราคา</label></div>
    <label className="product-label-search">ค้นหาสินค้า<input placeholder="ชื่อ / SKU / บาร์โค้ด" value={search} onChange={event => setSearch(event.target.value)} disabled={busy} /></label>
    <div className="product-label-list" aria-label="สินค้าสำหรับพิมพ์ฉลาก">{visible.length === 0 ? <p>ไม่พบสินค้า</p> : visible.map(product => <div className="product-label-row" key={product.id}><label><input type="checkbox" aria-label={`เลือก ${product.name}`} checked={!!quantities[product.id]} onChange={event => change(product.id, event.target.checked ? 1 : 0)} disabled={busy} /><span><b>{product.name}</b><small>{productLabelCode(product) || "ยังไม่มีรหัส"}{!product.barcode && " · ใช้ SKU"}</small>{issues.get(product.id) && <small className="product-label-error">{issues.get(product.id)}</small>}</span></label><input type="number" min="0" max="100" inputMode="numeric" aria-label={`จำนวนฉลาก ${product.name}`} value={quantities[product.id] || 0} onChange={event => change(product.id, Number(event.target.value))} disabled={busy} /></div>)}</div>
    <div className="product-label-summary"><b>{selected.length} สินค้า / {total} ใบ</b><button type="button" className="outline-button compact" disabled={busy || !total} onClick={() => setQuantities({})}>ล้างที่เลือก</button></div>
    {first && <div className="product-label-preview" aria-label="ตัวอย่างฉลากใบแรก" style={{ width: `${LABEL_FORMATS[format].width}mm`, minHeight: `${LABEL_FORMATS[format].height}mm` }}><b>{first.name}</b>{images.get(first.id) && <img alt={`บาร์โค้ด ${productLabelCode(first)}`} src={images.get(first.id)} style={{ width: `${barcodeWidthMm(productLabelCode(first))}mm`, maxWidth: "100%" }} />}<code>{productLabelCode(first)}</code>{showPrice && <strong>{first.sellMode === "money" ? "เลือกช่วงราคาที่ POS" : first.price > 0 ? `฿${first.price.toFixed(2)}` : "ยังไม่ตั้งราคา"}</strong>}</div>}
    <p className="product-label-hint">พิมพ์ขนาดจริง 100% ปิดหัว/ท้ายกระดาษ · เลือกกระดาษตรงกับที่ตั้งไว้ และลองสแกนใบแรกก่อน</p>
    {(error || invalid || total > MAX_PRODUCT_LABELS) && <div className="notice-bar error" role="alert">{error || (invalid ? `${invalid.name}: ${issues.get(invalid.id)}` : "พิมพ์ได้ไม่เกิน 500 ใบต่อครั้ง")}</div>}
    {message && <div className="notice-bar" role="status">{message}</div>}
    <footer className="modal-actions modal-footer"><button className="outline-button" onClick={onClose} disabled={busy}>ปิด</button><button className="primary-button" disabled={busy || !!invalid || total < 1 || total > MAX_PRODUCT_LABELS} onClick={() => void print()}><Printer size={16} />{busy ? "กำลังเตรียมพิมพ์…" : `พิมพ์ ${total} ใบ`}</button></footer>
  </WorkflowDialog>;
}
