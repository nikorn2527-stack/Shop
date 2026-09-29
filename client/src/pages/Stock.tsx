import { useEffect, useRef, useState } from "react";
import { TRPCClientError } from "@trpc/client";
import {
  Activity, Ban, Boxes, Camera, Check, ChevronDown, ChevronRight, CircleAlert, ClipboardList, Download, FileBarChart, Gift, ImagePlus, Lock, MoreHorizontal, PackagePlus, PackageSearch, Plus, Printer, RotateCcw, Search, Settings2, ShieldCheck, ShoppingCart, SlidersHorizontal, Star, Trash2, X,
} from "@/lib/icons";
import type { Role } from "./pageData";
import { compressImageToDataUrl, isAdminRole, money, roleThaiLabel, scanCandidates, scanMatches } from "./pageData";
import { CameraCaptureModal } from "@/components/CameraCaptureModal";
import { BarcodeCameraModal } from "@/components/BarcodeCameraModal";
import { formatLogDateTime } from "./viewFormat";
import { ConfirmDialog, SectionHeader, StatusPill, formEnterNav } from "./PagePrimitives";
import { ProductScanPicker } from "@/components/ScanPickers";
import { blocker } from "@/components/BlockerAlert";
import { ThaiDatePicker } from "@/components/ThaiDatePicker";
import { PrintPreviewModal } from "@/components/PrintPreviewModal";
import { HelpDisclosure } from "@/components/HelpDisclosure";
import { ExportPreviewModal, type ExportFormat, type ExportPreviewState } from "@/components/ExportPreviewModal";
import { StockCountSheet } from "@/components/StockCountSheet";
import { BulkPriceModal } from "@/components/BulkPriceModal";
import { EditionUpgradeModal, useEditionStatus } from "@/components/EditionUi";
import type { EditionFeatureKey } from "@shared/editions";
import { printReportDoc, downloadReportPdf } from "@/reportDoc";
import { downloadCsvFile, downloadXlsxFile, exportCount, exportNumber } from "@/exportUtils";
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

const emptyNewItem = { name: "", sku: "", category: "ของใช้ส่วนตัว", sizeNum: "", sizeUnit: "มล.", unit: "ชิ้น", cost: "", price: "", reorder: "10", imageUrl: "", sellMode: "unit" as "unit" | "money", quickPick: false, tiers: [{ label: "", price: "", qty: "" }] };
/** รับเข้าแบบซื้อ/แถม: จำนวนที่ซื้อ + จำนวนแถม + เงินที่จ่ายจริง */
type ReceiveFormDraft = { productId: string; lot: string; expiry: string; purchaseQty: string; freeQty: string; paidAmount: string };
const emptyReceiveForm = (): ReceiveFormDraft => ({ productId: "", lot: "", expiry: "", purchaseQty: "", freeQty: "0", paidAmount: "" });
/** สะสมหลายสินค้าไว้ใน "รายการรับเข้า" แล้วบันทึกพร้อมกันรอบเดียว */
type ReceiveCartEntry = Omit<ReceiveFormDraft, "productId"> & { productId: number };
const emptyCountForm = { productId: "", countedQty: "", note: "" };
const emptyEditForm = { name: "", category: "", unit: "ชิ้น", price: "", cost: "", reorder: "", sizeNum: "", sizeUnit: "มล.", barcode: "", imageUrl: "", sellMode: "unit" as "unit" | "money", quickPick: false, tiers: [{ label: "", price: "", qty: "" }] };

// Round 32-27 — ตัวเลือกขนาด/ปริมาณแบบเลือกจากลิสต์ กันคีย์ผิด (.g / กรัม ฯลฯ)
const SIZE_UNIT_OPTIONS = ["มล.", "ลิตร", "กรัม", "กก.", "ชิ้น", "แพ็ก", "ถุง", "ขวด", "กล่อง"];
// ROUND 71 — หมวดสินค้า: รหัสอัตโนมัติขึ้นต้นตามหมวด (ชุดเดียวกับ server/sqliteStore.ts CATEGORY_SKU_PREFIXES)
// เครื่องดื่ม=DRK · ของใช้ส่วนตัว=HYG · ขนม=SNK · อาหาร=FD · ของใช้ในครัวเรือน=HH · เครื่องเขียน=ST
const CATEGORY_SKU_PREFIXES: Record<string, string> = { "เครื่องดื่ม": "DRK", "อาหาร": "FD", "ของใช้": "HYG", "ของใช้ส่วนตัว": "HYG", "ของใช้ในครัวเรือน": "HH", "ขนม": "SNK", "เครื่องเขียน": "ST" };
const PRODUCT_CATEGORIES = ["ของใช้ส่วนตัว", "เครื่องดื่ม", "ขนม", "อาหาร", "ของใช้ในครัวเรือน", "เครื่องเขียน"];
const SIZE_PRESETS: [string, string][] = [["180", "มล."], ["300", "มล."], ["325", "มล."], ["500", "มล."], ["600", "มล."], ["1", "ลิตร"], ["200", "กรัม"], ["500", "กรัม"], ["1", "กก."]];
function parseSizeInput(size: string | null | undefined): { num: string; unit: string } {
  const trimmed = (size ?? "").trim();
  if (!trimmed) return { num: "", unit: "มล." };
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(.+)$/);
  if (!match) return { num: "", unit: "มล." };
  const rawUnit = match[2]!.trim().toLowerCase();
  const mapped = rawUnit === "ml" ? "มล." : rawUnit === "l" ? "ลิตร" : rawUnit === "g" || rawUnit === "ก." ? "กรัม" : rawUnit === "kg" || rawUnit === "กิโลกรัม" ? "กก." : rawUnit;
  return { num: match[1]!, unit: SIZE_UNIT_OPTIONS.includes(mapped) ? mapped : rawUnit };
}
const composeSize = (num: string, unit: string) => num.trim() === "" ? "" : `${num.trim()} ${unit.trim()}`;

type TierRow = { label: string; price: string; qty: string };

/** Round 31-12 — validate + serialize the price-tier editor rows → JSON for products.price_tiers. */
function serializeTierRows(rows: TierRow[]): { error?: string; json: string | null; minPrice: number } {
  const tiers = rows
    .map((row) => ({ label: row.label.trim(), price: Number(row.price), qty: Number(row.qty) }))
    .filter((tier) => tier.label !== "" || rowNonEmpty(tier.price, tier.qty));
  if (tiers.length === 0) return { json: null, minPrice: 0 };
  for (const tier of tiers) {
    if (!tier.label) return { error: "ช่องราคาต้องมีชื่อขนาด เช่น “200 กรัม”", json: null, minPrice: 0 };
    if (!(tier.price > 0)) return { error: `ช่องราคา “${tier.label}” ต้องมีราคามากกว่า 0`, json: null, minPrice: 0 };
    if (!(tier.qty > 0)) return { error: `ช่องราคา “${tier.label}” ต้องมีปริมาณมากกว่า 0`, json: null, minPrice: 0 };
  }
  return { json: JSON.stringify(tiers), minPrice: Math.min(...tiers.map((tier) => tier.price)) };
}
function rowNonEmpty(price: number, qty: number) {
  return Number.isFinite(price) && price !== 0 && Number.isFinite(qty) && qty !== 0;
}
function parseTierRows(json?: string | null): TierRow[] {
  if (!json) return [{ label: "", price: "", qty: "" }];
  try {
    const parsed = JSON.parse(json) as Array<{ label?: unknown; price?: unknown; qty?: unknown }>;
    if (!Array.isArray(parsed) || parsed.length === 0) return [{ label: "", price: "", qty: "" }];
    return parsed.map((tier) => ({ label: String(tier.label ?? ""), price: String(tier.price ?? ""), qty: String(tier.qty ?? "") }));
  } catch {
    return [{ label: "", price: "", qty: "" }];
  }
}
const stockStatusFilters = ["ทั้งหมด", "ปกติ", "สต็อกต่ำ", "ใกล้หมดอายุ", "ปิดการขาย"] as const;
type StockStatusFilter = (typeof stockStatusFilters)[number];

