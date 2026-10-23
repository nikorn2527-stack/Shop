import { ReceivePriceInsight } from "@/components/ReceivePriceInsight";
import { ProductImagePicker } from "@/components/ProductImagePicker";
import { ProductArtwork } from "@/components/ProductArtwork";
import { reportSellingValue } from "@shared/reportValuation";
import { notify } from "@/lib/notifications";
import { ReceivingSurface, WorkflowDialog, WorkflowResult } from "@/components/WorkflowDialog";
import { ReceiveItemEditor } from "@/components/ReceiveItemEditor";
import { INVENTORY_ACTION_LABELS } from "@/lib/inventoryActions";
import { serializeTierRows, type TierRow } from "@/lib/productPriceTiers";
import { normalizeExpiryDate } from "@shared/expiryDate";
import { categoryEmoji, normalizeProductCategory, PRODUCT_CATEGORIES, productCategoryOptions } from "@shared/productCategories";
import { ReceiveEntryForm } from "@/components/ReceiveEntryForm";
import { ReceiveEntryRow } from "@/components/ReceiveEntryRow";
import { ActionButton } from "@/components/ActionButton";
import { StockReceiptHistory } from "@/components/StockReceiptHistory";
import { SharedSearch } from "@/components/SharedSearch";
import { useEffect, useRef, useState } from "react";
import { TRPCClientError } from "@trpc/client";
import {
  Activity, Ban, Boxes, Camera, Check, ChevronDown, ChevronRight, CircleAlert, ClipboardList, Download, Eye, History, FileBarChart, FileText, Gift, ImagePlus, Lock, MoreHorizontal, PackagePlus, PackageSearch, Plus, Printer, RotateCcw, Save, Search, Settings2, ShieldCheck, ShoppingCart, SlidersHorizontal, Star, Trash2, X,
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

const emptyNewItem = { name: "", sku: "", category: "ของใช้", sizeNum: "", sizeUnit: "มล.", unit: "ชิ้น", cost: "", price: "", reorder: "10", emoji: "", imageUrl: "", sellMode: "unit" as "unit" | "money", quickPick: false, tiers: [{ label: "", price: "", qty: "" }] };
/** รับเข้าแบบซื้อ/แถม: จำนวนที่ซื้อ + จำนวนแถม + เงินที่จ่ายจริง */
type ReceiveFormDraft = { productId: string; lot: string; expiry: string; purchaseQty: string; freeQty: string; paidAmount: string; sellingPrice: string; expectedSellingPrice?: number; previousCost?: number | null };
const emptyReceiveForm = (): ReceiveFormDraft => ({ productId: "", lot: "", expiry: "", purchaseQty: "", freeQty: "0", paidAmount: "", sellingPrice: "" });
/** สะสมหลายสินค้าไว้ใน "รายการรับเข้า" แล้วบันทึกพร้อมกันรอบเดียว */
type NewProductDraft = Omit<import("../../../server/sqliteStore").CreateProductInput, "quickPick"> & { quickPick?: number };
type ReceiveCartEntry = Omit<ReceiveFormDraft, "productId"> & { productId: number; newProduct?: NewProductDraft };
const emptyCountForm = { productId: "", countedQty: "", note: "" };
const emptyEditForm = { name: "", category: "", unit: "ชิ้น", price: "", cost: "", reorder: "", sizeNum: "", sizeUnit: "มล.", barcode: "", emoji: "", imageUrl: "", sellMode: "unit" as "unit" | "money", quickPick: false, tiers: [{ label: "", price: "", qty: "" }] };

// Round 32-27 — ตัวเลือกขนาด/ปริมาณแบบเลือกจากลิสต์ กันคีย์ผิด
const SIZE_UNIT_OPTIONS = ["มล.", "ลิตร", "กรัม", "กก.", "ชิ้น", "แพ็ก", "ถุง", "ขวด", "กล่อง"];
// ROUND 71 — หมวดสินค้า: รหัสอัตโนมัติขึ้นต้นตามหมวด (ชุดเดียวกับ server/sqliteStore.ts CATEGORY_SKU_PREFIXES)
// เครื่องดื่ม=DRK · ของใช้ส่วนตัว=HYG · ขนม=SNK · อาหาร=FD · ของใช้ในครัวเรือน=HH · เครื่องเขียน=ST
const CATEGORY_SKU_PREFIXES: Record<string, string> = { "เครื่องดื่ม": "DRK", "อาหาร": "FD", "ของใช้": "HYG", "ของใช้ส่วนตัว": "HYG", "ของใช้ในครัวเรือน": "HH", "ขนม": "SNK", "เครื่องเขียน": "ST" };
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
const codeOrder = new Intl.Collator("th", {numeric:true,sensitivity:"base"});
const stockStatusFilters = ["ทั้งหมด", "ปกติ", "สต็อกต่ำ", "ใกล้หมดอายุ", "ปิดการขาย"] as const;
type StockStatusFilter = (typeof stockStatusFilters)[number];

export type StockInitialAction = "receive" | "add";
export function Stock({ role, userName, initialAction, embeddedAction = false, receivingPage = false, onClose, onDraftChange }: { role: Role; userName: string; initialAction?: StockInitialAction; embeddedAction?: boolean; receivingPage?: boolean; onClose?: () => void; onDraftChange?: (dirty: boolean) => void }) {
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
  const showValidation = (message: string) => { setError(message); notify.warning("ตรวจสอบข้อมูลก่อนทำรายการ", { description: message }); };
  const [addOpen, setAddOpen] = useState(initialAction === "add");
  const [receiveOpen, setReceiveOpen] = useState(receivingPage || initialAction === "receive");
  const [draftProducts, setDraftProducts] = useState<SqliteProduct[]>([]);
  const [draftDefinitions, setDraftDefinitions] = useState<Record<number, NewProductDraft>>({});
  const [creatingForReceipt, setCreatingForReceipt] = useState(false);
  const [newItem, setNewItem] = useState(emptyNewItem);
  const [iconTarget, setIconTarget] = useState<"new" | "edit" | null>(null);
  const [newReceiptForm, setNewReceiptForm] = useState(emptyReceiveForm);
  const [receiveForm, setReceiveForm] = useState(emptyReceiveForm);
  const [receiveScanKey, setReceiveScanKey] = useState(0);
  const receiptPricing = trpc.stock.receiptPricing.useQuery({productId:Math.max(1,Number(receiveForm.productId)||1)}, {enabled: receiveOpen && Number(receiveForm.productId)>0, staleTime:0});
  useEffect(()=>{
    const data=receiptPricing.data;
    if(data && String(data.productId)===receiveForm.productId && !receiveForm.sellingPrice.trim() && receiveForm.expectedSellingPrice!==data.sellingPrice) setReceiveForm(current=>({...current,expectedSellingPrice:data.sellingPrice}));
  },[receiptPricing.data,receiveForm.productId,receiveForm.sellingPrice,receiveForm.expectedSellingPrice]);
  const nextLotQuery = trpc.stock.nextLot.useQuery(undefined, { enabled: receiveOpen, staleTime: 0, refetchOnMount: "always" });

  const focusReceiptScanner = () => window.setTimeout(() => {
    document.querySelector<HTMLElement>(".stock-receive-modal .receive-form-body")?.scrollTo({top:0});
    document.querySelector<HTMLElement>(".stock-receive-modal .receive-split-workspace")?.scrollTo({top:0});
    document.querySelector<HTMLInputElement>(".stock-receive-modal .member-scan-field input")?.focus({preventScroll:true});
  },80);
  const queueReceiptProduct = (product: SqliteProduct) => {
    if (creatingForReceipt && (newItem.name.trim() || newReceiptForm.purchaseQty.trim() || newReceiptForm.paidAmount.trim() || Number(newReceiptForm.freeQty)>0)) { showValidation("มีข้อมูลสินค้าใหม่ที่กำลังกรอก กรุณาเพิ่มลงรายการหรือล้างข้อมูลก่อนเลือกสินค้าอื่น"); return; }
    if (product.id < 0) { showValidation("สินค้าใหม่นี้อยู่ในรายการแล้ว กรุณาแก้ไขจำนวนในตาราง"); return; }
    if (receiveForm.productId && receiveForm.productId !== String(product.id)) {
      showValidation("ยังมีสินค้าที่กำลังกรอก กรุณาเพิ่มลงรายการหรือล้างรายการก่อนเลือกสินค้าอื่น");
      return;
    }
    if (receiveForm.productId === String(product.id)) return;
    setCreatingForReceipt(false); setNewItem(emptyNewItem); setNewReceiptForm(emptyReceiveForm());
    setReceiveForm({ ...emptyReceiveForm(), productId: String(product.id), lot: suggestedLot, expectedSellingPrice: product.price });
    setError("");
    window.setTimeout(() => document.getElementById("receive-editor-qty")?.focus(), 80);
  };
  const openReceiptProductDraft = (code = "") => {
    if (receiveProgress || productsQuery.isLoading || productsQuery.isError) return;
    if (!isAdminRole(role)) { blocker.warning("ต้องใช้สิทธิ์ผู้บริหารเพื่อเพิ่มสินค้าใหม่", "คุณยังรับเข้าสินค้าเดิมได้ กรุณาให้ผู้บริหารเพิ่มรายการสินค้าใหม่ก่อน"); return; }
    if (receiveForm.productId) {
      showValidation("ยังมีสินค้าที่กำลังกรอก กรุณาเพิ่มลงรายการหรือล้างรายการก่อนเลือกสินค้าอื่น");
      return;
    }
    if (creatingForReceipt && newItem.sku && newItem.sku !== code && (newItem.name.trim() || newReceiptForm.purchaseQty.trim() || newReceiptForm.paidAmount.trim())) { showValidation("มีข้อมูลสินค้าใหม่ที่กำลังกรอก กรุณาเพิ่มลงรายการหรือล้างข้อมูลก่อนเปลี่ยนรหัส"); return; }
    setNewItem(current => ({ ...current, sku: code }));
    setError("");
    setCreatingForReceipt(true);
    window.setTimeout(() => document.getElementById("receive-new-name")?.focus(), 80);
  };
  const addEditedReceipt = () => {
    if (receiveProgress) return;
    if (normalizeExpiryDate(receiveForm.expiry) === null) { showValidation("วันหมดอายุไม่ถูกต้อง กรุณาระบุวัน/เดือน/ปี"); return; }
    const productId = Number(receiveForm.productId);
    if (!productId || !Number.isInteger(Number(receiveForm.purchaseQty)) || Number(receiveForm.purchaseQty) <= 0 || !Number.isInteger(Number(receiveForm.freeQty)) || Number(receiveForm.freeQty) < 0 || !receiveForm.paidAmount.trim() || !Number.isFinite(Number(receiveForm.paidAmount)) || Number(receiveForm.paidAmount) < 0) { showValidation("กรุณาตรวจจำนวนและยอดจ่ายก่อนเพิ่มรายการ"); return; }
    if (receiveForm.sellingPrice.trim() && (!Number.isFinite(Number(receiveForm.sellingPrice)) || Number(receiveForm.sellingPrice)<0)) {showValidation("ราคาขายใหม่ต้องเป็นตัวเลข 0 ขึ้นไป");return;}
    if (receiveForm.sellingPrice.trim() && receiveCart.some(row=>row.productId===productId && row.sellingPrice.trim() && Number(row.sellingPrice)!==Number(receiveForm.sellingPrice))) {showValidation("สินค้าเดียวกันระบุราคาขายใหม่ไม่ตรงกัน");return;}
    setReceiveCart(current => [...current, { ...receiveForm, previousCost: productId>0 ? receiptPricing.data?.previousCost ?? null : null, lot: receiveForm.lot || suggestedLot, productId, newProduct: draftDefinitions[productId] }]);
    setReceiveForm(emptyReceiveForm()); setReceiveScanKey(key => key + 1); setError("");
    focusReceiptScanner();
  };
  // ROUND 79 — รายการรับเข้าหลายสินค้า + ความคืบหน้าตอนบันทึกทีละรายการ
  const [receiveCart, setReceiveCart] = useState<ReceiveCartEntry[]>([]);
  const suggestedLot = (() => {
    const next = nextLotQuery.data;
    if (!next) return "";
    let sequence = next.sequence;
    const used = new Set(receiveCart.map(row => row.lot));
    while (used.has(next.prefix + String(sequence).padStart(4, "0"))) sequence++;
    return next.prefix + String(sequence).padStart(4, "0");
  })();
  const receiveSubmittingRef = useRef(false);
  const [receiveProgress, setReceiveProgress] = useState<{ done: number; total: number } | null>(null);
  const [receiveDiscardOpen, setReceiveDiscardOpen] = useState(false);
  const [receiveConfirmOpen, setReceiveConfirmOpen] = useState(false);
  const [countReview, setCountReview] = useState<{ description: string; run: () => void } | null>(null);
  const [operationResult, setOperationResult] = useState<{ title: string; description: string } | null>(null);
  const receiveDirty = receiveCart.length > 0 || Boolean(receiveForm.productId) || creatingForReceipt;
  useEffect(() => { onDraftChange?.(receiveDirty); return () => onDraftChange?.(false); }, [receiveDirty, onDraftChange]);
  useEffect(() => {
    if (!receiveDirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [receiveDirty]);
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
    if (addOpen || receiveOpen || operationResult) {
      embeddedReadyRef.current = true;
      return;
    }
    if (embeddedReadyRef.current) onClose();
  }, [addOpen, embeddedAction, initialAction, onClose, receiveOpen, operationResult]);
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
  const [stockTab, setStockTab] = useState<"inventory" | "orders" | "receipts">("inventory");
  // ROUND 55 (user) — ใบนับสต๊อกพิมพ์ออกมานับมือ (พรีวิวก่อนพิมพ์เหมือนทุกจุด)
  const [countSheetOpen, setCountSheetOpen] = useState(false);
  const [stockCategory, setStockCategory] = useState("ทั้งหมด");
  const [stockExportOpen, setStockExportOpen] = useState(false);
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
  const products = [...(productsQuery.data ?? []), ...draftProducts];
  const stockRows = stockQuery.data ?? [];
  const allProducts = [...(allProductsQuery.data ?? []), ...draftProducts];
  // ROUND 71 — ตัวเลือกหมวดสินค้า: ชุดหลัก 6 หมวด + หมวดที่พบจริงในคลัง (กันของเก่าหายไปจากลิสต์)
  const categoryOptions = productCategoryOptions([...PRODUCT_CATEGORIES, ...allProducts.map((product) => product.category)]);
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
  const orderSellingPrice = (item: typeof orderItems[number]) => allProducts.find(product => product.id === item.productId)?.price ?? item.sellingPrice;
  const orderTotalValue = orderItems.reduce((sum, item) => sum + reportSellingValue(item.qty, orderSellingPrice(item)), 0);
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
  const inventoryValue = products.reduce((sum, product) => sum + reportSellingValue(product.stock, product.price), 0);
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
  const categoryCards = productCards.filter(card=>stockCategory === "ทั้งหมด" || normalizeProductCategory(card.product.category)===stockCategory);
  const countSheetProducts = allProducts.filter(product=>stockCategory === "ทั้งหมด" || normalizeProductCategory(product.category)===stockCategory);
  const cardStatusCounts: Record<StockStatusFilter, number> = {
    "ทั้งหมด": categoryCards.length,
    "ปกติ": categoryCards.filter((card) => card.status === "ปกติ").length,
    "สต็อกต่ำ": categoryCards.filter((card) => card.status === "สต็อกต่ำ").length,
    "ใกล้หมดอายุ": categoryCards.filter((card) => card.status === "ใกล้หมดอายุ").length,
    "ปิดการขาย": categoryCards.filter((card) => card.status === "ปิดการขาย").length,
  };
  const filteredCards = categoryCards.filter((card) => (statusFilter === "ทั้งหมด" || card.status === statusFilter) && (cardTerm === "" || card.product.name.toLowerCase().includes(cardTerm) || card.product.sku.toLowerCase().includes(cardTerm) || (card.product.barcode ? cardScanCandidates.includes(card.product.barcode.toLowerCase()) : false) || cardScanCandidates.includes(card.product.sku.toLowerCase()))).sort((a,b)=>codeOrder.compare(a.product.barcode?.trim() || a.product.sku,b.product.barcode?.trim() || b.product.sku));
  const editUnitOptions = editTarget && !["ชิ้น", "ขวด", "ถุง", "กล่อง", "แพ็ก", "กรัม"].includes(editTarget.unit) ? ["ชิ้น", "ขวด", "ถุง", "กล่อง", "แพ็ก", "กรัม", editTarget.unit] : ["ชิ้น", "ขวด", "ถุง", "กล่อง", "แพ็ก", "กรัม"];
  // Round 31-12 — รับเข้าแบบถุง (น้ำแข็ง): ถุง × กรัม/ถุง → คำนวณเป็นกรัมให้ช่องจำนวน
  const selectedReceiveProduct = allProducts.find((product) => String(product.id) === receiveForm.productId) ?? null;
  const receivePriceSummary = receiveCart.filter(row=>!row.newProduct && row.sellingPrice.trim() && Number(row.sellingPrice)!==row.expectedSellingPrice).map(row=>{
    const product=allProducts.find(product=>product.id===row.productId);
    return `${product?.name ?? row.productId}: ฿${(row.expectedSellingPrice ?? product?.price ?? 0).toFixed(2)} → ฿${Number(row.sellingPrice).toFixed(2)}${Number(row.sellingPrice)<(row.expectedSellingPrice ?? 0) ? " (ลดราคา · ตรวจต้นทุนของเดิมก่อน)" : ""}`;
  }).join(" · ");
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
  const avgMargin = products.length === 0 ? 0 : products.reduce((sum, product) => sum + (product.price > 0 ? ((product.price - (product.cost > 0 ? product.cost : product.price)) / product.price) * 100 : 0), 0) / products.length;
  const updatedAt = stockQuery.dataUpdatedAt ? new Date(stockQuery.dataUpdatedAt) : null;
  const updatedLabel = updatedAt ? `${updatedAt.toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric" })} เวลา ${updatedAt.toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hourCycle: "h23", hour: "2-digit", minute: "2-digit" })} น.` : "กำลังโหลดข้อมูล…";
  const refreshQueries = () => {
    void utils.product.list.invalidate();
    void utils.stock.rows.invalidate();
    void utils.stock.receipts.invalidate();
    void utils.stock.receiptPricing.invalidate();
    void utils.dashboard.stats.invalidate();
  };
  const createMutation = trpc.product.create.useMutation({
    onSuccess: (product) => {
      closeModal();
      setNewItem(emptyNewItem);
      setError("");
      notify.completed(`เพิ่มสินค้า ${product.name} เข้ารายการแล้ว · รหัส ${product.sku}`);
      refreshQueries();
    },
    onError: (mutationError) => setError(getErrorMessage(mutationError)),
  });
  const deleteMutation = trpc.product.delete.useMutation({
    onSuccess: (result) => {
      setDeleteTarget(null);
      setDetailTarget(null);
      setManageError("");
      notify.completed(`ลบสินค้า ${result.name} (${result.sku}) ออกจากรายการเรียบร้อยแล้ว · ประวัติบิลเดิมยังคงอยู่ครบ`);
      refreshQueries();
    },
    onError: (mutationError) => { setDeleteTarget(null); setManageError(getErrorMessage(mutationError)); },
  });
  // ROUND 79 — บันทึกผ่าน mutateAsync ใน submitReceiveCart: วนทีละรายการใน "รายการรับเข้า"
  // (ผลลัพธ์/ความล้มเหลวจัดการที่ตัววนเอง — ตัว handler แค่เคลียร์ cache ให้ตัวเลขคลังสดทุกครั้ง)
  const receiveMutation = trpc.stock.receiveBatch.useMutation({
    onSuccess: () => refreshQueries(),
  });
  const countMutation = trpc.stock.count.useMutation({
    onSuccess: (result) => {
      setCountReview(null);
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
      notify.completed(`บันทึกการนับสต็อก ${result.name} เรียบร้อยแล้ว · ระบบ ${result.systemQty} → นับได้ ${result.countedQty} ${result.unit} (${result.diff >= 0 ? "+" : ""}${result.diff})`);
      refreshQueries();
    },
    onError: (mutationError) => { setCountReview(null); setError(getErrorMessage(mutationError)); notify.error("บันทึกการนับสต็อกไม่สำเร็จ", { description: getErrorMessage(mutationError) }); },
  });
  const countLotsMutation = trpc.stock.countLots.useMutation({
    onSuccess: (result) => {
      setCountReview(null);
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
      notify.completed(`บันทึกการนับสต็อก (แยกล็อต) ${result.name} เรียบร้อยแล้ว · รวม ${result.systemQty} → ${result.countedQty} ${result.unit} (${result.diff >= 0 ? "+" : ""}${result.diff}) · ${result.lots.length} ล็อต`);
      refreshQueries();
    },
    onError: (mutationError) => { setCountReview(null); setError(getErrorMessage(mutationError)); notify.error("บันทึกการนับสต็อกไม่สำเร็จ", { description: getErrorMessage(mutationError) }); },
  });
  const updateMutation = trpc.product.update.useMutation({
    onSuccess: (result) => {
      setDetailTarget(current => current?.id === result.id ? result : current);
      setEditOpen(false);
      setEditTarget(null);
      setEditForm(emptyEditForm);
      setManageError("");
      notify.completed(`บันทึกการแก้ไขสินค้า ${result.name} เรียบร้อยแล้ว · รหัส ${result.sku}`);
      refreshQueries();
    },
    onError: (mutationError) => setManageError(getErrorMessage(mutationError)),
  });
  const setActiveMutation = trpc.product.setActive.useMutation({
    onSuccess: (result) => {
      setArchiveTarget(null);
      setManageError("");
      notify.completed(result.active === 1 ? `เปิดขาย ${result.name} อีกครั้งแล้ว` : `ปิดการขาย ${result.name} แล้ว · คงเหลือ ${result.stock} ${result.unit} ยังอยู่ในคลัง`);
      refreshQueries();
    },
    onError: (mutationError) => setManageError(getErrorMessage(mutationError)),
  });
  const addProduct = (forReceipt: boolean) => {
    if (createMutation.isPending || receiveProgress) return;
    if (forReceipt && !isAdminRole(role)) { showValidation("ต้องใช้สิทธิ์ผู้บริหารเพื่อเพิ่มสินค้าใหม่"); return; }
    if (forReceipt && receiveForm.productId) {
      showValidation("ยังมีสินค้าที่กำลังกรอก กรุณายกเลิกหน้าต่างนี้แล้วเพิ่มลงรายการหรือล้างรายการก่อนสร้างสินค้าใหม่");
      return;
    }
    const name = newItem.name.trim();
    if (!name) { showValidation("กรุณาระบุชื่อสินค้า"); return; }
    if (forReceipt && !newItem.unit.trim()) { showValidation("กรุณาระบุหน่วยขายสินค้าใหม่"); return; }
    const isMoney = newItem.sellMode === "money";
    const tierResult = serializeTierRows(newItem.tiers);
    if (isMoney && tierResult.error) { showValidation(tierResult.error); return; }
    if (isMoney && !tierResult.json) { showValidation("สินค้าขายเป็นราคา ต้องมีช่องราคาอย่างน้อย 1 ช่อง เช่น ฿1 = 200 กรัม"); return; }
    const price = isMoney ? tierResult.minPrice : Number(newItem.price);
    // ROUND 54 (user) — อนุญาต ฿0 = ยังไม่ได้ตั้งราคา (สินค้านำเข้าทั้งหมดยังไม่มีราคา) — ห้ามติดลบ
    if (!Number.isFinite(price) || price < 0) { showValidation("ราคาขายต้องเป็นตัวเลข 0 ขึ้นไป"); return; }
    const cost = forReceipt ? undefined : newItem.cost.trim() === "" ? undefined : Number(newItem.cost);
    if (cost !== undefined && (!Number.isFinite(cost) || cost < 0)) { showValidation("ราคาต้นทุนต้องเป็นตัวเลข 0 ขึ้นไป"); return; }
    const reorderPoint = newItem.reorder.trim() === "" ? undefined : Number(newItem.reorder);
    if (reorderPoint !== undefined && (!Number.isInteger(reorderPoint) || reorderPoint < 0)) { showValidation("จุดสั่งซื้อขั้นต่ำต้องเป็นจำนวนเต็ม 0 ขึ้นไป"); return; }
    const skuValue = newItem.sku.trim();
    if (skuValue) {
      const duplicate = allProducts.find((product) => scanMatches(product.barcode, skuValue) || scanMatches(product.sku, skuValue));
      if (duplicate) { showValidation(`รหัส ${skuValue} ใช้กับ “${duplicate.name}” อยู่แล้ว · ใช้รหัสอื่น หรือรับเข้ากับรายการนั้นแทน`); return; }
    }
    setError("");
    const definition: NewProductDraft = {
      name,
      sku: skuValue || undefined,
      barcode: skuValue || undefined,
      size: composeSize(newItem.sizeNum, newItem.sizeUnit) || undefined,
      imageUrl: newItem.imageUrl || undefined,
      unit: newItem.unit,
      price,
      cost,
      reorderPoint,
      category: newItem.category,
      emoji: newItem.emoji || categoryEmoji(newItem.category),
      color: "mint",
      sellMode: isMoney ? "money" : undefined,
      priceTiers: isMoney ? tierResult.json : undefined,
      quickPick: newItem.quickPick ? 1 : 0,
    };
    if (forReceipt) {
      if (!Number.isInteger(Number(newReceiptForm.purchaseQty)) || Number(newReceiptForm.purchaseQty)<=0 || !Number.isInteger(Number(newReceiptForm.freeQty)) || Number(newReceiptForm.freeQty)<0 || !newReceiptForm.paidAmount.trim() || !Number.isFinite(Number(newReceiptForm.paidAmount)) || Number(newReceiptForm.paidAmount)<0) { showValidation("กรุณากรอกจำนวนซื้อ จำนวนแถม และยอดจ่ายของสินค้าใหม่ให้ถูกต้อง"); return; }
      if (normalizeExpiryDate(newReceiptForm.expiry) === null) { showValidation("วันหมดอายุไม่ถูกต้อง"); return; }
      const draftId = Math.min(0, ...draftProducts.map(product => product.id)) - 1;
      const draft: SqliteProduct = {
        id: draftId, name, sku: skuValue || `DRAFT-${Math.abs(draftId)}`,
        barcode: definition.barcode ?? null, size: definition.size ?? null,
        imageUrl: definition.imageUrl ?? null, unit: newItem.unit, price,
        cost: cost ?? 0, stock: 0, reorderPoint: definition.reorderPoint ?? 0,
        category: newItem.category, emoji: newItem.emoji || categoryEmoji(newItem.category), color: "mint", active: 1,
        quickPick: definition.quickPick ?? 0, sellMode: definition.sellMode ?? null,
        priceTiers: definition.priceTiers ?? null, createdAt: new Date().toISOString(),
      };
      setDraftProducts(current => [...current, draft]);
      setDraftDefinitions(current => ({ ...current, [draftId]: definition }));
      setReceiveCart(current => [...current, {...newReceiptForm, productId:draftId, newProduct:definition, lot:newReceiptForm.lot || suggestedLot}]);
      setReceiveForm(emptyReceiveForm()); setReceiveScanKey(key=>key+1);
      setReceiveOpen(true);
      setAddOpen(false);
      setCreatingForReceipt(false);
      setNewItem(emptyNewItem); setNewReceiptForm(emptyReceiveForm());
      focusReceiptScanner();
      return;
    }
    createMutation.mutate({ ...definition, actor, actorRole });
  };
  const addItem = () => addProduct(creatingForReceipt);
  // ROUND 79 (user) — รับเข้าทีละหลายรายการ: ตรวจรายการที่กำลังกรอกให้ครบก่อนเก็บเข้า "รายการรับเข้า"
    const removeReceiveEntry = (index: number) => setReceiveCart((current) => current.filter((_, i) => i !== index));
  // ปิดโมดัลรับเข้า: ถ้ายังมีรายการค้างใน "รายการรับเข้า" ให้ยืนยันก่อนทิ้ง (กันพลาดข้อมูลที่คีย์ไว้)
  const closeReceiveGuard = () => {
    if (receiveProgress || receiveMutation.isPending) return;
    const editorHasData = Boolean(receiveForm.productId) || creatingForReceipt;
    if (receiveCart.length > 0 || editorHasData) { setReceiveDiscardOpen(true); return; }
    if (receivingPage) onClose?.(); else closeModal();
  };
  // Validate the complete draft, confirm once, then commit the batch atomically.
  const submitReceiveCart = async (confirmed = false) => {
    if (receiveSubmittingRef.current) return;
    if (receiveForm.productId || creatingForReceipt) { showValidation("ยังมีสินค้าที่กำลังกรอก กรุณาเพิ่มลงรายการก่อนยืนยันรับเข้า"); return; }
    if (receiveCart.some(row => normalizeExpiryDate(row.expiry) === null)) { showValidation("วันหมดอายุไม่ถูกต้อง กรุณาตรวจรายการก่อนบันทึก"); return; }
    const cart = receiveCart.map(row => ({ ...row, expiry: normalizeExpiryDate(row.expiry)! }));
    if (cart.length === 0) { showValidation("ยังไม่มีรายการที่จะรับเข้า — สแกนหรือเลือกสินค้า แล้วกรอกจำนวนและยอดจ่าย"); return; }
    for (let index = 0; index < cart.length; index++) {
      const entry = cart[index];
      if (!Number.isInteger(Number(entry.purchaseQty)) || Number(entry.purchaseQty) <= 0 || !Number.isInteger(Number(entry.freeQty)) || Number(entry.freeQty) < 0 || entry.paidAmount.trim() === "" || !Number.isFinite(Number(entry.paidAmount)) || Number(entry.paidAmount) < 0) { showValidation("กรุณาตรวจจำนวนและยอดจ่ายของรายการที่ " + (index + 1)); return; }
    }
    const priceByProduct = new Map<number,number>();
    for(const row of cart) if(row.sellingPrice.trim()) {
      const price=Number(row.sellingPrice);
      if(!Number.isFinite(price) || price<0 || (priceByProduct.has(row.productId) && priceByProduct.get(row.productId)!==price)) {showValidation("กรุณาตรวจราคาขายใหม่ สินค้าเดียวกันต้องใช้ราคาเดียวกัน");return;}
      priceByProduct.set(row.productId,price);
    }
    if (receiveMutation.isPending || receiveProgress) return;
    if (!confirmed) { setReceiveConfirmOpen(true); return; }
    receiveSubmittingRef.current = true;
    setReceiveProgress({ done: 0, total: cart.length });
    try {
      const results = await receiveMutation.mutateAsync({ entries: cart.map(entry => ({
        productId: entry.newProduct ? undefined : entry.productId, newProduct: entry.newProduct,
        ...(entry.sellingPrice.trim() && Number(entry.sellingPrice)!==entry.expectedSellingPrice && !entry.newProduct ? {sellingPrice:Number(entry.sellingPrice),expectedSellingPrice:entry.expectedSellingPrice} : {}),
        lot: entry.lot || undefined, expiryDate: entry.expiry || null,
        purchaseQty: Number(entry.purchaseQty), freeQty: Number(entry.freeQty), paidAmount: Number(entry.paidAmount),
      })) });
      closeModal(); setReceiveForm(emptyReceiveForm());
      setReceiveConfirmOpen(false);
      setOperationResult({ title: "รับเข้าสินค้าสำเร็จ", description: `บันทึกเข้าคลังแล้ว ${results.length} รายการ · จำนวนรวม ${cart.reduce((sum, row) => sum + Number(row.purchaseQty) + Number(row.freeQty), 0).toLocaleString("th-TH")} หน่วย · ยอดจ่าย ${money(cart.reduce((sum, row) => sum + Number(row.paidAmount), 0))}` });
    } catch (mutationError) {
      setReceiveConfirmOpen(false); setReceiveCart(cart); setReceiveForm(emptyReceiveForm()); setError(getErrorMessage(mutationError));
      blocker.error("บันทึกการรับเข้าไม่สำเร็จ", getErrorMessage(mutationError));
    } finally { receiveSubmittingRef.current = false; setReceiveProgress(null); }
  };

  const submitCount = (keepOpen = false) => {
    const productId = Number(countForm.productId);
    if (!productId) { showValidation("กรุณาเลือกสินค้าที่ต้องการนับสต็อก"); return; }
    const countedQty = Number(countForm.countedQty);
    if (!Number.isInteger(countedQty) || countedQty < 0) { showValidation("จำนวนที่นับได้ต้องเป็น 0 ขึ้นไป"); return; }
    setError("");
    countKeepRef.current = keepOpen;
    setCountReview({ description: `${selectedCountProduct?.name ?? "สินค้า"} · ปรับยอดคงเหลือเป็น ${countedQty} หน่วย · ระบบจะบันทึกผลต่างและประวัติการนับ`, run: () => countMutation.mutate({ productId, countedQty, note: countForm.note.trim() || undefined, actor, actorRole }) });
  };
  const submitCountLots = (keepOpen = false) => {
    if (!selectedCountProduct) { showValidation("กรุณาเลือกสินค้าที่ต้องการนับสต็อก"); return; }
    if (!lotCountsValid) { showValidation("จำนวนที่นับได้ทุก Lot ต้องเป็น 0 ขึ้นไป"); return; }
    setError("");
    countKeepRef.current = keepOpen;
    setCountReview({ description: `${selectedCountProduct.name} · ปรับยอด ${lotCountEntries.length} Lot ตามจำนวนที่ตรวจนับ · ระบบจะบันทึกผลต่าง`, run: () => countLotsMutation.mutate({ counts: lotCountEntries.map((entry) => ({ lotId: entry.row.id, countedQty: entry.parsed })), note: countForm.note.trim() || undefined, actor, actorRole }) });
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
    // Editing replaces the inventory card; do not keep a second overlay over the form.
    setDetailTarget(null);
    setEditTarget(product);
    const parsedSize = parseSizeInput(product.size);
    setEditForm({ name: product.name, category: normalizeProductCategory(product.category) || PRODUCT_CATEGORIES[0], unit: product.unit, price: String(product.price), cost: String(product.cost), reorder: String(product.reorderPoint), sizeNum: parsedSize.num, sizeUnit: parsedSize.unit, barcode: product.barcode ?? "", emoji: product.emoji ?? "", imageUrl: product.imageUrl ?? "", sellMode: product.sellMode === "money" ? "money" : "unit", quickPick: product.quickPick === 1, tiers: parseTierRows(product.priceTiers) });
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
    if (cost !== undefined && (!Number.isFinite(cost) || cost < 0)) { setManageError("ต้นทุนต่อหน่วยต้องเป็นตัวเลข 0 ขึ้นไป"); return; }
    const reorderPoint = editForm.reorder.trim() === "" ? undefined : Number(editForm.reorder);
    if (reorderPoint !== undefined && (!Number.isInteger(reorderPoint) || reorderPoint < 0)) { setManageError("จุดสั่งซื้อขั้นต่ำต้องเป็นจำนวนเต็ม 0 ขึ้นไป"); return; }
    setManageError("");
    updateMutation.mutate({ productId: editTarget.id, name, category: editForm.category, unit: editForm.unit, price, cost, reorderPoint, barcode: editForm.barcode.trim() || null, size: composeSize(editForm.sizeNum, editForm.sizeUnit) || null, emoji: editForm.emoji || undefined, imageUrl: editForm.imageUrl || null, sellMode: isMoney ? "money" : "unit", priceTiers: isMoney ? tierResult.json : null, quickPick: editForm.quickPick ? 1 : 0, actor, actorRole });
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
    if (duplicate && creatingForReceipt) {
      if (!duplicate.active) { setError(`สินค้า “${duplicate.name}” ปิดการขายอยู่ กรุณาเปิดการขายในสต็อกก่อนรับเข้า`); return; }
      if (receiveForm.productId && receiveForm.productId !== String(duplicate.id)) {
        setError("ยังมีสินค้าที่กำลังกรอก กรุณาเพิ่มลงรายการหรือล้างรายการก่อนเลือกสินค้าอื่น");
        return;
      }
      queueReceiptProduct(duplicate);
      setAddOpen(false);
      setCreatingForReceipt(false);
      setNewItem(emptyNewItem);
      return;
    }
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
    const totalQty = filteredCards.reduce((sum, card) => sum + card.product.stock, 0);
    const openingValue = filteredCards.reduce((sum, card) => sum + reportSellingValue(card.product.stock, card.product.price), 0);
    const rows: string[][] = [
      ["สินค้า", "รหัส SKU", "บาร์โค้ด", "หน่วยขาย", "คงเหลือ", "ราคาขาย/หน่วย", "มูลค่ารวม (ราคาขาย)", "ล็อต", "หมดอายุถัดไป", "สถานะ"],
      ["ยอดยกมา — มูลค่าคงคลังตามตัวกรอง", "", "", "", exportCount(totalQty), "", exportNumber(openingValue), "", "", `สินค้า ${filteredCards.length} รายการ`],
      ...filteredCards.map((card) => [
        card.product.name, card.product.sku, card.product.barcode ?? "—", card.product.unit, exportCount(card.product.stock),
        exportNumber(card.product.price), exportNumber(reportSellingValue(card.product.stock, card.product.price)),
        exportCount(card.lots.length), formatExpiry(card.nextExpiry), card.status,
      ]),
      ["รวมตามตัวกรอง", "", "", "", exportCount(totalQty), "", exportNumber(openingValue), exportCount(filteredCards.reduce((sum, card) => sum + card.lots.length, 0)), "", ""],
    ];
    return rows;
  };
  const openStockExportPreview = async (preferred?: ExportFormat, direct = false) => {
    if (!canExport) { setUpgradeFeature("importExport"); return; } // ROUND 61 — ส่งออก/พิมพ์รายงานเป็นฟีเจอร์โปร
    if (filteredCards.length === 0) { setNotice("ยังไม่มีรายการคงคลังตามตัวกรองที่จะพิมพ์"); return; }
    const totalQty = filteredCards.reduce((sum, card) => sum + card.product.stock, 0);
    const openingValue = filteredCards.reduce((sum, card) => sum + reportSellingValue(card.product.stock, card.product.price), 0);
    const state: ExportPreviewState = {
      kind: "stock",
      title: "รายงานสินค้าคงคลัง",
      periodLabel: `ณ วันที่พิมพ์ ${new Date().toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "long", year: "numeric" })} · หมวด ${stockCategory} · ตามตัวกรอง${statusFilter !== "ทั้งหมด" ? `สถานะ ${statusFilter}` : "ทั้งหมด"}${manageSearch.trim() ? ` และคำค้น “${manageSearch.trim()}”` : ""}`,
      label: "สินค้าคงคลัง",
      fileName: "stock-report", sheetName: "รายการคงคลัง",
      rows: stockExportRows(),
      numericCols: [4, 5, 6, 7],
      preferred: preferred ?? "print",
      doc: {
        fileName: "stock-report.pdf", title: "รายงานสินค้าคงคลัง",
        periodLabel: `ณ วันที่พิมพ์ ${new Date().toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "long", year: "numeric" })} · หมวด ${stockCategory} · ตามตัวกรอง${statusFilter !== "ทั้งหมด" ? `สถานะ ${statusFilter}` : "ทั้งหมด"}${manageSearch.trim() ? ` และคำค้น “${manageSearch.trim()}”` : ""}`,
        meta: [["ยอดยกมา", `สินค้า ${filteredCards.length} รายการ · ${totalQty.toLocaleString("th-TH")} หน่วย`], ["มูลค่าคงคลังรวม (ราคาขาย)", money(openingValue)], ["ล็อตทั้งหมด", `${filteredCards.reduce((sum, card) => sum + card.lots.length, 0)} ล็อต`]],
        columns: ["สินค้า", "รหัส/บาร์โค้ด", "หน่วย", "คงเหลือ", "ราคาขาย/หน่วย", "มูลค่ารวม", "สถานะ"], numericCols: [3, 4, 5],
        columnWidths: ["23%", "24%", "8%", "10%", "11%", "15%", "9%"], nowrapCols: [1],
        rows: [
          ["ยอดยกมา — มูลค่าคงคลังตามตัวกรอง", `${filteredCards.length} รายการ`, "", exportCount(totalQty), "", exportNumber(openingValue), ""],
          ...filteredCards.map((card) => [card.product.name, card.product.barcode ?? card.product.sku, card.product.unit, exportCount(card.product.stock), exportNumber(card.product.price), exportNumber(reportSellingValue(card.product.stock, card.product.price)), card.status]),
        ],
        totalsRow: ["รวมตามตัวกรอง", `${filteredCards.length} รายการ`, "", exportCount(totalQty), "", exportNumber(openingValue), ""],
        brandName: "ร้านค้าสวัสดิการ", footnote: "แถวแรกคือยอดยกมา (มูลค่าคงคลัง ณ วันที่พิมพ์) · รายละเอียดล็อตและวันหมดอายุดูได้จากหน้าจอรายการคงคลัง",
      },
      hasTotalsRow: true,
      downloadNoticeBase: "รายงานสินค้าคงคลัง",
      printNotice: "สั่งพิมพ์รายงานคงคลังแล้ว — เอกสาร A4 พร้อมแถวยอดยกมา",
    };
    if (direct && preferred) {
      await runDocPreviewState(state, preferred);
      return;
    }
    setDocPreview(state);
  };
  const orderExportRows = () => [
    ["สินค้า", "รหัส SKU", "คงเหลือ", "จำนวนที่จะสั่ง", "หน่วย", "ราคาขาย/หน่วย", "มูลค่ารวมโดยประมาณ", "หมายเหตุ"],
    ...orderItems.map((item) => [item.name, item.sku, exportCount(item.stock), exportCount(item.qty), item.unit, exportNumber(orderSellingPrice(item)), exportNumber(reportSellingValue(item.qty, orderSellingPrice(item))), item.note ?? ""]),
    ["รวม", "", "", exportCount(orderItems.reduce((sum, item) => sum + item.qty, 0)), "", "", exportNumber(orderTotalValue), `${orderItems.length} รายการ`],
  ];
  // ROUND 63 (user) — พรีวิวก่อนพิมพ์/ส่งออกรายการสั่งซื้อ เหมือนแท็บคงคลังและหน้ารายงาน
  // (เดิม: ปุ่ม CSV/พิมพ์ วางซ้ายสุดแบบปุ่มธรรมดา ไม่มีพรีวิว/Excel/PDF — ต่างจากแท็บอื่นทั้งระบบ)
  const openOrderExportPreview = async (preferred?: ExportFormat, direct = false) => {
    if (!canExport) { setUpgradeFeature("importExport"); return; } // ROUND 61 — ส่งออก/พิมพ์รายการสั่งซื้อเป็นฟีเจอร์โปร
    if (orderItems.length === 0) { setNotice("ยังไม่มีรายการที่จะสั่งซื้อ"); return; }
    const state: ExportPreviewState = {
      kind: "orders",
      title: "พรีวิวก่อนพิมพ์รายการสั่งซื้อสินค้า",
      periodLabel: `สะสมไว้ ${orderItems.length} รายการ · พิมพ์เมื่อ ${new Date().toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "long", year: "numeric" })}`,
      label: "รายการสั่งซื้อ",
      fileName: "purchase-order", sheetName: "รายการสั่งซื้อ",
      rows: [
        ["สินค้า", "รหัส SKU", "คงเหลือ", "จะสั่ง", "หน่วย", "ราคาขาย/หน่วย", "มูลค่ารวม", "หมายเหตุ"],
        ...orderItems.map((item) => [item.name, item.sku, exportCount(item.stock), exportCount(item.qty), item.unit, exportNumber(orderSellingPrice(item)), exportNumber(reportSellingValue(item.qty, orderSellingPrice(item))), item.note ?? "—"]),
        ["รวม", "—", "—", exportCount(orderItems.reduce((sum, item) => sum + item.qty, 0)), "—", "—", exportNumber(orderTotalValue), `${orderItems.length} รายการ`],
      ],
      numericCols: [2, 3, 5, 6],
      preferred: preferred ?? "print",
      doc: {
        fileName: "purchase-order.pdf", title: "รายการสั่งซื้อสินค้า",
        periodLabel: `สะสมไว้ ${orderItems.length} รายการ · พิมพ์เมื่อ ${new Date().toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "long", year: "numeric" })}`,
        meta: [["จำนวนรายการ", `${orderItems.length} รายการ`], ["มูลค่ารวมโดยประมาณ", money(orderTotalValue)]],
        columns: ["สินค้า", "รหัส SKU", "คงเหลือ", "จะสั่ง", "หน่วย", "ราคาขาย/หน่วย", "มูลค่ารวม", "หมายเหตุ"], numericCols: [2, 3, 5, 6],
        rows: orderItems.map((item) => [item.name, item.sku, exportCount(item.stock), exportCount(item.qty), item.unit, exportNumber(orderSellingPrice(item)), exportNumber(reportSellingValue(item.qty, orderSellingPrice(item))), item.note ?? "—"]),
        totalsRow: ["รวม", "—", "—", exportCount(orderItems.reduce((sum, item) => sum + item.qty, 0)), "—", "—", exportNumber(orderTotalValue), `${orderItems.length} รายการ`],
        brandName: "ร้านค้าสวัสดิการ", footnote: "ใช้ตรวจทานก่อนสั่งซื้อจริง เพื่อไม่ให้ตกหล่น · ลบรายการที่รับเข้าแล้วออกจากลิสต์ได้ที่หน้าจอ",
      },
      hasTotalsRow: true,
      downloadNoticeBase: "รายการสั่งซื้อ",
      printNotice: "สั่งพิมพ์รายการสั่งซื้อแล้ว",
    };
    if (direct && preferred) {
      await runDocPreviewState(state, preferred);
      return;
    }
    setDocPreview(state);
  };
  // ROUND 63 — รันรูปแบบที่เลือกจากพรีวิว (พิมพ์ / PDF / CSV / Excel — เหมือนหน้ารายงาน)
  const runDocPreviewState = async (state: ExportPreviewState, format: ExportFormat) => {
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
    } finally { setDocPreview(null); }
  };
  const runDocPreview = async (format: ExportFormat) => {
    if (!docPreview) return;
    await runDocPreviewState(docPreview, format);
  };
  const closeModal = () => { setNewItem(emptyNewItem); setNewReceiptForm(emptyReceiveForm()); setAddOpen(false); setReceiveOpen(receivingPage); setCountOpen(false); setEditOpen(false); setDetailTarget(null); setLotCounts({}); setCountMode("total"); setError(""); setReceiveCart([]); setDraftProducts([]); setDraftDefinitions({}); setCreatingForReceipt(false);   setReceiveForm(emptyReceiveForm());  setReceiveProgress(null); countKeepRef.current = false; };
  return <div className={receivingPage ? "stock-receiving-page" : embeddedAction ? "stock-embedded" : "stock-page"}>{!receivingPage && <><SectionHeader eyebrow="คลังสินค้าและต้นทุน" title="สต็อกสินค้า" description="ติดตามจำนวนคงเหลือ Lot วันหมดอายุ และต้นทุนสินค้าในคลัง" action={<><button type="button" className="primary-button stock-receive-entry" onClick={() => setReceiveOpen(true)}><PackagePlus size={16} />รับเข้าสินค้า</button><button type="button" className="outline-button stock-add-entry" onClick={() => { setCreatingForReceipt(false); setNewItem(emptyNewItem); setAddOpen(true); setError(""); }}><Plus size={16} />{INVENTORY_ACTION_LABELS.add}</button><button className="outline-button" onClick={() => { if (hasStockCount) setCountSheetOpen(true); else setUpgradeFeature("stockCount"); }} title="พิมพ์ใบนับสต็อก A4 — เอาออกไปนับของจริงที่หน้าชั้นวาง แล้วกลับมากรอกผลที่เมนูนับสต็อก">{!hasStockCount && <Lock size={14} />}<Printer size={16} /> ใบนับสต๊อก</button><button className="outline-button bulk-price-entry" onClick={() => { setBulkPriceOpen(true); }} title="ตั้งราคา/ต้นทุนหลายรายการพร้อมกัน — เหมาะกับสินค้าใหม่ที่ยังไม่มีราคาเป็นจำนวนมาก"><SlidersHorizontal size={16} /> ปรับราคาหลายรายการ{zeroPriceCount > 0 && <span className="bulk-price-badge">{zeroPriceCount} รายการยังไม่มีราคา</span>}</button></>} /><div className="stock-overview"><div className="stock-stat"><span className="stat-icon blue"><Boxes size={18} /></span><div><small>มูลค่าสต็อก (ราคาขาย)</small><strong>{money(inventoryValue)}</strong></div></div><div className="stock-stat"><span className="stat-icon amber"><PackageSearch size={18} /></span><div><small>รายการทั้งหมด</small><strong>{products.length} <em>SKU</em></strong></div></div><div className="stock-stat"><span className="stat-icon red"><Activity size={18} /></span><div><small>ต้องสั่งซื้อ</small><strong className="red-text">{lowStockCount} <em>รายการ</em></strong></div></div><div className="stock-stat"><span className="stat-icon green"><FileBarChart size={18} /></span><div><small>กำไรขั้นต้นเฉลี่ย</small><strong className="green-text">{avgMargin.toFixed(1)}%</strong></div></div></div><section className="dash-workbench stock-workbench"><div className="dash-tabbar" role="tablist" aria-label="ส่วนการจัดการสต็อก"><button type="button" role="tab" aria-selected={stockTab === "inventory"} className={`dash-tab${stockTab === "inventory" ? " active" : ""}`} onClick={() => setStockTab("inventory")}><Boxes size={15} /> รายการคงคลัง<small>{filteredCards.length} รายการ</small></button><button type="button" role="tab" aria-selected={stockTab === "orders"} className={`dash-tab${stockTab === "orders" ? " active" : ""}`} onClick={() => setStockTab("orders")}><ShoppingCart size={15} /> รายการสั่งซื้อ{orderItems.length > 0 && <i className="tab-badge amber" title={`${orderItems.length} รายการที่รอสั่งซื้อ`}>{orderItems.length}</i>}</button>{!embeddedAction && <button type="button" role="tab" aria-selected={stockTab === "receipts"} className={`dash-tab${stockTab === "receipts" ? " active" : ""}`} onClick={() => setStockTab("receipts")}><History size={15} /> ประวัติรับเข้า</button>}</div><div className="dash-tab-body">{stockTab === "receipts" && <StockReceiptHistory canExport={canExport} onUpgrade={() => setUpgradeFeature("importExport")} expanded />}{stockTab === "inventory" && <section className="panel table-panel"><div className="table-toolbar stock-inventory-toolbar"><div><h2>รายการคงคลัง</h2><p>อัปเดตล่าสุดเมื่อ {updatedLabel}</p></div><div className="toolbar-actions"><SharedSearch label="สต็อก · ค้นหาสินค้า"><div className="search-field"><Search size={16} /><input value={manageSearch} onChange={(event) => setManageSearch(event.target.value)} placeholder="ค้นหาชื่อสินค้า รหัส SKU หรือเลขท้ายบาร์โค้ด" /><button type="button" className="scan-camera-btn" onClick={() => { if (hasCameraScan) setSearchCameraOpen(true); else setUpgradeFeature("cameraScan"); }} aria-label="สแกนบาร์โค้ดด้วยกล้องเพื่อค้นหาสินค้า" title="สแกนด้วยกล้องโทรศัพท์ — ยิงบาร์โค้ดที่ตัวสินค้าแล้วระบบหาให้เอง เหมาะกับงานนับสต็อก"><Camera size={16} /></button></div></SharedSearch><label className="stock-category-filter">หมวดสินค้า<select aria-label="หมวดสินค้าในรายการคงคลัง" value={stockCategory} onChange={e=>setStockCategory(e.target.value)}><option value="ทั้งหมด">ทุกหมวดสินค้า</option>{categoryOptions.map(category=><option key={category} value={category}>{category}</option>)}</select></label><div className="filter-pills">{stockStatusFilters.map((item) => <button className={statusFilter === item ? "active" : ""} key={item} onClick={() => setStatusFilter(item)}>{item}{item !== "ทั้งหมด" && <span>{cardStatusCounts[item]}</span>}</button>)}</div><button className="outline-button" onClick={() => { if (hasStockCount) { setCountOpen(true); setError(""); } else setUpgradeFeature("stockCount"); }}>{!hasStockCount && <Lock size={14} />}<ClipboardList size={16} /> นับสต็อก</button><div className={`stock-export-menu${stockExportOpen ? " is-open" : ""}`}><button type="button" className="outline-button stock-export-toggle" aria-expanded={stockExportOpen} onClick={() => setStockExportOpen(open => !open)}><Download size={15} /> ส่งออก / พิมพ์ <ChevronDown size={14} /></button><div className="report-export-actions stock-export-actions" aria-label="ส่งออกรายการคงคลัง"><button type="button" className="outline-button compact export-btn export-csv" onClick={() => void openStockExportPreview("csv", true)} title="ดาวน์โหลด CSV"><Download size={15} /> CSV</button><button type="button" className="outline-button compact export-btn export-excel" onClick={() => void openStockExportPreview("xlsx", true)} title="ดาวน์โหลด Excel"><FileBarChart size={15} /> Excel</button><button type="button" className="outline-button compact export-btn export-pdf" onClick={() => void openStockExportPreview("pdf", true)} title="ดาวน์โหลด PDF"><FileText size={15} /> PDF</button><button type="button" className="outline-button compact export-btn export-print" onClick={() => void openStockExportPreview("print", true)} title="พิมพ์รายงานสินค้าคงคลัง"><Printer size={15} /> พิมพ์</button><button type="button" className="outline-button compact export-btn preview-btn" onClick={() => void openStockExportPreview()} title="ดูตัวอย่างเอกสารก่อนส่งออก"><Eye size={15} /> ดูพรีวิว</button></div></div></div></div><div className="table-filter-summary"><span><ClipboardList size={13} /> {statusFilter === "ทั้งหมด" ? "สินค้าทั้งหมดในคลัง · กดแถวเพื่อดูล็อตและจัดการสินค้า" : `กรองตามสถานะ: ${statusFilter}`}</span><span>แสดง {filteredCards.length} จาก {productCards.length} สินค้า · {stockRows.length} ล็อต</span></div><div className="table-wrap">{stockQuery.isLoading || allProductsQuery.isLoading ? <div className="table-loading"><PackageSearch size={22} /><b>กำลังโหลดรายการคงคลัง</b><span>ดึงข้อมูลสินค้าและล็อตจากระบบ</span></div> : stockQuery.isError ? <div className="entity-state error" role="alert"><PackageSearch size={22} /><b>โหลดรายการคงคลังไม่สำเร็จ</b><span>{getErrorMessage(stockQuery.error)}</span></div> : filteredCards.length === 0 ? <div className="entity-state"><PackageSearch size={22} /><b>ไม่พบสินค้าตามเงื่อนไข</b><span>ลองเปลี่ยนคำค้นหาหรือสถานะ</span></div> : <table className="entity-table rows-stock" aria-label="รายการสินค้าในคลัง"><thead><tr><th>บาร์โค้ด</th><th>สินค้า</th><th className="num">คงเหลือ</th><th>หน่วยขาย</th><th className="num">ราคาขาย</th><th className="num hide-sm">ล็อต</th><th className="hide-sm">หมดอายุถัดไป</th><th>สถานะ</th><th>สั่งซื้อ</th><th className="stock-detail-column">รายละเอียด</th></tr></thead><tbody>{filteredCards.map((card) => <tr className="clickable" key={card.product.id} onClick={() => setDetailTarget(card.product)} title={`ดูล็อตและจัดการ ${card.product.name}`}><td className="stock-sku-column"><span className="cell-mono" style={{ whiteSpace: "nowrap" }}>{card.product.barcode || "—"}</span></td><td><div className="cell-product"><span className="cell-thumb"><ProductArtwork product={card.product} /></span><div><span className="cell-strong">{card.product.name}</span>{card.product.size && <small className="cell-sub">{card.product.size}</small>}</div></div></td><td className="num"><span className={`cell-qty${card.product.stock <= card.product.reorderPoint ? " low" : ""}`}>{card.product.stock}</span></td><td><small className="cell-unit">{card.product.unit}</small></td><td className="cell-num">{money(card.product.price)}</td><td className="cell-num hide-sm">{card.lots.length}</td><td className="hide-sm"><small className="cell-mono" style={{ marginTop: 0 }}>{formatExpiry(card.nextExpiry)}</small></td><td><StatusPill tone={card.tone}>{card.status}</StatusPill></td><td><button type="button" className="mini-button order-add-btn" disabled={orderAddMutation.isPending} onClick={(event) => { event.stopPropagation(); orderAddMutation.mutate({ productId: card.product.id, qty: orderSuggest(card.product), actor, actorRole }); }} title={`เพิ่ม ${card.product.name} เข้ารายการสั่งซื้อ (${orderSuggest(card.product)} ${card.product.unit})`}><ShoppingCart size={13} /> สั่ง</button></td><td className="stock-detail-column"><span className="row-chevron"><ChevronRight size={15} /></span></td></tr>)}</tbody></table>}</div>{notice && <div className="notice-bar"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}{error && !addOpen && !receiveOpen && !countOpen && <div className="notice-bar error"><CircleAlert size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}{manageNotice && <div className="notice-bar"><Check size={16} /> {manageNotice}<button onClick={() => setManageNotice("")}><X size={14} /></button></div>}{manageError && !editOpen && <div className="notice-bar error"><CircleAlert size={16} /> {manageError}<button onClick={() => setManageError("")}><X size={14} /></button></div>}</section>}{stockTab === "orders" && <section className="panel table-panel order-list-panel"><div className="table-toolbar"><div><h2>รายการสั่งซื้อ</h2><p>สะสมสินค้าที่จะสั่งเข้าไว้ที่นี่ก่อน — กันตกหล่น: เพิ่มด้วยปุ่ม "สั่ง" ในตารางคงคลัง ยิงบาร์โค้ด หรือกดเติมสินค้าสต็อกต่ำทั้งหมด</p></div><div className="toolbar-actions"><button className="outline-button" onClick={addAllLowStockToOrders} disabled={orderAddMutation.isPending}><PackagePlus size={15} /> เติมสินค้าสต็อกต่ำ</button>{orderItems.length > 0 && <button className="danger-outline-button" onClick={() => setClearOrdersOpen(true)} disabled={orderClearMutation.isPending}><Trash2 size={15} /> ล้างรายการ</button>}<div className="report-export-actions stock-export-actions order-export-actions" aria-label="ส่งออกรายการสั่งซื้อ"><button type="button" className="outline-button compact export-btn export-csv" onClick={() => void openOrderExportPreview("csv", true)} title="ดาวน์โหลด CSV"><Download size={15} /> CSV</button><button type="button" className="outline-button compact export-btn export-excel" onClick={() => void openOrderExportPreview("xlsx", true)} title="ดาวน์โหลด Excel"><FileBarChart size={15} /> Excel</button><button type="button" className="outline-button compact export-btn export-pdf" onClick={() => void openOrderExportPreview("pdf", true)} title="ดาวน์โหลด PDF"><FileText size={15} /> PDF</button><button type="button" className="outline-button compact export-btn export-print" onClick={() => void openOrderExportPreview("print", true)} title="พิมพ์รายการสั่งซื้อ"><Printer size={15} /> พิมพ์</button><button type="button" className="outline-button compact export-btn preview-btn" onClick={() => void openOrderExportPreview()} title="ดูตัวอย่างเอกสารก่อนส่งออก"><Eye size={15} /> ดูพรีวิว</button></div></div></div><div className="order-add-row"><div className="form-scan-picker"><span className="field-label">เพิ่มสินค้าเข้ารายการ — ยิงบาร์โค้ด หรือคีย์รหัส / ชื่อ</span><ProductScanPicker products={allProducts} selectedId={null} onSelect={(product) => { if (product) orderAddMutation.mutate({ productId: product.id, qty: orderSuggest(product), actor, actorRole }); }} /></div><span className="order-add-hint"><ShoppingCart size={14} /> เลือกแล้วระบบเสนอจำนวนตามจุดสั่งซื้ออัตโนมัติ · แก้จำนวนได้ในตาราง</span></div><div className="table-filter-summary"><span><ShoppingCart size={13} /> รายการที่รอสั่งซื้อ · พิมพ์หรือส่งออกไปให้ผู้ขายได้ทันที</span><span>แสดง {orderItems.length} รายการ · มูลค่ารวมโดยประมาณ {money(orderTotalValue)}</span></div><div className="table-wrap">{orderListQuery.isLoading ? <div className="table-loading"><ShoppingCart size={22} /><b>กำลังโหลดรายการสั่งซื้อ</b><span>ดึงข้อมูลจากระบบ</span></div> : orderListQuery.isError ? <div className="entity-state error" role="alert"><CircleAlert size={22} /><b>โหลดรายการสั่งซื้อไม่สำเร็จ</b><span>{getErrorMessage(orderListQuery.error)}</span></div> : orderItems.length === 0 ? <div className="entity-state"><ShoppingCart size={22} /><b>ยังไม่มีรายการที่จะสั่งซื้อ</b><span>กดปุ่ม "สั่ง" ในตารางคงคลัง ยิงบาร์โค้ดด้านบน หรือกด "เติมสินค้าสต็อกต่ำ"</span></div> : <table className="entity-table rows-orders" aria-label="รายการสั่งซื้อ"><thead><tr><th>สินค้า</th><th>คงเหลือ</th><th className="num">จะสั่ง</th><th>หน่วย</th><th className="num">ราคาขาย/หน่วย</th><th className="num">มูลค่ารวม</th><th className="hide-sm">หมายเหตุ</th><th>การจัดการ</th></tr></thead><tbody>{orderItems.map((item) => { const draftKey = item.id; return <tr key={item.id}><td><span className="cell-strong">{item.name}</span><small className="cell-sub">{item.sku} · จุดสั่งซื้อ {item.reorderPoint}</small></td><td className="num"><span className={`cell-qty${item.stock <= item.reorderPoint ? " low" : ""}`}>{item.stock}</span></td><td className="num"><input className="order-qty-input" type="text" inputMode="numeric" value={orderQtyDrafts[draftKey] ?? String(item.qty)} onFocus={(event) => event.currentTarget.select()} onBlur={() => setOrderQtyDrafts((drafts) => { const next = { ...drafts }; delete next[draftKey]; return next; })} onChange={(event) => { const raw = event.target.value; setOrderQtyDrafts((drafts) => ({ ...drafts, [draftKey]: raw })); const parsed = Number(raw); if (raw.trim() !== "" && Number.isFinite(parsed) && parsed > 0) orderUpdateMutation.mutate({ id: item.id, qty: parsed, actor, actorRole }); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} aria-label={`จำนวนที่จะสั่ง ${item.name}`} title="คลิกแล้วพิมพ์จำนวนที่จะสั่ง" /></td><td><small className="cell-unit">{item.unit}</small></td><td className="cell-num">{money(orderSellingPrice(item))}</td><td className="cell-num">{money(reportSellingValue(item.qty, orderSellingPrice(item)))}</td><td className="hide-sm"><input className="order-note-input" defaultValue={item.note ?? ""} onBlur={(event) => { const note = event.target.value.trim(); if (note !== (item.note ?? "")) orderUpdateMutation.mutate({ id: item.id, note, actor, actorRole }); }} placeholder="หมายเหตุถึงผู้ขาย" aria-label={`หมายเหตุ ${item.name}`} /></td><td><div className="row-actions"><button className="mini-button danger" disabled={orderRemoveMutation.isPending} onClick={() => orderRemoveMutation.mutate({ id: item.id, actor, actorRole })} title="ถอดออกจากรายการสั่งซื้อ (รับเข้าแล้ว หรือไม่ต้องสั่ง)"><Trash2 size={13} /> ถอด</button></div></td></tr>; })}</tbody></table>}</div>{notice && <div className="notice-bar"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}{error && !addOpen && !receiveOpen && !countOpen && <div className="notice-bar error"><CircleAlert size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="order-footer-note"><ShieldCheck size={15} /> รายการนี้ช่วยกันตกหล่นก่อนสั่งจริง — พิมพ์/ส่งออกให้ผู้ขายได้ทันที · เมื่อรับของแล้วกด "ถอด" เพื่อเอาออกจากลิสต์ (การรับเข้าบันทึกที่ปุ่มรับเข้าสินค้าตามปกติ)</div></section>}</div></section>{detailTarget && (() => { const card = productCards.find((entry) => entry.product.id === detailTarget.id); const lots = card?.lots ?? []; return <WorkflowDialog title="รายละเอียดสินค้า" onClose={() => setDetailTarget(null)} className="form-modal stock-detail-modal"><div className="modal-heading"><div><span className="eyebrow">INVENTORY CARD</span><h2>{detailTarget.name}</h2><p>{detailTarget.sku} · คงเหลือ {detailTarget.stock} {detailTarget.unit}{card && <> · <StatusPill tone={card.tone}>{card.status}</StatusPill></>}</p></div><button className="icon-button" onClick={() => setDetailTarget(null)}><X size={17} /></button></div>{detailTarget.imageUrl && <div className="stock-detail-photo"><img src={detailTarget.imageUrl} alt={`รูปสินค้า ${detailTarget.name}`} /></div>}<div className="stock-detail-grid"><div><small>คงเหลือ</small><strong>{detailTarget.stock} <em>{detailTarget.unit}</em></strong></div><div><small>ราคาขาย</small><strong>{money(detailTarget.price)}</strong></div><div><small>ต้นทุนต่อหน่วย</small><strong>{money(detailTarget.cost)}</strong></div><div><small>จุดสั่งซื้อ</small><strong>{detailTarget.reorderPoint} {detailTarget.unit}</strong></div><div><small>มูลค่าคงคลัง (ราคาขาย)</small><strong>{money(reportSellingValue(detailTarget.stock, detailTarget.price))}</strong></div><div><small>หมดอายุถัดไป</small><strong>{formatExpiry(card?.nextExpiry ?? null)}</strong></div></div><div className="stock-detail-lots"><div className="stock-detail-lots-head"><h3>ล็อตสินค้า ({lots.length})</h3><small>ระบบตัดยอดแบบเข้าก่อน-หมดอายุก่อน</small></div>{lots.length === 0 ? <div className="stock-lots-empty"><PackageSearch size={20} /><b>ยังไม่มีล็อตคงเหลือ</b><span>รับเข้าสินค้าเพื่อเริ่มติดตาม</span></div> : <div className="stock-lot-list">{lots.map((lot) => <div className={`stock-lot-row${lot.status === "ใกล้หมดอายุ" ? " expiring" : ""}`} key={lot.id}><div className="stock-lot-main"><b>Lot {lot.lot}</b><small>รับเข้า {lot.receivedAt ? formatLogDateTime(lot.receivedAt) : "—"}</small></div><div className="stock-lot-expiry"><small>หมดอายุ</small><span>{formatExpiry(lot.expiry)}</span></div><div className="stock-lot-qty"><small>คงเหลือ</small><span><b>{lot.qty}</b> {lot.unit}</span></div><StatusPill tone={lot.tone}>{lot.status}</StatusPill></div>)}</div>}</div><div className="stock-detail-actions"><button className="outline-button" onClick={() => openReceiveFor(detailTarget)}><PackagePlus size={15} /> รับเข้าสินค้า</button><button className="outline-button" onClick={() => openCountFor(detailTarget)}><ClipboardList size={15} /> นับสต็อก</button>{isAdminRole(role) && <button className="outline-button" onClick={() => openEditProduct(detailTarget)}><Settings2 size={15} /> แก้ไขข้อมูล</button>}{isAdminRole(role) && (detailTarget.active === 1 ? <button className="outline-button" data-action-tone="warning" onClick={() => setArchiveTarget(detailTarget)}><Ban size={15} /> ปิดการขาย</button> : <button className="outline-button" onClick={() => restoreProduct(detailTarget)}><Check size={15} /> เปิดขายอีกครั้ง</button>)}{isAdminRole(role) && <button className="danger-outline-button" onClick={() => setDeleteTarget(detailTarget)}><Trash2 size={15} /> ลบรายการสินค้า</button>}</div></WorkflowDialog>; })()}</>}{receiveOpen && !addOpen && <ReceivingSurface page={receivingPage} busy={Boolean(receiveProgress)} onClose={closeReceiveGuard}><div className="modal-heading"><div><h2>{INVENTORY_ACTION_LABELS.receive}</h2><p>สแกนหรือเพิ่มสินค้าใหม่ → เพิ่มลงรายการ → ยืนยันรับเข้าทั้งหมด</p></div><button className="icon-button" onClick={closeReceiveGuard}><X size={17} /></button></div><div className="receive-split-workspace"><div className="receive-entry-side"><ReceiveEntryForm onCancel={closeReceiveGuard} artwork={!selectedReceiveProduct && isAdminRole(role) ? <div className="product-artwork-control"><span className="product-artwork-thumb"><ProductArtwork product={{...newItem,barcode:newItem.sku}} /></span><button type="button" className="outline-button compact" disabled={receiveProgress!=null} onClick={() => setIconTarget("new")}>เลือกไอคอนสินค้า</button></div> : undefined} scan={<ProductScanPicker local key={receiveScanKey} onNotFound={openReceiptProductDraft} compactSelected products={products} selectedId={null} onSelect={product=>{if(product && !receiveProgress) queueReceiptProduct(product);}} autoFocus placeholder="สแกนบาร์โค้ด / รหัส / ชื่อ" />} value={!selectedReceiveProduct ? newReceiptForm : receiveForm} onChange={(field,value)=>{if(!selectedReceiveProduct){setCreatingForReceipt(true);setNewReceiptForm(current=>({...current,[field]:value}));}else setReceiveForm(current=>({...current,[field]:value}));}} product={selectedReceiveProduct} newItem={!selectedReceiveProduct ? newItem : undefined} newDraftActive={creatingForReceipt} canCreate={isAdminRole(role)} onNewChange={(field,value)=>{setCreatingForReceipt(true);setNewItem(current=>({...current,[field]:value}));}} onBarcodeCommit={code=>{const match=products.find(product=>product.id>0 && (scanMatches(product.barcode,code)||scanMatches(product.sku,code)));if(match) queueReceiptProduct(match);}} categories={categoryOptions} pricing={Number(receiveForm.productId)>0 ? receiptPricing.data : undefined} loading={Number(receiveForm.productId)>0 && receiptPricing.isFetching} pricingError={Number(receiveForm.productId)>0 && receiptPricing.isError} canChangePrice={isAdminRole(role) && selectedReceiveProduct?.sellMode!=="money"} busy={receiveProgress!=null} onAdd={()=>selectedReceiveProduct ? addEditedReceipt() : addProduct(true)} onClear={()=>{setCreatingForReceipt(false);setNewItem(emptyNewItem);setNewReceiptForm(emptyReceiveForm());setReceiveForm(emptyReceiveForm());setReceiveScanKey(key=>key+1);setError("");focusReceiptScanner();}} /></div><section className="receive-review-side"><div className="receive-cart-head"><div><h3>รายการรับเข้ารอบนี้</h3><span>{receiveCart.length} รายการ</span></div><b>{money(receiveCart.reduce((sum,row)=>sum+(Number(row.paidAmount)||0),0))}</b></div><div className="receive-review-content">{(selectedReceiveProduct || creatingForReceipt) && <ReceivePriceInsight name={selectedReceiveProduct?.name ?? newItem.name} unit={selectedReceiveProduct?.unit ?? newItem.unit} draft={selectedReceiveProduct ? receiveForm : {...newReceiptForm,sellingPrice:newItem.price}} pricing={selectedReceiveProduct ? receiptPricing.data : undefined} catalogCost={selectedReceiveProduct?.cost} currentSellingPrice={selectedReceiveProduct?.price} loading={Boolean(selectedReceiveProduct && receiptPricing.isFetching)} error={Boolean(selectedReceiveProduct && receiptPricing.isError)} newProduct={!selectedReceiveProduct} />}{receiveCart.length===0 ? <div className="receive-empty-list"><PackagePlus size={28}/><b>ยังไม่มีรายการรับเข้า</b><span>สแกนหรือกรอกข้อมูลทางซ้าย แล้วกดเพิ่มลงรายการ</span></div> : <div className="receive-entry-table-wrap"><table className="receive-entry-table receive-simple-table"><thead><tr><th>สินค้า / รหัส</th><th>ซื้อ / แถม</th><th>ยอดจ่าย / ต้นทุนก่อน / รอบนี้</th><th>ราคาขาย</th><th>Lot / หมดอายุ</th><th>จัดการ</th></tr></thead><tbody>{receiveCart.map((entry, index) => { const product = allProducts.find(product => product.id === entry.productId); return <ReceiveEntryRow key={index} entry={entry} index={index} name={product?.name ?? entry.newProduct?.name ?? "สินค้า"} code={product?.barcode || product?.sku} unit={product?.unit} canChangePrice={isAdminRole(role) && product?.sellMode !== "money"} sellingPrice={Number(receiveCart.find(row=>row.productId===entry.productId && row.sellingPrice.trim())?.sellingPrice ?? product?.price ?? entry.newProduct?.price ?? 0)} busy={receiveProgress != null} onUpdate={(field, value) => setReceiveCart(current => current.map((row, i) => i === index ? { ...row, [field]: value, ...(field === "sellingPrice" && row.newProduct ? {newProduct:{...row.newProduct,price:value.trim() ? Number(value) : product?.price ?? row.newProduct.price}} : {}) } : row))} onRemove={() => removeReceiveEntry(index)} />; })}</tbody><tfoot><tr><td colSpan={2}>{receiveCart.length} รายการ</td><td colSpan={4}>ยอดจ่ายรวม {money(receiveCart.reduce((sum,row)=>sum+(Number(row.paidAmount)||0),0))}</td></tr></tfoot></table></div>}</div><div className="receive-review-actions"><ActionButton disabledReason="กรอกข้อมูลให้ครบ" busy={receiveProgress != null} className="primary-button" disabled={receiveProgress != null || receiveCart.length === 0} onClick={() => void submitReceiveCart()}><Save size={16} /> {receiveProgress ? "กำลังบันทึกทั้งชุด…" : receiveCart.length > 0 ? `บันทึกทั้งหมด ${receiveCart.length} รายการ` : "บันทึกการรับเข้า"}</ActionButton></div></section></div>{error && <div className="notice-bar error" role="alert"><CircleAlert size={16} /> {error}<button type="button" onClick={() => setError("")} aria-label="ปิดข้อความแจ้งเตือน"><X size={14} /></button></div>}</ReceivingSurface>}{countReview && <ConfirmDialog open tone="warning" title="ยืนยันปรับยอดสต็อกตามที่นับ?" description={countReview.description} confirmLabel="ยืนยันบันทึกการนับ" pending={countMutation.isPending || countLotsMutation.isPending} onCancel={() => setCountReview(null)} onConfirm={countReview.run} />}
    {receiveConfirmOpen && <ConfirmDialog open tone="primary" title="ยืนยันรับเข้าสินค้าทั้งชุด?" description={`${receiveCart.length} รายการ · สินค้าใหม่ ${receiveCart.filter(row => row.newProduct).length} รายการ · ยอดจ่าย ${money(receiveCart.reduce((sum, row) => sum + Number(row.paidAmount), 0))} · เมื่อยืนยัน ระบบจะสร้างสินค้าใหม่และเพิ่มสต็อกพร้อมกัน${receivePriceSummary ? ` · ปรับราคาขายทั้งสินค้าคงเหลือ: ${receivePriceSummary}` : ""}`} confirmLabel={`ยืนยันรับเข้า ${receiveCart.length} รายการ`} pending={Boolean(receiveProgress)} onCancel={() => setReceiveConfirmOpen(false)} onConfirm={() => void submitReceiveCart(true)} />}
    {operationResult && <WorkflowResult title={operationResult.title} description={operationResult.description} actionLabel={receivingPage ? "เสร็จสิ้น · รับเข้ารอบใหม่" : "เสร็จสิ้น · กลับสต็อก"} onDone={() => { setOperationResult(null); void nextLotQuery.refetch(); window.requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".stock-receive-modal .member-scan-field input")?.focus()); }} />}
    {receiveDiscardOpen && <ConfirmDialog tone="danger" open title="ทิ้งรายการรับเข้าที่ยังไม่ได้บันทึก?" description={`ยังมี ${receiveCart.length} รายการใน "รายการรับเข้า" ที่ยังไม่ได้บันทึกลงคลัง — ปิดหน้าต่างนี้คือทิ้งรายการเหล่านั้นทั้งหมด`} confirmLabel="ทิ้งรายการและปิดหน้าต่าง" onCancel={() => setReceiveDiscardOpen(false)} onConfirm={() => { setReceiveDiscardOpen(false); setReceiveCart([]); setReceiveForm(emptyReceiveForm()); closeModal(); if (receivingPage) onClose?.(); }} />}{iconTarget && <ProductImagePicker currentEmoji={(iconTarget === "new" ? newItem : editForm).emoji} currentImageUrl={(iconTarget === "new" ? newItem : editForm).imageUrl} category={(iconTarget === "new" ? newItem : editForm).category} productName={(iconTarget === "new" ? newItem : editForm).name} onChange={(emoji,imageUrl) => { if (iconTarget === "new") { setNewItem(current => ({...current,emoji:emoji || "",imageUrl:imageUrl || ""})); if(receiveOpen) setCreatingForReceipt(true); } else setEditForm(current => ({...current,emoji:emoji || "",imageUrl:imageUrl || ""})); }} onClose={() => setIconTarget(null)} />}{newCameraOpen && <CameraCaptureModal open title="ถ่ายรูปสินค้าใหม่" hint="ถ่ายหน้าตาสินค้าจริงวางบนชั้น — รูปจะเข้าฟอร์มเพิ่มสินค้าทันที" onClose={() => setNewCameraOpen(false)} onCapture={(dataUrl) => setNewItem((current) => ({ ...current, imageUrl: dataUrl }))} />}{editCameraOpen && <CameraCaptureModal open title={`ถ่ายรูปสินค้าใหม่${editTarget ? ` · ${editTarget.name}` : ""}`} hint="แทนที่รูปเดิมของสินค้านี้ — ยังไม่บันทึกจนกดบันทึกการแก้ไข" onClose={() => setEditCameraOpen(false)} onCapture={(dataUrl) => setEditForm((current) => ({ ...current, imageUrl: dataUrl }))} />}{addOpen && <WorkflowDialog title="เพิ่มสินค้าใหม่" busy={createMutation.isPending} onClose={() => { if (creatingForReceipt) { setAddOpen(false); setCreatingForReceipt(false); setError(""); } else closeModal(); }}><div className="modal-heading"><div><span className="eyebrow">INVENTORY ITEM</span><h2>{INVENTORY_ACTION_LABELS.add}</h2><p>{creatingForReceipt ? "เตรียมข้อมูลสินค้าใหม่สำหรับรายการรับเข้ารอบนี้" : "สร้างข้อมูลสินค้าในระบบทันที โดยยังไม่เพิ่มจำนวนสต็อก"}</p></div><button className="icon-button" onClick={() => { if (creatingForReceipt) { setAddOpen(false); setCreatingForReceipt(false); setError(""); } else closeModal(); }}><X size={17} /></button></div>{creatingForReceipt && <div className="initial-balance-note">สินค้าใหม่ยังเป็นรายการร่าง จะสร้างสินค้าและเพิ่มสต็อกเมื่อกดบันทึกรับเข้าทั้งหมด · ยกเลิกหน้าต่างนี้ไม่กระทบรายการรับเข้าเดิม</div>}<div className="form-grid compact-form" onKeyDownCapture={(event) => formEnterNav(event, addItem)}><label className="wide">รหัสสินค้า / SKU — ยิงบาร์โค้ดที่ตัวสินค้า หรือคีย์เอง<input autoFocus value={newItem.sku} onChange={(event) => setNewItem({ ...newItem, sku: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); handleSkuScan(); } }} placeholder="ยิงบาร์โค้ด หรือพิมพ์รหัส · เว้นว่างเพื่อให้ระบบรันอัตโนมัติ" /></label><label className="wide">ชื่อสินค้า *<input ref={addItemNameRef} value={newItem.name} onChange={(event) => setNewItem({ ...newItem, name: event.target.value })} placeholder="เช่น น้ำดื่มขวดเล็ก" /></label><div className="category-field wide"><span className="field-label">หมวดสินค้า — เว้นช่องรหัสว่างไว้ ระบบจะออกรหัสให้ตามหมวดนี้</span><div className="category-select-row"><select value={newItem.category} onChange={(event) => setNewItem({ ...newItem, category: event.target.value })} aria-label="หมวดสินค้าของรายการใหม่">{categoryOptions.map((category) => <option key={category} value={category}>{category} — รหัส {CATEGORY_SKU_PREFIXES[category] ?? "GEN"}</option>)}</select><small className="category-sku-hint">เว้นช่องรหัสว่าง → ระบบออก <b>{nextAutoSkuPreview(newItem.category)}</b> ให้อัตโนมัติ</small></div></div><div className="size-preset-field wide"><span className="field-label">ขนาด / ปริมาณ — พิมพ์ตัวเลขแล้วเลือกหน่วยจากลิสต์</span><div className="size-preset-row"><input type="number" min="0" step="any" value={newItem.sizeNum} onChange={(event) => setNewItem({ ...newItem, sizeNum: event.target.value })} placeholder="เช่น 500" aria-label="จำนวนขนาด" /><select value={newItem.sizeUnit} onChange={(event) => setNewItem({ ...newItem, sizeUnit: event.target.value })} aria-label="หน่วยของขนาด">{SIZE_UNIT_OPTIONS.map((unit) => <option key={unit}>{unit}</option>)}</select></div><div className="size-preset-chips">{SIZE_PRESETS.map(([num, unit]) => <button type="button" key={`${num}${unit}`} onClick={() => setNewItem({ ...newItem, sizeNum: num, sizeUnit: unit })}>{num} {unit}</button>)}</div></div><label>หน่วยขาย<select value={newItem.unit} onChange={(event) => setNewItem({ ...newItem, unit: event.target.value })}><option>ชิ้น</option><option>ขวด</option><option>ถุง</option><option>กล่อง</option><option>แพ็ก</option><option>กรัม</option></select></label><label>ต้นทุนต่อหน่วย (฿)<input type="number" min="0" step="0.01" readOnly={creatingForReceipt} value={creatingForReceipt ? (Number(newReceiptForm.purchaseQty)+Number(newReceiptForm.freeQty)>0 && newReceiptForm.paidAmount.trim() ? (Number(newReceiptForm.paidAmount)/(Number(newReceiptForm.purchaseQty)+Number(newReceiptForm.freeQty))).toFixed(4) : "") : newItem.cost} onChange={(event) => setNewItem({ ...newItem, cost: event.target.value })} placeholder="0.00" /></label><label>ราคาขาย *<input value={newItem.price} onChange={(event) => setNewItem({ ...newItem, price: event.target.value })} placeholder="฿0.00" />{newItem.sellMode !== "money" && !(Number(newItem.price) > 0) && <small className="price-zero-hint"><CircleAlert size={12} /> เว้นว่าง/ใส่ 0 = ยังไม่ได้ตั้งราคา บันทึกได้เลย</small>}</label><label>จุดสั่งซื้อขั้นต่ำ<input value={newItem.reorder} onChange={(event) => setNewItem({ ...newItem, reorder: event.target.value })} placeholder="10" /></label>{creatingForReceipt && <div className="receive-new-quantity wide"><ReceiveItemEditor value={newReceiptForm} name="จำนวนรับเข้าสินค้าใหม่" busy={Boolean(receiveProgress)} onChange={(field,value)=>setNewReceiptForm(current=>({...current,[field]:value}))} onAdd={()=>{}} onClear={()=>{}} showActions={false} /></div>}<label>วิธีขาย<select value={newItem.sellMode} onChange={(event) => setNewItem({ ...newItem, sellMode: event.target.value as "unit" | "money" })}><option value="unit">ตามหน่วย — ปกติ</option><option value="money">กำหนดเอง-ต่อหน่วย</option></select></label><div className="quickpick-field"><span className="field-label">แผงลัดหน้าร้าน POS</span><button type="button" className={`quickpick-toggle${newItem.quickPick ? " on" : ""}`} onClick={() => setNewItem({ ...newItem, quickPick: !newItem.quickPick })} aria-pressed={newItem.quickPick} title="กดเพื่อสลับสถานะ — สินค้าที่ขึ้นแผงลัดหน้าร้าน POS เปลี่ยนได้ทีหลังที่หน้าขายสินค้าได้เสมอ"><Star size={14} /> {newItem.quickPick ? "ขึ้นแผงแล้ว — กดเพื่อเลิก" : "ยังไม่ขึ้นแผง — กดเพื่อเปิดใช้"}</button></div>{newItem.sellMode === "money" && <div className="tier-editor wide"><div className="tier-editor-head"><span className="field-label">ช่องราคาขาย — ที่ POS แสดงเป็นปุ่มกดเพิ่มเข้าบิล</span><span className="tier-col-labels"><i>ชื่อขนาด</i><i>ราคา ฿</i><i>ปริมาณ ({newItem.unit})</i><i aria-label="ลบ" /></span></div>{newItem.tiers.map((tier, index) => <div className="tier-row" key={index}><input value={tier.label} onChange={(event) => setNewItem({ ...newItem, tiers: newItem.tiers.map((row, rowIndex) => rowIndex === index ? { ...row, label: event.target.value } : row) })} placeholder="เช่น 200 กรัม" aria-label={`ชื่อขนาดช่องที่ ${index + 1}`} /><input type="number" min="0.25" step="0.25" value={tier.price} onChange={(event) => setNewItem({ ...newItem, tiers: newItem.tiers.map((row, rowIndex) => rowIndex === index ? { ...row, price: event.target.value } : row) })} placeholder="1" aria-label={`ราคาช่องที่ ${index + 1} (บาท)`} /><input type="number" min="0.01" step="0.01" value={tier.qty} onChange={(event) => setNewItem({ ...newItem, tiers: newItem.tiers.map((row, rowIndex) => rowIndex === index ? { ...row, qty: event.target.value } : row) })} placeholder="200" aria-label={`ปริมาณของช่องที่ ${index + 1} (${newItem.unit})`} /><button type="button" className="mini-button danger" onClick={() => setNewItem({ ...newItem, tiers: newItem.tiers.length > 1 ? newItem.tiers.filter((_, rowIndex) => rowIndex !== index) : newItem.tiers })} disabled={newItem.tiers.length === 1} aria-label="ลบช่องราคานี้"><X size={13} /></button></div>)}<button type="button" className="mini-button" onClick={() => setNewItem({ ...newItem, tiers: [...newItem.tiers, { label: "", price: "", qty: "" }] })}><Plus size={13} /> เพิ่มช่องราคา</button><small className="tier-hint">ตัวอย่างน้ำแข็ง: ตั้งหน่วยเป็น “กรัม” แล้วรับเข้าเป็นถุง 10 กก. (ช่วยคำนวณให้ตอนรับเข้า) · ขาย ฿1 = 200 ก. · ฿5 = 1,000 ก. · ฿10 = 2,000 ก.</small></div>}<div className="form-image-field wide"><span className="field-label">ภาพสินค้า</span><div className="product-artwork-control"><span className="product-artwork-thumb"><ProductArtwork product={{ ...newItem, barcode: newItem.sku }} /></span><button type="button" className="outline-button" onClick={() => setIconTarget("new")}>เลือกไอคอนแทนรูปถ่าย</button></div><div className="product-image-uploader">{newItem.imageUrl ? <div className="product-image-preview"><img src={newItem.imageUrl} alt="ตัวอย่างรูปสินค้า" /><div><b>พร้อมใช้งาน</b><small>แสดงบน POS และรายการคงคลัง</small></div><div className="photo-action-row"><button type="button" className="mini-button" onClick={() => setNewCameraOpen(true)}><Camera size={13} /> ถ่ายใหม่จากกล้อง</button><button type="button" className="mini-button danger" onClick={() => setNewItem({ ...newItem, imageUrl: "" })}><Trash2 size={13} /> ลบรูป</button></div></div> : <><label className="upload-drop product-upload-drop" htmlFor="new-item-image"><ImagePlus size={18} /><span><b>คลิกเพื่อถ่ายรูปหรืออัปโหลดรูปสินค้าจริง</b><small>รองรับ JPG PNG WEBP · ระบบย่อให้พอดีอัตโนมัติ</small></span><input id="new-item-image" type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => handleNewItemImage(event.target.files?.[0])} /></label><button type="button" className="outline-button compact camera-hint-inline" onClick={() => setNewCameraOpen(true)}><Camera size={15} /> หรือถ่ายรูปสินค้าจากกล้อง</button></>}</div></div></div>{error && <div className="notice-bar error"><CircleAlert size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={() => { if (creatingForReceipt) { setAddOpen(false); setCreatingForReceipt(false); setError(""); } else closeModal(); }}>ยกเลิก</button><ActionButton disabledReason="กรอกข้อมูลให้ครบ" busy={createMutation.isPending} className="primary-button" disabled={createMutation.isPending} onClick={addItem}><Plus size={16} /> {createMutation.isPending ? "กำลังบันทึก…" : creatingForReceipt ? "ใช้สินค้านี้ในรายการรับเข้า" : INVENTORY_ACTION_LABELS.add}</ActionButton></div></WorkflowDialog>}{countOpen && <WorkflowDialog title="นับสต็อก" onClose={closeModal} busy={countMutation.isPending || countLotsMutation.isPending} className="form-modal stock-count-modal"><div className="modal-heading"><div><span className="eyebrow">STOCK COUNT</span><h2>นับสต็อก</h2><p>บันทึกยอดที่นับได้จริง ระบบจะปรับยอดคงเหลือให้ตรงกันทันที</p></div><button className="icon-button" onClick={closeModal}><X size={17} /></button></div><div className="form-grid compact-form"><div className="form-scan-picker wide"><span className="field-label">สินค้า — ยิงบาร์โค้ดที่ตัวสินค้า หรือคีย์รหัส / ชื่อ *</span><ProductScanPicker products={products} selectedId={countForm.productId ? Number(countForm.productId) : null} onSelect={(product) => { setCountForm({ ...countForm, productId: product ? String(product.id) : "" }); setLotCounts({}); }} autoFocus /></div></div>{selectedCountProduct && <div className="count-mode-toggle" role="tablist" aria-label="โหมดการนับสต็อก"><button type="button" role="tab" aria-selected={countMode === "total"} className={countMode === "total" ? "active" : ""} onClick={() => setCountMode("total")}><Boxes size={14} /> นับรวม</button><button type="button" role="tab" aria-selected={countMode === "lots"} className={countMode === "lots" ? "active" : ""} onClick={() => setCountMode("lots")}><ClipboardList size={14} /> แยกตาม Lot{selectedLots.length > 0 && ` (${selectedLots.length})`}</button></div>}{countMode === "total" ? <>{selectedCountProduct && <div className="member-number-preview stock-count-preview"><span><ClipboardList size={16} /> ระบบ {selectedCountProduct.stock} {selectedCountProduct.unit} · นับได้ {countedInput === null ? "—" : countedInput} {selectedCountProduct.unit}</span><b className={countDiff !== null && countDiff < 0 ? "red-text" : countDiff !== null && countDiff > 0 ? "green-text" : ""}>{countDiff === null ? "ต่าง —" : `ต่าง ${countDiff > 0 ? "+" : ""}${countDiff}`}</b></div>}<div className="form-grid compact-form"><label>จำนวนที่นับได้ *<input id="count-qty-input" type="number" min="0" step="1" value={countForm.countedQty} onChange={(event) => setCountForm({ ...countForm, countedQty: event.target.value })} placeholder="ตามจำนวนที่นับได้จริง" /></label><label className="wide">หมายเหตุ<input value={countForm.note} onChange={(event) => setCountForm({ ...countForm, note: event.target.value })} placeholder="เช่น นับก่อนปิดร้าน หรือระบุสาเหตุความต่าง" /></label></div></> : <>{selectedLots.length === 0 ? <div className="lot-count-empty"><PackageSearch size={20} /><b>ไม่พบ Lot ของสินค้านี้</b><span>ใช้โหมด “นับรวม” หรือรับเข้าสินค้าก่อนนับแยกล็อต</span></div> : <div className="lot-count-list">{lotCountEntries.map((entry) => <div className="lot-count-row" key={entry.row.id}><div className="lot-count-label"><b>{entry.row.lot}</b><small>{entry.row.expiry ? `หมดอายุ ${formatExpiry(entry.row.expiry)}` : "ไม่ระบุวันหมดอายุ"} · ระบบ {entry.row.qty} {entry.row.unit}</small></div><input type="number" min="0" step="1" value={entry.raw} aria-label={`จำนวนที่นับได้ Lot ${entry.row.lot}`} onChange={(event) => setLotCounts({ ...lotCounts, [String(entry.row.id)]: event.target.value })} /><b className={`lot-count-diff${entry.diff !== null && entry.diff < 0 ? " negative" : entry.diff !== null && entry.diff > 0 ? " positive" : ""}`}>{entry.diff === null ? "—" : entry.diff === 0 ? "ตรง" : `${entry.diff > 0 ? "+" : ""}${entry.diff}`}</b></div>)}{selectedCountProduct && <div className="lot-count-total"><span>รวมทั้งสินค้า · ระบบ {selectedCountProduct.stock} {selectedCountProduct.unit}</span><b className={lotTotalDiff !== null && lotTotalDiff < 0 ? "red-text" : lotTotalDiff !== null && lotTotalDiff > 0 ? "green-text" : ""}>นับรวม {lotTotal} {selectedCountProduct.unit} · ต่าง {lotTotalDiff === null ? "—" : `${lotTotalDiff > 0 ? "+" : ""}${lotTotalDiff}`}</b></div>}</div>}<div className="form-grid compact-form"><label className="wide">หมายเหตุ<input value={countForm.note} onChange={(event) => setCountForm({ ...countForm, note: event.target.value })} placeholder="เช่อ นับก่อนปิดร้าน หรือระบุสาเหตุความต่าง" /></label></div></>}<div className="initial-balance-note"><ShieldCheck size={15} /> {countMode === "total" ? "การนับสต็อกจะปรับยอดคงเหลือตามจำนวนที่นับได้ทันที และบันทึกความต่างลงระบบ Log" : "โหมดแยกล็อตจะปรับยอดแต่ละ Lot ตามที่นับได้ แล้วคำนวณยอดรวมของสินค้าจากทุก Lot ใหม่"}</div>{error && <div className="notice-bar error"><CircleAlert size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={closeModal}>ยกเลิก</button><div className="modal-actions-group"><button className="outline-button" disabled={countMode === "total" ? countMutation.isPending || !selectedCountProduct || countedInput === null || !Number.isInteger(countedInput) || countedInput < 0 : countLotsMutation.isPending || !selectedCountProduct || !lotCountsValid} onClick={() => (countMode === "total" ? submitCount(true) : submitCountLots(true))}><RotateCcw size={15} /> บันทึกและนับรายการถัดไป</button><ActionButton disabledReason="กรอกข้อมูลให้ครบ" busy={countMode === "total" ? countMutation.isPending : countLotsMutation.isPending} className="primary-button" disabled={countMode === "total" ? countMutation.isPending || !selectedCountProduct || countedInput === null || !Number.isInteger(countedInput) || countedInput < 0 : countLotsMutation.isPending || !selectedCountProduct || !lotCountsValid} onClick={() => (countMode === "total" ? submitCount(false) : submitCountLots(false))}><ClipboardList size={16} /> {(countMode === "total" ? countMutation.isPending : countLotsMutation.isPending) ? "กำลังบันทึก…" : countMode === "total" ? "บันทึกการนับสต็อก" : "บันทึกการนับแยกล็อต"}</ActionButton></div></div></WorkflowDialog>}{editOpen && editTarget && <WorkflowDialog title="แก้ไขข้อมูลสินค้า" onClose={closeModal} busy={updateMutation.isPending} className="form-modal stock-edit-modal"><div className="modal-heading"><div><span className="eyebrow">PRODUCT EDIT</span><h2>แก้ไขข้อมูลสินค้า</h2><p>{editTarget.sku} · {editTarget.name}<StatusPill tone={editTarget.active === 1 ? "green" : "purple"}>{editTarget.active === 1 ? "ขายปกติ" : "ปิดการขาย"}</StatusPill></p></div><button className="icon-button" onClick={closeModal}><X size={17} /></button></div><div className="form-grid compact-form"><label className="wide">ชื่อสินค้า *<input autoFocus value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} placeholder="ชื่อที่แสดงบนหน้าร้าน POS" /></label><label className="wide">บาร์โค้ด / รหัส SKU<input value={editForm.barcode} onChange={(event) => setEditForm({ ...editForm, barcode: event.target.value })} placeholder="ยิงบาร์โค้ดที่ตัวสินค้า หรือพิมพ์รหัส" /></label><div className="category-field wide"><span className="field-label">หมวดสินค้า — ใช้จัดกลุ่มรายงาน และกำหนดรหัสให้สินค้าที่จะเพิ่มใหม่</span><div className="category-select-row"><select value={editForm.category} onChange={(event) => setEditForm({ ...editForm, category: event.target.value })} aria-label="หมวดสินค้า">{categoryOptions.map((category) => <option key={category} value={category}>{category} — รหัส {CATEGORY_SKU_PREFIXES[category] ?? "GEN"}</option>)}</select><small className="category-sku-hint">รหัสปัจจุบัน <b>{editTarget.sku}</b> ไม่เปลี่ยนตามหมวด</small></div></div><div className="size-preset-field wide"><span className="field-label">ขนาด / ปริมาณ — พิมพ์ตัวเลขแล้วเลือกหน่วยจากลิสต์</span><div className="size-preset-row"><input type="number" min="0" step="any" value={editForm.sizeNum} onChange={(event) => setEditForm({ ...editForm, sizeNum: event.target.value })} placeholder="เช่น 500" aria-label="จำนวนขนาด" /><select value={editForm.sizeUnit} onChange={(event) => setEditForm({ ...editForm, sizeUnit: event.target.value })} aria-label="หน่วยของขนาด">{(SIZE_UNIT_OPTIONS.includes(editForm.sizeUnit) ? SIZE_UNIT_OPTIONS : [...SIZE_UNIT_OPTIONS, editForm.sizeUnit]).map((unit) => <option key={unit}>{unit}</option>)}</select></div><div className="size-preset-chips">{SIZE_PRESETS.map(([num, unit]) => <button type="button" key={`${num}${unit}`} onClick={() => setEditForm({ ...editForm, sizeNum: num, sizeUnit: unit })}>{num} {unit}</button>)}</div></div><label>หน่วยขาย<select value={editForm.unit} onChange={(event) => setEditForm({ ...editForm, unit: event.target.value })}>{editUnitOptions.map((unit) => <option key={unit}>{unit}</option>)}</select></label><label>ต้นทุนต่อหน่วย (฿)<input type="number" min="0" step="0.01" value={editForm.cost} onChange={(event) => setEditForm({ ...editForm, cost: event.target.value })} placeholder="ต้นทุนต่อหน่วย" /></label><label>ราคาขาย *<input type="number" min="0" step="0.01" value={editForm.price} onChange={(event) => setEditForm({ ...editForm, price: event.target.value })} placeholder="฿0.00" />{editForm.sellMode !== "money" && !(Number(editForm.price) > 0) && <small className="price-zero-hint"><CircleAlert size={12} /> ยังไม่ได้ตั้งราคาขาย — บันทึกเป็น ฿0 ได้ และค่อยใส่ราคาภายหลัง</small>}</label><label>จุดสั่งซื้อขั้นต่ำ<input type="number" min="0" step="1" value={editForm.reorder} onChange={(event) => setEditForm({ ...editForm, reorder: event.target.value })} placeholder="เช่น 10" /></label><label>วิธีขาย<select value={editForm.sellMode} onChange={(event) => setEditForm({ ...editForm, sellMode: event.target.value as "unit" | "money" })}><option value="unit">ตามหน่วย — ปกติ</option><option value="money">กำหนดเอง-ต่อหน่วย</option></select></label><div className="quickpick-field"><span className="field-label">แผงลัดหน้าร้าน POS</span><button type="button" className={`quickpick-toggle${editForm.quickPick ? " on" : ""}`} onClick={() => setEditForm({ ...editForm, quickPick: !editForm.quickPick })} aria-pressed={editForm.quickPick} title="กดเพื่อสลับสถานะ — สินค้าที่ขึ้นแผงลัดหน้าร้าน POS เปลี่ยนได้ทีหลังที่หน้าขายสินค้าได้เสมอ"><Star size={14} /> {editForm.quickPick ? "ขึ้นแผงแล้ว — กดเพื่อเลิก" : "ยังไม่ขึ้นแผง — กดเพื่อเปิดใช้"}</button></div>{editForm.sellMode === "money" && <div className="tier-editor wide"><div className="tier-editor-head"><span className="field-label">ช่องราคาขาย — ที่ POS แสดงเป็นปุ่มกดเพิ่มเข้าบิล</span><span className="tier-col-labels"><i>ชื่อขนาด</i><i>ราคา ฿</i><i>ปริมาณ ({editForm.unit})</i><i aria-label="ลบ" /></span></div>{editForm.tiers.map((tier, index) => <div className="tier-row" key={index}><input value={tier.label} onChange={(event) => setEditForm({ ...editForm, tiers: editForm.tiers.map((row, rowIndex) => rowIndex === index ? { ...row, label: event.target.value } : row) })} placeholder="เช่น 200 กรัม" aria-label={`ชื่อขนาดช่องที่ ${index + 1}`} /><input type="number" min="0.25" step="0.25" value={tier.price} onChange={(event) => setEditForm({ ...editForm, tiers: editForm.tiers.map((row, rowIndex) => rowIndex === index ? { ...row, price: event.target.value } : row) })} placeholder="1" aria-label={`ราคาช่องที่ ${index + 1} (บาท)`} /><input type="number" min="0.01" step="0.01" value={tier.qty} onChange={(event) => setEditForm({ ...editForm, tiers: editForm.tiers.map((row, rowIndex) => rowIndex === index ? { ...row, qty: event.target.value } : row) })} placeholder="200" aria-label={`ปริมาณของช่องที่ ${index + 1} (${editForm.unit})`} /><button type="button" className="mini-button danger" onClick={() => setEditForm({ ...editForm, tiers: editForm.tiers.length > 1 ? editForm.tiers.filter((_, rowIndex) => rowIndex !== index) : editForm.tiers })} disabled={editForm.tiers.length === 1} aria-label="ลบช่องราคานี้"><X size={13} /></button></div>)}<button type="button" className="mini-button" onClick={() => setEditForm({ ...editForm, tiers: [...editForm.tiers, { label: "", price: "", qty: "" }] })}><Plus size={13} /> เพิ่มช่องราคา</button><small className="tier-hint">ตัวอย่างน้ำแข็ง: ฿1 = 200 ก. · ฿5 = 1,000 ก. · ฿10 = 2,000 ก. — หน่วยคงเหลือนับเป็นกรัม</small></div>}<div className="form-image-field wide"><span className="field-label">ภาพสินค้า</span><div className="product-artwork-control"><span className="product-artwork-thumb"><ProductArtwork product={{ ...editForm, barcode: editForm.barcode }} /></span><button type="button" className="outline-button" onClick={() => setIconTarget("edit")}>เลือกไอคอนแทนรูปถ่าย</button></div><div className="product-image-uploader">{editForm.imageUrl ? <div className="product-image-preview"><img src={editForm.imageUrl} alt="ตัวอย่างรูปสินค้า" /><div><b>พร้อมใช้งาน</b><small>แสดงบน POS และรายการคงคลัง</small></div><div className="photo-action-row"><button type="button" className="mini-button" onClick={() => setEditCameraOpen(true)}><Camera size={13} /> ถ่ายใหม่จากกล้อง</button><button type="button" className="mini-button danger" onClick={() => setEditForm({ ...editForm, imageUrl: "" })}><Trash2 size={13} /> ลบรูป</button></div></div> : <><label className="upload-drop product-upload-drop" htmlFor="edit-item-image"><ImagePlus size={18} /><span><b>คลิกเพื่ออัปโหลดรูปสินค้าจริง</b><small>รองรับ JPG PNG WEBP · ระบบย่อให้พอดีอัตโนมัติ</small></span><input id="edit-item-image" type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => handleEditImage(event.target.files?.[0])} /></label><button type="button" className="outline-button compact camera-hint-inline" onClick={() => setEditCameraOpen(true)}><Camera size={15} /> หรือถ่ายรูปสินค้าจากกล้อง</button></>}</div></div></div><div className="member-number-preview"><span><ClipboardList size={16} /> ระบบ {editTarget.stock} {editTarget.unit} · แก้ไขจำนวนผ่านการนับสต็อก</span></div><div className="initial-balance-note"><ShieldCheck size={15} /> การแก้ไขบันทึกทันทีและปรากฏในระบบ Log · ระบุเฉพาะรายการที่แก้ไข</div>{manageError && <div className="notice-bar error"><CircleAlert size={16} /> {manageError}<button onClick={() => setManageError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={closeModal}>ยกเลิก</button><ActionButton disabledReason="กรอกข้อมูลให้ครบ" busy={updateMutation.isPending} className="primary-button" disabled={updateMutation.isPending || editForm.name.trim() === "" || !Number.isFinite(Number(editForm.price)) || Number(editForm.price) < 0} onClick={submitEditProduct}><SlidersHorizontal size={16} /> {updateMutation.isPending ? "กำลังบันทึก…" : "บันทึกการแก้ไข"}</ActionButton></div></WorkflowDialog>}<ConfirmDialog tone="danger" open={deleteTarget !== null} title="ยืนยันการลบรายการสินค้า?" description={deleteTarget ? `ลบ “${deleteTarget.name}” (${deleteTarget.sku}) ออกจากรายการสินค้าถาวร · ล็อตคงเหลือ ${deleteTarget.stock} ${deleteTarget.unit} จะถูกลบไปด้วย · ประวัติบิลเดิมยังคงแสดงชื่อรายการเหมือนเดิม` : ""} confirmLabel="ยืนยันลบสินค้า" onCancel={() => setDeleteTarget(null)} onConfirm={() => { if (deleteTarget) deleteMutation.mutate({ productId: deleteTarget.id, actor, actorRole }); }} /><ConfirmDialog tone="danger" open={clearOrdersOpen} title="ยืนยันล้างรายการสั่งซื้อทั้งหมด?" description={`รายการสั่งซื้อ ${orderItems.length} รายการ (มูลค่าโดยประมาณ ${money(orderTotalValue)}) จะถูกล้างออกทั้งหมด · ใช้หลังสั่งซื้อครบหรือตรวจสอบรายการแล้วเท่านั้น — ระบบบันทึกการล้างลง Log`} confirmLabel={`ยืนยันล้าง ${orderItems.length} รายการ`} onCancel={() => setClearOrdersOpen(false)} onConfirm={() => { setClearOrdersOpen(false); orderClearMutation.mutate({ actor, actorRole }); }} /><ConfirmDialog tone="warning" open={archiveTarget !== null} title="ยืนยันการปิดการขายสินค้า?" description={archiveTarget ? `สินค้า ${archiveTarget.name} (${archiveTarget.sku}) จะถูกซ่อนจากหน้าร้าน POS ทันที · สต็อกคงเหลือ ${archiveTarget.stock} ${archiveTarget.unit} ยังอยู่ในคลังและตรวจสอบได้ที่รายการคงคลัง` : ""} confirmLabel="ยืนยันปิดการขาย" onCancel={() => setArchiveTarget(null)} onConfirm={confirmArchive} />{/* ROUND 53 (user) — ใบนับสต๊อก A4 สำหรับพิมพ์ออกไปนับมือ (ซ่อนบนจอ โผล่ตอนพรีวิว/พิมพ์) */}<StockCountSheet products={countSheetProducts} />{countSheetOpen && <PrintPreviewModal targetId="stock-count-sheet" title="พรีวิวใบนับสต็อก" subtitle={`หมวดสินค้า: ${stockCategory}`} paper="a4" documentVersion={stockCategory} renderControls={busy=><label className="stock-count-category-picker">เลือกหมวดสินค้าที่ต้องการพิมพ์<select aria-label="หมวดสินค้าในใบนับสต็อก" value={stockCategory} disabled={busy} onChange={e=>setStockCategory(e.target.value)}><option value="ทั้งหมด">ทุกหมวดสินค้า</option>{categoryOptions.map(category=><option key={category} value={category}>{category}</option>)}</select></label>} onClose={() => setCountSheetOpen(false)} />}{/* ROUND 55 (user) — สแกนบาร์โค้ดด้วยกล้องที่ช่องค้นหารายการคงคลัง */}{searchCameraOpen && <BarcodeCameraModal open title="สแกนบาร์โค้ดสินค้า" hint="เล็งบาร์โค้ดที่ตัวสินค้า — อ่านได้แล้วระบบค้นหารายการนั้นให้ทันที (ใช้เว็บแคม/มือถือแทนปืนสแกนได้)" onClose={() => setSearchCameraOpen(false)} onDetect={(code) => { setSearchCameraOpen(false); setManageSearch(code); }} />}{docPreview && <ExportPreviewModal state={docPreview} onClose={() => setDocPreview(null)} onRun={(format) => void runDocPreview(format)} />}{bulkPriceOpen && isAdminRole(role) && <BulkPriceModal open products={allProducts} actor={actor} actorRole={actorRole} onClose={() => setBulkPriceOpen(false)} onDone={(message) => { setBulkPriceOpen(false); notify.completed("ปรับราคาและต้นทุนสำเร็จ", { description: message }); }} />}{upgradeFeature && <EditionUpgradeModal open onClose={() => setUpgradeFeature(null)} status={edition.status} focusFeature={upgradeFeature} onApplied={() => void edition.refetch()} />}</div>;
}

