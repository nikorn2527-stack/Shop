import { useRef, useState } from "react";
import { TRPCClientError } from "@trpc/client";
import {
  Activity, Ban, Boxes, Check, ChevronDown, ChevronRight, CircleAlert, ClipboardList, Download, FileBarChart, ImagePlus, MoreHorizontal, PackagePlus, PackageSearch, Plus, RotateCcw, Search, Settings2, ShieldCheck, SlidersHorizontal, Trash2, X,
} from "lucide-react";
import type { Role } from "./pageData";
import { compressImageToDataUrl, money, scanCandidates, scanMatches } from "./pageData";
import { formatLogDateTime } from "./viewFormat";
import { ConfirmDialog, SectionHeader, StatusPill } from "./PagePrimitives";
import { ProductScanPicker } from "@/components/ScanPickers";
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

const emptyNewItem = { name: "", sku: "", size: "", unit: "ชิ้น", cost: "", price: "", reorder: "10", imageUrl: "" };
const emptyReceiveForm = { productId: "", lot: "", expiry: "", qty: "", cost: "" };
const emptyCountForm = { productId: "", countedQty: "", note: "" };
const emptyEditForm = { name: "", unit: "ชิ้น", price: "", cost: "", reorder: "", size: "", barcode: "", imageUrl: "" };
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
  // ROUND 25 — การ์ดสินค้า: กดการ์ดเพื่อเปิดดูล็อต + ทุก action ของสินค้านั้น
  const [detailTarget, setDetailTarget] = useState<SqliteProduct | null>(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [archiveTarget, setArchiveTarget] = useState<SqliteProduct | null>(null);
  // Round 29 — keep-open receive/count flows (scan the next item right away) and
  // hard-delete for catalog mistakes (สินค้าไม่มีบาร์โค้ดที่สร้างผิด/ไม่ใช้แล้ว).
  const receiveKeepRef = useRef(false);
  const countKeepRef = useRef(false);
  const [deleteTarget, setDeleteTarget] = useState<SqliteProduct | null>(null);
  const addItemNameRef = useRef<HTMLInputElement | null>(null);
  const products = productsQuery.data ?? [];
  const stockRows = stockQuery.data ?? [];
  const allProducts = allProductsQuery.data ?? [];
  const actor = userName || "ผู้ใช้ระบบ";
  const actorRole = role === "admin" ? "ผู้บริหาร" : "เจ้าหน้าที่";
  const inventoryValue = products.reduce((sum, product) => sum + product.stock * product.cost, 0);
  const lowStockCount = stockRows.filter((row) => row.status === "สต็อกต่ำ").length;
  const archivedCount = stockRows.filter((row) => row.status === "ปิดการขาย").length;
  const statusCounts: Record<StockStatusFilter, number> = { "ทั้งหมด": stockRows.length, "ปกติ": stockRows.filter((row) => row.status === "ปกติ").length, "สต็อกต่ำ": lowStockCount, "ใกล้หมดอายุ": stockRows.filter((row) => row.status === "ใกล้หมดอายุ").length, "ปิดการขาย": archivedCount };
  // ROUND 25 — จัดกลุ่ม lot เป็นการ์ดรายสินค้า (ตารางแบนเดิมอ่านยากเมื่อข้อมูลเยอะ)
  const cardTerm = manageSearch.trim().toLowerCase();
  const cardScanCandidates = scanCandidates(manageSearch.trim());
  const productCards = allProducts.map((product) => {
    const lots = stockRows.filter((row) => row.productId === product.id);
    const nextExpiry = lots.reduce<string | null>((best, row) => (row.expiry && (!best || row.expiry < best) ? row.expiry : best), null);
    const status: StockStatusFilter = product.active !== 1 ? "ปิดการขาย" : lots.some((row) => row.status === "ใกล้หมดอายุ") ? "ใกล้หมดอายุ" : product.stock <= product.reorderPoint ? "สต็อกต่ำ" : "ปกติ";
    const tone = status === "ปิดการขาย" ? "purple" : status === "ใกล้หมดอายุ" ? "amber" : status === "สต็อกต่ำ" ? "red" : "green";
    return { product, lots, nextExpiry, status, tone };
  });
  const cardStatusCounts: Record<StockStatusFilter, number> = {
    "ทั้งหมด": productCards.length,
    "ปกติ": productCards.filter((card) => card.status === "ปกติ").length,
    "สต็อกต่ำ": productCards.filter((card) => card.status === "สต็อกต่ำ").length,
    "ใกล้หมดอายุ": productCards.filter((card) => card.status === "ใกล้หมดอายุ").length,
    "ปิดการขาย": productCards.filter((card) => card.status === "ปิดการขาย").length,
  };
  const filteredCards = productCards.filter((card) => (statusFilter === "ทั้งหมด" || card.status === statusFilter) && (cardTerm === "" || card.product.name.toLowerCase().includes(cardTerm) || card.product.sku.toLowerCase().includes(cardTerm) || (card.product.barcode ? cardScanCandidates.includes(card.product.barcode.toLowerCase()) : false) || cardScanCandidates.includes(card.product.sku.toLowerCase())));
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
  const deleteMutation = trpc.product.delete.useMutation({
    onSuccess: (result) => {
      setDeleteTarget(null);
      setDetailTarget(null);
      setManageError("");
      setManageNotice(`ลบสินค้า ${result.name} (${result.sku}) ออกจากรายการเรียบร้อยแล้ว · ประวัติบิลเดิมยังคงอยู่ครบ`);
      refreshQueries();
    },
    onError: (mutationError) => { setDeleteTarget(null); setManageError(getErrorMessage(mutationError)); },
  });
  const receiveMutation = trpc.stock.receive.useMutation({
    onSuccess: (result) => {
      if (receiveKeepRef.current) {
        receiveKeepRef.current = false;
        setReceiveForm({ ...emptyReceiveForm });
        setError("");
        setNotice(`รับเข้า ${result.product.name} แล้ว · Lot ${result.lot.lot} · +${result.lot.qty} ${result.product.unit} · คงเหลือ ${result.product.stock} · ยิงบาร์โค้ดรายการถัดไปต่อได้เลย`);
        refreshQueries();
        return;
      }
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
      if (countKeepRef.current) {
        countKeepRef.current = false;
        setCountForm(emptyCountForm);
        setError("");
        setNotice(`นับสต็อก ${result.name} บันทึกแล้ว · ระบบ ${result.systemQty} → นับได้ ${result.countedQty} ${result.unit} (${result.diff >= 0 ? "+" : ""}${result.diff}) · ยิงรายการถัดไปต่อได้เลย`);
        refreshQueries();
        return;
      }
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
      if (countKeepRef.current) {
        countKeepRef.current = false;
        setCountForm(emptyCountForm);
        setLotCounts({});
        setError("");
        setNotice(`นับสต็อก (แยกล็อต) ${result.name} บันทึกแล้ว · รวม ${result.countedQty} ${result.unit} · ยิงรายการถัดไปต่อได้เลย`);
        refreshQueries();
        return;
      }
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
    const cost = newItem.cost.trim() === "" ? undefined : Number(newItem.cost);
    if (cost !== undefined && !(cost >= 0)) { setError("ราคาต้นทุนต้องเป็นตัวเลข 0 ขึ้นไป"); return; }
    const skuValue = newItem.sku.trim();
    if (skuValue) {
      const duplicate = allProducts.find((product) => scanMatches(product.barcode, skuValue) || scanMatches(product.sku, skuValue));
      if (duplicate) { setError(`รหัส ${skuValue} ใช้กับ “${duplicate.name}” อยู่แล้ว · ใช้รหัสอื่น หรือรับเข้ากับรายการนั้นแทน`); return; }
    }
    setError("");
    createMutation.mutate({
      name,
      sku: skuValue || undefined,
      barcode: skuValue || undefined,
      size: newItem.size.trim() || undefined,
      imageUrl: newItem.imageUrl || undefined,
      unit: newItem.unit,
      price,
      cost,
      reorderPoint: Number(newItem.reorder) >= 0 ? Math.floor(Number(newItem.reorder)) : undefined,
      category: "ของใช้",
      emoji: "🛍️",
      color: "mint",
      actor,
      actorRole,
    });
  };
  const submitReceive = (keepOpen = false) => {
    const productId = Number(receiveForm.productId);
    if (!productId) { setError("กรุณาเลือกสินค้าที่ต้องการรับเข้า"); return; }
    const qty = Number(receiveForm.qty);
    if (!Number.isInteger(qty) || qty <= 0) { setError("กรุณาระบุจำนวนเป็นจำนวนเต็มมากกว่า 0"); return; }
    setError("");
    receiveKeepRef.current = keepOpen;
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
  const submitCount = (keepOpen = false) => {
    const productId = Number(countForm.productId);
    if (!productId) { setError("กรุณาเลือกสินค้าที่ต้องการนับสต็อก"); return; }
    const countedQty = Number(countForm.countedQty);
    if (!Number.isInteger(countedQty) || countedQty < 0) { setError("จำนวนที่นับได้ต้องเป็น 0 ขึ้นไป"); return; }
    setError("");
    countKeepRef.current = keepOpen;
    countMutation.mutate({ productId, countedQty, note: countForm.note.trim() || undefined, actor, actorRole });
  };
  const submitCountLots = (keepOpen = false) => {
    if (!selectedCountProduct) { setError("กรุณาเลือกสินค้าที่ต้องการนับสต็อก"); return; }
    if (!lotCountsValid) { setError("จำนวนที่นับได้ทุก Lot ต้องเป็น 0 ขึ้นไป"); return; }
    setError("");
    countKeepRef.current = keepOpen;
    countLotsMutation.mutate({ counts: lotCountEntries.map((entry) => ({ lotId: entry.row.id, countedQty: entry.parsed })), note: countForm.note.trim() || undefined, actor, actorRole });
  };
  const openReceiveFor = (product: SqliteProduct) => {
    setDetailTarget(null);
    setReceiveForm({ ...emptyReceiveForm, productId: String(product.id) });
    setReceiveOpen(true);
    setError("");
  };
  const openCountFor = (product: SqliteProduct) => {
    setDetailTarget(null);
    setCountForm({ ...emptyCountForm, productId: String(product.id) });
    setCountOpen(true);
    setError("");
  };
  const openEditProduct = (product: SqliteProduct) => {
    setEditTarget(product);
    setEditForm({ name: product.name, unit: product.unit, price: String(product.price), cost: String(product.cost), reorder: String(product.reorderPoint), size: product.size ?? "", barcode: product.barcode ?? "", imageUrl: product.imageUrl ?? "" });
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
    updateMutation.mutate({ productId: editTarget.id, name, unit: editForm.unit, price, cost, reorderPoint, barcode: editForm.barcode.trim() || null, size: editForm.size.trim() || null, imageUrl: editForm.imageUrl || null, actor, actorRole });
  };
  const handleNewItemImage = async (file?: File) => {
    if (!file) return;
    try {
      const dataUrl = await compressImageToDataUrl(file);
      setNewItem({ ...newItem, imageUrl: dataUrl });
      setError("");
    } catch {
      setError("อ่านไฟล์รูปไม่สำเร็จ · ลองใช้ไฟล์ JPG หรือ PNG ไฟล์อื่น");
    }
  };
  const handleEditImage = async (file?: File) => {
    if (!file) return;
    try {
      const dataUrl = await compressImageToDataUrl(file);
      setEditForm({ ...editForm, imageUrl: dataUrl });
      setManageError("");
    } catch {
      setManageError("อ่านไฟล์รูปไม่สำเร็จ · ลองใช้ไฟล์ JPG หรือ PNG ไฟล์อื่น");
    }
  };
  const handleSkuScan = () => {
    const value = newItem.sku.trim();
    if (!value) return;
    const duplicate = allProducts.find((product) => scanMatches(product.barcode, value) || scanMatches(product.sku, value));
    if (duplicate) { setError(`รหัส ${value} ใช้กับ “${duplicate.name}” อยู่แล้ว · ใช้รหัสอื่น หรือรับเข้ากับรายการนั้นแทน`); return; }
    setError("");
    addItemNameRef.current?.focus();
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
  const closeModal = () => { setAddOpen(false); setReceiveOpen(false); setCountOpen(false); setEditOpen(false); setDetailTarget(null); setLotCounts({}); setCountMode("total"); setError(""); receiveKeepRef.current = false; countKeepRef.current = false; };
  return <><SectionHeader eyebrow="คลังสินค้าและต้นทุน" title="สต็อกสินค้า" description="ติดตามจำนวนคงเหลือ Lot วันหมดอายุ และต้นทุนสินค้าในคลัง" action={<><button className="outline-button" onClick={() => { setAddOpen(true); setError(""); }}><Plus size={16} /> เพิ่มไอเทมสินค้า</button><button className="primary-button" onClick={() => { setReceiveOpen(true); setError(""); }}><PackagePlus size={16} /> {role === "admin" ? "รับเข้าสินค้า" : "ขอรับเข้าสินค้า"}</button></>} /><div className="stock-overview"><div className="stock-stat"><span className="stat-icon blue"><Boxes size={18} /></span><div><small>มูลค่าสต็อกทั้งหมด</small><strong>{money(inventoryValue)}</strong></div></div><div className="stock-stat"><span className="stat-icon amber"><PackageSearch size={18} /></span><div><small>รายการทั้งหมด</small><strong>{products.length} <em>SKU</em></strong></div></div><div className="stock-stat"><span className="stat-icon red"><Activity size={18} /></span><div><small>ต้องสั่งซื้อ</small><strong className="red-text">{lowStockCount} <em>รายการ</em></strong></div></div><div className="stock-stat"><span className="stat-icon green"><FileBarChart size={18} /></span><div><small>กำไรขั้นต้นเฉลี่ย</small><strong className="green-text">{avgMargin.toFixed(1)}%</strong></div></div></div><section className="panel table-panel"><div className="table-toolbar"><div><h2>รายการคงคลัง</h2><p>อัปเดตล่าสุดเมื่อ {updatedLabel}</p></div><div className="toolbar-actions"><div className="search-field"><Search size={16} /><input value={manageSearch} onChange={(event) => setManageSearch(event.target.value)} placeholder="ค้นหาชื่อสินค้า หรือรหัส SKU" /></div><div className="filter-pills">{stockStatusFilters.map((item) => <button className={statusFilter === item ? "active" : ""} key={item} onClick={() => setStatusFilter(item)}>{item}{item !== "ทั้งหมด" && <span>{cardStatusCounts[item]}</span>}</button>)}</div><button className="outline-button" onClick={() => { setCountOpen(true); setError(""); }}><ClipboardList size={16} /> นับสต็อก</button><button className="outline-button" onClick={downloadStockCsv}><Download size={16} /> ส่งออก</button></div></div><div className="table-filter-summary"><span><ClipboardList size={13} /> {statusFilter === "ทั้งหมด" ? "สินค้าทั้งหมดในคลัง · กดแถวเพื่อดูล็อตและจัดการสินค้า" : `กรองตามสถานะ: ${statusFilter}`}</span><span>แสดง {filteredCards.length} จาก {productCards.length} สินค้า · {stockRows.length} ล็อต</span></div><div className="table-wrap">{stockQuery.isLoading || allProductsQuery.isLoading ? <div className="table-loading"><PackageSearch size={22} /><b>กำลังโหลดรายการคงคลัง</b><span>ดึงข้อมูลสินค้าและล็อตจากระบบ</span></div> : stockQuery.isError ? <div className="entity-state error" role="alert"><PackageSearch size={22} /><b>โหลดรายการคงคลังไม่สำเร็จ</b><span>{getErrorMessage(stockQuery.error)}</span></div> : filteredCards.length === 0 ? <div className="entity-state"><PackageSearch size={22} /><b>ไม่พบสินค้าตามเงื่อนไข</b><span>ลองเปลี่ยนคำค้นหาหรือสถานะ</span></div> : <table className="entity-table rows-stock" aria-label="รายการสินค้าในคลัง"><thead><tr><th>สินค้า</th><th className="num">คงเหลือ</th><th className="num">ราคาขาย</th><th className="num hide-sm">ล็อต</th><th className="hide-sm">หมดอายุถัดไป</th><th>สถานะ</th><th aria-label="เปิดจัดการ" /></tr></thead><tbody>{filteredCards.map((card) => <tr className="clickable" key={card.product.id} onClick={() => setDetailTarget(card.product)} title={`ดูล็อตและจัดการ ${card.product.name}`}><td><div className="cell-product"><span className="cell-thumb">{card.product.imageUrl ? <img src={card.product.imageUrl} alt="" /> : <span className="cell-thumb-fallback">{card.product.emoji ?? "🛍️"}</span>}</span><div><span className="cell-strong">{card.product.name}</span><small className="cell-sub">{card.product.sku}{card.product.size ? ` · ${card.product.size}` : ""}</small></div></div></td><td className="num"><span className={`cell-qty${card.product.stock <= card.product.reorderPoint ? " low" : ""}`}>{card.product.stock}</span> <small style={{ fontSize: 10.5, color: "#6f7365" }}>{card.product.unit}</small></td><td className="cell-num">{money(card.product.price)}</td><td className="cell-num hide-sm">{card.lots.length}</td><td className="hide-sm"><small className="cell-mono" style={{ marginTop: 0 }}>{formatExpiry(card.nextExpiry)}</small></td><td><StatusPill tone={card.tone}>{card.status}</StatusPill></td><td><span className="row-chevron"><ChevronRight size={15} /></span></td></tr>)}</tbody></table>}</div>{notice && <div className="notice-bar"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}{error && !addOpen && !receiveOpen && !countOpen && <div className="notice-bar error"><CircleAlert size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}{manageNotice && <div className="notice-bar"><Check size={16} /> {manageNotice}<button onClick={() => setManageNotice("")}><X size={14} /></button></div>}{manageError && !editOpen && <div className="notice-bar error"><CircleAlert size={16} /> {manageError}<button onClick={() => setManageError("")}><X size={14} /></button></div>}</section>{detailTarget && (() => { const card = productCards.find((entry) => entry.product.id === detailTarget.id); const lots = card?.lots ?? []; return <div className="modal-backdrop" onClick={() => setDetailTarget(null)}><div className="form-modal stock-detail-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">INVENTORY CARD</span><h2>{detailTarget.name}</h2><p>{detailTarget.sku} · คงเหลือ {detailTarget.stock} {detailTarget.unit}{card && <> · <StatusPill tone={card.tone}>{card.status}</StatusPill></>}</p></div><button className="icon-button" onClick={() => setDetailTarget(null)}><X size={17} /></button></div>{detailTarget.imageUrl && <div className="stock-detail-photo"><img src={detailTarget.imageUrl} alt={`รูปสินค้า ${detailTarget.name}`} /></div>}<div className="stock-detail-grid"><div><small>คงเหลือ</small><strong>{detailTarget.stock} <em>{detailTarget.unit}</em></strong></div><div><small>ราคาขาย</small><strong>{money(detailTarget.price)}</strong></div><div><small>ต้นทุนต่อหน่วย</small><strong>{money(detailTarget.cost)}</strong></div><div><small>จุดสั่งซื้อ</small><strong>{detailTarget.reorderPoint} {detailTarget.unit}</strong></div><div><small>มูลค่าคงคลัง (ต้นทุน)</small><strong>{money(detailTarget.stock * detailTarget.cost)}</strong></div><div><small>หมดอายุถัดไป</small><strong>{formatExpiry(card?.nextExpiry ?? null)}</strong></div></div><div className="stock-detail-lots"><div className="stock-detail-lots-head"><h3>ล็อตสินค้า ({lots.length})</h3><small>ระบบตัดยอดแบบเข้าก่อน-หมดอายุก่อน</small></div>{lots.length === 0 ? <div className="stock-lots-empty"><PackageSearch size={20} /><b>ยังไม่มีล็อตคงเหลือ</b><span>รับเข้าสินค้าเพื่อเริ่มติดตาม</span></div> : <div className="stock-lot-list">{lots.map((lot) => <div className={`stock-lot-row${lot.status === "ใกล้หมดอายุ" ? " expiring" : ""}`} key={lot.id}><div className="stock-lot-main"><b>Lot {lot.lot}</b><small>รับเข้า {lot.receivedAt ? formatLogDateTime(lot.receivedAt) : "—"}</small></div><div className="stock-lot-expiry"><small>หมดอายุ</small><span>{formatExpiry(lot.expiry)}</span></div><div className="stock-lot-qty"><small>คงเหลือ</small><span><b>{lot.qty}</b> {lot.unit}</span></div><StatusPill tone={lot.tone}>{lot.status}</StatusPill></div>)}</div>}</div><div className="stock-detail-actions"><button className="outline-button" onClick={() => openReceiveFor(detailTarget)}><PackagePlus size={15} /> รับเข้าสินค้า</button><button className="outline-button" onClick={() => openCountFor(detailTarget)}><ClipboardList size={15} /> นับสต็อก</button>{role === "admin" && <button className="outline-button" onClick={() => openEditProduct(detailTarget)}><Settings2 size={15} /> แก้ไขข้อมูล</button>}{role === "admin" && (detailTarget.active === 1 ? <button className="danger-outline-button" onClick={() => setArchiveTarget(detailTarget)}><Ban size={15} /> ปิดการขาย</button> : <button className="outline-button" onClick={() => restoreProduct(detailTarget)}><Check size={15} /> เปิดขายอีกครั้ง</button>)}{role === "admin" && <button className="danger-outline-button" onClick={() => setDeleteTarget(detailTarget)}><Trash2 size={15} /> ลบรายการสินค้า</button>}</div></div></div>; })()}{receiveOpen && <div className="modal-backdrop" onClick={closeModal}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">STOCK RECEIPT</span><h2>รับเข้าสินค้า</h2><p>บันทึกการรับเข้า Lot ใหม่ จำนวน และต้นทุนต่อหน่วย</p></div><button className="icon-button" onClick={closeModal}><X size={17} /></button></div><div className="form-grid compact-form"><div className="form-scan-picker wide"><span className="field-label">สินค้า — ยิงบาร์โค้ดที่ตัวสินค้า หรือคีย์รหัส / ชื่อ *</span><ProductScanPicker products={products} selectedId={receiveForm.productId ? Number(receiveForm.productId) : null} onSelect={(product) => setReceiveForm({ ...receiveForm, productId: product ? String(product.id) : "" })} autoFocus /></div><label>Lot<input value={receiveForm.lot} onChange={(event) => setReceiveForm({ ...receiveForm, lot: event.target.value })} placeholder="เช่น CR-260918-01" /></label><label>วันหมดอายุ<input type="date" value={receiveForm.expiry} onChange={(event) => setReceiveForm({ ...receiveForm, expiry: event.target.value })} /></label><label>จำนวนที่รับเข้า *<input type="number" min="1" step="1" value={receiveForm.qty} onChange={(event) => setReceiveForm({ ...receiveForm, qty: event.target.value })} placeholder="เช่น 24" /></label><label>ต้นทุนต่อหน่วย (฿)<input type="number" min="0" step="0.01" value={receiveForm.cost} onChange={(event) => setReceiveForm({ ...receiveForm, cost: event.target.value })} placeholder="ตามต้นทุนปัจจุบัน" /></label></div>{error && <div className="notice-bar error"><CircleAlert size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={closeModal}>ยกเลิก</button><div className="modal-actions-group"><button className="outline-button" disabled={receiveMutation.isPending || !receiveForm.productId || !(Number(receiveForm.qty) > 0)} onClick={() => submitReceive(true)}><RotateCcw size={15} /> บันทึกและรับรายการถัดไป</button><button className="primary-button" disabled={receiveMutation.isPending} onClick={() => submitReceive(false)}><PackagePlus size={16} /> {receiveMutation.isPending ? "กำลังบันทึก…" : "บันทึกการรับเข้า"}</button></div></div></div></div>}{addOpen && <div className="modal-backdrop" onClick={closeModal}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">INVENTORY ITEM</span><h2>เพิ่มไอเทมสินค้า</h2><p>สร้างรายการสินค้าใหม่ก่อนรับเข้า Lot และจำนวน</p></div><button className="icon-button" onClick={closeModal}><X size={17} /></button></div><div className="form-grid compact-form"><label className="wide">รหัสสินค้า / SKU — ยิงบาร์โค้ดที่ตัวสินค้า หรือคีย์เอง<input autoFocus value={newItem.sku} onChange={(event) => setNewItem({ ...newItem, sku: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); handleSkuScan(); } }} placeholder="ยิงบาร์โค้ด หรือพิมพ์รหัส · เว้นว่างเพื่อให้ระบบรันอัตโนมัติ" /></label><label className="wide">ชื่อสินค้า *<input ref={addItemNameRef} value={newItem.name} onChange={(event) => setNewItem({ ...newItem, name: event.target.value })} placeholder="เช่น น้ำดื่มขวดเล็ก" /></label><label>ขนาด / ปริมาณ<input value={newItem.size} onChange={(event) => setNewItem({ ...newItem, size: event.target.value })} placeholder="เช่น 500 ml · 300 g" /></label><label>หน่วยขาย<select value={newItem.unit} onChange={(event) => setNewItem({ ...newItem, unit: event.target.value })}><option>ชิ้น</option><option>ขวด</option><option>ถุง</option><option>กล่อง</option><option>แพ็ก</option></select></label><label>ราคาต้นทุน (฿)<input type="number" min="0" step="0.01" value={newItem.cost} onChange={(event) => setNewItem({ ...newItem, cost: event.target.value })} placeholder="0.00" /></label><label>ราคาขาย *<input value={newItem.price} onChange={(event) => setNewItem({ ...newItem, price: event.target.value })} placeholder="฿0.00" /></label><label>จุดสั่งซื้อขั้นต่ำ<input value={newItem.reorder} onChange={(event) => setNewItem({ ...newItem, reorder: event.target.value })} placeholder="10" /></label><div className="form-image-field wide"><span className="field-label">รูปสินค้าจริง</span><div className="product-image-uploader">{newItem.imageUrl ? <div className="product-image-preview"><img src={newItem.imageUrl} alt="ตัวอย่างรูปสินค้า" /><div><b>พร้อมใช้งาน</b><small>แสดงบน POS และรายการคงคลัง</small></div><button type="button" className="mini-button danger" onClick={() => setNewItem({ ...newItem, imageUrl: "" })}><Trash2 size={13} /> ลบรูป</button></div> : <label className="upload-drop product-upload-drop" htmlFor="new-item-image"><ImagePlus size={18} /><span><b>คลิกเพื่อถ่ายรูปหรืออัปโหลดรูปสินค้าจริง</b><small>รองรับ JPG PNG WEBP · ระบบย่อให้พอดีอัตโนมัติ</small></span><input id="new-item-image" type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => handleNewItemImage(event.target.files?.[0])} /></label>}</div></div></div>{error && <div className="notice-bar error"><CircleAlert size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={closeModal}>ยกเลิก</button><button className="primary-button" disabled={createMutation.isPending} onClick={addItem}><Plus size={16} /> {createMutation.isPending ? "กำลังบันทึก…" : "เพิ่มรายการสินค้า"}</button></div></div></div>}{countOpen && <div className="modal-backdrop" onClick={closeModal}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">STOCK COUNT</span><h2>นับสต็อก</h2><p>บันทึกยอดที่นับได้จริง ระบบจะปรับยอดคงเหลือให้ตรงกันทันที</p></div><button className="icon-button" onClick={closeModal}><X size={17} /></button></div><div className="form-grid compact-form"><div className="form-scan-picker wide"><span className="field-label">สินค้า — ยิงบาร์โค้ดที่ตัวสินค้า หรือคีย์รหัส / ชื่อ *</span><ProductScanPicker products={products} selectedId={countForm.productId ? Number(countForm.productId) : null} onSelect={(product) => { setCountForm({ ...countForm, productId: product ? String(product.id) : "" }); setLotCounts({}); }} autoFocus /></div></div>{selectedCountProduct && <div className="count-mode-toggle" role="tablist" aria-label="โหมดการนับสต็อก"><button type="button" role="tab" aria-selected={countMode === "total"} className={countMode === "total" ? "active" : ""} onClick={() => setCountMode("total")}><Boxes size={14} /> นับรวม</button><button type="button" role="tab" aria-selected={countMode === "lots"} className={countMode === "lots" ? "active" : ""} onClick={() => setCountMode("lots")}><ClipboardList size={14} /> แยกตาม Lot{selectedLots.length > 0 && ` (${selectedLots.length})`}</button></div>}{countMode === "total" ? <>{selectedCountProduct && <div className="member-number-preview stock-count-preview"><span><ClipboardList size={16} /> ระบบ {selectedCountProduct.stock} {selectedCountProduct.unit} · นับได้ {countedInput === null ? "—" : countedInput} {selectedCountProduct.unit}</span><b className={countDiff !== null && countDiff < 0 ? "red-text" : countDiff !== null && countDiff > 0 ? "green-text" : ""}>{countDiff === null ? "ต่าง —" : `ต่าง ${countDiff > 0 ? "+" : ""}${countDiff}`}</b></div>}<div className="form-grid compact-form"><label>จำนวนที่นับได้ *<input type="number" min="0" step="1" value={countForm.countedQty} onChange={(event) => setCountForm({ ...countForm, countedQty: event.target.value })} placeholder="ตามจำนวนที่นับได้จริง" /></label><label className="wide">หมายเหตุ<input value={countForm.note} onChange={(event) => setCountForm({ ...countForm, note: event.target.value })} placeholder="เช่น นับก่อนปิดร้าน หรือระบุสาเหตุความต่าง" /></label></div></> : <>{selectedLots.length === 0 ? <div className="lot-count-empty"><PackageSearch size={20} /><b>ไม่พบ Lot ของสินค้านี้</b><span>ใช้โหมด “นับรวม” หรือรับเข้าสินค้าก่อนนับแยกล็อต</span></div> : <div className="lot-count-list">{lotCountEntries.map((entry) => <div className="lot-count-row" key={entry.row.id}><div className="lot-count-label"><b>{entry.row.lot}</b><small>{entry.row.expiry ? `หมดอายุ ${formatExpiry(entry.row.expiry)}` : "ไม่ระบุวันหมดอายุ"} · ระบบ {entry.row.qty} {entry.row.unit}</small></div><input type="number" min="0" step="1" value={entry.raw} aria-label={`จำนวนที่นับได้ Lot ${entry.row.lot}`} onChange={(event) => setLotCounts({ ...lotCounts, [String(entry.row.id)]: event.target.value })} /><b className={`lot-count-diff${entry.diff !== null && entry.diff < 0 ? " negative" : entry.diff !== null && entry.diff > 0 ? " positive" : ""}`}>{entry.diff === null ? "—" : entry.diff === 0 ? "ตรง" : `${entry.diff > 0 ? "+" : ""}${entry.diff}`}</b></div>)}{selectedCountProduct && <div className="lot-count-total"><span>รวมทั้งสินค้า · ระบบ {selectedCountProduct.stock} {selectedCountProduct.unit}</span><b className={lotTotalDiff !== null && lotTotalDiff < 0 ? "red-text" : lotTotalDiff !== null && lotTotalDiff > 0 ? "green-text" : ""}>นับรวม {lotTotal} {selectedCountProduct.unit} · ต่าง {lotTotalDiff === null ? "—" : `${lotTotalDiff > 0 ? "+" : ""}${lotTotalDiff}`}</b></div>}</div>}<div className="form-grid compact-form"><label className="wide">หมายเหตุ<input value={countForm.note} onChange={(event) => setCountForm({ ...countForm, note: event.target.value })} placeholder="เช่อ นับก่อนปิดร้าน หรือระบุสาเหตุความต่าง" /></label></div></>}<div className="initial-balance-note"><ShieldCheck size={15} /> {countMode === "total" ? "การนับสต็อกจะปรับยอดคงเหลือตามจำนวนที่นับได้ทันที และบันทึกความต่างลงระบบ Log" : "โหมดแยกล็อตจะปรับยอดแต่ละ Lot ตามที่นับได้ แล้วคำนวณยอดรวมของสินค้าจากทุก Lot ใหม่"}</div>{error && <div className="notice-bar error"><CircleAlert size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={closeModal}>ยกเลิก</button><div className="modal-actions-group"><button className="outline-button" disabled={countMode === "total" ? countMutation.isPending || !selectedCountProduct || countedInput === null || !Number.isInteger(countedInput) || countedInput < 0 : countLotsMutation.isPending || !selectedCountProduct || !lotCountsValid} onClick={() => (countMode === "total" ? submitCount(true) : submitCountLots(true))}><RotateCcw size={15} /> บันทึกและนับรายการถัดไป</button><button className="primary-button" disabled={countMode === "total" ? countMutation.isPending || !selectedCountProduct || countedInput === null || !Number.isInteger(countedInput) || countedInput < 0 : countLotsMutation.isPending || !selectedCountProduct || !lotCountsValid} onClick={() => (countMode === "total" ? submitCount(false) : submitCountLots(false))}><ClipboardList size={16} /> {(countMode === "total" ? countMutation.isPending : countLotsMutation.isPending) ? "กำลังบันทึก…" : countMode === "total" ? "บันทึกการนับสต็อก" : "บันทึกการนับแยกล็อต"}</button></div></div></div></div>}{editOpen && editTarget && <div className="modal-backdrop" onClick={closeModal}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">PRODUCT EDIT</span><h2>แก้ไขข้อมูลสินค้า</h2><p>{editTarget.sku} · {editTarget.name}<StatusPill tone={editTarget.active === 1 ? "green" : "purple"}>{editTarget.active === 1 ? "ขายปกติ" : "ปิดการขาย"}</StatusPill></p></div><button className="icon-button" onClick={closeModal}><X size={17} /></button></div><div className="form-grid compact-form"><label className="wide">ชื่อสินค้า *<input autoFocus value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} placeholder="ชื่อที่แสดงบนหน้าร้าน POS" /></label><label className="wide">บาร์โค้ด / รหัส SKU<input value={editForm.barcode} onChange={(event) => setEditForm({ ...editForm, barcode: event.target.value })} placeholder="ยิงบาร์โค้ดที่ตัวสินค้า หรือพิมพ์รหัส" /></label><label>ขนาด / ปริมาณ<input value={editForm.size} onChange={(event) => setEditForm({ ...editForm, size: event.target.value })} placeholder="เช่น 500 ml · 300 g" /></label><label>หน่วยขาย<select value={editForm.unit} onChange={(event) => setEditForm({ ...editForm, unit: event.target.value })}>{editUnitOptions.map((unit) => <option key={unit}>{unit}</option>)}</select></label><label>ราคาขาย *<input type="number" min="0.01" step="0.01" value={editForm.price} onChange={(event) => setEditForm({ ...editForm, price: event.target.value })} placeholder="฿0.00" /></label><label>ต้นทุนต่อหน่วย (฿)<input type="number" min="0" step="0.01" value={editForm.cost} onChange={(event) => setEditForm({ ...editForm, cost: event.target.value })} placeholder="ต้นทุนต่อหน่วย" /></label><label>จุดสั่งซื้อขั้นต่ำ<input type="number" min="0" step="1" value={editForm.reorder} onChange={(event) => setEditForm({ ...editForm, reorder: event.target.value })} placeholder="เช่น 10" /></label><div className="form-image-field wide"><span className="field-label">รูปสินค้าจริง</span><div className="product-image-uploader">{editForm.imageUrl ? <div className="product-image-preview"><img src={editForm.imageUrl} alt="ตัวอย่างรูปสินค้า" /><div><b>พร้อมใช้งาน</b><small>แสดงบน POS และรายการคงคลัง</small></div><button type="button" className="mini-button danger" onClick={() => setEditForm({ ...editForm, imageUrl: "" })}><Trash2 size={13} /> ลบรูป</button></div> : <label className="upload-drop product-upload-drop" htmlFor="edit-item-image"><ImagePlus size={18} /><span><b>คลิกเพื่ออัปโหลดรูปสินค้าจริง</b><small>รองรับ JPG PNG WEBP · ระบบย่อให้พอดีอัตโนมัติ</small></span><input id="edit-item-image" type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => handleEditImage(event.target.files?.[0])} /></label>}</div></div></div><div className="member-number-preview"><span><ClipboardList size={16} /> ระบบ {editTarget.stock} {editTarget.unit} · แก้ไขจำนวนผ่านการนับสต็อก</span></div><div className="initial-balance-note"><ShieldCheck size={15} /> การแก้ไขบันทึกทันทีและปรากฏในระบบ Log · ระบุเฉพาะรายการที่แก้ไข</div>{manageError && <div className="notice-bar error"><CircleAlert size={16} /> {manageError}<button onClick={() => setManageError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={closeModal}>ยกเลิก</button><button className="primary-button" disabled={updateMutation.isPending || editForm.name.trim() === "" || !(Number(editForm.price) > 0)} onClick={submitEditProduct}><SlidersHorizontal size={16} /> {updateMutation.isPending ? "กำลังบันทึก…" : "บันทึกการแก้ไข"}</button></div></div></div>}<ConfirmDialog open={deleteTarget !== null} title="ยืนยันการลบรายการสินค้า?" description={deleteTarget ? `ลบ “${deleteTarget.name}” (${deleteTarget.sku}) ออกจากรายการสินค้าถาวร · ล็อตคงเหลือ ${deleteTarget.stock} ${deleteTarget.unit} จะถูกลบไปด้วย · ประวัติบิลเดิมยังคงแสดงชื่อรายการเหมือนเดิม` : ""} confirmLabel="ยืนยันลบสินค้า" onCancel={() => setDeleteTarget(null)} onConfirm={() => { if (deleteTarget) deleteMutation.mutate({ productId: deleteTarget.id, actor, actorRole }); }} /><ConfirmDialog open={archiveTarget !== null} title="ยืนยันการปิดการขายสินค้า?" description={archiveTarget ? `สินค้า ${archiveTarget.name} (${archiveTarget.sku}) จะถูกซ่อนจากหน้าร้าน POS ทันที · สต็อกคงเหลือ ${archiveTarget.stock} ${archiveTarget.unit} ยังอยู่ในคลังและตรวจสอบได้ที่รายการคงคลัง` : ""} confirmLabel="ยืนยันปิดการขาย" onCancel={() => setArchiveTarget(null)} onConfirm={confirmArchive} /></>;
}