export type StockInitialAction = "receive" | "add";
export function Stock({ role, userName, initialAction, embeddedAction = false, onClose }: { role: Role; userName: string; initialAction?: StockInitialAction; embeddedAction?: boolean; onClose?: () => void }) {
  // ROUND 61 — สิทธิ์เวอร์ชัน: งานนับสต็อก (โปรพลัส) · การส่งออก CSV/Excel/พิมพ์ (โปร)
  const edition = useEditionStatus();
  const hasStockCount = edition.status?.has("stockCount") ?? false;
  const hasCameraScan = edition.status?.has("cameraScan") ?? false;
  const canExport = edition.status?.has("importExport") ?? false;
  const [upgradeFeature, setUpgradeFeature] = useState<EditionFeatureKey | null>(null);
  const utils = trpc.useUtils();
  const stockQuery = trpc.stock.rows.useQuery(undefined);
  const productsQuery = trpc.product.list.useQuery(undefined);
  const allProductsQuery = trpc.product.list.useQuery({ includeInactive: true });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [catalogMenuOpen, setCatalogMenuOpen] = useState(false);
  const [newItem, setNewItem] = useState(emptyNewItem);
  const [receiveForm, setReceiveForm] = useState(emptyReceiveForm);
  // ROUND 79 — รายการรับเข้าหลายสินค้า + ความคืบหน้าตอนบันทึกทีละรายการ
  const [receiveCart, setReceiveCart] = useState<ReceiveCartEntry[]>([]);
  const [receiveProgress, setReceiveProgress] = useState<{ done: number; total: number } | null>(null);
  const [receiveDiscardOpen, setReceiveDiscardOpen] = useState(false);
  const [countOpen, setCountOpen] = useState(false);
  const [countForm, setCountForm] = useState(emptyCountForm);
  const [countMode, setCountMode] = useState<"total" | "lots">("total");
  const [lotCounts, setLotCounts] = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] = useState<StockStatusFilter>("ทั้งหมด");
  const [manageSearch, setManageSearch] = useState("");
  const [manageNotice, setManageNotice] = useState("");
  const [manageError, setManageError] = useState("");
  useEffect(() => {
    if (initialAction === "receive") setReceiveOpen(true);
    if (initialAction === "add") setAddOpen(true);
  }, [initialAction]);
  // Embedded Stock is rendered inside POS's outer modal. If a nested form is
  // closed by any path (X, cancel, backdrop, or a future action), notify POS
  // so an empty outer backdrop cannot remain over the page.
  const embeddedReadyRef = useRef(false);
  useEffect(() => {
    if (!embeddedAction || !onClose || !initialAction) return;
    if (!embeddedReadyRef.current) {
      embeddedReadyRef.current = true;
      return;
    }
    if (!addOpen && !receiveOpen) onClose();
  }, [addOpen, embeddedAction, initialAction, onClose, receiveOpen]);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SqliteProduct | null>(null);
  // ROUND 38 (ข้อ 37) — ถ่ายรูปสินค้าจากกล้อง (เพิ่มใหม่ + แก้ไข)
  const [newCameraOpen, setNewCameraOpen] = useState(false);
  const [editCameraOpen, setEditCameraOpen] = useState(false);
  // ROUND 25 — การ์ดสินค้า: กดการ์ดเพื่อเปิดดูล็อต + ทุก action ของสินค้านั้น
  const [detailTarget, setDetailTarget] = useState<SqliteProduct | null>(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [archiveTarget, setArchiveTarget] = useState<SqliteProduct | null>(null);
  // Round 29 — keep-open receive/count flows (scan the next item right away) and
  // hard-delete for catalog mistakes (สินค้าไม่มีบาร์โค้ดที่สร้างผิด/ไม่ใช้แล้ว).
  const countKeepRef = useRef(false);
  const [deleteTarget, setDeleteTarget] = useState<SqliteProduct | null>(null);
  // Round 32-15 — รายการสั่งซื้อ: สะสมสินค้าที่จะสั่งเข้า กันตกหล่นก่อนสั่งจริง
  const [stockTab, setStockTab] = useState<"inventory" | "orders">("inventory");
  // ROUND 55 (user) — ใบนับสต๊อกพิมพ์ออกมานับมือ (พรีวิวก่อนพิมพ์เหมือนทุกจุด)
  const [countSheetOpen, setCountSheetOpen] = useState(false);
  // ROUND 63 (user) — พรีวิวก่อนพิมพ์รายงานสต็อก (คงคลัง + รายการสั่งซื้อ) ผ่าน ExportPreviewModal
  const [docPreview, setDocPreview] = useState<ExportPreviewState | null>(null);
  // ROUND 64 (user) — ปรับราคา/ต้นทุนหลายรายการพร้อมกัน (ใช้กับสินค้าใหม่ 100+ รายการที่ยังไม่มีราคา)
  const [bulkPriceOpen, setBulkPriceOpen] = useState(false);
  // ROUND 55 (user) — สแกนบาร์โค้ดด้วยกล้องที่ช่องค้นหา (เดินนับรอบร้านด้วยมือถือ)
  const [searchCameraOpen, setSearchCameraOpen] = useState(false);
  // ROUND 55 — สแกน/เลือกสินค้าเสร็จในโมดัลนับสต็อก/รับเข้า ให้กระโดดไปช่องจำนวนทันที
  // (โฟลว์กล้องมือถือ: ยิงบาร์โค้ด → พิมพ์จำนวน → Enter รายการถัดไป — มือเดียวจบ)
  useEffect(() => {
    if (countForm.productId) document.getElementById("count-qty-input")?.focus();
  }, [countForm.productId]);
  useEffect(() => {
    if (receiveForm.productId) document.getElementById("receive-qty-input")?.focus();
  }, [receiveForm.productId]);
  const [orderQtyDrafts, setOrderQtyDrafts] = useState<Record<number, string>>({});
  const [clearOrdersOpen, setClearOrdersOpen] = useState(false);
  const addItemNameRef = useRef<HTMLInputElement | null>(null);
  const products = productsQuery.data ?? [];
  const stockRows = stockQuery.data ?? [];
  const allProducts = allProductsQuery.data ?? [];
  // ROUND 71 — ตัวเลือกหมวดสินค้า: ชุดหลัก 6 หมวด + หมวดที่พบจริงในคลัง (กันของเก่าหายไปจากลิสต์)
  const categoryOptions = Array.from(new Set([...PRODUCT_CATEGORIES, ...allProducts.map((product) => product.category).filter((category): category is string => Boolean(category))]));
  // รหัสอัตโนมัติถัดไปของหมวด (พรีวิวในฟอร์มเพิ่มสินค้า — ตัวจริงคำนวณฝั่ง server)
  const nextAutoSkuPreview = (category: string) => {
    const prefix = CATEGORY_SKU_PREFIXES[category] ?? "GEN";
    let maxSeq = 0;
    for (const product of allProducts) {
      const match = /^([A-Z]+)-(\d{3,})$/.exec(product.sku);
      if (match && match[1] === prefix) maxSeq = Math.max(maxSeq, Number(match[2]));
    }
    return `${prefix}-${String(maxSeq + 1).padStart(3, "0")}`;
  };
  const orderListQuery = trpc.stock.orderList.useQuery(undefined);
  const orderItems = orderListQuery.data ?? [];
  const orderTotalValue = orderItems.reduce((sum, item) => sum + item.qty * item.cost, 0);
  const orderSuggest = (product: SqliteProduct) => Math.max(product.reorderPoint * 2 - product.stock, 1);
  const refreshOrderQueries = () => {
    void utils.stock.orderList.invalidate();
    void utils.logs.list.invalidate();
  };
  const orderAddMutation = trpc.stock.orderAdd.useMutation({
    onSuccess: (items, variables) => {
      void utils.stock.orderList.setData(undefined, items);
      refreshOrderQueries();
      const added = items.find((item) => item.productId === variables.productId);
      setNotice(`เพิ่ม "${added?.name ?? "รายการ"}" เข้ารายการสั่งซื้อแล้ว · จะสั่ง ${added?.qty ?? 1} ${added?.unit ?? ""}${added && added.qty > 1 ? " (รวมยอดเดิม)" : ""}`);
    },
    onError: (mutationError) => setError(getErrorMessage(mutationError)),
  });
  const orderUpdateMutation = trpc.stock.orderUpdate.useMutation({
    onSuccess: (items) => { void utils.stock.orderList.setData(undefined, items); refreshOrderQueries(); },
    onError: (mutationError) => setError(getErrorMessage(mutationError)),
  });
  const orderRemoveMutation = trpc.stock.orderRemove.useMutation({
    onSuccess: (items) => { void utils.stock.orderList.setData(undefined, items); refreshOrderQueries(); setNotice("ถอดรายการออกจากรายการสั่งซื้อแล้ว"); },
    onError: (mutationError) => setError(getErrorMessage(mutationError)),
  });
  const orderClearMutation = trpc.stock.orderClear.useMutation({
    onSuccess: (items) => { void utils.stock.orderList.setData(undefined, items); refreshOrderQueries(); setNotice("ล้างรายการสั่งซื้อเรียบร้อย — เริ่มสะสมรายการใหม่ได้เลย"); },
    onError: (mutationError) => setError(getErrorMessage(mutationError)),
  });
  const addAllLowStockToOrders = () => {
    const lowStockProducts = allProducts.filter((product) => product.active === 1 && product.stock <= product.reorderPoint);
    if (lowStockProducts.length === 0) { setNotice("ไม่มีสินค้าที่ต่ำกว่าจุดสั่งซื้อในตอนนี้"); return; }
    for (const product of lowStockProducts) orderAddMutation.mutate({ productId: product.id, qty: orderSuggest(product), actor, actorRole });
    setStockTab("orders");
  };
  const actor = userName || "ผู้ใช้ระบบ";
  const actorRole = roleThaiLabel(role);
  const inventoryValue = products.reduce((sum, product) => sum + product.stock * product.cost, 0);
  // ROUND 64 — จำนวนสินค้าที่ยังไม่มีราคาขาย (ใช้ทั้ง active + ปิดการขาย — ตั้งราคาได้ทุกรายการ)
  const zeroPriceCount = allProducts.filter((product) => product.price === 0).length;
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
  const editUnitOptions = editTarget && !["ชิ้น", "ขวด", "ถุง", "กล่อง", "แพ็ก", "กรัม"].includes(editTarget.unit) ? ["ชิ้น", "ขวด", "ถุง", "กล่อง", "แพ็ก", "กรัม", editTarget.unit] : ["ชิ้น", "ขวด", "ถุง", "กล่อง", "แพ็ก", "กรัม"];
  // Round 31-12 — รับเข้าแบบถุง (น้ำแข็ง): ถุง × กรัม/ถุง → คำนวณเป็นกรัมให้ช่องจำนวน
  const selectedReceiveProduct = products.find((product) => String(product.id) === receiveForm.productId) ?? null;
  const [bagCount, setBagCount] = useState("");
  const [bagGrams, setBagGrams] = useState("10000");
  const applyBags = () => {
    const bags = Math.max(0, Math.floor(Number(bagCount) || 0));
    const grams = Math.max(0, Math.floor(Number(bagGrams) || 0));
    if (bags <= 0 || grams <= 0) { setError("ระบุจำนวนถุงและกรัมต่อถุงก่อนกดคำนวณ"); return; }
    setReceiveForm((current) => ({ ...current, purchaseQty: String(bags * grams) }));
    setError("");
  };
  // คำนวณต้นทุนจากเงินที่จ่ายจริงหารด้วยจำนวนรับจริง (ซื้อ + แถม)
  const receivePreview = (() => {
    const purchaseQty = Math.floor(Number(receiveForm.purchaseQty)) || 0;
    const freeQty = Math.floor(Number(receiveForm.freeQty)) || 0;
    const paidAmount = Number(receiveForm.paidAmount);
    const totalQty = purchaseQty + freeQty;
    const validPaid = Number.isFinite(paidAmount) && paidAmount >= 0 ? paidAmount : 0;
    const roundAvg = totalQty > 0 ? Math.round((validPaid / totalQty) * 100) / 100 : 0;
    const oldQty = Math.max(0, selectedReceiveProduct?.stock ?? 0);
    const oldCost = selectedReceiveProduct?.cost ?? 0;
    const blended = totalQty > 0 && receiveForm.paidAmount.trim() !== "" ? Math.round(((oldQty * oldCost + validPaid) / (oldQty + totalQty)) * 100) / 100 : null;
    return { purchaseQty, freeQty, paidAmount: validPaid, totalQty, roundAvg, blended };
  })();
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
      closeModal();
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
  // ROUND 79 — บันทึกผ่าน mutateAsync ใน submitReceiveCart: วนทีละรายการใน "รายการรับเข้า"
  // (ผลลัพธ์/ความล้มเหลวจัดการที่ตัววนเอง — ตัว handler แค่เคลียร์ cache ให้ตัวเลขคลังสดทุกครั้ง)
  const receiveMutation = trpc.stock.receive.useMutation({
    onSuccess: () => refreshQueries(),
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
    const isMoney = newItem.sellMode === "money";
    const tierResult = serializeTierRows(newItem.tiers);
    if (isMoney && tierResult.error) { setError(tierResult.error); return; }
    if (isMoney && !tierResult.json) { setError("สินค้าขายเป็นราคา ต้องมีช่องราคาอย่างน้อย 1 ช่อง เช่น ฿1 = 200 กรัม"); return; }
    const price = isMoney ? tierResult.minPrice : Number(newItem.price);
    // ROUND 54 (user) — อนุญาต ฿0 = ยังไม่ได้ตั้งราคา (สินค้านำเข้าทั้งหมดยังไม่มีราคา) — ห้ามติดลบ
    if (!Number.isFinite(price) || price < 0) { setError("ราคาขายต้องเป็นตัวเลข 0 ขึ้นไป"); return; }
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
      size: composeSize(newItem.sizeNum, newItem.sizeUnit) || undefined,
      imageUrl: newItem.imageUrl || undefined,
      unit: newItem.unit,
      price,
      cost,
      reorderPoint: Number(newItem.reorder) >= 0 ? Math.floor(Number(newItem.reorder)) : undefined,
      category: newItem.category,
      emoji: "🛍️",
      color: "mint",
      sellMode: isMoney ? "money" : undefined,
      priceTiers: isMoney ? tierResult.json : undefined,
      quickPick: newItem.quickPick ? 1 : 0,
      actor,
      actorRole,
    });
  };
  // ROUND 79 (user) — รับเข้าทีละหลายรายการ: ตรวจรายการที่กำลังกรอกให้ครบก่อนเก็บเข้า "รายการรับเข้า"
  const validateReceiveEntry = (): { entry: ReceiveCartEntry } | { error: string } => {
    const productId = Number(receiveForm.productId);
    if (!productId) return { error: "กรุณาเลือกสินค้าที่ต้องการรับเข้า (ยิงบาร์โค้ด หรือค้นหาด้วยรหัส / ชื่อ)" };
    const purchaseQty = Math.floor(Number(receiveForm.purchaseQty));
    const freeQty = Math.floor(Number(receiveForm.freeQty));
    const paidAmount = Number(receiveForm.paidAmount);
    if (!Number.isInteger(purchaseQty) || purchaseQty <= 0) return { error: "จำนวนที่ซื้อต้องเป็นจำนวนเต็มมากกว่า 0" };
    if (!Number.isInteger(freeQty) || freeQty < 0) return { error: "จำนวนแถมต้องเป็นจำนวนเต็ม 0 ขึ้นไป" };
    if (!Number.isFinite(paidAmount) || paidAmount < 0) return { error: "เงินที่จ่ายจริงต้องเป็นตัวเลข 0 ขึ้นไป" };
    return { entry: { productId, lot: receiveForm.lot.trim(), expiry: receiveForm.expiry, purchaseQty: String(purchaseQty), freeQty: String(freeQty), paidAmount: String(paidAmount) } };
  };
  const pushReceiveEntry = () => {
    const result = validateReceiveEntry();
    if ("error" in result) { setError(result.error); return; }
    setError("");
    setReceiveCart((current) => [...current, result.entry]);
    // ล้างช่องกรอกให้พร้อมยิงสินค้าตัวถัดไปทันที (คงวันหมดอายุไว้ — มักส่งมาเป็นรอบเดียวกัน)
    setReceiveForm({ ...emptyReceiveForm(), expiry: receiveForm.expiry });
  };
  const editReceiveEntry = (index: number) => {
    const entry = receiveCart[index];
    if (!entry) return;
    setReceiveCart((current) => current.filter((_, i) => i !== index));
    setReceiveForm({ productId: String(entry.productId), lot: entry.lot, expiry: entry.expiry, purchaseQty: entry.purchaseQty, freeQty: entry.freeQty, paidAmount: entry.paidAmount });
    setError("");
  };
  const removeReceiveEntry = (index: number) => setReceiveCart((current) => current.filter((_, i) => i !== index));
  // ปิดโมดัลรับเข้า: ถ้ายังมีรายการค้างใน "รายการรับเข้า" ให้ยืนยันก่อนทิ้ง (กันพลาดข้อมูลที่คีย์ไว้)
  const closeReceiveGuard = () => {
    const editorHasData = Boolean(receiveForm.productId) && (receiveForm.purchaseQty.trim() !== "" || receiveForm.freeQty.trim() !== "0" || receiveForm.paidAmount.trim() !== "");
    if (receiveCart.length > 0 || editorHasData) { setReceiveDiscardOpen(true); return; }
    closeModal();
  };
  // ROUND 79 — บันทึกทุกรายการพร้อมกัน (วนเรียงทีละตัว) · ตัวที่กำลังกรอกยังไม่ว่าง = เก็บเข้ารายการให้อัตโนมัติก่อน
  const submitReceiveCart = async () => {
    let cart = receiveCart;
    const editorFilled = Boolean(receiveForm.productId) && (receiveForm.purchaseQty.trim() !== "" || receiveForm.freeQty.trim() !== "0" || receiveForm.paidAmount.trim() !== "");
    if (editorFilled) {
      const result = validateReceiveEntry();
      if ("error" in result) { setError(result.error); return; }
      cart = [...receiveCart, result.entry];
      setReceiveCart(cart);
    }
    if (cart.length === 0) { setError("ยังไม่มีรายการที่จะรับเข้า — ยิงบาร์โค้ดสินค้า กรอกจำนวน แล้วกด เพิ่มลงรายการ ก่อนบันทึก"); return; }
    const saved: string[] = [];
    for (let index = 0; index < cart.length; index++) {
      const entry = cart[index];
      const product = allProducts.find((item) => item.id === entry.productId);
      setReceiveProgress({ done: index, total: cart.length });
      try {
        const result = await receiveMutation.mutateAsync({
          productId: entry.productId,
          lot: entry.lot || undefined,
          expiryDate: entry.expiry || null,
          purchaseQty: Math.floor(Number(entry.purchaseQty)),
          freeQty: Math.floor(Number(entry.freeQty)),
          paidAmount: Number(entry.paidAmount),
          actor,
          actorRole,
        });
        const totalReceived = result.lots.reduce((sum, lot) => sum + lot.qty, 0);
        saved.push(`${result.product.name} +${totalReceived.toLocaleString("th-TH")} ${result.product.unit}`);
      } catch (mutationError) {
        // เก็บตัวที่ติดขัด + ที่ยังไม่ได้บันทึกไว้ในรายการต่อ — แจ้งกลางจอให้เห็นชัด (สไตล์ r78)
        setReceiveCart(cart.slice(index));
        setReceiveProgress(null);
        setError(getErrorMessage(mutationError));
        blocker.error(
          "บันทึกการรับเข้าไม่สำเร็จ",
          `รายการที่ ${index + 1}: ${product?.name ?? `สินค้า #${entry.productId}`}\n${getErrorMessage(mutationError)}${saved.length > 0 ? `\n\nบันทึกสำเร็จแล้ว ${saved.length} รายการ — ที่เหลือยังอยู่ในรายการรับเข้า แก้ไขแล้วกดบันทึกใหม่ได้เลย` : "\n\nรายการนี้ยังอยู่ในรายการรับเข้า แก้ไขแล้วกดบันทึกใหม่ได้เลย"}`,
          { hint: "ตรวจข้อมูลของรายการที่ติดขัด (จำนวน/ต้นทุน/สินค้า) แล้วกดปุ่มบันทึกอีกครั้ง" },
        );
        return;
      }
    }
    setReceiveProgress(null);
    setReceiveCart([]);
    closeModal();
    setReceiveForm(emptyReceiveForm());
    setError("");
    setNotice(`รับเข้าสินค้า ${cart.length} รายการสำเร็จ: ${saved.join(" · ")}`);
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
    setReceiveForm({ ...emptyReceiveForm(), productId: String(product.id) });
    setReceiveOpen(true);
    setError("");
  };
  const openCountFor = (product: SqliteProduct) => {
    if (!hasStockCount) { setUpgradeFeature("stockCount"); return; } // ROUND 61 — นับสต็อกเป็นฟีเจอร์โปรพลัส
    setDetailTarget(null);
    setCountForm({ ...emptyCountForm, productId: String(product.id) });
    setCountOpen(true);
    setError("");
  };
  const openEditProduct = (product: SqliteProduct) => {
    setEditTarget(product);
    const parsedSize = parseSizeInput(product.size);
    setEditForm({ name: product.name, category: product.category || PRODUCT_CATEGORIES[0], unit: product.unit, price: String(product.price), cost: String(product.cost), reorder: String(product.reorderPoint), sizeNum: parsedSize.num, sizeUnit: parsedSize.unit, barcode: product.barcode ?? "", imageUrl: product.imageUrl ?? "", sellMode: product.sellMode === "money" ? "money" : "unit", quickPick: product.quickPick === 1, tiers: parseTierRows(product.priceTiers) });
    setEditOpen(true);
    setManageError("");
  };
  const submitEditProduct = () => {
    if (!editTarget) return;
    const name = editForm.name.trim();
    if (!name) { setManageError("กรุณาระบุชื่อสินค้า"); return; }
    const isMoney = editForm.sellMode === "money";
    const tierResult = serializeTierRows(editForm.tiers);
    if (isMoney && tierResult.error) { setManageError(tierResult.error); return; }
    if (isMoney && !tierResult.json) { setManageError("สินค้าขายเป็นราคา ต้องมีช่องราคาอย่างน้อย 1 ช่อง"); return; }
    const price = isMoney ? tierResult.minPrice : Number(editForm.price);
    // ROUND 54 (user) — แก้ไขสินค้าราคา ฿0 ได้ (บันทึกชื่อ/ขนาด/หน่วยก่อนตั้งราคา) — ห้ามติดลบ
    if (!Number.isFinite(price) || price < 0) { setManageError("ราคาขายต้องเป็นตัวเลข 0 ขึ้นไป"); return; }
    const cost = editForm.cost.trim() === "" ? undefined : Number(editForm.cost);
    if (cost !== undefined && !(cost >= 0)) { setManageError("ต้นทุนต่อหน่วยต้องเป็นตัวเลข 0 ขึ้นไป"); return; }
    const reorderPoint = editForm.reorder.trim() === "" ? undefined : Number(editForm.reorder);
    if (reorderPoint !== undefined && (!Number.isInteger(reorderPoint) || reorderPoint < 0)) { setManageError("จุดสั่งซื้อขั้นต่ำต้องเป็นจำนวนเต็ม 0 ขึ้นไป"); return; }
    setManageError("");
    updateMutation.mutate({ productId: editTarget.id, name, category: editForm.category, unit: editForm.unit, price, cost, reorderPoint, barcode: editForm.barcode.trim() || null, size: composeSize(editForm.sizeNum, editForm.sizeUnit) || null, imageUrl: editForm.imageUrl || null, sellMode: isMoney ? "money" : "unit", priceTiers: isMoney ? tierResult.json : null, quickPick: editForm.quickPick ? 1 : 0, actor, actorRole });
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
  // Round 32-26 — รายการคงคลัง: ส่งออก CSV/Excel + สั่งพิมพ์ พร้อมแถว "ยอดยกมา" นำหน้าตาราง
  const stockExportRows = () => {
    const totalQty = productCards.reduce((sum, card) => sum + card.product.stock, 0);
    const openingValue = products.reduce((sum, product) => sum + product.stock * product.cost, 0);
    const rows: string[][] = [
      ["สินค้า", "รหัส SKU", "บาร์โค้ด", "หน่วยขาย", "คงเหลือ", "ต้นทุน/หน่วย", "มูลค่ารวม (ต้นทุน)", "ล็อต", "หมดอายุถัดไป", "สถานะ"],
      ["ยอดยกมา — มูลค่าคงคลังทั้งหมด", "", "", "", exportCount(totalQty), "", exportNumber(openingValue), "", "", `สินค้า ${productCards.length} รายการ`],
      ...filteredCards.map((card) => [
        card.product.name, card.product.sku, card.product.barcode ?? "—", card.product.unit, exportCount(card.product.stock),
        exportNumber(card.product.cost), exportNumber(card.product.stock * card.product.cost),
        exportCount(card.lots.length), formatExpiry(card.nextExpiry), card.status,
      ]),
      ["รวมทั้งคลัง", "", "", "", exportCount(totalQty), "", exportNumber(openingValue), exportCount(stockRows.length), "", ""],
    ];
    return rows;
  };
  const downloadStockCsv = () => {
    if (!canExport) { setUpgradeFeature("importExport"); return; } // ROUND 61 — ส่งออกเป็นฟีเจอร์โปร
    if (stockRows.length === 0) { setNotice("ยังไม่มีรายการคงคลังให้ส่งออก"); return; }
    const csv = "\uFEFF" + stockExportRows().map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n");
    const link = document.createElement("a");
    const today = new Date();
    const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = `stock-report-${stamp}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    setNotice(`ส่งออกรายงานสต็อกเรียบร้อยแล้ว · ${filteredCards.length} รายการ · รวมแถวยอดยกมา`);
  };
  const downloadStockXlsx = () => {
    if (!canExport) { setUpgradeFeature("importExport"); return; } // ROUND 61 — ส่งออกเป็นฟีเจอร์โปร
    if (stockRows.length === 0) { setNotice("ยังไม่มีรายการคงคลังให้ส่งออก"); return; }
    // ROUND 59 — ใช้ตัวส่งออกกลางของระบบ: ตัวเลขมีลูกน้ำ · แปลงเฉพาะคอลัมน์ตัวเลขที่ระบุ
    // (บาร์โค้ดคงเป็นข้อความ ไม่กลายเป็นเลขวิทยาศาสตร์) · คอลัมน์กว้างพอดีเนื้อหาอัตโนมัติ
    downloadXlsxFile("stock-report", "รายการคงคลัง", stockExportRows(), [4, 5, 6, 7]);
    setNotice(`ส่งออกรายการคงคลัง Excel แล้ว · ${filteredCards.length} รายการ · รวมแถวยอดยกมา`);
  };
  const printStockReport = () => {
    if (!canExport) { setUpgradeFeature("importExport"); return; } // ROUND 61 — ส่งออก/พิมพ์รายงานเป็นฟีเจอร์โปร
    if (stockRows.length === 0) { setNotice("ยังไม่มีรายการคงคลังที่จะพิมพ์"); return; }
    const totalQty = productCards.reduce((sum, card) => sum + card.product.stock, 0);
    const openingValue = products.reduce((sum, product) => sum + product.stock * product.cost, 0);
    // ROUND 63 (user) — พิมพ์ผ่านพรีวิวก่อนเสมอ (เหมือนจุดพิมพ์อื่นทั้งระบบ): เห็นตาราง
    // เอกสาร A4 ที่จะออกเครื่องพิมพ์ แล้วเลือก พิมพ์ / PDF / CSV / Excel จากปุ่มเดียวกัน
    setDocPreview({
      kind: "stock",
      title: "พรีวิวก่อนพิมพ์รายงานสินค้าคงคลัง",
      periodLabel: `ณ วันที่พิมพ์ ${new Date().toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" })} · ตามตัวกรอง${statusFilter !== "ทั้งหมด" ? `สถานะ ${statusFilter}` : "ทั้งหมด"}${manageSearch.trim() ? ` และคำค้น “${manageSearch.trim()}”` : ""}`,
      label: "สินค้าคงคลัง",
      fileName: "stock-report", sheetName: "รายการคงคลัง",
      rows: [
        ["สินค้า", "รหัส/บาร์โค้ด", "หน่วย", "คงเหลือ", "ต้นทุน/หน่วย", "มูลค่ารวม", "สถานะ"],
        ["ยอดยกมา — มูลค่าคงคลังทั้งหมด", `${productCards.length} รายการ`, "", exportCount(totalQty), "", exportNumber(openingValue), ""],
        ...filteredCards.map((card) => [card.product.name, card.product.barcode ?? card.product.sku, card.product.unit, exportCount(card.product.stock), exportNumber(card.product.cost), exportNumber(card.product.stock * card.product.cost), card.status]),
        ["รวมทั้งคลัง", `${filteredCards.length} รายการ`, "", exportCount(totalQty), "", exportNumber(openingValue), ""],
      ],
      numericCols: [3, 4, 5],
      preferred: "print",
      doc: {
        fileName: "stock-report.pdf", title: "รายงานสินค้าคงคลัง",
        periodLabel: `ณ วันที่พิมพ์ ${new Date().toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" })} · ตามตัวกรอง${statusFilter !== "ทั้งหมด" ? `สถานะ ${statusFilter}` : "ทั้งหมด"}${manageSearch.trim() ? ` และคำค้น “${manageSearch.trim()}”` : ""}`,
        meta: [["ยอดยกมา", `สินค้า ${filteredCards.length} รายการ · ${totalQty.toLocaleString("th-TH")} หน่วย`], ["มูลค่าคงคลังรวม (ต้นทุน)", money(openingValue)], ["ล็อตทั้งหมด", `${stockRows.length} ล็อต`]],
        columns: ["สินค้า", "รหัส/บาร์โค้ด", "หน่วย", "คงเหลือ", "ต้นทุน/หน่วย", "มูลค่ารวม", "สถานะ"], numericCols: [3, 4, 5],
        rows: [
          ["ยอดยกมา — มูลค่าคงคลังทั้งหมด", `${productCards.length} รายการ`, "", exportCount(totalQty), "", exportNumber(openingValue), ""],
          ...filteredCards.map((card) => [card.product.name, card.product.barcode ?? card.product.sku, card.product.unit, exportCount(card.product.stock), exportNumber(card.product.cost), exportNumber(card.product.stock * card.product.cost), card.status]),
        ],
        totalsRow: ["รวมทั้งคลัง", `${filteredCards.length} รายการ`, "", exportCount(totalQty), "", exportNumber(openingValue), ""],
        brandName: "ร้านค้าสวัสดิการ", footnote: "แถวแรกคือยอดยกมา (มูลค่าคงคลัง ณ วันที่พิมพ์) · รายละเอียดล็อตและวันหมดอายุดูได้จากหน้าจอรายการคงคลัง",
      },
      hasTotalsRow: true,
      downloadNoticeBase: "รายงานสินค้าคงคลัง",
      printNotice: "สั่งพิมพ์รายงานคงคลังแล้ว — เอกสาร A4 พร้อมแถวยอดยกมา",
    });
  };
  const orderExportRows = () => [
    ["สินค้า", "รหัส SKU", "คงเหลือ", "จำนวนที่จะสั่ง", "หน่วย", "ต้นทุน/หน่วย", "มูลค่ารวมโดยประมาณ", "หมายเหตุ"],
    ...orderItems.map((item) => [item.name, item.sku, exportCount(item.stock), exportCount(item.qty), item.unit, exportNumber(item.cost), exportNumber(item.qty * item.cost), item.note ?? ""]),
    ["รวม", "", "", exportCount(orderItems.reduce((sum, item) => sum + item.qty, 0)), "", "", exportNumber(orderTotalValue), `${orderItems.length} รายการ`],
  ];
  const downloadOrderCsv = () => {
    if (!canExport) { setUpgradeFeature("importExport"); return; } // ROUND 61 — ส่งออกเป็นฟีเจอร์โปร
    if (orderItems.length === 0) { setNotice("ยังไม่มีรายการที่จะสั่งซื้อ"); return; }
    const csv = "\uFEFF" + orderExportRows().map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = "purchase-order.csv";
    link.click();
    URL.revokeObjectURL(link.href);
    setNotice(`ส่งออกรายการสั่งซื้อแล้ว · ${orderItems.length} รายการ`);
  };
  const printOrderList = () => {
    if (orderItems.length === 0) { setNotice("ยังไม่มีรายการที่จะสั่งซื้อ"); return; }
    // ROUND 63 (user) — พิมพ์ผ่านพรีวิวก่อน เหมือนจุดพิมพ์อื่นทั้งระบบ
    setDocPreview({
      kind: "orders",
      title: "พรีวิวก่อนพิมพ์รายการสั่งซื้อสินค้า",
      periodLabel: `สะสมไว้ ${orderItems.length} รายการ · พิมพ์เมื่อ ${new Date().toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" })}`,
      label: "รายการสั่งซื้อ",
      fileName: "purchase-order", sheetName: "รายการสั่งซื้อ",
      rows: [
        ["สินค้า", "รหัส SKU", "คงเหลือ", "จะสั่ง", "หน่วย", "ต้นทุน/หน่วย", "มูลค่ารวม", "หมายเหตุ"],
        ...orderItems.map((item) => [item.name, item.sku, exportCount(item.stock), exportCount(item.qty), item.unit, exportNumber(item.cost), exportNumber(item.qty * item.cost), item.note ?? "—"]),
        ["รวม", "—", "—", exportCount(orderItems.reduce((sum, item) => sum + item.qty, 0)), "—", "—", exportNumber(orderTotalValue), `${orderItems.length} รายการ`],
      ],
      numericCols: [2, 3, 5, 6],
      preferred: "print",
      doc: {
        fileName: "purchase-order.pdf", title: "รายการสั่งซื้อสินค้า",
        periodLabel: `สะสมไว้ ${orderItems.length} รายการ · พิมพ์เมื่อ ${new Date().toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" })}`,
        meta: [["จำนวนรายการ", `${orderItems.length} รายการ`], ["มูลค่ารวมโดยประมาณ", money(orderTotalValue)]],
        columns: ["สินค้า", "รหัส SKU", "คงเหลือ", "จะสั่ง", "หน่วย", "ต้นทุน/หน่วย", "มูลค่ารวม", "หมายเหตุ"], numericCols: [2, 3, 5, 6],
        rows: orderItems.map((item) => [item.name, item.sku, exportCount(item.stock), exportCount(item.qty), item.unit, exportNumber(item.cost), exportNumber(item.qty * item.cost), item.note ?? "—"]),
        totalsRow: ["รวม", "—", "—", exportCount(orderItems.reduce((sum, item) => sum + item.qty, 0)), "—", "—", exportNumber(orderTotalValue), `${orderItems.length} รายการ`],
        brandName: "ร้านค้าสวัสดิการ", footnote: "ใช้ตรวจทานก่อนสั่งซื้อจริง เพื่อไม่ให้ตกหล่น · ลบรายการที่รับเข้าแล้วออกจากลิสต์ได้ที่หน้าจอ",
      },
      hasTotalsRow: true,
      downloadNoticeBase: "รายการสั่งซื้อ",
      printNotice: "สั่งพิมพ์รายการสั่งซื้อแล้ว",
    });
  };
  // ROUND 63 — รันรูปแบบที่เลือกจากพรีวิว (พิมพ์ / PDF / CSV / Excel — เหมือนหน้ารายงาน)
  const runDocPreview = async (format: ExportFormat) => {
    const state = docPreview;
    if (!state) return;
    try {
      if (format === "csv") {
        downloadCsvFile(state.fileName, state.rows);
        setNotice(`ดาวน์โหลด${state.downloadNoticeBase} CSV แล้ว`);
      } else if (format === "xlsx") {
        downloadXlsxFile(state.fileName, state.sheetName, state.rows, state.numericCols);
        setNotice(`ดาวน์โหลด${state.downloadNoticeBase} Excel แล้ว`);
      } else if (format === "pdf") {
        await downloadReportPdf(state.doc);
        setNotice(`ดาวน์โหลด${state.downloadNoticeBase} PDF แล้ว`);
      } else {
        printReportDoc(state.doc);
        setNotice(state.printNotice);
      }
    } finally {
      setDocPreview(null);
    }
  };
  const closeModal = () => { setAddOpen(false); setReceiveOpen(false); setCountOpen(false); setEditOpen(false); setDetailTarget(null); setLotCounts({}); setCountMode("total"); setError(""); setReceiveCart([]); setReceiveProgress(null); countKeepRef.current = false; onClose?.(); };
  return <div className={embeddedAction ? "stock-embedded" : "stock-page"}><SectionHeader eyebrow="คลังสินค้าและต้นทุน" title="สต็อกสินค้า" description="ติดตามจำนวนคงเหลือ Lot วันหมดอายุ และต้นทุนสินค้าในคลัง" action={<><button className="outline-button" onClick={() => { if (hasStockCount) setCountSheetOpen(true); else setUpgradeFeature("stockCount"); }} title="พิมพ์ใบนับสต็อก A4 — เอาออกไปนับของจริงที่หน้าชั้นวาง แล้วกลับมากรอกผลที่เมนูนับสต็อก">{!hasStockCount && <Lock size={14} />}<Printer size={16} /> ใบนับสต๊อก</button><button className="outline-button bulk-price-entry" onClick={() => { setBulkPriceOpen(true); }} title="ตั้งราคา/ต้นทุนหลายรายการพร้อมกัน — เหมาะกับสินค้าใหม่ที่ยังไม่มีราคาเป็นจำนวนมาก"><SlidersHorizontal size={16} /> ปรับราคาหลายรายการ{zeroPriceCount > 0 && <span className="bulk-price-badge">{zeroPriceCount} รายการยังไม่มีราคา</span>}</button><div className="stock-catalog-actions"><button type="button" className="outline-button stock-catalog-trigger" aria-haspopup="menu" aria-expanded={catalogMenuOpen} onClick={() => setCatalogMenuOpen((open) => !open)}><PackagePlus size={16} /> สินค้าและรับเข้า <ChevronDown size={14} /></button>{catalogMenuOpen && <div className="stock-catalog-menu" role="menu"><button type="button" role="menuitem" onClick={() => { setCatalogMenuOpen(false); setAddOpen(true); setError(""); }}><Plus size={16} /><span><b>เพิ่มสินค้าใหม่</b><small>สร้างรายการสินค้าและกำหนดราคา</small></span></button><button type="button" role="menuitem" onClick={() => { setCatalogMenuOpen(false); setReceiveOpen(true); setError(""); }}><PackagePlus size={16} /><span><b>{isAdminRole(role) ? "รับสินค้าเข้า" : "ขอรับสินค้าเข้า"}</b><small>เพิ่มสต็อก พร้อมกรอกจำนวนซื้อ/ของแถม/เงินที่จ่าย</small></span></button></div>}</div></>} /><div className="stock-overview"><div className="stock-stat"><span className="stat-icon blue"><Boxes size={18} /></span><div><small>มูลค่าสต็อกทั้งหมด</small><strong>{money(inventoryValue)}</strong></div></div><div className="stock-stat"><span className="stat-icon amber"><PackageSearch size={18} /></span><div><small>รายการทั้งหมด</small><strong>{products.length} <em>SKU</em></strong></div></div><div className="stock-stat"><span className="stat-icon red"><Activity size={18} /></span><div><small>ต้องสั่งซื้อ</small><strong className="red-text">{lowStockCount} <em>รายการ</em></strong></div></div><div className="stock-stat"><span className="stat-icon green"><FileBarChart size={18} /></span><div><small>กำไรขั้นต้นเฉลี่ย</small><strong className="green-text">{avgMargin.toFixed(1)}%</strong></div></div></div><section className="dash-workbench stock-workbench"><div className="dash-tabbar" role="tablist" aria-label="ส่วนการจัดการสต็อก"><button type="button" role="tab" aria-selected={stockTab === "inventory"} className={`dash-tab${stockTab === "inventory" ? " active" : ""}`} onClick={() => setStockTab("inventory")}><Boxes size={15} /> รายการคงคลัง<small>{filteredCards.length} รายการ</small></button><button type="button" role="tab" aria-selected={stockTab === "orders"} className={`dash-tab${stockTab === "orders" ? " active" : ""}`} onClick={() => setStockTab("orders")}><ShoppingCart size={15} /> รายการสั่งซื้อ{orderItems.length > 0 && <i className="tab-badge amber" title={`${orderItems.length} รายการที่รอสั่งซื้อ`}>{orderItems.length}</i>}</button></div><div className="dash-tab-body">{stockTab === "inventory" && <section className="panel table-panel"><div className="table-toolbar"><div><h2>รายการคงคลัง</h2><p>อัปเดตล่าสุดเมื่อ {updatedLabel}</p></div><div className="toolbar-actions"><div className="search-field"><Search size={16} /><input value={manageSearch} onChange={(event) => setManageSearch(event.target.value)} placeholder="ค้นหาชื่อสินค้า รหัส SKU หรือเลขท้ายบาร์โค้ด" /><button type="button" className="scan-camera-btn" onClick={() => { if (hasCameraScan) setSearchCameraOpen(true); else setUpgradeFeature("cameraScan"); }} aria-label="สแกนบาร์โค้ดด้วยกล้องเพื่อค้นหาสินค้า" title="สแกนด้วยกล้องโทรศัพท์ — ยิงบาร์โค้ดที่ตัวสินค้าแล้วระบบหาให้เอง เหมาะกับงานนับสต็อก"><Camera size={16} /></button></div><div className="filter-pills">{stockStatusFilters.map((item) => <button className={statusFilter === item ? "active" : ""} key={item} onClick={() => setStatusFilter(item)}>{item}{item !== "ทั้งหมด" && <span>{cardStatusCounts[item]}</span>}</button>)}</div><button className="outline-button" onClick={() => { if (hasStockCount) { setCountOpen(true); setError(""); } else setUpgradeFeature("stockCount"); }}>{!hasStockCount && <Lock size={14} />}<ClipboardList size={16} /> นับสต็อก</button><button className="outline-button" onClick={downloadStockXlsx}><FileBarChart size={16} /> Excel</button><button className="outline-button" onClick={downloadStockCsv}><Download size={16} /> CSV</button><button className="outline-button" onClick={printStockReport}><Printer size={16} /> พิมพ์</button></div></div><div className="table-filter-summary"><span><ClipboardList size={13} /> {statusFilter === "ทั้งหมด" ? "สินค้าทั้งหมดในคลัง · กดแถวเพื่อดูล็อตและจัดการสินค้า" : `กรองตามสถานะ: ${statusFilter}`}</span><span>แสดง {filteredCards.length} จาก {productCards.length} สินค้า · {stockRows.length} ล็อต</span></div><div className="table-wrap">{stockQuery.isLoading || allProductsQuery.isLoading ? <div className="table-loading"><PackageSearch size={22} /><b>กำลังโหลดรายการคงคลัง</b><span>ดึงข้อมูลสินค้าและล็อตจากระบบ</span></div> : stockQuery.isError ? <div className="entity-state error" role="alert"><PackageSearch size={22} /><b>โหลดรายการคงคลังไม่สำเร็จ</b><span>{getErrorMessage(stockQuery.error)}</span></div> : filteredCards.length === 0 ? <div className="entity-state"><PackageSearch size={22} /><b>ไม่พบสินค้าตามเงื่อนไข</b><span>ลองเปลี่ยนคำค้นหาหรือสถานะ</span></div> : <table className="entity-table rows-stock" aria-label="รายการสินค้าในคลัง"><thead><tr><th>สินค้า</th><th className="num">คงเหลือ</th><th>หน่วยขาย</th><th className="num">ราคาขาย</th><th className="num hide-sm">ล็อต</th><th className="hide-sm">หมดอายุถัดไป</th><th>สถานะ</th><th>สั่งซื้อ</th><th aria-label="เปิดจัดการ" /></tr></thead><tbody>{filteredCards.map((card) => <tr className="clickable" key={card.product.id} onClick={() => setDetailTarget(card.product)} title={`ดูล็อตและจัดการ ${card.product.name}`}><td><div className="cell-product"><span className="cell-thumb">{card.product.imageUrl ? <img src={card.product.imageUrl} alt="" /> : <span className="cell-thumb-fallback">{card.product.emoji ?? "🛍️"}</span>}</span><div><span className="cell-strong">{card.product.name}</span><small className="cell-sub">{card.product.sku}{card.product.size ? ` · ${card.product.size}` : ""}</small></div></div></td><td className="num"><span className={`cell-qty${card.product.stock <= card.product.reorderPoint ? " low" : ""}`}>{card.product.stock}</span></td><td><small className="cell-unit">{card.product.unit}</small></td><td className="cell-num">{money(card.product.price)}</td><td className="cell-num hide-sm">{card.lots.length}</td><td className="hide-sm"><small className="cell-mono" style={{ marginTop: 0 }}>{formatExpiry(card.nextExpiry)}</small></td><td><StatusPill tone={card.tone}>{card.status}</StatusPill></td><td><button type="button" className="mini-button order-add-btn" disabled={orderAddMutation.isPending} onClick={(event) => { event.stopPropagation(); orderAddMutation.mutate({ productId: card.product.id, qty: orderSuggest(card.product), actor, actorRole }); }} title={`เพิ่ม ${card.product.name} เข้ารายการสั่งซื้อ (${orderSuggest(card.product)} ${card.product.unit})`}><ShoppingCart size={13} /> สั่ง</button></td><td><span className="row-chevron"><ChevronRight size={15} /></span></td></tr>)}</tbody></table>}</div>{notice && <div className="notice-bar"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}{error && !addOpen && !receiveOpen && !countOpen && <div className="notice-bar error"><CircleAlert size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}{manageNotice && <div className="notice-bar"><Check size={16} /> {manageNotice}<button onClick={() => setManageNotice("")}><X size={14} /></button></div>}{manageError && !editOpen && <div className="notice-bar error"><CircleAlert size={16} /> {manageError}<button onClick={() => setManageError("")}><X size={14} /></button></div>}</section>}{stockTab === "orders" && <section className="panel table-panel order-list-panel"><div className="table-toolbar"><div><h2>รายการสั่งซื้อ</h2><p>สะสมสินค้าที่จะสั่งเข้าไว้ที่นี่ก่อน — กันตกหล่น: เพิ่มด้วยปุ่ม "สั่ง" ในตารางคงคลัง ยิงบาร์โค้ด หรือกดเติมสินค้าสต็อกต่ำทั้งหมด</p></div><div className="toolbar-actions"><button className="outline-button" onClick={downloadOrderCsv}><Download size={15} /> CSV</button><button className="outline-button" onClick={printOrderList}><Printer size={15} /> พิมพ์</button><button className="outline-button" onClick={addAllLowStockToOrders} disabled={orderAddMutation.isPending}><PackagePlus size={15} /> เติมสินค้าสต็อกต่ำ</button>{orderItems.length > 0 && <button className="danger-outline-button" onClick={() => setClearOrdersOpen(true)} disabled={orderClearMutation.isPending}><Trash2 size={15} /> ล้างรายการ</button>}</div></div><div className="order-add-row"><div className="form-scan-picker"><span className="field-label">เพิ่มสินค้าเข้ารายการ — ยิงบาร์โค้ด หรือคีย์รหัส / ชื่อ</span><ProductScanPicker products={allProducts} selectedId={null} onSelect={(product) => { if (product) orderAddMutation.mutate({ productId: product.id, qty: orderSuggest(product), actor, actorRole }); }} /></div><span className="order-add-hint"><ShoppingCart size={14} /> เลือกแล้วระบบเสนอจำนวนตามจุดสั่งซื้ออัตโนมัติ · แก้จำนวนได้ในตาราง</span></div><div className="table-filter-summary"><span><ShoppingCart size={13} /> รายการที่รอสั่งซื้อ · พิมพ์หรือส่งออกไปให้ผู้ขายได้ทันที</span><span>แสดง {orderItems.length} รายการ · มูลค่ารวมโดยประมาณ {money(orderTotalValue)}</span></div><div className="table-wrap">{orderListQuery.isLoading ? <div className="table-loading"><ShoppingCart size={22} /><b>กำลังโหลดรายการสั่งซื้อ</b><span>ดึงข้อมูลจากระบบ</span></div> : orderListQuery.isError ? <div className="entity-state error" role="alert"><CircleAlert size={22} /><b>โหลดรายการสั่งซื้อไม่สำเร็จ</b><span>{getErrorMessage(orderListQuery.error)}</span></div> : orderItems.length === 0 ? <div className="entity-state"><ShoppingCart size={22} /><b>ยังไม่มีรายการที่จะสั่งซื้อ</b><span>กดปุ่ม "สั่ง" ในตารางคงคลัง ยิงบาร์โค้ดด้านบน หรือกด "เติมสินค้าสต็อกต่ำ"</span></div> : <table className="entity-table rows-orders" aria-label="รายการสั่งซื้อ"><thead><tr><th>สินค้า</th><th>คงเหลือ</th><th className="num">จะสั่ง</th><th>หน่วย</th><th className="num">ต้นทุน/หน่วย</th><th className="num">มูลค่ารวม</th><th className="hide-sm">หมายเหตุ</th><th>การจัดการ</th></tr></thead><tbody>{orderItems.map((item) => { const draftKey = item.id; return <tr key={item.id}><td><span className="cell-strong">{item.name}</span><small className="cell-sub">{item.sku} · จุดสั่งซื้อ {item.reorderPoint}</small></td><td className="num"><span className={`cell-qty${item.stock <= item.reorderPoint ? " low" : ""}`}>{item.stock}</span></td><td className="num"><input className="order-qty-input" type="text" inputMode="numeric" value={orderQtyDrafts[draftKey] ?? String(item.qty)} onFocus={(event) => event.currentTarget.select()} onBlur={() => setOrderQtyDrafts((drafts) => { const next = { ...drafts }; delete next[draftKey]; return next; })} onChange={(event) => { const raw = event.target.value; setOrderQtyDrafts((drafts) => ({ ...drafts, [draftKey]: raw })); const parsed = Number(raw); if (raw.trim() !== "" && Number.isFinite(parsed) && parsed > 0) orderUpdateMutation.mutate({ id: item.id, qty: parsed, actor, actorRole }); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} aria-label={`จำนวนที่จะสั่ง ${item.name}`} title="คลิกแล้วพิมพ์จำนวนที่จะสั่ง" /></td><td><small className="cell-unit">{item.unit}</small></td><td className="cell-num">{money(item.cost)}</td><td className="cell-num">{money(item.qty * item.cost)}</td><td className="hide-sm"><input className="order-note-input" defaultValue={item.note ?? ""} onBlur={(event) => { const note = event.target.value.trim(); if (note !== (item.note ?? "")) orderUpdateMutation.mutate({ id: item.id, note, actor, actorRole }); }} placeholder="หมายเหตุถึงผู้ขาย" aria-label={`หมายเหตุ ${item.name}`} /></td><td><div className="row-actions"><button className="mini-button danger" disabled={orderRemoveMutation.isPending} onClick={() => orderRemoveMutation.mutate({ id: item.id, actor, actorRole })} title="ถอดออกจากรายการสั่งซื้อ (รับเข้าแล้ว หรือไม่ต้องสั่ง)"><Trash2 size={13} /> ถอด</button></div></td></tr>; })}</tbody></table>}</div>{notice && <div className="notice-bar"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}{error && !addOpen && !receiveOpen && !countOpen && <div className="notice-bar error"><CircleAlert size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="order-footer-note"><ShieldCheck size={15} /> รายการนี้ช่วยกันตกหล่นก่อนสั่งจริง — พิมพ์/ส่งออกให้ผู้ขายได้ทันที · เมื่อรับของแล้วกด "ถอด" เพื่อเอาออกจากลิสต์ (การรับเข้าบันทึกที่ปุ่มรับเข้าสินค้าตามปกติ)</div></section>}</div></section>{detailTarget && (() => { const card = productCards.find((entry) => entry.product.id === detailTarget.id); const lots = card?.lots ?? []; return <div className="modal-backdrop" onClick={() => setDetailTarget(null)}><div className="form-modal stock-detail-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">INVENTORY CARD</span><h2>{detailTarget.name}</h2><p>{detailTarget.sku} · คงเหลือ {detailTarget.stock} {detailTarget.unit}{card && <> · <StatusPill tone={card.tone}>{card.status}</StatusPill></>}</p></div><button className="icon-button" onClick={() => setDetailTarget(null)}><X size={17} /></button></div>{detailTarget.imageUrl && <div className="stock-detail-photo"><img src={detailTarget.imageUrl} alt={`รูปสินค้า ${detailTarget.name}`} /></div>}<div className="stock-detail-grid"><div><small>คงเหลือ</small><strong>{detailTarget.stock} <em>{detailTarget.unit}</em></strong></div><div><small>ราคาขาย</small><strong>{money(detailTarget.price)}</strong></div><div><small>ต้นทุนต่อหน่วย</small><strong>{money(detailTarget.cost)}</strong></div><div><small>จุดสั่งซื้อ</small><strong>{detailTarget.reorderPoint} {detailTarget.unit}</strong></div><div><small>มูลค่าคงคลัง (ต้นทุน)</small><strong>{money(detailTarget.stock * detailTarget.cost)}</strong></div><div><small>หมดอายุถัดไป</small><strong>{formatExpiry(card?.nextExpiry ?? null)}</strong></div></div><div className="stock-detail-lots"><div className="stock-detail-lots-head"><h3>ล็อตสินค้า ({lots.length})</h3><small>ระบบตัดยอดแบบเข้าก่อน-หมดอายุก่อน</small></div>{lots.length === 0 ? <div className="stock-lots-empty"><PackageSearch size={20} /><b>ยังไม่มีล็อตคงเหลือ</b><span>รับเข้าสินค้าเพื่อเริ่มติดตาม</span></div> : <div className="stock-lot-list">{lots.map((lot) => <div className={`stock-lot-row${lot.status === "ใกล้หมดอายุ" ? " expiring" : ""}`} key={lot.id}><div className="stock-lot-main"><b>Lot {lot.lot}</b><small>รับเข้า {lot.receivedAt ? formatLogDateTime(lot.receivedAt) : "—"}</small></div><div className="stock-lot-expiry"><small>หมดอายุ</small><span>{formatExpiry(lot.expiry)}</span></div><div className="stock-lot-qty"><small>คงเหลือ</small><span><b>{lot.qty}</b> {lot.unit}</span></div><StatusPill tone={lot.tone}>{lot.status}</StatusPill></div>)}</div>}</div><div className="stock-detail-actions"><button className="outline-button" onClick={() => openReceiveFor(detailTarget)}><PackagePlus size={15} /> รับเข้าสินค้า</button><button className="outline-button" onClick={() => openCountFor(detailTarget)}><ClipboardList size={15} /> นับสต็อก</button>{isAdminRole(role) && <button className="outline-button" onClick={() => openEditProduct(detailTarget)}><Settings2 size={15} /> แก้ไขข้อมูล</button>}{isAdminRole(role) && (detailTarget.active === 1 ? <button className="danger-outline-button" onClick={() => setArchiveTarget(detailTarget)}><Ban size={15} /> ปิดการขาย</button> : <button className="outline-button" onClick={() => restoreProduct(detailTarget)}><Check size={15} /> เปิดขายอีกครั้ง</button>)}{isAdminRole(role) && <button className="danger-outline-button" onClick={() => setDeleteTarget(detailTarget)}><Trash2 size={15} /> ลบรายการสินค้า</button>}</div></div></div>; })()}{receiveOpen && <div className="modal-backdrop" onClick={closeReceiveGuard}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">STOCK RECEIPT</span><h2>รับเข้าสินค้า</h2><p>ยิงบาร์โค้ด → กรอกจำนวน → Enter — สะสมหลายสินค้าแล้วบันทึกรอบเดียว</p></div><button className="icon-button" onClick={closeReceiveGuard}><X size={17} /></button></div><HelpDisclosure id="stock-receive-help" label="วิธีรับเข้าหลายรายการ / ต้นทุน"><span>ยิงทุกตัวที่รับเข้า — แต่ละตัวเข้า “รายการรอบันทึก” ก่อน ครบแล้วกดบันทึกทีเดียว · ราคาต่างกัน/ของแถมได้ ต้นทุนเก็บแบบถัวเฉลี่ยอัตโนมัติ · ตรวจชื่อสินค้าบนการ์ดยืนยันให้ตรงของจริงทุกครั้งก่อนกรอกจำนวน</span></HelpDisclosure><div className="form-grid compact-form"><div className="form-scan-picker wide"><span className="field-label">สินค้า — ยิงบาร์โค้ดที่ตัวสินค้า หรือคีย์รหัส / ชื่อ *</span><ProductScanPicker products={products} selectedId={receiveForm.productId ? Number(receiveForm.productId) : null} onSelect={(product) => setReceiveForm({ ...receiveForm, productId: product ? String(product.id) : "" })} autoFocus /></div>{selectedReceiveProduct && <div className="receive-confirm-card wide"><div className="receive-confirm-thumb">{selectedReceiveProduct.imageUrl ? <img src={selectedReceiveProduct.imageUrl} alt={`รูปสินค้า ${selectedReceiveProduct.name}`} /> : <PackageSearch size={20} />}</div><div className="receive-confirm-info"><b>{selectedReceiveProduct.name}</b><small>{selectedReceiveProduct.sku}{selectedReceiveProduct.size ? ` · ${selectedReceiveProduct.size}` : ""} · คงเหลือ {selectedReceiveProduct.stock.toLocaleString("th-TH")} {selectedReceiveProduct.unit} · ต้นทุนปัจจุบัน {money(selectedReceiveProduct.cost)}/{selectedReceiveProduct.unit}</small></div><span className="receive-confirm-badge" title="ยืนยันว่าชื่อสินค้าบนจอตรงกับของจริงที่รับเข้า ก่อนกรอกจำนวน">ตรวจชื่อสินค้าให้ถูกต้องก่อนกรอกจำนวน</span></div>}<label>Lot<input value={receiveForm.lot} onChange={(event) => setReceiveForm({ ...receiveForm, lot: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); document.getElementById("receive-qty-input")?.focus(); } }} placeholder="เช่น CR-260918-01" /></label><label>วันหมดอายุ (ปฏิทินไทย)<ThaiDatePicker value={receiveForm.expiry} onChange={(value) => setReceiveForm({ ...receiveForm, expiry: value })} ariaLabel="วันหมดอายุของล็อตที่รับเข้า" /></label><div className="receive-cost-entry wide"><div className="receive-lines-head"><span className="field-label">ต้นทุนรอบรับเข้า — กรอกจำนวนที่ซื้อ จำนวนแถม และเงินที่จ่ายจริง *</span><b>{receivePreview.totalQty > 0 ? <>รับจริง {receivePreview.totalQty.toLocaleString("th-TH")} {selectedReceiveProduct?.unit ?? "ชิ้น"} · ต้นทุนเฉลี่ย {money(receivePreview.roundAvg)}/{selectedReceiveProduct?.unit ?? "หน่วย"}</> : "—"}</b></div><div className="receive-purchase-grid"><label>จำนวนที่ซื้อ *<input data-line-qty="on" id="receive-qty-input" type="number" min="1" step="1" value={receiveForm.purchaseQty} onChange={(event) => setReceiveForm({ ...receiveForm, purchaseQty: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); document.getElementById("receive-paid-input")?.focus(); } }} placeholder="เช่น 20" /></label><label>จำนวนแถม<input type="number" min="0" step="1" value={receiveForm.freeQty} onChange={(event) => setReceiveForm({ ...receiveForm, freeQty: event.target.value })} placeholder="เช่น 2" /></label><label>เงินที่จ่ายจริง (฿) *<input id="receive-paid-input" type="number" min="0" step="0.01" value={receiveForm.paidAmount} onChange={(event) => setReceiveForm({ ...receiveForm, paidAmount: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); pushReceiveEntry(); } }} placeholder="เช่น 100.00" /></label></div>{receivePreview.totalQty > 0 && <div className="receive-cost-summary"><span>จำนวนรับจริง <b>{receivePreview.totalQty.toLocaleString("th-TH")} {selectedReceiveProduct?.unit ?? "หน่วย"}</b></span><span>ต้นทุนต่อหน่วย <b>{money(receivePreview.roundAvg)}</b></span>{receivePreview.blended != null && selectedReceiveProduct && <span>ต้นทุนสินค้าใหม่ <b>{money(receivePreview.blended)}</b></span>}</div>}<small className="receive-lines-hint">สูตร: (เงินที่จ่ายจริง ÷ (จำนวนที่ซื้อ + จำนวนแถม)) · ตัวอย่าง 100 บาท ÷ (20 + 2 ห่อ) = 4.55 บาท/ห่อ · ของแถมมีจำนวนในสต็อก แต่ไม่เพิ่มเงินที่จ่าย</small></div>{selectedReceiveProduct?.sellMode === "money" && <div className="bag-helper wide"><span className="field-label">รับแบบถุง — คำนวณเป็นกรัมให้อัตโนมัติ</span><div className="bag-helper-row"><label>จำนวนถุง<input type="number" min="0" step="1" value={bagCount} onChange={(event) => setBagCount(event.target.value)} placeholder="เช่น 2" aria-label="จำนวนถุง" /></label><b aria-hidden="true">×</b><label>กรัมต่อถุง<input type="number" min="1" step="1" value={bagGrams} onChange={(event) => setBagGrams(event.target.value)} aria-label="กรัมต่อถุง" /></label><button type="button" className="mini-button" onClick={applyBags}>= ใส่ {(Math.max(0, Math.floor(Number(bagCount) || 0)) * Math.max(0, Math.floor(Number(bagGrams) || 0))).toLocaleString("th-TH")} ก.</button></div><small>เช่น น้ำแข็งถุง 10 กก. → 1 ถุง = 10,000 กรัม</small></div>}
</div>{receiveCart.length > 0 && <div className="receive-cart"><div className="receive-cart-head"><span className="field-label">รายการที่จะรับเข้ารอบนี้ ({receiveCart.length} สินค้า)</span><b>ตรวจสอบรายละเอียดก่อนกดบันทึกทั้งหมด</b></div>{receiveCart.map((entry, index) => <div className="receive-cart-row" key={`receive-cart-${entry.productId}-${index}`}><div className="receive-cart-thumb">{allProducts.find((product) => product.id === entry.productId)?.imageUrl ? <img src={allProducts.find((product) => product.id === entry.productId)?.imageUrl ?? ""} alt="" /> : <PackageSearch size={15} />}</div><div className="receive-cart-info"><b>{allProducts.find((product) => product.id === entry.productId)?.name ?? `สินค้า #${entry.productId}`}</b><small>{allProducts.find((product) => product.id === entry.productId)?.sku ?? ""}{entry.lot ? ` · Lot ${entry.lot}` : ""}{entry.expiry ? ` · หมดอายุ ${formatExpiry(entry.expiry)}` : " · ไม่ระบุวันหมดอายุ"} · ซื้อ {entry.purchaseQty} + แถม {entry.freeQty} = รับ {(Number(entry.purchaseQty) + Number(entry.freeQty)).toLocaleString("th-TH")} · จ่าย {money(Number(entry.paidAmount))}</small></div><div className="receive-cart-qty"><b>+{(Number(entry.purchaseQty) + Number(entry.freeQty)).toLocaleString("th-TH")}</b>{Number(entry.freeQty) > 0 && <em className="receive-free-tag">แถม {entry.freeQty}</em>}</div><span className="receive-cart-cost">{money(Number(entry.paidAmount))}</span><div className="receive-cart-actions"><button type="button" className="icon-button" onClick={() => editReceiveEntry(index)} aria-label="แก้ไขรายการรับเข้า" title="แก้ไขรายการ"><Settings2 size={15} /></button><button type="button" className="icon-button" onClick={() => removeReceiveEntry(index)} aria-label="นำรายการออก" title="นำออกจากรายการ"><X size={15} /></button></div></div>)}</div>}<div className="modal-actions"><button className="outline-button" onClick={closeReceiveGuard}>ยกเลิก</button><div className="modal-actions-group"><button type="button" className="outline-button" disabled={!receiveForm.productId || receiveProgress != null} onClick={pushReceiveEntry} title="เก็บรายการนี้ไว้ก่อน แล้วยิงบาร์โค้ดสินค้าตัวถัดไปต่อ — บันทึกพร้อมกันตอนกดบันทึกท้ายสุด"><Plus size={15} /> เพิ่มลงรายการ</button><button className="primary-button" disabled={receiveProgress != null || (receiveCart.length === 0 && !receiveForm.productId)} onClick={() => void submitReceiveCart()}><PackagePlus size={16} /> {receiveProgress ? `กำลังบันทึก ${receiveProgress.done + 1}/${receiveProgress.total}…` : receiveCart.length > 0 ? `บันทึกทั้งหมด ${receiveCart.length} รายการ` : "บันทึกการรับเข้า"}</button></div></div></div></div>}{receiveDiscardOpen && <ConfirmDialog open title="ทิ้งรายการรับเข้าที่ยังไม่ได้บันทึก?" description={`ยังมี ${receiveCart.length} รายการใน "รายการรับเข้า" ที่ยังไม่ได้บันทึกลงคลัง — ปิดหน้าต่างนี้คือทิ้งรายการเหล่านั้นทั้งหมด`} confirmLabel="ทิ้งรายการและปิดหน้าต่าง" onCancel={() => setReceiveDiscardOpen(false)} onConfirm={() => { setReceiveDiscardOpen(false); setReceiveCart([]); setReceiveForm(emptyReceiveForm()); closeModal(); }} />}{newCameraOpen && <CameraCaptureModal open title="ถ่ายรูปสินค้าใหม่" hint="ถ่ายหน้าตาสินค้าจริงวางบนชั้น — รูปจะเข้าฟอร์มเพิ่มสินค้าทันที" onClose={() => setNewCameraOpen(false)} onCapture={(dataUrl) => setNewItem((current) => ({ ...current, imageUrl: dataUrl }))} />}{editCameraOpen && <CameraCaptureModal open title={`ถ่ายรูปสินค้าใหม่${editTarget ? ` · ${editTarget.name}` : ""}`} hint="แทนที่รูปเดิมของสินค้านี้ — ยังไม่บันทึกจนกดบันทึกการแก้ไข" onClose={() => setEditCameraOpen(false)} onCapture={(dataUrl) => setEditForm((current) => ({ ...current, imageUrl: dataUrl }))} />}{addOpen && <div className="modal-backdrop" onClick={closeModal}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">INVENTORY ITEM</span><h2>เพิ่มไอเทมสินค้า</h2><p>สร้างรายการสินค้าใหม่ก่อนรับเข้า Lot และจำนวน</p></div><button className="icon-button" onClick={closeModal}><X size={17} /></button></div><div className="form-grid compact-form" onKeyDownCapture={(event) => formEnterNav(event, addItem)}><label className="wide">รหัสสินค้า / SKU — ยิงบาร์โค้ดที่ตัวสินค้า หรือคีย์เอง<input autoFocus value={newItem.sku} onChange={(event) => setNewItem({ ...newItem, sku: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); handleSkuScan(); } }} placeholder="ยิงบาร์โค้ด หรือพิมพ์รหัส · เว้นว่างเพื่อให้ระบบรันอัตโนมัติ" /></label><label className="wide">ชื่อสินค้า *<input ref={addItemNameRef} value={newItem.name} onChange={(event) => setNewItem({ ...newItem, name: event.target.value })} placeholder="เช่น น้ำดื่มขวดเล็ก" /></label><div className="category-field wide"><span className="field-label">หมวดสินค้า — เว้นช่องรหัสว่างไว้ ระบบจะออกรหัสให้ตามหมวดนี้</span><div className="category-select-row"><select value={newItem.category} onChange={(event) => setNewItem({ ...newItem, category: event.target.value })} aria-label="หมวดสินค้าของรายการใหม่">{categoryOptions.map((category) => <option key={category} value={category}>{category} — รหัส {CATEGORY_SKU_PREFIXES[category] ?? "GEN"}</option>)}</select><small className="category-sku-hint">เว้นช่องรหัสว่าง → ระบบออก <b>{nextAutoSkuPreview(newItem.category)}</b> ให้อัตโนมัติ</small></div></div><div className="size-preset-field wide"><span className="field-label">ขนาด / ปริมาณ — พิมพ์ตัวเลขแล้วเลือกหน่วยจากลิสต์ (กันคีย์ .g / กรัม ผิดๆ)</span><div className="size-preset-row"><input type="number" min="0" step="any" value={newItem.sizeNum} onChange={(event) => setNewItem({ ...newItem, sizeNum: event.target.value })} placeholder="เช่น 500" aria-label="จำนวนขนาด" /><select value={newItem.sizeUnit} onChange={(event) => setNewItem({ ...newItem, sizeUnit: event.target.value })} aria-label="หน่วยของขนาด">{SIZE_UNIT_OPTIONS.map((unit) => <option key={unit}>{unit}</option>)}</select></div><div className="size-preset-chips">{SIZE_PRESETS.map(([num, unit]) => <button type="button" key={`${num}${unit}`} onClick={() => setNewItem({ ...newItem, sizeNum: num, sizeUnit: unit })}>{num} {unit}</button>)}</div></div><label>หน่วยขาย<select value={newItem.unit} onChange={(event) => setNewItem({ ...newItem, unit: event.target.value })}><option>ชิ้น</option><option>ขวด</option><option>ถุง</option><option>กล่อง</option><option>แพ็ก</option><option>กรัม</option></select></label><label>ต้นทุนต่อหน่วย (฿)<input type="number" min="0" step="0.01" value={newItem.cost} onChange={(event) => setNewItem({ ...newItem, cost: event.target.value })} placeholder="0.00" /></label><label>ราคาขาย *<input value={newItem.price} onChange={(event) => setNewItem({ ...newItem, price: event.target.value })} placeholder="฿0.00" />{newItem.sellMode !== "money" && !(Number(newItem.price) > 0) && <small className="price-zero-hint"><CircleAlert size={12} /> เว้นว่าง/ใส่ 0 = ยังไม่ได้ตั้งราคา บันทึกได้เลย</small>}</label><label>จุดสั่งซื้อขั้นต่ำ<input value={newItem.reorder} onChange={(event) => setNewItem({ ...newItem, reorder: event.target.value })} placeholder="10" /></label><label>วิธีขาย<select value={newItem.sellMode} onChange={(event) => setNewItem({ ...newItem, sellMode: event.target.value as "unit" | "money" })}><option value="unit">ตามหน่วย — ปกติ</option><option value="money">ขายเป็นราคา — เช่น น้ำแข็ง</option></select></label><div className="quickpick-field"><span className="field-label">แผงลัดหน้าร้าน POS</span><button type="button" className={`quickpick-toggle${newItem.quickPick ? " on" : ""}`} onClick={() => setNewItem({ ...newItem, quickPick: !newItem.quickPick })} aria-pressed={newItem.quickPick} title="กดเพื่อสลับสถานะ — สินค้าที่ขึ้นแผงลัดหน้าร้าน POS เปลี่ยนได้ทีหลังที่หน้าขายสินค้าได้เสมอ"><Star size={14} /> {newItem.quickPick ? "ขึ้นแผงแล้ว — กดเพื่อเลิก" : "ยังไม่ขึ้นแผง — กดเพื่อเปิดใช้"}</button></div>{newItem.sellMode === "money" && <div className="tier-editor wide"><div className="tier-editor-head"><span className="field-label">ช่องราคาขาย — ที่ POS แสดงเป็นปุ่มกดเพิ่มเข้าบิล</span><span className="tier-col-labels"><i>ชื่อขนาด</i><i>ราคา ฿</i><i>ปริมาณ ({newItem.unit})</i><i aria-label="ลบ" /></span></div>{newItem.tiers.map((tier, index) => <div className="tier-row" key={index}><input value={tier.label} onChange={(event) => setNewItem({ ...newItem, tiers: newItem.tiers.map((row, rowIndex) => rowIndex === index ? { ...row, label: event.target.value } : row) })} placeholder="เช่น 200 กรัม" aria-label={`ชื่อขนาดช่องที่ ${index + 1}`} /><input type="number" min="0.25" step="0.25" value={tier.price} onChange={(event) => setNewItem({ ...newItem, tiers: newItem.tiers.map((row, rowIndex) => rowIndex === index ? { ...row, price: event.target.value } : row) })} placeholder="1" aria-label={`ราคาช่องที่ ${index + 1} (บาท)`} /><input type="number" min="0.01" step="0.01" value={tier.qty} onChange={(event) => setNewItem({ ...newItem, tiers: newItem.tiers.map((row, rowIndex) => rowIndex === index ? { ...row, qty: event.target.value } : row) })} placeholder="200" aria-label={`ปริมาณของช่องที่ ${index + 1} (${newItem.unit})`} /><button type="button" className="mini-button danger" onClick={() => setNewItem({ ...newItem, tiers: newItem.tiers.length > 1 ? newItem.tiers.filter((_, rowIndex) => rowIndex !== index) : newItem.tiers })} disabled={newItem.tiers.length === 1} aria-label="ลบช่องราคานี้"><X size={13} /></button></div>)}<button type="button" className="mini-button" onClick={() => setNewItem({ ...newItem, tiers: [...newItem.tiers, { label: "", price: "", qty: "" }] })}><Plus size={13} /> เพิ่มช่องราคา</button><small className="tier-hint">ตัวอย่างน้ำแข็ง: ตั้งหน่วยเป็น “กรัม” แล้วรับเข้าเป็นถุง 10 กก. (ช่วยคำนวณให้ตอนรับเข้า) · ขาย ฿1 = 200 ก. · ฿5 = 1,000 ก. · ฿10 = 2,000 ก.</small></div>}<div className="form-image-field wide"><span className="field-label">รูปสินค้าจริง</span><div className="product-image-uploader">{newItem.imageUrl ? <div className="product-image-preview"><img src={newItem.imageUrl} alt="ตัวอย่างรูปสินค้า" /><div><b>พร้อมใช้งาน</b><small>แสดงบน POS และรายการคงคลัง</small></div><div className="photo-action-row"><button type="button" className="mini-button" onClick={() => setNewCameraOpen(true)}><Camera size={13} /> ถ่ายใหม่จากกล้อง</button><button type="button" className="mini-button danger" onClick={() => setNewItem({ ...newItem, imageUrl: "" })}><Trash2 size={13} /> ลบรูป</button></div></div> : <><label className="upload-drop product-upload-drop" htmlFor="new-item-image"><ImagePlus size={18} /><span><b>คลิกเพื่อถ่ายรูปหรืออัปโหลดรูปสินค้าจริง</b><small>รองรับ JPG PNG WEBP · ระบบย่อให้พอดีอัตโนมัติ</small></span><input id="new-item-image" type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => handleNewItemImage(event.target.files?.[0])} /></label><button type="button" className="outline-button compact camera-hint-inline" onClick={() => setNewCameraOpen(true)}><Camera size={15} /> หรือถ่ายรูปสินค้าจากกล้อง</button></>}</div></div></div>{error && <div className="notice-bar error"><CircleAlert size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={closeModal}>ยกเลิก</button><button className="primary-button" disabled={createMutation.isPending} onClick={addItem}><Plus size={16} /> {createMutation.isPending ? "กำลังบันทึก…" : "เพิ่มรายการสินค้า"}</button></div></div></div>}{countOpen && <div className="modal-backdrop" onClick={closeModal}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">STOCK COUNT</span><h2>นับสต็อก</h2><p>บันทึกยอดที่นับได้จริง ระบบจะปรับยอดคงเหลือให้ตรงกันทันที</p></div><button className="icon-button" onClick={closeModal}><X size={17} /></button></div><div className="form-grid compact-form"><div className="form-scan-picker wide"><span className="field-label">สินค้า — ยิงบาร์โค้ดที่ตัวสินค้า หรือคีย์รหัส / ชื่อ *</span><ProductScanPicker products={products} selectedId={countForm.productId ? Number(countForm.productId) : null} onSelect={(product) => { setCountForm({ ...countForm, productId: product ? String(product.id) : "" }); setLotCounts({}); }} autoFocus /></div></div>{selectedCountProduct && <div className="count-mode-toggle" role="tablist" aria-label="โหมดการนับสต็อก"><button type="button" role="tab" aria-selected={countMode === "total"} className={countMode === "total" ? "active" : ""} onClick={() => setCountMode("total")}><Boxes size={14} /> นับรวม</button><button type="button" role="tab" aria-selected={countMode === "lots"} className={countMode === "lots" ? "active" : ""} onClick={() => setCountMode("lots")}><ClipboardList size={14} /> แยกตาม Lot{selectedLots.length > 0 && ` (${selectedLots.length})`}</button></div>}{countMode === "total" ? <>{selectedCountProduct && <div className="member-number-preview stock-count-preview"><span><ClipboardList size={16} /> ระบบ {selectedCountProduct.stock} {selectedCountProduct.unit} · นับได้ {countedInput === null ? "—" : countedInput} {selectedCountProduct.unit}</span><b className={countDiff !== null && countDiff < 0 ? "red-text" : countDiff !== null && countDiff > 0 ? "green-text" : ""}>{countDiff === null ? "ต่าง —" : `ต่าง ${countDiff > 0 ? "+" : ""}${countDiff}`}</b></div>}<div className="form-grid compact-form"><label>จำนวนที่นับได้ *<input id="count-qty-input" type="number" min="0" step="1" value={countForm.countedQty} onChange={(event) => setCountForm({ ...countForm, countedQty: event.target.value })} placeholder="ตามจำนวนที่นับได้จริง" /></label><label className="wide">หมายเหตุ<input value={countForm.note} onChange={(event) => setCountForm({ ...countForm, note: event.target.value })} placeholder="เช่น นับก่อนปิดร้าน หรือระบุสาเหตุความต่าง" /></label></div></> : <>{selectedLots.length === 0 ? <div className="lot-count-empty"><PackageSearch size={20} /><b>ไม่พบ Lot ของสินค้านี้</b><span>ใช้โหมด “นับรวม” หรือรับเข้าสินค้าก่อนนับแยกล็อต</span></div> : <div className="lot-count-list">{lotCountEntries.map((entry) => <div className="lot-count-row" key={entry.row.id}><div className="lot-count-label"><b>{entry.row.lot}</b><small>{entry.row.expiry ? `หมดอายุ ${formatExpiry(entry.row.expiry)}` : "ไม่ระบุวันหมดอายุ"} · ระบบ {entry.row.qty} {entry.row.unit}</small></div><input type="number" min="0" step="1" value={entry.raw} aria-label={`จำนวนที่นับได้ Lot ${entry.row.lot}`} onChange={(event) => setLotCounts({ ...lotCounts, [String(entry.row.id)]: event.target.value })} /><b className={`lot-count-diff${entry.diff !== null && entry.diff < 0 ? " negative" : entry.diff !== null && entry.diff > 0 ? " positive" : ""}`}>{entry.diff === null ? "—" : entry.diff === 0 ? "ตรง" : `${entry.diff > 0 ? "+" : ""}${entry.diff}`}</b></div>)}{selectedCountProduct && <div className="lot-count-total"><span>รวมทั้งสินค้า · ระบบ {selectedCountProduct.stock} {selectedCountProduct.unit}</span><b className={lotTotalDiff !== null && lotTotalDiff < 0 ? "red-text" : lotTotalDiff !== null && lotTotalDiff > 0 ? "green-text" : ""}>นับรวม {lotTotal} {selectedCountProduct.unit} · ต่าง {lotTotalDiff === null ? "—" : `${lotTotalDiff > 0 ? "+" : ""}${lotTotalDiff}`}</b></div>}</div>}<div className="form-grid compact-form"><label className="wide">หมายเหตุ<input value={countForm.note} onChange={(event) => setCountForm({ ...countForm, note: event.target.value })} placeholder="เช่อ นับก่อนปิดร้าน หรือระบุสาเหตุความต่าง" /></label></div></>}<div className="initial-balance-note"><ShieldCheck size={15} /> {countMode === "total" ? "การนับสต็อกจะปรับยอดคงเหลือตามจำนวนที่นับได้ทันที และบันทึกความต่างลงระบบ Log" : "โหมดแยกล็อตจะปรับยอดแต่ละ Lot ตามที่นับได้ แล้วคำนวณยอดรวมของสินค้าจากทุก Lot ใหม่"}</div>{error && <div className="notice-bar error"><CircleAlert size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={closeModal}>ยกเลิก</button><div className="modal-actions-group"><button className="outline-button" disabled={countMode === "total" ? countMutation.isPending || !selectedCountProduct || countedInput === null || !Number.isInteger(countedInput) || countedInput < 0 : countLotsMutation.isPending || !selectedCountProduct || !lotCountsValid} onClick={() => (countMode === "total" ? submitCount(true) : submitCountLots(true))}><RotateCcw size={15} /> บันทึกและนับรายการถัดไป</button><button className="primary-button" disabled={countMode === "total" ? countMutation.isPending || !selectedCountProduct || countedInput === null || !Number.isInteger(countedInput) || countedInput < 0 : countLotsMutation.isPending || !selectedCountProduct || !lotCountsValid} onClick={() => (countMode === "total" ? submitCount(false) : submitCountLots(false))}><ClipboardList size={16} /> {(countMode === "total" ? countMutation.isPending : countLotsMutation.isPending) ? "กำลังบันทึก…" : countMode === "total" ? "บันทึกการนับสต็อก" : "บันทึกการนับแยกล็อต"}</button></div></div></div></div>}{editOpen && editTarget && <div className="modal-backdrop" onClick={closeModal}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">PRODUCT EDIT</span><h2>แก้ไขข้อมูลสินค้า</h2><p>{editTarget.sku} · {editTarget.name}<StatusPill tone={editTarget.active === 1 ? "green" : "purple"}>{editTarget.active === 1 ? "ขายปกติ" : "ปิดการขาย"}</StatusPill></p></div><button className="icon-button" onClick={closeModal}><X size={17} /></button></div><div className="form-grid compact-form"><label className="wide">ชื่อสินค้า *<input autoFocus value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} placeholder="ชื่อที่แสดงบนหน้าร้าน POS" /></label><label className="wide">บาร์โค้ด / รหัส SKU<input value={editForm.barcode} onChange={(event) => setEditForm({ ...editForm, barcode: event.target.value })} placeholder="ยิงบาร์โค้ดที่ตัวสินค้า หรือพิมพ์รหัส" /></label><div className="category-field wide"><span className="field-label">หมวดสินค้า — ใช้จัดกลุ่มรายงาน และกำหนดรหัสให้สินค้าที่จะเพิ่มใหม่</span><div className="category-select-row"><select value={editForm.category} onChange={(event) => setEditForm({ ...editForm, category: event.target.value })} aria-label="หมวดสินค้า">{categoryOptions.map((category) => <option key={category} value={category}>{category} — รหัส {CATEGORY_SKU_PREFIXES[category] ?? "GEN"}</option>)}</select><small className="category-sku-hint">รหัสปัจจุบัน <b>{editTarget.sku}</b> ไม่เปลี่ยนตามหมวด</small></div></div><div className="size-preset-field wide"><span className="field-label">ขนาด / ปริมาณ — พิมพ์ตัวเลขแล้วเลือกหน่วยจากลิสต์ (กันคีย์ .g / กรัม ผิดๆ)</span><div className="size-preset-row"><input type="number" min="0" step="any" value={editForm.sizeNum} onChange={(event) => setEditForm({ ...editForm, sizeNum: event.target.value })} placeholder="เช่น 500" aria-label="จำนวนขนาด" /><select value={editForm.sizeUnit} onChange={(event) => setEditForm({ ...editForm, sizeUnit: event.target.value })} aria-label="หน่วยของขนาด">{(SIZE_UNIT_OPTIONS.includes(editForm.sizeUnit) ? SIZE_UNIT_OPTIONS : [...SIZE_UNIT_OPTIONS, editForm.sizeUnit]).map((unit) => <option key={unit}>{unit}</option>)}</select></div><div className="size-preset-chips">{SIZE_PRESETS.map(([num, unit]) => <button type="button" key={`${num}${unit}`} onClick={() => setEditForm({ ...editForm, sizeNum: num, sizeUnit: unit })}>{num} {unit}</button>)}</div></div><label>หน่วยขาย<select value={editForm.unit} onChange={(event) => setEditForm({ ...editForm, unit: event.target.value })}>{editUnitOptions.map((unit) => <option key={unit}>{unit}</option>)}</select></label><label>ต้นทุนต่อหน่วย (฿)<input type="number" min="0" step="0.01" value={editForm.cost} onChange={(event) => setEditForm({ ...editForm, cost: event.target.value })} placeholder="ต้นทุนต่อหน่วย" /></label><label>ราคาขาย *<input type="number" min="0" step="0.01" value={editForm.price} onChange={(event) => setEditForm({ ...editForm, price: event.target.value })} placeholder="฿0.00" />{editForm.sellMode !== "money" && !(Number(editForm.price) > 0) && <small className="price-zero-hint"><CircleAlert size={12} /> ยังไม่ได้ตั้งราคาขาย — บันทึกเป็น ฿0 ได้ และค่อยใส่ราคาภายหลัง</small>}</label><label>จุดสั่งซื้อขั้นต่ำ<input type="number" min="0" step="1" value={editForm.reorder} onChange={(event) => setEditForm({ ...editForm, reorder: event.target.value })} placeholder="เช่น 10" /></label><label>วิธีขาย<select value={editForm.sellMode} onChange={(event) => setEditForm({ ...editForm, sellMode: event.target.value as "unit" | "money" })}><option value="unit">ตามหน่วย — ปกติ</option><option value="money">ขายเป็นราคา — เช่น น้ำแข็ง</option></select></label><div className="quickpick-field"><span className="field-label">แผงลัดหน้าร้าน POS</span><button type="button" className={`quickpick-toggle${editForm.quickPick ? " on" : ""}`} onClick={() => setEditForm({ ...editForm, quickPick: !editForm.quickPick })} aria-pressed={editForm.quickPick} title="กดเพื่อสลับสถานะ — สินค้าที่ขึ้นแผงลัดหน้าร้าน POS เปลี่ยนได้ทีหลังที่หน้าขายสินค้าได้เสมอ"><Star size={14} /> {editForm.quickPick ? "ขึ้นแผงแล้ว — กดเพื่อเลิก" : "ยังไม่ขึ้นแผง — กดเพื่อเปิดใช้"}</button></div>{editForm.sellMode === "money" && <div className="tier-editor wide"><div className="tier-editor-head"><span className="field-label">ช่องราคาขาย — ที่ POS แสดงเป็นปุ่มกดเพิ่มเข้าบิล</span><span className="tier-col-labels"><i>ชื่อขนาด</i><i>ราคา ฿</i><i>ปริมาณ ({editForm.unit})</i><i aria-label="ลบ" /></span></div>{editForm.tiers.map((tier, index) => <div className="tier-row" key={index}><input value={tier.label} onChange={(event) => setEditForm({ ...editForm, tiers: editForm.tiers.map((row, rowIndex) => rowIndex === index ? { ...row, label: event.target.value } : row) })} placeholder="เช่น 200 กรัม" aria-label={`ชื่อขนาดช่องที่ ${index + 1}`} /><input type="number" min="0.25" step="0.25" value={tier.price} onChange={(event) => setEditForm({ ...editForm, tiers: editForm.tiers.map((row, rowIndex) => rowIndex === index ? { ...row, price: event.target.value } : row) })} placeholder="1" aria-label={`ราคาช่องที่ ${index + 1} (บาท)`} /><input type="number" min="0.01" step="0.01" value={tier.qty} onChange={(event) => setEditForm({ ...editForm, tiers: editForm.tiers.map((row, rowIndex) => rowIndex === index ? { ...row, qty: event.target.value } : row) })} placeholder="200" aria-label={`ปริมาณของช่องที่ ${index + 1} (${editForm.unit})`} /><button type="button" className="mini-button danger" onClick={() => setEditForm({ ...editForm, tiers: editForm.tiers.length > 1 ? editForm.tiers.filter((_, rowIndex) => rowIndex !== index) : editForm.tiers })} disabled={editForm.tiers.length === 1} aria-label="ลบช่องราคานี้"><X size={13} /></button></div>)}<button type="button" className="mini-button" onClick={() => setEditForm({ ...editForm, tiers: [...editForm.tiers, { label: "", price: "", qty: "" }] })}><Plus size={13} /> เพิ่มช่องราคา</button><small className="tier-hint">ตัวอย่างน้ำแข็ง: ฿1 = 200 ก. · ฿5 = 1,000 ก. · ฿10 = 2,000 ก. — หน่วยคงเหลือนับเป็นกรัม</small></div>}<div className="form-image-field wide"><span className="field-label">รูปสินค้าจริง</span><div className="product-image-uploader">{editForm.imageUrl ? <div className="product-image-preview"><img src={editForm.imageUrl} alt="ตัวอย่างรูปสินค้า" /><div><b>พร้อมใช้งาน</b><small>แสดงบน POS และรายการคงคลัง</small></div><div className="photo-action-row"><button type="button" className="mini-button" onClick={() => setEditCameraOpen(true)}><Camera size={13} /> ถ่ายใหม่จากกล้อง</button><button type="button" className="mini-button danger" onClick={() => setEditForm({ ...editForm, imageUrl: "" })}><Trash2 size={13} /> ลบรูป</button></div></div> : <><label className="upload-drop product-upload-drop" htmlFor="edit-item-image"><ImagePlus size={18} /><span><b>คลิกเพื่ออัปโหลดรูปสินค้าจริง</b><small>รองรับ JPG PNG WEBP · ระบบย่อให้พอดีอัตโนมัติ</small></span><input id="edit-item-image" type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => handleEditImage(event.target.files?.[0])} /></label><button type="button" className="outline-button compact camera-hint-inline" onClick={() => setEditCameraOpen(true)}><Camera size={15} /> หรือถ่ายรูปสินค้าจากกล้อง</button></>}</div></div></div><div className="member-number-preview"><span><ClipboardList size={16} /> ระบบ {editTarget.stock} {editTarget.unit} · แก้ไขจำนวนผ่านการนับสต็อก</span></div><div className="initial-balance-note"><ShieldCheck size={15} /> การแก้ไขบันทึกทันทีและปรากฏในระบบ Log · ระบุเฉพาะรายการที่แก้ไข</div>{manageError && <div className="notice-bar error"><CircleAlert size={16} /> {manageError}<button onClick={() => setManageError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={closeModal}>ยกเลิก</button><button className="primary-button" disabled={updateMutation.isPending || editForm.name.trim() === "" || !Number.isFinite(Number(editForm.price)) || Number(editForm.price) < 0} onClick={submitEditProduct}><SlidersHorizontal size={16} /> {updateMutation.isPending ? "กำลังบันทึก…" : "บันทึกการแก้ไข"}</button></div></div></div>}<ConfirmDialog open={deleteTarget !== null} title="ยืนยันการลบรายการสินค้า?" description={deleteTarget ? `ลบ “${deleteTarget.name}” (${deleteTarget.sku}) ออกจากรายการสินค้าถาวร · ล็อตคงเหลือ ${deleteTarget.stock} ${deleteTarget.unit} จะถูกลบไปด้วย · ประวัติบิลเดิมยังคงแสดงชื่อรายการเหมือนเดิม` : ""} confirmLabel="ยืนยันลบสินค้า" onCancel={() => setDeleteTarget(null)} onConfirm={() => { if (deleteTarget) deleteMutation.mutate({ productId: deleteTarget.id, actor, actorRole }); }} /><ConfirmDialog open={clearOrdersOpen} title="ยืนยันล้างรายการสั่งซื้อทั้งหมด?" description={`รายการสั่งซื้อ ${orderItems.length} รายการ (มูลค่าโดยประมาณ ${money(orderTotalValue)}) จะถูกล้างออกทั้งหมด · ใช้หลังสั่งซื้อครบหรือตรวจสอบรายการแล้วเท่านั้น — ระบบบันทึกการล้างลง Log`} confirmLabel={`ยืนยันล้าง ${orderItems.length} รายการ`} onCancel={() => setClearOrdersOpen(false)} onConfirm={() => { setClearOrdersOpen(false); orderClearMutation.mutate({ actor, actorRole }); }} /><ConfirmDialog open={archiveTarget !== null} title="ยืนยันการปิดการขายสินค้า?" description={archiveTarget ? `สินค้า ${archiveTarget.name} (${archiveTarget.sku}) จะถูกซ่อนจากหน้าร้าน POS ทันที · สต็อกคงเหลือ ${archiveTarget.stock} ${archiveTarget.unit} ยังอยู่ในคลังและตรวจสอบได้ที่รายการคงคลัง` : ""} confirmLabel="ยืนยันปิดการขาย" onCancel={() => setArchiveTarget(null)} onConfirm={confirmArchive} />{/* ROUND 53 (user) — ใบนับสต๊อก A4 สำหรับพิมพ์ออกไปนับมือ (ซ่อนบนจอ โผล่ตอนพรีวิว/พิมพ์) */}<StockCountSheet products={allProducts} />{countSheetOpen && <PrintPreviewModal targetId="stock-count-sheet" title="พรีวิวใบนับสต็อก" subtitle="กระดาษ A4 พิมพ์ออกไปนับของจริงที่ชั้นวาง แล้วกลับมากรอกที่เมนูนับสต็อก" paper="a4" chips={[`${allProducts.filter((product) => product.active === 1).length} รายการทั้งหมด`, "มีช่อง นับได้ · ผลต่าง · หมายเหตุ ให้เขียนด้วยมือ", `ออกเมื่อ ${formatLogDateTime(new Date().toISOString())}`]} onClose={() => setCountSheetOpen(false)} />}{/* ROUND 55 (user) — สแกนบาร์โค้ดด้วยกล้องที่ช่องค้นหารายการคงคลัง */}{searchCameraOpen && <BarcodeCameraModal open title="สแกนบาร์โค้ดสินค้า" hint="เล็งบาร์โค้ดที่ตัวสินค้า — อ่านได้แล้วระบบค้นหารายการนั้นให้ทันที (ใช้เว็บแคม/มือถือแทนปืนสแกนได้)" onClose={() => setSearchCameraOpen(false)} onDetect={(code) => { setSearchCameraOpen(false); setManageSearch(code); }} />}{docPreview && <ExportPreviewModal state={docPreview} onClose={() => setDocPreview(null)} onRun={(format) => void runDocPreview(format)} />}{bulkPriceOpen && isAdminRole(role) && <BulkPriceModal open products={allProducts} actor={actor} actorRole={actorRole} onClose={() => setBulkPriceOpen(false)} onDone={(message) => { setBulkPriceOpen(false); setManageNotice(message); }} />}{upgradeFeature && <EditionUpgradeModal open onClose={() => setUpgradeFeature(null)} status={edition.status} focusFeature={upgradeFeature} onApplied={() => void edition.refetch()} />}</div>;
}
