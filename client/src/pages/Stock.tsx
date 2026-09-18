import { useState } from "react";
import { TRPCClientError } from "@trpc/client";
import {
  Activity, Ban, Boxes, Check, CircleAlert, ClipboardList, Download, FileBarChart, MoreHorizontal, PackagePlus, PackageSearch, Plus, RotateCcw, Search, ShieldCheck, SlidersHorizontal, X,
} from "lucide-react";
import type { Role } from "./pageData";
import { money } from "./pageData";
import { ConfirmDialog, SectionHeader, StatusPill } from "./PagePrimitives";
import type { SqliteProduct } from "../../../server/sqliteStore";
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
const emptyCountForm = { productId: "", countedQty: "", note: "" };
const emptyEditForm = { name: "", unit: "ชิ้น", price: "", cost: "", reorder: "" };
const stockStatusFilters = ["ทั้งหมด", "ปกติ", "สต็อกต่ำ", "ใกล้หมดอายุ", "ปิดการขาย"] as const;
type StockStatusFilter = (typeof stockStatusFilters)[number];

export function Stock({ role, userName }: { role: Role; userName: string }) {
  const utils = trpc.useUtils();
  const stockQuery = trpc.stock.rows.useQuery(undefined);
  const productsQuery = trpc.product.list.useQuery(undefined);
  const allProductsQuery = trpc.product.list.useQuery({ includeInactive: true });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [newItem, setNewItem] = useState(emptyNewItem);
  const [receiveForm, setReceiveForm] = useState(emptyReceiveForm);
  const [countOpen, setCountOpen] = useState(false);
  const [countForm, setCountForm] = useState(emptyCountForm);
  const [countMode, setCountMode] = useState<"total" | "lots">("total");
  const [lotCounts, setLotCounts] = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] = useState<StockStatusFilter>("ทั้งหมด");
  const [manageSearch, setManageSearch] = useState("");
  const [manageNotice, setManageNotice] = useState("");
  const [manageError, setManageError] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SqliteProduct | null>(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [archiveTarget, setArchiveTarget] = useState<SqliteProduct | null>(null);
  const products = productsQuery.data ?? [];
  const stockRows = stockQuery.data ?? [];
  const allProducts = allProductsQuery.data ?? [];
  const actor = userName || "ผู้ใช้ระบบ";
  const actorRole = role === "admin" ? "ผู้บริหาร" : "เจ้าหน้าที่";
  const inventoryValue = products.reduce((sum, product) => sum + product.stock * product.cost, 0);
  const lowStockCount = stockRows.filter((row) => row.status === "สต็อกต่ำ").length;
  const archivedCount = stockRows.filter((row) => row.status === "ปิดการขาย").length;
  const statusCounts: Record<StockStatusFilter, number> = { "ทั้งหมด": stockRows.length, "ปกติ": stockRows.filter((row) => row.status === "ปกติ").length, "สต็อกต่ำ": lowStockCount, "ใกล้หมดอายุ": stockRows.filter((row) => row.status === "ใกล้หมดอายุ").length, "ปิดการขาย": archivedCount };
  const manageTerm = manageSearch.trim().toLowerCase();
  const manageRows = manageTerm === "" ? allProducts : allProducts.filter((product) => product.name.toLowerCase().includes(manageTerm) || product.sku.toLowerCase().includes(manageTerm));
  const editUnitOptions = editTarget && !["ชิ้น", "ขวด", "ถุง", "กล่อง", "แพ็ก"].includes(editTarget.unit) ? ["ชิ้น", "ขวด", "ถุง", "กล่อง", "แพ็ก", editTarget.unit] : ["ชิ้น", "ขวด", "ถุง", "กล่อง", "แพ็ก"];
  const filteredRows = statusFilter === "ทั้งหมด" ? stockRows : stockRows.filter((row) => row.status === statusFilter);
  const selectedCountProduct = products.find((product) => product.id === Number(countForm.productId));
  const selectedLots = selectedCountProduct ? stockRows.filter((row) => row.productId === selectedCountProduct.id) : [];
  const lotCountEntries = selectedLots.map((row) => {
    const raw = lotCounts[String(row.id)] ?? String(row.qty);
    const parsed = raw.trim() === "" ? Number.NaN : Number(raw);
    const valid = Number.isInteger(parsed) && parsed >= 0;
    return { row, raw, parsed, valid, diff: valid ? parsed - row.qty : null };
  });
  const lotCountsValid = lotCountEntries.length > 0 && lotCountEntries.every((entry) => entry.valid);
  const lotTotal = lotCountEntries.reduce((sum, entry) => sum + (entry.valid ? entry.parsed : 0), 0);
  const lotTotalDiff = selectedCountProduct ? lotTotal - selectedCountProduct.stock : null;
  const countedInput = countForm.countedQty.trim() === "" ? null : Number(countForm.countedQty);
  const countDiff = selectedCountProduct && countedInput !== null && Number.isFinite(countedInput) ? countedInput - selectedCountProduct.stock : null;
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
  const countMutation = trpc.stock.count.useMutation({
    onSuccess: (result) => {
      setCountOpen(false);
      setCountForm(emptyCountForm);
      setError("");
      setNotice(`บันทึกการนับสต็อก ${result.name} เรียบร้อยแล้ว · ระบบ ${result.systemQty} → นับได้ ${result.countedQty} ${result.unit} (${result.diff >= 0 ? "+" : ""}${result.diff})`);
      refreshQueries();
    },
    onError: (mutationError) => setError(getErrorMessage(mutationError)),
  });
  const countLotsMutation = trpc.stock.countLots.useMutation({
    onSuccess: (result) => {
      setCountOpen(false);
      setCountForm(emptyCountForm);
      setLotCounts({});
      setCountMode("total");
      setError("");
      setNotice(`บันทึกการนับสต็อก (แยกล็อต) ${result.name} เรียบร้อยแล้ว · รวม ${result.systemQty} → ${result.countedQty} ${result.unit} (${result.diff >= 0 ? "+" : ""}${result.diff}) · ${result.lots.length} ล็อต`);
      refreshQueries();
    },
    onError: (mutationError) => setError(getErrorMessage(mutationError)),
  });
  const updateMutation = trpc.product.update.useMutation({
    onSuccess: (result) => {
      setEditOpen(false);
      setEditTarget(null);
      setEditForm(emptyEditForm);
      setManageError("");
      setManageNotice(`บันทึกการแก้ไขสินค้า ${result.name} เรียบร้อยแล้ว · รหัส ${result.sku}`);
      refreshQueries();
    },
    onError: (mutationError) => setManageError(getErrorMessage(mutationError)),
  });
  const setActiveMutation = trpc.product.setActive.useMutation({
    onSuccess: (result) => {
      setArchiveTarget(null);
      setManageError("");
      setManageNotice(result.active === 1 ? `เปิดขาย ${result.name} อีกครั้งแล้ว` : `ปิดการขาย ${result.name} แล้ว · คงเหลือ ${result.stock} ${result.unit} ยังอยู่ในคลัง`);
      refreshQueries();
    },
    onError: (mutationError) => setManageError(getErrorMessage(mutationError)),
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
  const submitCount = () => {
    const productId = Number(countForm.productId);
    if (!productId) { setError("กรุณาเลือกสินค้าที่ต้องการนับสต็อก"); return; }
    const countedQty = Number(countForm.countedQty);
    if (!Number.isInteger(countedQty) || countedQty < 0) { setError("จำนวนที่นับได้ต้องเป็น 0 ขึ้นไป"); return; }
    setError("");
    countMutation.mutate({ productId, countedQty, note: countForm.note.trim() || undefined, actor, actorRole });
  };
  const submitCountLots = () => {
    if (!selectedCountProduct) { setError("กรุณาเลือกสินค้าที่ต้องการนับสต็อก"); return; }
    if (!lotCountsValid) { setError("จำนวนที่นับได้ทุก Lot ต้องเป็น 0 ขึ้นไป"); return; }
    setError("");
    countLotsMutation.mutate({ counts: lotCountEntries.map((entry) => ({ lotId: entry.row.id, countedQty: entry.parsed })), note: countForm.note.trim() || undefined, actor, actorRole });
  };
  const openEditProduct = (product: SqliteProduct) => {
    setEditTarget(product);
    setEditForm({ name: product.name, unit: product.unit, price: String(product.price), cost: String(product.cost), reorder: String(product.reorderPoint) });
    setEditOpen(true);
    setManageError("");
  };
  const submitEditProduct = () => {
    if (!editTarget) return;
    const name = editForm.name.trim();
    if (!name) { setManageError("กรุณาระบุชื่อสินค้า"); return; }
    const price = Number(editForm.price);
    if (!(price > 0)) { setManageError("ราคาขายต้องมากกว่า 0"); return; }
    const cost = editForm.cost.trim() === "" ? undefined : Number(editForm.cost);
    if (cost !== undefined && !(cost >= 0)) { setManageError("ต้นทุนต่อหน่วยต้องเป็นตัวเลข 0 ขึ้นไป"); return; }
    const reorderPoint = editForm.reorder.trim() === "" ? undefined : Number(editForm.reorder);
    if (reorderPoint !== undefined && (!Number.isInteger(reorderPoint) || reorderPoint < 0)) { setManageError("จุดสั่งซื้อขั้นต่ำต้องเป็นจำนวนเต็ม 0 ขึ้นไป"); return; }
    setManageError("");
    updateMutation.mutate({ productId: editTarget.id, name, unit: editForm.unit, price, cost, reorderPoint, actor, actorRole });
  };
  const confirmArchive = () => {
    if (!archiveTarget) return;
    const target = archiveTarget;
    setArchiveTarget(null);
    setActiveMutation.mutate({ productId: target.id, active: false, actor, actorRole });
  };
  const restoreProduct = (product: SqliteProduct) => {
    setActiveMutation.mutate({ productId: product.id, active: true, actor, actorRole });
  };
  const downloadStockCsv = () => {
    if (stockRows.length === 0) { setNotice("ยังไม่มีรายการคงคลังให้ส่งออก"); return; }
    const csvRows = [
      ["รหัสสินค้า", "ชื่อสินค้า", "Lot", "วันหมดอายุ", "จำนวนคงเหลือ", "หน่วย", "ต้นทุนต่อหน่วย", "ราคาขาย", "สถานะ"],
      ...stockRows.map((row) => [row.sku, row.name, row.lot, formatExpiry(row.expiry), String(row.qty), row.unit, row.cost.toFixed(2), row.price.toFixed(2), row.status]),
      ["รวมมูลค่าคงคลัง (ต้นทุน)", inventoryValue.toFixed(2), "", "", "", "", "", "", ""],
    ];
    const csv = "\uFEFF" + csvRows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n");
    const link = document.createElement("a");
    const today = new Date();
    const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = `stock-report-${stamp}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    setNotice(`ส่งออกรายงานสต็อกเรียบร้อยแล้ว · ${stockRows.length} รายการ`);
  };
  const closeModal = () => { setAddOpen(false); setReceiveOpen(false); setCountOpen(false); setEditOpen(false); setLotCounts({}); setCountMode("total"); setError(""); };
  return <><SectionHeader eyebrow="คลังสินค้าและต้นทุน" title="สต็อกสินค้า" description="ติดตามจำนวนคงเหลือ Lot วันหมดอายุ และต้นทุนสินค้าในคลัง" action={<><button className="outline-button" onClick={() => { setAddOpen(true); setError(""); }}><Plus size={16} /> เพิ่มไอเทมสินค้า</button><button className="primary-button" onClick={() => { setReceiveOpen(true); setError(""); }}><PackagePlus size={16} /> {role === "admin" ? "รับเข้าสินค้า" : "ขอรับเข้าสินค้า"}</button></>} /><div className="stock-overview"><div className="stock-stat"><span className="stat-icon blue"><Boxes size={18} /></span><div><small>มูลค่าสต็อกทั้งหมด</small><strong>{money(inventoryValue)}</strong></div></div><div className="stock-stat"><span className="stat-icon amber"><PackageSearch size={18} /></span><div><small>รายการทั้งหมด</small><strong>{products.length} <em>SKU</em></strong></div></div><div className="stock-stat"><span className="stat-icon red"><Activity size={18} /></span><div><small>ต้องสั่งซื้อ</small><strong className="red-text">{lowStockCount} <em>รายการ</em></strong></div></div><div className="stock-stat"><span className="stat-icon green"><FileBarChart size={18} /></span><div><small>กำไรขั้นต้นเฉลี่ย</small><strong className="green-text">{avgMargin.toFixed(1)}%</strong></div></div></div><section className="panel table-panel"><div className="table-toolbar"><div><h2>รายการคงคลัง</h2><p>อัปเดตล่าสุดเมื่อ {updatedLabel}</p></div><div className="toolbar-actions"><div className="filter-pills">{stockStatusFilters.map((item) => <button className={statusFilter === item ? "active" : ""} key={item} onClick={() => setStatusFilter(item)}>{item}{item !== "ทั้งหมด" && <span>{statusCounts[item]}</span>}</button>)}</div><button className="outline-button" onClick={() => { setCountOpen(true); setError(""); }}><ClipboardList size={16} /> นับสต็อก</button><button className="outline-button" onClick={downloadStockCsv}><Download size={16} /> ส่งออก</button></div></div><div className="table-filter-summary"><span><ClipboardList size={13} /> {statusFilter === "ทั้งหมด" ? "รายการคงคลังทั้งหมด" : `กรองตามสถานะ: ${statusFilter}`}</span><span>แสดง {filteredRows.length} จาก {stockRows.length} รายการ</span></div><div className="table-wrap"><table><thead><tr><th>รหัส / สินค้า</th><th>Lot / วันหมดอายุ</th><th>คงเหลือ</th><th>ต้นทุน</th><th>ราคาขาย</th><th>สถานะ</th><th /></tr></thead><tbody>{stockQuery.isLoading ? <tr className="table-state-row"><td colSpan={7}><div className="table-loading"><PackageSearch size={22} /><b>กำลังโหลดรายการคงคลังจากระบบ</b><span>ดึงข้อมูล Lot และสต็อกล่าสุด</span></div></td></tr> : stockQuery.isError ? <tr className="table-state-row"><td colSpan={7}><div className="table-loading"><CircleAlert size={22} /><b>โหลดรายการสต็อกไม่สำเร็จ</b><span>{getErrorMessage(stockQuery.error)}</span></div></td></tr> : filteredRows.length === 0 ? <tr className="table-state-row"><td colSpan={7}><div className="table-loading"><Boxes size={22} /><b>{stockRows.length === 0 ? "ยังไม่มีรายการคงคลัง" : "ไม่พบรายการตามตัวกรอง"}</b><span>{stockRows.length === 0 ? "กด “รับเข้าสินค้า” เพื่อบันทึก Lot แรก" : "ลองเปลี่ยนตัวกรองสถานะ หรือเลือก “ทั้งหมด”"}</span></div></td></tr> : filteredRows.map((row) => <tr key={`${row.sku}-${row.id}`}><td><b>{row.name}</b><small>{row.sku}</small></td><td><b>{row.lot}</b><small>{formatExpiry(row.expiry)}</small></td><td><b>{row.qty} {row.unit}</b></td><td>{money(row.cost)}</td><td>{money(row.price)}</td><td><StatusPill tone={row.tone}>{row.status}</StatusPill></td><td><button className="table-more" onClick={() => setNotice(`เลือก ${row.name} · Lot ${row.lot}`)}><MoreHorizontal size={18} /></button></td></tr>)}</tbody></table></div>{notice && <div className="notice-bar"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}{error && !addOpen && !receiveOpen && !countOpen && <div className="notice-bar error"><CircleAlert size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}</section><section className="panel table-panel"><div className="table-toolbar"><div><h2>จัดการสินค้า</h2><p>แก้ไขข้อมูลราคาและต้นทุน · ปิดหรือเปิดการขายสินค้าแต่ละรายการ (ผู้บริหาร)</p></div><div className="toolbar-actions"><div className="search-field"><Search size={16} /><input value={manageSearch} onChange={(event) => setManageSearch(event.target.value)} placeholder="ค้นหาชื่อสินค้า หรือรหัส SKU" /></div></div></div><div className="table-filter-summary"><span><Search size={13} /> {manageTerm === "" ? "สินค้าทั้งหมด (รวมรายการที่ปิดการขาย)" : `ค้นหา “${manageSearch.trim()}”`}</span><span>แสดง {manageRows.length} จาก {allProducts.length} รายการ</span></div><div className="table-wrap"><table><thead><tr><th>รหัส / สินค้า</th><th>หน่วย</th><th>ราคาขาย</th><th>ต้นทุน</th><th>คงเหลือ</th><th>จุดสั่งซื้อ</th><th>สถานะ</th><th>การจัดการ</th></tr></thead><tbody>{allProductsQuery.isLoading ? <tr className="table-state-row"><td colSpan={8}><div className="table-loading"><PackageSearch size={22} /><b>กำลังโหลดรายการสินค้าจากระบบ</b><span>ดึงข้อมูลราคา ต้นทุน และสถานะการขาย</span></div></td></tr> : allProductsQuery.isError ? <tr className="table-state-row"><td colSpan={8}><div className="table-loading"><CircleAlert size={22} /><b>โหลดรายการสินค้าไม่สำเร็จ</b><span>{getErrorMessage(allProductsQuery.error)}</span></div></td></tr> : manageRows.length === 0 ? <tr className="table-state-row"><td colSpan={8}><div className="table-loading"><Search size={22} /><b>ไม่พบสินค้าตามคำค้นหา</b><span>ลองค้นหาด้วยชื่อสินค้าหรือรหัส SKU อื่น</span></div></td></tr> : manageRows.map((product) => <tr key={product.id} className={product.active === 1 ? "" : "archived-row"}><td><div className="product-cell"><span className="product-cell-icon">{product.emoji ?? "🛍️"}</span><div><b>{product.name}</b><small>{product.sku}</small></div></div></td><td>{product.unit}</td><td><b>{money(product.price)}</b></td><td>{money(product.cost)}</td><td><b className={product.stock <= product.reorderPoint ? "red-text" : ""}>{product.stock} {product.unit}</b></td><td>{product.reorderPoint}</td><td className="status-cell">{product.active === 1 ? <StatusPill tone="green">ขายปกติ</StatusPill> : <StatusPill tone="purple">ปิดการขาย</StatusPill>}</td><td><div className="product-actions"><button className="mini-button" onClick={() => openEditProduct(product)}><SlidersHorizontal size={13} /> แก้ไข</button>{role === "admin" && (product.active === 1 ? <button className="mini-button danger" disabled={setActiveMutation.isPending} onClick={() => setArchiveTarget(product)}><Ban size={13} /> ปิดการขาย</button> : <button className="mini-button success" disabled={setActiveMutation.isPending} onClick={() => restoreProduct(product)}><RotateCcw size={13} /> เปิดขาย</button>)}</div></td></tr>)}</tbody></table></div>{manageNotice && <div className="notice-bar"><Check size={16} /> {manageNotice}<button onClick={() => setManageNotice("")}><X size={14} /></button></div>}{manageError && !editOpen && <div className="notice-bar error"><CircleAlert size={16} /> {manageError}<button onClick={() => setManageError("")}><X size={14} /></button></div>}</section>{receiveOpen && <div className="modal-backdrop" onClick={closeModal}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">STOCK RECEIPT</span><h2>รับเข้าสินค้า</h2><p>บันทึกการรับเข้า Lot ใหม่ จำนวน และต้นทุนต่อหน่วย</p></div><button className="icon-button" onClick={closeModal}><X size={17} /></button></div><div className="form-grid compact-form"><label className="wide">สินค้า *<select autoFocus value={receiveForm.productId} onChange={(event) => setReceiveForm({ ...receiveForm, productId: event.target.value })}><option value="">เลือกสินค้าที่ต้องการรับเข้า</option>{products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name} (คงเหลือ {product.stock} {product.unit})</option>)}</select></label><label>Lot<input value={receiveForm.lot} onChange={(event) => setReceiveForm({ ...receiveForm, lot: event.target.value })} placeholder="เช่น CR-260918-01" /></label><label>วันหมดอายุ<input type="date" value={receiveForm.expiry} onChange={(event) => setReceiveForm({ ...receiveForm, expiry: event.target.value })} /></label><label>จำนวนที่รับเข้า *<input type="number" min="1" step="1" value={receiveForm.qty} onChange={(event) => setReceiveForm({ ...receiveForm, qty: event.target.value })} placeholder="เช่น 24" /></label><label>ต้นทุนต่อหน่วย (฿)<input type="number" min="0" step="0.01" value={receiveForm.cost} onChange={(event) => setReceiveForm({ ...receiveForm, cost: event.target.value })} placeholder="ตามต้นทุนปัจจุบัน" /></label></div>{error && <div className="notice-bar error"><CircleAlert size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={closeModal}>ยกเลิก</button><button className="primary-button" disabled={receiveMutation.isPending} onClick={submitReceive}><PackagePlus size={16} /> {receiveMutation.isPending ? "กำลังบันทึก…" : "บันทึกการรับเข้า"}</button></div></div></div>}{addOpen && <div className="modal-backdrop" onClick={closeModal}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">INVENTORY ITEM</span><h2>เพิ่มไอเทมสินค้า</h2><p>สร้างรายการสินค้าใหม่ก่อนรับเข้า Lot และจำนวน</p></div><button className="icon-button" onClick={closeModal}><X size={17} /></button></div><div className="form-grid compact-form"><label className="wide">ชื่อสินค้า *<input autoFocus value={newItem.name} onChange={(event) => setNewItem({ ...newItem, name: event.target.value })} placeholder="เช่น น้ำดื่มขวดเล็ก" /></label><label>รหัสสินค้า / SKU<input value={newItem.sku} onChange={(event) => setNewItem({ ...newItem, sku: event.target.value })} placeholder="เว้นว่างเพื่อรันอัตโนมัติ" /></label><label>หน่วยขาย<select value={newItem.unit} onChange={(event) => setNewItem({ ...newItem, unit: event.target.value })}><option>ชิ้น</option><option>ขวด</option><option>ถุง</option><option>กล่อง</option><option>แพ็ก</option></select></label><label>ราคาขายเริ่มต้น *<input value={newItem.price} onChange={(event) => setNewItem({ ...newItem, price: event.target.value })} placeholder="฿0.00" /></label><label>จุดสั่งซื้อขั้นต่ำ<input value={newItem.reorder} onChange={(event) => setNewItem({ ...newItem, reorder: event.target.value })} placeholder="10" /></label></div>{error && <div className="notice-bar error"><CircleAlert size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={closeModal}>ยกเลิก</button><button className="primary-button" disabled={createMutation.isPending} onClick={addItem}><Plus size={16} /> {createMutation.isPending ? "กำลังบันทึก…" : "เพิ่มรายการสินค้า"}</button></div></div></div>}{countOpen && <div className="modal-backdrop" onClick={closeModal}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">STOCK COUNT</span><h2>นับสต็อก</h2><p>บันทึกยอดที่นับได้จริง ระบบจะปรับยอดคงเหลือให้ตรงกันทันที</p></div><button className="icon-button" onClick={closeModal}><X size={17} /></button></div><div className="form-grid compact-form"><label className="wide">สินค้า *<select autoFocus value={countForm.productId} onChange={(event) => { setCountForm({ ...countForm, productId: event.target.value }); setLotCounts({}); }}><option value="">เลือกสินค้าที่ต้องการนับสต็อก</option>{products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name} (ระบบ {product.stock} {product.unit})</option>)}</select></label></div>{selectedCountProduct && <div className="count-mode-toggle" role="tablist" aria-label="โหมดการนับสต็อก"><button type="button" role="tab" aria-selected={countMode === "total"} className={countMode === "total" ? "active" : ""} onClick={() => setCountMode("total")}><Boxes size={14} /> นับรวม</button><button type="button" role="tab" aria-selected={countMode === "lots"} className={countMode === "lots" ? "active" : ""} onClick={() => setCountMode("lots")}><ClipboardList size={14} /> แยกตาม Lot{selectedLots.length > 0 && ` (${selectedLots.length})`}</button></div>}{countMode === "total" ? <>{selectedCountProduct && <div className="member-number-preview stock-count-preview"><span><ClipboardList size={16} /> ระบบ {selectedCountProduct.stock} {selectedCountProduct.unit} · นับได้ {countedInput === null ? "—" : countedInput} {selectedCountProduct.unit}</span><b className={countDiff !== null && countDiff < 0 ? "red-text" : countDiff !== null && countDiff > 0 ? "green-text" : ""}>{countDiff === null ? "ต่าง —" : `ต่าง ${countDiff > 0 ? "+" : ""}${countDiff}`}</b></div>}<div className="form-grid compact-form"><label>จำนวนที่นับได้ *<input type="number" min="0" step="1" value={countForm.countedQty} onChange={(event) => setCountForm({ ...countForm, countedQty: event.target.value })} placeholder="ตามจำนวนที่นับได้จริง" /></label><label className="wide">หมายเหตุ<input value={countForm.note} onChange={(event) => setCountForm({ ...countForm, note: event.target.value })} placeholder="เช่น นับก่อนปิดร้าน หรือระบุสาเหตุความต่าง" /></label></div></> : <>{selectedLots.length === 0 ? <div className="lot-count-empty"><PackageSearch size={20} /><b>ไม่พบ Lot ของสินค้านี้</b><span>ใช้โหมด “นับรวม” หรือรับเข้าสินค้าก่อนนับแยกล็อต</span></div> : <div className="lot-count-list">{lotCountEntries.map((entry) => <div className="lot-count-row" key={entry.row.id}><div className="lot-count-label"><b>{entry.row.lot}</b><small>{entry.row.expiry ? `หมดอายุ ${formatExpiry(entry.row.expiry)}` : "ไม่ระบุวันหมดอายุ"} · ระบบ {entry.row.qty} {entry.row.unit}</small></div><input type="number" min="0" step="1" value={entry.raw} aria-label={`จำนวนที่นับได้ Lot ${entry.row.lot}`} onChange={(event) => setLotCounts({ ...lotCounts, [String(entry.row.id)]: event.target.value })} /><b className={`lot-count-diff${entry.diff !== null && entry.diff < 0 ? " negative" : entry.diff !== null && entry.diff > 0 ? " positive" : ""}`}>{entry.diff === null ? "—" : entry.diff === 0 ? "ตรง" : `${entry.diff > 0 ? "+" : ""}${entry.diff}`}</b></div>)}{selectedCountProduct && <div className="lot-count-total"><span>รวมทั้งสินค้า · ระบบ {selectedCountProduct.stock} {selectedCountProduct.unit}</span><b className={lotTotalDiff !== null && lotTotalDiff < 0 ? "red-text" : lotTotalDiff !== null && lotTotalDiff > 0 ? "green-text" : ""}>นับรวม {lotTotal} {selectedCountProduct.unit} · ต่าง {lotTotalDiff === null ? "—" : `${lotTotalDiff > 0 ? "+" : ""}${lotTotalDiff}`}</b></div>}</div>}<div className="form-grid compact-form"><label className="wide">หมายเหตุ<input value={countForm.note} onChange={(event) => setCountForm({ ...countForm, note: event.target.value })} placeholder="เช่อ นับก่อนปิดร้าน หรือระบุสาเหตุความต่าง" /></label></div></>}<div className="initial-balance-note"><ShieldCheck size={15} /> {countMode === "total" ? "การนับสต็อกจะปรับยอดคงเหลือตามจำนวนที่นับได้ทันที และบันทึกความต่างลงระบบ Log" : "โหมดแยกล็อตจะปรับยอดแต่ละ Lot ตามที่นับได้ แล้วคำนวณยอดรวมของสินค้าจากทุก Lot ใหม่"}</div>{error && <div className="notice-bar error"><CircleAlert size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={closeModal}>ยกเลิก</button><button className="primary-button" disabled={countMode === "total" ? countMutation.isPending || !selectedCountProduct || countedInput === null || !Number.isInteger(countedInput) || countedInput < 0 : countLotsMutation.isPending || !selectedCountProduct || !lotCountsValid} onClick={countMode === "total" ? submitCount : submitCountLots}><ClipboardList size={16} /> {(countMode === "total" ? countMutation.isPending : countLotsMutation.isPending) ? "กำลังบันทึก…" : countMode === "total" ? "บันทึกการนับสต็อก" : "บันทึกการนับแยกล็อต"}</button></div></div></div>}{editOpen && editTarget && <div className="modal-backdrop" onClick={closeModal}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">PRODUCT EDIT</span><h2>แก้ไขข้อมูลสินค้า</h2><p>{editTarget.sku} · {editTarget.name}<StatusPill tone={editTarget.active === 1 ? "green" : "purple"}>{editTarget.active === 1 ? "ขายปกติ" : "ปิดการขาย"}</StatusPill></p></div><button className="icon-button" onClick={closeModal}><X size={17} /></button></div><div className="form-grid compact-form"><label className="wide">ชื่อสินค้า *<input autoFocus value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} placeholder="ชื่อที่แสดงบนหน้าร้าน POS" /></label><label>หน่วยขาย<select value={editForm.unit} onChange={(event) => setEditForm({ ...editForm, unit: event.target.value })}>{editUnitOptions.map((unit) => <option key={unit}>{unit}</option>)}</select></label><label>ราคาขาย *<input type="number" min="0.01" step="0.01" value={editForm.price} onChange={(event) => setEditForm({ ...editForm, price: event.target.value })} placeholder="฿0.00" /></label><label>ต้นทุนต่อหน่วย (฿)<input type="number" min="0" step="0.01" value={editForm.cost} onChange={(event) => setEditForm({ ...editForm, cost: event.target.value })} placeholder="ต้นทุนต่อหน่วย" /></label><label>จุดสั่งซื้อขั้นต่ำ<input type="number" min="0" step="1" value={editForm.reorder} onChange={(event) => setEditForm({ ...editForm, reorder: event.target.value })} placeholder="เช่น 10" /></label></div><div className="member-number-preview"><span><ClipboardList size={16} /> ระบบ {editTarget.stock} {editTarget.unit} · แก้ไขจำนวนผ่านการนับสต็อก</span></div><div className="initial-balance-note"><ShieldCheck size={15} /> การแก้ไขบันทึกทันทีและปรากฏในระบบ Log · ระบุเฉพาะรายการที่แก้ไข</div>{manageError && <div className="notice-bar error"><CircleAlert size={16} /> {manageError}<button onClick={() => setManageError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={closeModal}>ยกเลิก</button><button className="primary-button" disabled={updateMutation.isPending || editForm.name.trim() === "" || !(Number(editForm.price) > 0)} onClick={submitEditProduct}><SlidersHorizontal size={16} /> {updateMutation.isPending ? "กำลังบันทึก…" : "บันทึกการแก้ไข"}</button></div></div></div>}<ConfirmDialog open={archiveTarget !== null} title="ยืนยันการปิดการขายสินค้า?" description={archiveTarget ? `สินค้า ${archiveTarget.name} (${archiveTarget.sku}) จะถูกซ่อนจากหน้าร้าน POS ทันที · สต็อกคงเหลือ ${archiveTarget.stock} ${archiveTarget.unit} ยังอยู่ในคลังและตรวจสอบได้ที่รายการคงคลัง` : ""} confirmLabel="ยืนยันปิดการขาย" onCancel={() => setArchiveTarget(null)} onConfirm={confirmArchive} /></>;
}
