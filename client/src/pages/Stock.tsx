import { useState } from "react";
import { TRPCClientError } from "@trpc/client";
import {
  Activity, Boxes, Check, CircleAlert, ClipboardList, Download, FileBarChart, MoreHorizontal, PackagePlus, PackageSearch, Plus, SlidersHorizontal, X,
} from "lucide-react";
import type { Role } from "./pageData";
import { money } from "./pageData";
import { SectionHeader, StatusPill } from "./PagePrimitives";
import { trpc } from "@/lib/trpc";

function getErrorMessage(error: unknown) {
  if (error instanceof TRPCClientError) return error.message;
  return "เกิดข้อผิดพลาดในการเชื่อมต่อระบบ กรุณาลองอีกครั้ง";
}

/** "2027-08-18" → "18/08/2027" (null → ไม่ระบุ) */
function formatExpiry(value: string | null) {
  if (!value) return "ไม่ระบุ";
  const [year, month, day] = value.split("-");
  return day && month && year ? `${day}/${month}/${year}` : value;
}

const emptyNewItem = { name: "", sku: "", unit: "ชิ้น", price: "", reorder: "10" };
const emptyReceiveForm = { productId: "", lot: "", expiry: "", qty: "", cost: "" };

export function Stock({ role }: { role: Role }) {
  const utils = trpc.useUtils();
  const stockQuery = trpc.stock.rows.useQuery(undefined);
  const productsQuery = trpc.product.list.useQuery(undefined);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [newItem, setNewItem] = useState(emptyNewItem);
  const [receiveForm, setReceiveForm] = useState(emptyReceiveForm);
  const products = productsQuery.data ?? [];
  const stockRows = stockQuery.data ?? [];
  const actor = role === "admin" ? "วรพจน์ ด." : "กัญญาณัฐ พ.";
  const actorRole = role === "admin" ? "ผู้บริหาร" : "เจ้าหน้าที่";
  const inventoryValue = products.reduce((sum, product) => sum + product.stock * product.cost, 0);
  const lowStockCount = stockRows.filter((row) => row.status === "สต็อกต่ำ").length;
  const avgMargin = products.length === 0 ? 0 : products.reduce((sum, product) => sum + (product.price > 0 ? ((product.price - product.cost) / product.price) * 100 : 0), 0) / products.length;
  const updatedAt = stockQuery.dataUpdatedAt ? new Date(stockQuery.dataUpdatedAt) : null;
  const updatedLabel = updatedAt ? `${updatedAt.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" })} เวลา ${updatedAt.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })} น.` : "กำลังโหลดข้อมูล…";
  const refreshQueries = () => {
    void utils.product.list.invalidate();
    void utils.stock.rows.invalidate();
    void utils.dashboard.stats.invalidate();
  };
  const createMutation = trpc.product.create.useMutation({
    onSuccess: (product) => {
      setAddOpen(false);
      setNewItem(emptyNewItem);
      setError("");
      setNotice(`เพิ่มสินค้า ${product.name} เข้ารายการแล้ว · รหัส ${product.sku}`);
      refreshQueries();
    },
    onError: (mutationError) => setError(getErrorMessage(mutationError)),
  });
  const receiveMutation = trpc.stock.receive.useMutation({
    onSuccess: (result) => {
      setReceiveOpen(false);
      setReceiveForm(emptyReceiveForm);
      setError("");
      setNotice(`รับเข้าสินค้า ${result.product.name} แล้ว · Lot ${result.lot.lot} · +${result.lot.qty} ${result.product.unit} · คงเหลือ ${result.product.stock} ${result.product.unit}`);
      refreshQueries();
    },
    onError: (mutationError) => setError(getErrorMessage(mutationError)),
  });
  const addItem = () => {
    const name = newItem.name.trim();
    if (!name) { setError("กรุณาระบุชื่อสินค้า"); return; }
    const price = Number(newItem.price);
    if (!(price > 0)) { setError("ราคาขายต้องมากกว่า 0"); return; }
    setError("");
    createMutation.mutate({
      name,
      sku: newItem.sku.trim() || undefined,
      unit: newItem.unit,
      price,
      reorderPoint: Number(newItem.reorder) >= 0 ? Math.floor(Number(newItem.reorder)) : undefined,
      category: "ของใช้",
      emoji: "🛍️",
      color: "mint",
      actor,
      actorRole,
    });
  };
  const submitReceive = () => {
    const productId = Number(receiveForm.productId);
    if (!productId) { setError("กรุณาเลือกสินค้าที่ต้องการรับเข้า"); return; }
    const qty = Number(receiveForm.qty);
    if (!Number.isInteger(qty) || qty <= 0) { setError("กรุณาระบุจำนวนเป็นจำนวนเต็มมากกว่า 0"); return; }
    setError("");
    receiveMutation.mutate({
      productId,
      lot: receiveForm.lot.trim() || undefined,
      expiryDate: receiveForm.expiry || null,
      qty,
      cost: receiveForm.cost.trim() === "" ? undefined : Number(receiveForm.cost),
      actor,
      actorRole,
    });
  };
  const closeModal = () => { setAddOpen(false); setReceiveOpen(false); setError(""); };
  return <><SectionHeader eyebrow="คลังสินค้าและต้นทุน" title="สต็อกสินค้า" description="ติดตามจำนวนคงเหลือ Lot วันหมดอายุ และต้นทุนสินค้าในคลัง" action={<><button className="outline-button" onClick={() => setNotice("เปิดตัวกรองสต็อกแล้ว")}><SlidersHorizontal size={16} /> ตัวกรอง</button><button className="outline-button" onClick={() => { setAddOpen(true); setError(""); }}><Plus size={16} /> เพิ่มไอเทมสินค้า</button><button className="primary-button" onClick={() => { setReceiveOpen(true); setError(""); }}><PackagePlus size={16} /> {role === "admin" ? "รับเข้าสินค้า" : "ขอรับเข้าสินค้า"}</button></>} /><div className="stock-overview"><div className="stock-stat"><span className="stat-icon blue"><Boxes size={18} /></span><div><small>มูลค่าสต็อกทั้งหมด</small><strong>{money(inventoryValue)}</strong></div></div><div className="stock-stat"><span className="stat-icon amber"><PackageSearch size={18} /></span><div><small>รายการทั้งหมด</small><strong>{products.length} <em>SKU</em></strong></div></div><div className="stock-stat"><span className="stat-icon red"><Activity size={18} /></span><div><small>ต้องสั่งซื้อ</small><strong className="red-text">{lowStockCount} <em>รายการ</em></strong></div></div><div className="stock-stat"><span className="stat-icon green"><FileBarChart size={18} /></span><div><small>กำไรขั้นต้นเฉลี่ย</small><strong className="green-text">{avgMargin.toFixed(1)}%</strong></div></div></div><section className="panel table-panel"><div className="table-toolbar"><div><h2>รายการคงคลัง</h2><p>อัปเดตล่าสุดเมื่อ {updatedLabel}</p></div><div className="toolbar-actions"><button className="outline-button" onClick={() => setNotice("เปิดโหมดนับสต็อกแล้ว")}><ClipboardList size={16} /> นับสต็อก</button><button className="outline-button" onClick={() => setNotice("ส่งออกรายงานสต็อกแล้ว")}><Download size={16} /> ส่งออก</button></div></div><div className="table-wrap"><table><thead><tr><th>รหัส / สินค้า</th><th>Lot / วันหมดอายุ</th><th>คงเหลือ</th><th>ต้นทุน</th><th>ราคาขาย</th><th>สถานะ</th><th /></tr></thead><tbody>{stockQuery.isLoading ? <tr className="table-state-row"><td colSpan={7}><div className="table-loading"><PackageSearch size={22} /><b>กำลังโหลดรายการคงคลังจากระบบ</b><span>ดึงข้อมูล Lot และสต็อกล่าสุด</span></div></td></tr> : stockQuery.isError ? <tr className="table-state-row"><td colSpan={7}><div className="table-loading"><CircleAlert size={22} /><b>โหลดรายการสต็อกไม่สำเร็จ</b><span>{getErrorMessage(stockQuery.error)}</span></div></td></tr> : stockRows.length === 0 ? <tr className="table-state-row"><td colSpan={7}><div className="table-loading"><Boxes size={22} /><b>ยังไม่มีรายการคงคลัง</b><span>กด “รับเข้าสินค้า” เพื่อบันทึก Lot แรก</span></div></td></tr> : stockRows.map((row) => <tr key={`${row.sku}-${row.id}`}><td><b>{row.name}</b><small>{row.sku}</small></td><td><b>{row.lot}</b><small>{formatExpiry(row.expiry)}</small></td><td><b>{row.qty} {row.unit}</b></td><td>{money(row.cost)}</td><td>{money(row.price)}</td><td><StatusPill tone={row.tone}>{row.status}</StatusPill></td><td><button className="table-more" onClick={() => setNotice(`เลือก ${row.name} · Lot ${row.lot}`)}><MoreHorizontal size={18} /></button></td></tr>)}</tbody></table></div>{notice && <div className="notice-bar"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}{error && !addOpen && !receiveOpen && <div className="notice-bar error"><CircleAlert size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}</section>{receiveOpen && <div className="modal-backdrop" onClick={closeModal}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">STOCK RECEIPT</span><h2>รับเข้าสินค้า</h2><p>บันทึกการรับเข้า Lot ใหม่ จำนวน และต้นทุนต่อหน่วย</p></div><button className="icon-button" onClick={closeModal}><X size={17} /></button></div><div className="form-grid compact-form"><label className="wide">สินค้า *<select autoFocus value={receiveForm.productId} onChange={(event) => setReceiveForm({ ...receiveForm, productId: event.target.value })}><option value="">เลือกสินค้าที่ต้องการรับเข้า</option>{products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name} (คงเหลือ {product.stock} {product.unit})</option>)}</select></label><label>Lot<input value={receiveForm.lot} onChange={(event) => setReceiveForm({ ...receiveForm, lot: event.target.value })} placeholder="เช่น CR-260918-01" /></label><label>วันหมดอายุ<input type="date" value={receiveForm.expiry} onChange={(event) => setReceiveForm({ ...receiveForm, expiry: event.target.value })} /></label><label>จำนวนที่รับเข้า *<input type="number" min="1" step="1" value={receiveForm.qty} onChange={(event) => setReceiveForm({ ...receiveForm, qty: event.target.value })} placeholder="เช่น 24" /></label><label>ต้นทุนต่อหน่วย (฿)<input type="number" min="0" step="0.01" value={receiveForm.cost} onChange={(event) => setReceiveForm({ ...receiveForm, cost: event.target.value })} placeholder="ตามต้นทุนปัจจุบัน" /></label></div>{error && <div className="notice-bar error"><CircleAlert size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={closeModal}>ยกเลิก</button><button className="primary-button" disabled={receiveMutation.isPending} onClick={submitReceive}><PackagePlus size={16} /> {receiveMutation.isPending ? "กำลังบันทึก…" : "บันทึกการรับเข้า"}</button></div></div></div>}{addOpen && <div className="modal-backdrop" onClick={closeModal}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">INVENTORY ITEM</span><h2>เพิ่มไอเทมสินค้า</h2><p>สร้างรายการสินค้าใหม่ก่อนรับเข้า Lot และจำนวน</p></div><button className="icon-button" onClick={closeModal}><X size={17} /></button></div><div className="form-grid compact-form"><label className="wide">ชื่อสินค้า *<input autoFocus value={newItem.name} onChange={(event) => setNewItem({ ...newItem, name: event.target.value })} placeholder="เช่น น้ำดื่มขวดเล็ก" /></label><label>รหัสสินค้า / SKU<input value={newItem.sku} onChange={(event) => setNewItem({ ...newItem, sku: event.target.value })} placeholder="เว้นว่างเพื่อรันอัตโนมัติ" /></label><label>หน่วยขาย<select value={newItem.unit} onChange={(event) => setNewItem({ ...newItem, unit: event.target.value })}><option>ชิ้น</option><option>ขวด</option><option>ถุง</option><option>กล่อง</option><option>แพ็ก</option></select></label><label>ราคาขายเริ่มต้น *<input value={newItem.price} onChange={(event) => setNewItem({ ...newItem, price: event.target.value })} placeholder="฿0.00" /></label><label>จุดสั่งซื้อขั้นต่ำ<input value={newItem.reorder} onChange={(event) => setNewItem({ ...newItem, reorder: event.target.value })} placeholder="10" /></label></div>{error && <div className="notice-bar error"><CircleAlert size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={closeModal}>ยกเลิก</button><button className="primary-button" disabled={createMutation.isPending} onClick={addItem}><Plus size={16} /> {createMutation.isPending ? "กำลังบันทึก…" : "เพิ่มรายการสินค้า"}</button></div></div></div>}</>;
}
