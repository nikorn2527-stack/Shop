import { MemberRegistrationModal } from "@/components/MemberRegistrationModal";
import type { MemberCardData } from "@/components/MemberCardModal";
import { LimitReductionModal } from "@/components/LimitReductionModal";
import { useEffect, useMemo, useRef, useState } from "react";
import { TRPCClientError } from "@trpc/client";
import QRCode from "qrcode";
import {
  ArrowDownToLine, ArrowUpFromLine, Bank, Camera, Check, ChevronDown, CircleAlert, CircleHelp, Copy, CreditCard, Download, FileImage, History, IdCard, ImagePlus, LayoutGrid, Lock, Minus, PackageSearch, Pause, Plus, Printer, QrCode, RotateCcw, ScanLine, Search, ShieldCheck, Sparkles, Star, StarOff, ShoppingCart, Trash2, Upload, UserRound, WalletCards, X,
} from "@/lib/icons";
import { toast } from "sonner";
import { blocker } from "@/components/BlockerAlert";
import type { CartItem, HeldBill, MemberLite, Product, Role } from "./pageData";
import { HELD_BILLS_LIMIT, PRENAME_OPTIONS, addScannedItem, addTierItem, calculateCartSubtotal, compressImageToDataUrl, formatMemberNumber, isAdminRole, loadHeldBills, memberFullName, money, parsePriceTiers, roleThaiLabel, scanMatches, smartMatchScore } from "./pageData";
import type { PriceTier } from "./pageData";
import { nextMemberSequence } from "./viewFormat";
import { ConfirmDialog, SectionHeader, formEnterNav } from "./PagePrimitives";
import { PaymentNotice } from "@/components/PaymentNotice";
import { ReceiptModal } from "@/components/ReceiptModal";
import { MemberScanPicker } from "@/components/ScanPickers";
import { CameraCaptureModal } from "@/components/CameraCaptureModal";
import { MemberAvatar } from "@/components/MemberAvatar";
import { MemberCardModal } from "@/components/MemberCardModal";
import { PrintPreviewModal } from "@/components/PrintPreviewModal";
import { BarcodeCameraModal } from "@/components/BarcodeCameraModal";
import { EditionUpgradeModal, useEditionStatus } from "@/components/EditionUi";
import type { EditionFeatureKey } from "@shared/editions";
import { buildPromptPayPayload, isValidPromptPayId } from "@/promptpay";
import { downloadSlipFile } from "@/exportUtils";
import { SCAN_LAYOUT_TOAST, useScanLayout } from "../scanLayout";
import { HelpDisclosure } from "@/components/HelpDisclosure";
import { trpc } from "@/lib/trpc";
import { Stock } from "./Stock";
import { SharedSearch } from "@/components/SharedSearch";

/** Product row straight from trpc.product.list (backend SqliteProduct). */
type StoreProduct = Product & {
  sku: string;
  barcode: string | null;
  cost: number;
  reorderPoint: number;
  size: string | null;
  imageUrl: string | null;
  sellMode: string | null;
  priceTiers: string | null;
  quickPick: number;
};

type CheckoutReceipt = {
  orderNumber: string;
  createdAt: string;
  items: { productId: number | null; name: string; unit: string; qty: number; price: number; amount: number }[];
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: string;
  memberNumber: string | null;
  memberName: string | null;
  balanceAfter: number | null;
  cashier: string | null;
};

type PaymentMethod = "เงินสด" | "QR / สแกน" | "หักบัญชีสมาชิก";

/** ROUND 41 — แถวรายการให้เลือกใต้ช่องสแกน: สินค้า หรือ สมาชิก */
type ScanRow = { kind: "product"; product: StoreProduct } | { kind: "member"; member: MemberLite };

// R74 — จัดแผงลัดหน้าร้าน: จำนวนแถวคลังที่โชว์ก่อนมีปุ่ม "แสดงเพิ่ม" (เดิมหั่นเงียบ ๆ ที่ 40 ตาม id
// จนของเดิมบนแผงที่ id ท้ายคลัง 11 จาก 13 รายการมองไม่เห็น = ผู้ใช้นำออกไม่ได้)
const QUICK_MANAGE_PAGE = 60;
const SPECIAL_SHORTCUT = "สินค้าไม่ระบุตายตัว";

function getErrorMessage(error: unknown) {
  if (error instanceof TRPCClientError) return error.message;
  return "เกิดข้อผิดพลาดในการเชื่อมต่อระบบ กรุณาลองอีกครั้ง";
}

function holdTimeLabel(savedAt: number) {
  return new Date(savedAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

function slipTimeLabel(date: Date) {
  return `${date.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" })} · ${date.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })} น.`;
}

/** Money-mode products count stock in grams — show 1,200 ก. / 1.2 กก. instead of raw numbers. */
function formatBillQty(qty: number, unit: string) {
  const normalized = (unit || "").trim();
  if (normalized === "กรัม" || normalized === "ก." || normalized === "กรัม (g)") {
    return qty >= 1000 ? `${(qty / 1000).toLocaleString("th-TH", { maximumFractionDigits: 2 })} กก.` : `${qty.toLocaleString("th-TH")} ก.`;
  }
  return qty.toLocaleString("th-TH");
}

export function Pos({ shortcut, setShortcut, role, userName, focusProductId, onFocusProductConsumed }: { shortcut: string; setShortcut: (value: string) => void; role: Role; userName: string; focusProductId?: number | null; onFocusProductConsumed?: () => void }) {
  // ROUND 61 — สิทธิ์เวอร์ชัน: กล้องสแกน + รายการพิเศษ/ของสั่ง เป็นฟีเจอร์เวอร์ชันโปรพลัส
  const edition = useEditionStatus();
  const hasCameraScan = edition.status?.has("cameraScan") ?? false;
  const hasSpecialOrders = edition.status?.has("specialOrders") ?? false;
  const [upgradeFeature, setUpgradeFeature] = useState<EditionFeatureKey | null>(null);
  // เปิดกล้อง/รายการพิเศษผ่านปุ่มหรือ F4 — ถ้าเวอร์ชันยังไม่รวม จะเปิดหน้าต่างเลือกเวอร์ชันแท
  const openCamera = () => { if (hasCameraScan) setCameraOpen(true); else setUpgradeFeature("cameraScan"); };
  const toggleSpecial = () => { if (hasSpecialOrders) setShortcut(shortcut === SPECIAL_SHORTCUT ? "" : SPECIAL_SHORTCUT); else setUpgradeFeature("specialOrders"); };
  const utils = trpc.useUtils();
  const productsQuery = trpc.product.list.useQuery(undefined);
  const membersQuery = trpc.member.list.useQuery();
  // Store settings drive POS behavior: showBalanceOnReceipt is read inside
  // ReceiptModal for every slip, and posRailHidden hides rail buttons here.
  // ROUND 75 — autoPrintReceipt was removed: the checkout success screen never
  // auto-opens the print dialog anymore (print/image/PDF are manual buttons).
  const settingsQuery = trpc.settings.get.useQuery(undefined);
  // ROUND 75 (user) — ตั้งค่า "เมนูลัดหน้าร้าน" (ตั้งค่า → การขายหน้าร้าน): ปุ่มไหนถูกปิด
  // ให้ซ่อนจากรางซ้าย และคีย์ลัด F ของปุ่มนั้นหยุดทำงานด้วย (ป้องกันกด F2 แล้วหน้าต่างเด้งขึ้นมา)
  const railHidden = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(settingsQuery.data?.posRailHidden || "[]");
      return new Set<string>(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
    } catch {
      return new Set<string>();
    }
  }, [settingsQuery.data?.posRailHidden]);
  const shortcutKeys = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(settingsQuery.data?.posShortcutKeys || "{}");
      return parsed && typeof parsed === "object" ? parsed as Record<string, string> : {};
    } catch {
      return {};
    }
  }, [settingsQuery.data?.posShortcutKeys]);
  const isShortcut = (event: KeyboardEvent, action: string, fallback: string) => {
    const assigned = (shortcutKeys[action] || fallback).trim().toUpperCase();
    return assigned !== "ESC" && (event.key.toUpperCase() === assigned || event.code.toUpperCase() === assigned);
  };
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("ทั้งหมด");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedMemberNumber, setSelectedMemberNumber] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // ROUND 37 (req 36) — ยิงบาร์โค้ด/คิวอาร์ของ “บัตรสมาชิก” ที่ช่องสแกนหลัก
  // (หรือช่องจำนวน) → เด้งโมดูลบัตรสมาชิกให้ยืนยันข้อมูลก่อนเข้าบิล
  const [scanMember, setScanMember] = useState<MemberLite | null>(null);
  // ROUND 63 — สลิปเติม/ถอน: เก็บ data-URL จริง (ย่อ 800px) เพื่อส่งเก็บไว้กับรายการ
  const [slipPreview, setSlipPreview] = useState("");
  const [slipName, setSlipName] = useState("");
  const [slipDataUrl, setSlipDataUrl] = useState("");
  const [slipCameraOpen, setSlipCameraOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receipt, setReceipt] = useState<CheckoutReceipt | null>(null);
  const [discount, setDiscount] = useState("0");
  const [walletAmount, setWalletAmount] = useState("");
  const [walletNote, setWalletNote] = useState("");
  const [walletMemberNumber, setWalletMemberNumber] = useState("");
  // Round 31 — เติม/ถอนเป็น 2 ขั้น: กรอก → ยืนยันรายละเอียดก่อนเงินเข้าบัญชี →
  // สลิปยอดผลลัพธ์พร้อมพิมพ์ (บันทึกลงรายการธุรกรรมเหมือนซื้อสินค้าทั่วไป)
  const [walletStep, setWalletStep] = useState<"form" | "confirm" | "success">("form");
  const [walletResult, setWalletResult] = useState<{ memberNumber: string; memberName: string; type: "deposit" | "withdrawal" | "refund"; amount: number; balanceBefore: number; balanceAfter: number; detail: string } | null>(null);
  const [walletDoneAt, setWalletDoneAt] = useState<Date | null>(null);
  // ROUND 51 — พิมพ์สลิปเติม/ถอนเงินผ่านพรีวิวก่อน (เหมือนจุดพิมพ์อื่นทั้งระบบ)
  const [walletPrintPreview, setWalletPrintPreview] = useState(false);
  // ROUND 77 (user) — สลิปเติม/ถอน: ดาวน์โหลดรูป/PDF ได้เหมือนใบเสร็จ (ฟอร์แมตเดียวกันทุกจุด)
  const [walletSlipBusy, setWalletSlipBusy] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  // ROUND 54 (user) — ทุกการชำระเงินต้องยืนยันก่อน: ปุ่มจ่ายเงินเปิดหน้าตรวจรายการ
  // บิลจะยังไม่ถูกบันทึก/ตัดสต็อก/สั่งพิมพ์ จนกว่าจะกด “ยืนยันการชำระเงิน"
  const [payConfirm, setPayConfirm] = useState<PaymentMethod | null>(null);
  // ROUND 63 (user) — QR พร้อมเพย์ที่หน้ายืนยัน: ภาพ QR ยอดตามบิล ให้ลูกค้าสแกนจ่าย
  const [payQrUrl, setPayQrUrl] = useState("");
  const [paymentNoticeOpen, setPaymentNoticeOpen] = useState(false);
  // รูปหลักฐานการชำระที่แนบไปกับบิล QR / สแกน (ถ่ายจากกล้อง หรือเลือกจากไฟล์)
  const [paySlip, setPaySlip] = useState<{ dataUrl: string; name: string } | null>(null);
  const [paySlipCameraOpen, setPaySlipCameraOpen] = useState(false);
  // FIX-7 (user) — QR verification: แคชเชียร์ต้องติ๊ก "ตรวจสอบการชำระแล้ว" ก่อนปุ่มยืนยันถึงจะ enable
  // (ป้องกันกดผิด/กดเร็วก่อนลูกค้าสแกนจ่ายจริง) · reset ทุกครั้งที่ปิด modal
  const [qrVerified, setQrVerified] = useState(false);
  // FIX-7 (user) — Cash received: แคชเชียร์กรอกยอดเงินที่รับมา (inputMode=numeric บนมือถือ)
  // + ปุ่มลัด 50/100/200/500/1000/รับตรงยอด → ระบบคำนวณเงินทอน + ปุ่มยืนยัน disabled ถ้าเงินไม่พอ
  const [cashReceived, setCashReceived] = useState("");
  // ROUND 55 (user) — สแกนด้วยกล้องมือถือ/เว็บแคม ที่ช่องสแกนหลัก (ไม่มีปืนสแกนก็ยิงได้)
  const [cameraOpen, setCameraOpen] = useState(false);
  // Round 31-12 — แผงลัดหน้าร้าน: เลือก/นำออกสินค้าที่หยิบบ่อยได้ที่ POS เลย
  const [quickManageOpen, setQuickManageOpen] = useState(false);
  const [quickManageSearch, setQuickManageSearch] = useState("");
  const [quickManageNotice, setQuickManageNotice] = useState("");
  // R74 — โมดัลจัดแผง: กด "แสดงเพิ่ม" เปิดคลังทั้งหมด (รีเซ็ตทุกครั้งที่เปิดโมดัลใหม่)
  const [quickManageShowAll, setQuickManageShowAll] = useState(false);
  const [inventoryQuickOpen, setInventoryQuickOpen] = useState(false);
  const [inventoryQuickAction, setInventoryQuickAction] = useState<"receive" | "add">("receive");
  useEffect(() => {
    if (!inventoryQuickOpen) return;
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
    };
  }, [inventoryQuickOpen]);
  // Round 32-13 — จำนวนแบบพิมพ์ตรงๆ: แต่ละแถวบิลเป็นช่องจำนวนที่เคอร์เซอร์รออยู่
  // หลังเพิ่มสินค้า (พิมพ์เลข = ตั้งจำนวนทันที) + ยิงบาร์โค้ดใส่ช่องจำนวนก็ได้
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});
  // ROUND 41 — ช่องสแกนหลัก = ช่องค้นหา: พิมพ์แล้วมีรายการ (สินค้า + สมาชิก) โชว์
  // ใต้ช่องให้เลือก · ว่าง+โฟกัส = ประวัติรายการที่เพิ่งเลือก (เพิ่มซ้ำได้ในหนึ่งแตะ)
  const [scanOpen, setScanOpen] = useState(false);
  const [scanHighlight, setScanHighlight] = useState(-1);
  const [recentScanIds, setRecentScanIds] = useState<number[]>(() => {
    try {
      const raw = localStorage.getItem("png-scan-recent-v1");
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(parsed) ? parsed.filter((id): id is number => typeof id === "number") : [];
    } catch { return []; }
  });
  // Round 32-16 — ลงทะเบียนสมาชิกใหม่ + พิมพ์บัตร อยู่ที่ POS จุดเดียว
  const [limitShortcutOpen, setLimitShortcutOpen] = useState(false);
  const [limitMember, setLimitMember] = useState<MemberLite | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [cardForNew, setCardForNew] = useState<{ memberNumber: string; prename?: string | null; firstName: string; lastName: string; type: string; balance: number; status: "active" | "suspended"; createdAt: string; photoUrl: string | null; gender: string | null } | null>(null);
  // ROUND 38 (ข้อ 37) — ถ่ายรูปสมาชิกจากกล้อง ตอนลงทะเบียนสมาชิกใหม่
  // พักบิล — parked bills live on this device so they survive reloads/view switches.
  const [heldBills, setHeldBills] = useState<HeldBill[]>(() => loadHeldBills());
  // รายการพิเศษ form state (F4 — ad-hoc priced line, no product/stock behind it).
  const [specialName, setSpecialName] = useState("");
  const [specialPrice, setSpecialPrice] = useState("");
  const [specialQty, setSpecialQty] = useState("1");
  const [specialUnit, setSpecialUnit] = useState("รายการ");
  const specialSeq = useRef(0);
  // Round 20 — scan-first POS: the hero input is THE scanner. It autofocuses,
  // re-selects after every add, and refocuses when the cashier returns to the
  // window — so a barcode can be fired at any moment without touching the mouse.
  const scanRef = useRef<HTMLInputElement | null>(null);
  const scanHeroRef = useRef<HTMLDivElement | null>(null);
  // ROUND 80 — ยิงบาร์โค้ดตอนวินโดว์เป็นภาษาไทย: จับปุ่มจริง (event.code) + จังหวะปืนสแกน
  // แล้วแปลงอักขระไทยกลับเป็นเลข/อังกฤษให้เอง — พนักงานไม่ต้องสลับภาษาก่อนยิงอีกต่อไป
  const scanLayout = useScanLayout();
  // ROUND 37 (req 36) — ช่องคีย์ POS ไม่เก็บประวัติ: ชื่อช่องสุ่มต่อเซสชัน
  // (คู่กับ autoComplete="off") ทำให้เบราว์เซอร์ไม่ดึงบาร์โค้ดที่
  // เคยมีคนยิง/คีย์ ขึ้นมาเป็น dropdown ประวัติอีกต่อไป
  const formNoiseRef = useRef(Math.random().toString(36).slice(2, 9));
  const cartPanelRef = useRef<HTMLElement | null>(null);
  // Round 21 — the bill pane's middle zone is the ONLY scroll area; ref it so
  // action forms (F2/F3/F4) can be scrolled into view the moment they open.
  const cartMidRef = useRef<HTMLDivElement | null>(null);
  const focusScan = () => {
    if (document.querySelector('.modal-backdrop, [role="dialog"]')) return;
    const input = scanRef.current;
    if (!input) return;
    input.focus();
    input.select();
  };
  // ROUND 80 (user) — ปุ่ม Enter ใช้งานทั่วแอป: ใช้ formEnterNav จาก PagePrimitives
  // (กรอกข้อมูลแล้วกด Enter ไปช่องถัดไป ช่องสุดท้าย = ยืนยัน/บันทึก)
  const products = useMemo<StoreProduct[]>(() => (productsQuery.data ?? []).map((product) => ({
    id: product.id,
    name: product.name,
    category: product.category,
    price: product.price,
    stock: product.stock,
    unit: product.unit,
    color: product.color ?? "mint",
    emoji: product.emoji ?? "🛍️",
    sku: product.sku,
    barcode: product.barcode,
    cost: product.cost,
    reorderPoint: product.reorderPoint,
    size: product.size ?? null,
    imageUrl: product.imageUrl ?? null,
    sellMode: product.sellMode ?? "unit",
    priceTiers: product.priceTiers ?? null,
    quickPick: product.quickPick ?? 0,
  })), [productsQuery.data]);
  const members = membersQuery.data ?? [];
  const selectedMember: MemberLite | null = members.find((member) => member.memberNumber === selectedMemberNumber) ?? null;
  // ROUND 41 — รายการให้เลือกใต้ช่องสแกน: สินค้า (ชื่อ/SKU/บาร์โค้ด) + สมาชิก
  // (เลข/ชื่อ) เรียงตามคะแนน smart match เหมือนช่องเลือกสมาชิก — ช่องว่าง = ประวัติ
  const scanSuggestions = useMemo(() => {
    const q = query.trim();
    if (q === "") return [] as StoreProduct[];
    return products
      .map((product) => ({ product, score: Math.max(smartMatchScore(product.barcode, q), smartMatchScore(product.sku, q), smartMatchScore(product.name, q) * 0.92) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((entry) => entry.product);
  }, [products, query]);
  const scanMemberSuggestions = useMemo(() => {
    const q = query.trim();
    if (q === "") return [] as MemberLite[];
    return members
      .map((member) => ({ member, score: Math.max(smartMatchScore(member.memberNumber, q), Math.max(smartMatchScore(memberFullName(member), q), smartMatchScore(member.firstName, q), smartMatchScore(member.lastName, q)) * 0.9) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((entry) => entry.member);
  }, [members, query]);
  const recentScanProducts = useMemo(() => recentScanIds.map((id) => products.find((product) => product.id === id)).filter((product): product is StoreProduct => Boolean(product)).slice(0, 8), [products, recentScanIds]);
  const scanRows = useMemo<ScanRow[]>(() => (query.trim() !== "" ? [...scanSuggestions.map((product) => ({ kind: "product" as const, product })), ...scanMemberSuggestions.map((member) => ({ kind: "member" as const, member }))] : recentScanProducts.map((product) => ({ kind: "product" as const, product }))), [query, recentScanProducts, scanMemberSuggestions, scanSuggestions]);
  const pushRecentScan = (id: number) => setRecentScanIds((ids) => {
    const next = [id, ...ids.filter((entry) => entry !== id)].slice(0, 8);
    try { localStorage.setItem("png-scan-recent-v1", JSON.stringify(next)); } catch { /* storage เต็ม/ถูกบล็อก — ใช้เฉพาะรอบเซสชันนี้ */ }
    return next;
  });
  const clearRecentScan = () => {
    setRecentScanIds([]);
    try { localStorage.removeItem("png-scan-recent-v1"); } catch { /* ignore */ }
  };
  const shortcuts = useMemo(() => products.filter((product) => product.quickPick === 1), [products]);
  // R74 — จัดแผงลัด: ค้นหาครอบทั้งชื่อ/SKU/บาร์โค้ด (lowercase ทุกช่อง) และแยกรายการ
  // "ของเดิมที่อยู่บนแผง" ขึ้นหัวโมดัลเสมอ พร้อมปุ่มนำออกเดี่ยว ๆ — เดิมโมดัลตัดที่ 40 แถว
  // แรกตาม id ของบนแผงที่ id ท้ายคลังเลยมองไม่เห็น ผู้ใช้จึงลบของเดิมออกไม่ได้
  const quickManageMatches = useMemo(() => {
    const needle = quickManageSearch.trim().toLowerCase();
    return products.filter((product) => needle === "" || product.name.toLowerCase().includes(needle) || product.sku.toLowerCase().includes(needle) || (product.barcode ?? "").toLowerCase().includes(needle));
  }, [products, quickManageSearch]);
  const quickPanelItems = useMemo(() => quickManageMatches.filter((product) => product.quickPick === 1), [quickManageMatches]);
  // ROUND 41 — แผงลัดหน้าร้านคงเป็นสินค้าที่หยิบบ่อยตามหมวดเสมอ (ผลค้นหาจากช่อง
  // สแกนย้ายไปโชว์เป็นรายการใต้ช่องแทน — แผงขวาไม่ถูกดันเป็นผลค้นหาอีกต่อไป)
  const panelList = useMemo(() => {
    const byCategory = category === "ทั้งหมด" ? products : products.filter((product) => product.category === category);
    if (shortcuts.length === 0) return byCategory;
    const inCategory = category === "ทั้งหมด" ? shortcuts : shortcuts.filter((product) => product.category === category);
    return inCategory.length > 0 || category === "ทั้งหมด" ? inCategory : shortcuts;
  }, [category, products, shortcuts]);
  const sampleCodes = useMemo(() => products.filter((product) => product.barcode).slice(0, 3), [products]);
  const subtotal = calculateCartSubtotal(cart);
  const discountValue = Math.max(0, Number(discount) || 0);
  const payable = Math.max(0, subtotal - discountValue);
  const cashier = userName || "ผู้ใช้ระบบ";
  const actorRole = roleThaiLabel(role);
  const cartPieces = cart.reduce((sum, item) => sum + (item.variant ? 1 : item.qty), 0);
  const shortcutTitle = shortcut === SPECIAL_SHORTCUT ? "เพิ่มรายการพิเศษ" : shortcut;
  // ROUND 63 (user) — QR พร้อมเพย์ที่หน้ายืนยันการชำระ: สร้างภาพ QR ยอดตามบิล
  // (บัญชีร้านมาจาก ตั้งค่า → การชำระเงิน) ให้ลูกค้าเปิดแอปธนาคารสแกนจ่ายได้เลย
  const promptpayId = settingsQuery.data?.promptpayId ?? "";
  useEffect(() => {
    let cancelled = false;
    if (payConfirm !== "QR / สแกน" || !isValidPromptPayId(promptpayId) || !(payable > 0)) {
      setPayQrUrl("");
      return;
    }
    let payload: string;
    try {
      payload = buildPromptPayPayload({ promptpayId, amount: payable });
    } catch {
      setPayQrUrl("");
      return;
    }
    QRCode.toDataURL(payload, { margin: 1, width: 250, errorCorrectionLevel: "M" })
      .then((url) => { if (!cancelled) setPayQrUrl(url); })
      .catch(() => { if (!cancelled) setPayQrUrl(""); });
    return () => { cancelled = true; };
  }, [payConfirm, promptpayId, payable]);
  const checkoutMutation = trpc.pos.checkout.useMutation({
    onSuccess: (result) => {
      setPayConfirm(null);
      setPaySlip(null);
      setReceipt(result);
      setReceiptOpen(true);
      setError("");
      setMessage(`ชำระเงินสำเร็จด้วย${result.paymentMethod} · บิล ${result.orderNumber}`);
      // ROUND 37 (req 35) — แจ้งเตือนใหญ่ชัดเจน: toast พร้อมเลขบิล วิธีชำระ และยอด
      toast.success("ชำระเงินสำเร็จ", { description: `บิล ${result.orderNumber} · ${result.paymentMethod} · ยอด ${money(result.total)}`, duration: 4500 });
    },
    // ROUND 78 — ชำระเงินไม่สำเร็จ (เงินไม่พอ · สต็อกไม่พอ · เซิร์ฟเวอร์ error) ต้องเห็นกลางจอทันที
    onError: (mutationError) => { setError(getErrorMessage(mutationError)); blocker.error("ชำระเงินไม่สำเร็จ", getErrorMessage(mutationError), { hint: "บิลนี้ยังไม่ถูกบันทึก — แก้ไขแล้วกดยืนยันใหม่ได้เลย" }); },
  });
  // ROUND 80 — Enter = ยืนยันการชำระเงินทันที (นิสัย POS มาตรฐาน): โฟกัสปุ่มยืนยันเมื่อเปิดหน้าต่าง
  // และรองรับ Enter ระดับหน้าต่างเมื่อโฟกัสยังไม่ได้อยู่ใน modal (กดปุ่มจ่ายเงินแล้วโฟกัสค้างที่ปุ่มเดิม)
  useEffect(() => {
    if (!payConfirm) return;
    const frame = window.requestAnimationFrame(() => {
      const button = document.querySelector<HTMLButtonElement>(".pay-confirm-modal .pay-confirm-button");
      if (button && !button.disabled) button.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [payConfirm]);
  useEffect(() => {
    if (!payConfirm || checkoutMutation.isPending) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      const target = event.target as HTMLElement | null;
      if (target && typeof target.closest === "function" && target.closest("button, textarea, input, select")) return; // ช่องกรอก/ปุ่ม จัดการ Enter เอง
      const button = document.querySelector<HTMLButtonElement>(".pay-confirm-modal .pay-confirm-button");
      if (button && !button.disabled) { event.preventDefault(); button.click(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [payConfirm, checkoutMutation.isPending]);
  const walletMutation = trpc.member.wallet.useMutation({
    onSuccess: (result) => {
      setWalletResult(result);
      setWalletStep("success");
      setWalletDoneAt(new Date());
      setError("");
      toast.success(shortcut === "ถอนเงิน" ? "ถอนเงินสำเร็จ" : "เติมเงินสำเร็จ", { description: `${result.memberName} · ${result.memberNumber} · ${money(result.amount)} → คงเหลือ ${money(result.balanceAfter)}`, duration: 4500 });
      void utils.member.list.invalidate();
      void utils.logs.list.invalidate();
      void utils.dashboard.stats.invalidate();
    },
    // ROUND 78 — เติม/ถอนไม่สำเร็จ (เช่น ยอดเงินคงเหลือไม่พอ) เด้งกลางจอ — ก่อนหน้านี้ error ไปอยู่บรรทัดสถานะเล็ก ๆ ที่โดนโมดูลบัง มองไม่เห็น
    onError: (mutationError) => { setError(getErrorMessage(mutationError)); blocker.error("บันทึกรายการไม่สำเร็จ", getErrorMessage(mutationError), { hint: "รายการนี้ยังไม่ถูกบันทึก — แก้ไขจำนวนแล้วยืนยันใหม่ได้เลย" }); },
  });
  // Round 32-16 — ลงทะเบียนสมาชิกใหม่ที่ POS จุดเดียว: บันทึกเสร็จเปิดบัตรให้พิมพ์
  // ทันที แล้วเลือกสมาชิกใหม่เข้าบิลปัจจุบันให้อัตโนมัติ
  const openRegister = () => { setRegisterOpen(true); setError(""); };
  const onMemberRegistered = (member: MemberCardData) => {
    setRegisterOpen(false);
    const result = { member };
      setSelectedMemberNumber(result.member.memberNumber);
      setMessage(`ลงทะเบียน ${memberFullName(result.member)} แล้ว · หมายเลข ${result.member.memberNumber} · เลือกเข้าบิลนี้ให้แล้ว${result.member.balance > 0 ? ` · เงินเริ่มต้น ${money(result.member.balance)}` : ""}`);
      toast.success("ลงทะเบียนสมาชิกใหม่แล้ว", { description: `${memberFullName(result.member)} · ${result.member.memberNumber} · เลือกเข้าบิลนี้ให้แล้ว${result.member.balance > 0 ? ` · เงินเริ่มต้น ${money(result.member.balance)}` : ""}`, duration: 4500 });
      void utils.member.list.invalidate();
      void utils.logs.list.invalidate();
  };
  const clearNotices = () => { setMessage(""); setError(""); };
  // ROUND 37 (req 36) — ยิงบัตรสมาชิก (บาร์โค้ด/คิวอาร์) ที่ช่องสแกนหลัก หรือ
  // ช่องจำนวน → เด้ง “โมดูลบัตรสมาชิก” ให้พนักงานเทียบ ชื่อ-รูป-เลข-ยอดคงเหลือ
  // กับบัตรจริงก่อนกดยืนยันเข้าบิล — กันหักบัญชีผิดคน
  const openMemberVerify = (member: MemberLite) => {
    setScanMember(member);
    setQuery("");
    setMessage(`พบบัตรสมาชิก ${member.memberNumber} · ตรวจสอบข้อมูลบนบัตร แล้วกดยืนยันเพื่อใช้กับบิลนี้`);
    focusScan();
  };
  const confirmScanMember = () => {
    if (!scanMember) return;
    const member = scanMember;
    setScanMember(null);
    if (member.status === "suspended") {
      setError(`บัตร ${member.memberNumber} ถูกระงับการใช้จ่าย — ชำระด้วยเงินสดหรือ QR แทนได้`);
      // ROUND 78 — บัตรถูกระงับ: กลางจอใหญ่ชัด พนักงานเห็นทันทีตอนยืนยันบัตร
      blocker.warning("บัตรสมาชิกถูกระงับการใช้จ่าย", `${memberFullName(member)} · ${member.memberNumber}\nตรวจสอบกับผู้บริหาร — บิลนี้ชำระด้วยเงินสดหรือ QR แทนได้`);
      focusScan();
      return;
    }
    setSelectedMemberNumber(member.memberNumber);
    clearNotices();
    toast.success(`ยืนยันสมาชิก${memberFullName(member)} แล้ว`, { description: `เลขสมาชิก ${member.memberNumber} · ยอดคงเหลือ ${money(member.balance)} · ใช้กับบิลนี้`, duration: 3200 });
    focusScan();
  };
  // Round 32-13 — key ประจำแถวบิล (ใช้เป็น id ช่องจำนวน เพื่อโฟกัสหลังเพิ่มสินค้า)
  const billRowKey = (item: CartItem) => item.variant ? `v-${item.id}-${item.variant}` : item.special ? `s-${item.id}` : `p-${item.id}`;
  const focusQtyInput = (key: string) => {
    window.requestAnimationFrame(() => {
      const input = document.getElementById(`bill-qty-${key}`) as HTMLInputElement | null;
      if (input) { input.focus(); input.select(); }
      else focusScan();
    });
  };
  const clearQtyDraft = (key: string) => setQtyDrafts((drafts) => {
    if (!(key in drafts)) return drafts;
    const next = { ...drafts };
    delete next[key];
    return next;
  });
  const addProduct = (product: Product) => {
    const store = products.find((item) => item.id === product.id);
    if (store?.sellMode === "money" && parsePriceTiers(store.priceTiers).length > 0) {
      setError(`${product.name} ขายเป็นราคา — กดปุ่มราคา (฿1 / ฿5 / ฿10) บนการ์ดเพื่อเลือกขนาด`);
      blocker.warning("สินค้านี้ขายเป็นราคา — กดปุ่มราคาบนการ์ด", `${product.name} — เลือกขนาดที่ปุ่มราคา (฿1 / ฿5 / ฿10) บนการ์ดสินค้า`);
      return;
    }
    const currentQty = cart.reduce((sum, item) => (item.id === product.id && !item.variant ? sum + item.qty : sum), 0);
    if (store && currentQty + 1 > store.stock) {
      setError(`สต็อกไม่พอ · ${product.name} เหลือ ${store.stock} ${store.unit}`);
      blocker.error("สต็อกไม่พอ — เพิ่มเข้าบิลไม่ได้", `${product.name} เหลือ ${store.stock} ${store.unit} ในคลัง\nรับเข้าเพิ่มได้ที่หน้าสต็อกสินค้า`);
      return;
    }
    setCart((items) => addScannedItem(items, product));
    pushRecentScan(product.id);
    clearNotices();
    setMessage(`เพิ่ม ${product.name} แล้ว · พิมพ์จำนวนที่ช่องจำนวนได้เลย (หรือสแกนซ้ำ = +1)`);
    toast.success("เพิ่มสินค้าเข้าบิลแล้ว", { description: `${product.name} · ยิงซ้ำ = +1 หรือพิมพ์จำนวนที่ช่องจำนวนได้เลย`, duration: 1800 });
    focusQtyInput(`p-${product.id}`);
  };
  const addTier = (product: StoreProduct, tier: PriceTier) => {
    const inBill = cart.reduce((sum, item) => (item.id === product.id ? sum + item.qty : sum), 0);
    if (inBill + tier.qty > product.stock) {
      setError(`สต็อกไม่พอ · ${product.name} เหลือ ${formatBillQty(product.stock, product.unit)}`);
      blocker.error("สต็อกไม่พอ — เพิ่มเข้าบิลไม่ได้", `${product.name} เหลือ ${formatBillQty(product.stock, product.unit)} ในคลัง`);
      return;
    }
    clearNotices();
    setCart((items) => addTierItem(items, product, tier));
    pushRecentScan(product.id);
    setMessage(`เพิ่ม ${product.name} · ${tier.label} ${money(tier.price)} แล้ว · พิมพ์กรัมเพิ่มที่ช่องจำนวนได้`);
    toast.success("เพิ่มสินค้าเข้าบิลแล้ว", { description: `${product.name} · ${tier.label} ${money(tier.price)} · พิมพ์จำนวนเพิ่มที่ช่องจำนวนได้`, duration: 1800 });
    focusQtyInput(`v-${product.id}-${tier.label}`);
  };
  // Round 32-13 — ตั้งจำนวนตรงๆ จากช่องกรอก (พิมพ์ทับได้ทุกแถว ไม่ต้องไล่ลบไล่ยิงใหม่)
  const applyQtyDirect = (item: CartItem, qty: number) => {
    if (!Number.isFinite(qty) || qty < 1) return;
    const store = products.find((entry) => entry.id === item.id);
    if (store && !item.variant && !item.special) {
      const others = cart.reduce((sum,entry) => (entry.id === item.id && (entry.variant ?? "") !== (item.variant ?? "") ? sum + entry.qty : sum), 0);
      if (qty + others > store.stock) {
        setError(`สต็อกไม่พอ · ${store.name} เหลือ ${formatBillQty(store.stock, store.unit)} (ในบิลแล้ว ${formatBillQty(others, store.unit)})`);
        blocker.error("สต็อกไม่พอสำหรับจำนวนที่ตั้ง", `${store.name} เหลือ ${formatBillQty(store.stock, store.unit)} ในคลัง\nในบิลนี้มีอยู่แล้ว ${formatBillQty(others, store.unit)}`);
        return;
      }
    }
    if (store && item.variant) {
      const others = cart.reduce((sum, entry) => (entry.id === item.id && entry.variant !== item.variant ? sum + entry.qty : sum), 0);
      if (qty + others > store.stock) {
        setError(`สต็อกไม่พอ · ${store.name} เหลือ ${formatBillQty(store.stock, store.unit)}`);
        blocker.error("สต็อกไม่พอสำหรับจำนวนที่ตั้ง", `${store.name} เหลือ ${formatBillQty(store.stock, store.unit)} ในคลัง`);
        return;
      }
    }
    clearNotices();
    setCart((items) => items.map((entry) => (entry === item ? { ...entry, qty } : entry)));
  };
  const handleQtyInput = (item: CartItem, key: string, raw: string) => {
    setQtyDrafts((drafts) => ({ ...drafts, [key]: raw }));
    const parsed = Number(raw.replace(/[,\s]/g, ""));
    if (raw.trim() !== "" && Number.isFinite(parsed) && parsed >= 1) applyQtyDirect(item, parsed);
  };
  const handleQtyKey = (item: CartItem, key: string, event: React.KeyboardEvent<HTMLInputElement>) => {
    const raw = qtyDrafts[key] ?? String(item.qty);
    if (event.key === "Enter") {
      event.preventDefault();
      // ยิงบาร์โค้ดใส่ช่องจำนวน (สแกนเนอร์พิมพ์รหัสยาวๆ ตาม Enter) → เป็นสินค้าใหม่ ไม่ใช่จำนวน
      let scanned = raw.replace(/[,\s]/g, "");
      // ROUND 80 — ยิงตอนภาษาไทย: แปลงอักขระไทยกลับเป็นเลข/อังกฤษก่อนหาสินค้า/สมาชิก
      const fixedScan = scanLayout.normalize(scanned);
      if (fixedScan.convertedFrom !== undefined) {
        scanned = fixedScan.value;
        toast.info(SCAN_LAYOUT_TOAST.message, { description: SCAN_LAYOUT_TOAST.description(fixedScan.convertedFrom, fixedScan.value), duration: 3200 });
      }
      const target = scanned.length >= 5 ? products.find((product) => scanMatches(product.barcode, scanned) || scanMatches(product.sku, scanned)) : undefined;
      if (target) { clearQtyDraft(key); addProduct(target); return; }
      // ROUND 37 (req 36) — ยิงบัตรสมาชิกใส่ช่องจำนวนก็จับได้ → เด้งบัตรให้ยืนยันเหมือนช่องสแกนหลัก
      const memberTarget = scanned.length >= 5 ? members.find((member) => scanMatches(member.memberNumber, scanned)) : undefined;
      if (memberTarget) { clearQtyDraft(key); openMemberVerify(memberTarget); return; }
      const parsed = Number(scanned);
      if (Number.isFinite(parsed) && parsed >= 1) applyQtyDirect(item, parsed);
      clearQtyDraft(key);
      focusScan();
      return;
    }
    if (event.key === "Escape") { event.preventDefault(); clearQtyDraft(key); focusScan(); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input[id^='bill-qty-']"));
      const index = inputs.findIndex((input) => input.id === `bill-qty-${key}`);
      const next = inputs[index + (event.key === "ArrowDown" ? 1 : -1)];
      if (next) { next.focus(); next.select(); }
      else focusScan();
    }
  };
  const updateQty = (id: number, delta: number, variant?: string, step = 1) => {
    if (delta > 0) {
      const store = products.find((item) => item.id === id);
      const inBill = cart.reduce((sum, item) => (item.id === id ? sum + item.qty : sum), 0);
      if (store && inBill + delta * step > store.stock) {
        setError(`สต็อกไม่พอ · ${store.name} เหลือ ${store.stock} ${store.unit}`);
        blocker.error("สต็อกไม่พอ — เพิ่มจำนวนไม่ได้", `${store.name} เหลือ ${store.stock} ${store.unit} ในคลัง`);
        return;
      }
    }
    clearNotices();
    setCart((items) => items.flatMap((item) => (item.id === id && (item.variant ?? "") === (variant ?? "") ? (item.qty + delta * step <= 0 ? [] : [{ ...item, qty: item.qty + delta * step }]) : item)));
    focusScan();
  };
  // Quick picks (สินค้าไม่มีบาร์โค้ด) get their own stepper on the card itself —
  // the cashier can เพิ่ม/ลด directly on the grid without hunting the bill row.
  const qtyInBill = (id: number) => cart.reduce((sum, item) => (item.id === id ? sum + item.qty : sum), 0);
  const quickPickMutation = trpc.product.update.useMutation({
    onSuccess: (updated) => {
      void utils.product.list.invalidate();
      setQuickManageNotice(updated.quickPick === 1 ? `เพิ่ม ${updated.name} ขึ้นแผงลัดแล้ว` : `นำ ${updated.name} ออกจากแผงลัดแล้ว`);
    },
    onError: (mutationError) => setQuickManageNotice(getErrorMessage(mutationError)),
  });
  const bumpPick = (product: StoreProduct, delta: number) => {
    if (qtyInBill(product.id) === 0 && delta > 0) {
      addProduct(product);
      return;
    }
    updateQty(product.id, delta);
  };
  // ROUND 41 — Enter ที่ช่องสแกน: บาร์โค้ด/SKU ตรง = ลงบิลทันที (นิสัยเครื่องสแกน)
  // ส่วนพิมพ์ค้นหา = เลือกจากรายการใต้ช่อง (ลูกศร ↑↓ + Enter หรือคลิก)
  const closeScanDrop = () => { setScanOpen(false); setScanHighlight(-1); };
  useEffect(() => {
    if (focusProductId == null || productsQuery.isLoading) return;
    const product = products.find(item => item.id === focusProductId);
    if (product) {
      setQuery(product.sku);
      setScanOpen(true);
      setScanHighlight(-1);
      focusScan();
    }
    onFocusProductConsumed?.();
  }, [focusProductId, productsQuery.isLoading, products, onFocusProductConsumed]);
  const pickScanProduct = (product: Product) => { addProduct(product); setQuery(""); closeScanDrop(); focusScan(); };
  const pickScanMember = (member: MemberLite) => { setQuery(""); closeScanDrop(); openMemberVerify(member); };
  // ROUND 55 — codeArg = รหัสที่มาจากกล้อง: เข้าสู่ตรวจสมาชิก/สินค้าเหมือนปืนสแกนทุกประการ
  const handleScanSubmit = (codeArg?: string) => {
    if (codeArg === undefined && scanHighlight >= 0 && scanRows[scanHighlight]) {
      const row = scanRows[scanHighlight];
      if (row.kind === "member") pickScanMember(row.member);
      else pickScanProduct(row.product);
      return;
    }
    let code = (codeArg ?? query).trim();
    if (!code) { closeScanDrop(); return; }
    // ROUND 80 — คีย์บอร์ดไทย: บาร์โค้ด/เลขสมาชิกที่ยิงมาเป็นอักขระไทย แปลงกลับให้อัตโนมัติ
    if (codeArg === undefined) {
      const fixed = scanLayout.normalize(code);
      if (fixed.convertedFrom !== undefined) {
        code = fixed.value;
        setQuery(fixed.value);
        toast.info(SCAN_LAYOUT_TOAST.message, { description: SCAN_LAYOUT_TOAST.description(fixed.convertedFrom, fixed.value), duration: 3200 });
      }
    }
    const exact = products.find((product) => scanMatches(product.barcode, code) || scanMatches(product.sku, code));
    // ROUND 37 (req 36) — ยิงบัตรสมาชิกที่ช่องสแกนหลัก → เด้งโมดูลบัตรให้ยืนยันข้อมูลก่อนเข้าบิล
    // (สแกนเนอร์จบด้วย Enter เหมือนสินค้า — ต้องตรวจสมาชิกก่อน heuristic การค้นหาสินค้า)
    const memberHit = members.find((member) => scanMatches(member.memberNumber, code));
    if (exact && memberHit) {
      setQuery(code);
      setScanOpen(true);
      setScanHighlight(-1);
      setMessage("รหัสตรงกับสินค้าและสมาชิก · เลือกรายการที่ต้องการ");
      return;
    }
    if (exact) { pickScanProduct(exact); return; }
    if (memberHit) { pickScanMember(memberHit); return; }
    if (scanSuggestions.length === 1 && scanMemberSuggestions.length === 0) { pickScanProduct(scanSuggestions[0]); return; }
    if (scanSuggestions.length + scanMemberSuggestions.length > 1) {
      setScanOpen(true);
      setScanHighlight(0);
      setMessage(`พบ ${scanSuggestions.length + scanMemberSuggestions.length} รายการสำหรับ "${code}" · เลือกจากรายการใต้ช่องสแกน (↑↓ แล้ว Enter หรือคลิก)`);
      return;
    }
    setError(`ไม่พบสินค้าหรือสมาชิกสำหรับ "${code}" · ลองยิงบาร์โค้ดจริง เช่น ${sampleCodes[0]?.barcode ?? "8850000000017"} หรือรหัส SKU เช่น DRK-001`);
    // ROUND 78 — ยิงบาร์โค้ดไม่เจอ: เด้งกลางจอ (ปืนสแกนไม่มีเสียงบี๊บ พนักงานต้องเห็นสาเหตุ)
    blocker.warning("ไม่พบรายการที่สแกน", `ไม่พบสินค้าหรือสมาชิกสำหรับ "${code}"\nลองยิงบาร์โค้ดจริง เช่น ${sampleCodes[0]?.barcode ?? "8850000000017"} หรือรหัส SKU เช่น DRK-001`);
  };
  const handleSlip = async (file?: File) => {
    if (!file) return;
    try {
      // ROUND 63 — ย่อรูปเป็น data-URL เก็บจริง ไม่ใช่แค่พรีวิว — บันทึกไปกับรายการเติม/ถอน
      const dataUrl = await compressImageToDataUrl(file, 800, 0.78);
      setSlipDataUrl(dataUrl);
      setSlipName(file.name);
      setSlipPreview(dataUrl);
      setMessage(`แนบสลิป ${file.name} แล้ว · พร้อมบันทึกไปกับรายการ`);
    } catch {
      setError("อ่านไฟล์รูปไม่สำเร็จ — ลองเลือกรูปใหม่ (รองรับ JPG / PNG)");
    }
  };
  // ROUND 63 (user) — แนบหลักฐานการชำระที่บิล QR: เลือกจากไฟล์
  const handlePaySlipFile = async (file?: File) => {
    if (!file) return;
    try {
      const dataUrl = await compressImageToDataUrl(file, 800, 0.78);
      setPaySlip({ dataUrl, name: file.name });
      setError("");
      setMessage(`แนบหลักฐาน ${file.name} แล้ว · จะบันทึกไปกับบิลเมื่อกดยืนยัน`);
    } catch {
      setError("อ่านไฟล์รูปไม่สำเร็จ — ลองเลือกรูปใหม่ (รองรับ JPG / PNG / WEBP)");
    }
  };
  // ROUND 54 (user) — ทุกการชำระเงินต้องยืนยันก่อน: ปุ่มจ่ายเงินไม่บันทึกทันที
  // แต่เปิดหน้า “ยืนยันการชำระเงิน” ให้ตรวจรายการ ยอด และวิธีชำระก่อนเสมอ
  const requestPayment = (method: PaymentMethod) => {
    if (cart.length === 0) return;
    if (method === "หักบัญชีสมาชิก" && !selectedMember) {
      setError("กรุณาเลือกสมาชิกก่อนชำระแบบหักบัญชี");
      blocker.warning("ยังไม่ได้เลือกสมาชิก", "ชำระแบบหักบัญชีสมาชิก ต้องมีสมาชิกในบิลก่อน\nยิงบัตรสมาชิกที่ช่องสแกน หรือกด F1 เพื่อเลือกสมาชิก");
      return;
    }
    if (discountValue > subtotal) {
      setError("ส่วนลดมากกว่ายอดรวมสินค้า");
      blocker.warning("ส่วนลดมากกว่ายอดรวมสินค้า", "ปรับส่วนลดให้ไม่เกินยอดรวม แล้วชำระเงินใหม่ได้เลย");
      return;
    }
    clearNotices();
    setPaySlip(null);
    // FIX-7 — reset verification + cash state ทุกครั้งที่เปิด modal ใหม่ (กด ยืนยัน → เปิด modal อีกครั้ง)
    setQrVerified(false);
    setCashReceived("");
    setPayConfirm(method);
  };
  // FIX-7 — derived: แปลง cashReceived string → number + คำนวณเงินทอน (negative = ขาด)
  const cashReceivedNum = Number(cashReceived || 0);
  const changeDue = Math.round((cashReceivedNum - payable) * 100) / 100;
  const cashShortfall = Math.round((payable - cashReceivedNum) * 100) / 100;
  const cashSufficient = cashReceivedNum >= payable;
  // FIX-7 — ปุ่มลัดยอดรับเงินสด (เพิ่มความเร็วให้แคชเชียร์ — กดครั้งเดียวแทนพิมพ์ตัวเลข)
  const QUICK_CASH_AMOUNTS = [50, 100, 200, 500, 1000];
  const pickQuickCash = (amount: number | "exact") => {
    if (amount === "exact") {
      setCashReceived(String(Math.round(payable * 100) / 100));
    } else {
      // กดปุ่ม 100 → ถ้ามี 50 อยู่แล้ว → กลายเป็น 150 (สะสม) ถ้าว่าง → 100
      const current = Number(cashReceived || 0);
      const next = Math.round((current + amount) * 100) / 100;
      setCashReceived(String(next));
    }
  };
  const completePayment = (method: PaymentMethod) => {
    if (cart.length === 0) return;
    if (discountValue > subtotal) { setError("ส่วนลดมากกว่ายอดรวมสินค้า"); blocker.warning("ส่วนลดมากกว่ายอดรวมสินค้า", "ปรับส่วนลดให้ไม่เกินยอดรวม แล้วกดยืนยันใหม่ได้เลย"); return; }
    clearNotices();
    checkoutMutation.mutate({
      clientRequestId: crypto.randomUUID(),
      items: cart.map((item) => item.special
        ? { name: item.name, price: item.price, qty: item.qty, unit: item.unit }
        : item.variant
          ? { productId: item.id, qty: item.qty, price: Math.round((item.price / (item.step || 1)) * 10000) / 10000, unit: item.unit, label: item.variant }
          : { productId: item.id, qty: item.qty }),
      paymentMethod: method,
      memberNumber: selectedMember?.memberNumber ?? null,
      discount: discountValue,
      cashier,
      actorRole,
      // ROUND 63 — หลักฐานการชำระ (สลิปโอน/สแกนจ่าย) เก็บไปกับบิล
      slipImage: paySlip?.dataUrl ?? null,
      // FIX-7 — ส่งยอดเงินสด/ทอน + flag ยืนยันไป backend (เก็บใน sales table)
      receivedCash: method === "เงินสด" ? cashReceivedNum : null,
      changeDue: method === "เงินสด" ? (cashSufficient ? Math.max(0, changeDue) : 0) : null,
      paymentVerified: method === "QR / สแกน" ? qrVerified : null,
    });
  };
  const submitWallet = () => {
    const memberNumber = walletMemberNumber || selectedMemberNumber;
    if (!memberNumber) { setError("กรุณาเลือกสมาชิกก่อนบันทึกรายการ"); blocker.warning("ยังไม่ได้เลือกสมาชิก", "ยิงบัตรสมาชิกที่ช่องด้านบน หรือเลือกจากรายการก่อนบันทึกรายการ"); return; }
    const amount = Number(walletAmount);
    if (!(amount > 0)) { setError("กรุณาระบุจำนวนเงินมากกว่า 0"); blocker.warning("กรุณาระบุจำนวนเงินให้ถูกต้อง", "ใส่ยอดเงินที่จะเติมหรือถอนเป็นตัวเลขมากกว่า 0"); return; }
    clearNotices();
    setWalletStep("confirm");
  };
  const confirmWallet = () => {
    const memberNumber = walletMemberNumber || selectedMemberNumber;
    if (!memberNumber || !(Number(walletAmount) > 0)) { setWalletStep("form"); return; }
    walletMutation.mutate({
      clientRequestId: crypto.randomUUID(),
      memberNumber,
      type: shortcut === "ถอนเงิน" ? "withdrawal" : "deposit",
      amount: Number(walletAmount),
      note: walletNote.trim() || undefined,
      actor: cashier,
      actorRole,
      // ROUND 63 — สลิปที่แนบมาเก็บไปกับรายการเติม/ถอนจริง (แต่ก่อนแค่พรีวิวที่เครื่อง)
      slipImage: slipDataUrl || null,
    });
  };
  const finishWallet = () => {
    setShortcut("");
    setWalletAmount("");
    setWalletNote("");
    setWalletMemberNumber("");
    setWalletStep("form");
    setWalletResult(null);
    setWalletDoneAt(null);
    setSlipName("");
    setSlipPreview("");
    setSlipDataUrl("");
    focusScan();
  };
  // ROUND 77 — ดาวน์โหลดสลิปเติม/ถอนเป็น PDF 80มม. หรือรูป PNG (ชื่อไฟล์ตามรายการ)
  const downloadWalletSlip = async (format: "pdf" | "image") => {
    if (!walletResult) return;
    setWalletSlipBusy(format);
    try {
      const stamp = walletDoneAt
        ? `${String(walletDoneAt.getFullYear() + 543).slice(2)}${String(walletDoneAt.getMonth() + 1).padStart(2, "0")}${String(walletDoneAt.getDate()).padStart(2, "0")}-${String(walletDoneAt.getHours()).padStart(2, "0")}${String(walletDoneAt.getMinutes()).padStart(2, "0")}`
        : String(Date.now());
      const kindLabel = walletResult.type === "deposit" ? "เติมเงิน" : walletResult.type === "refund" ? "คืนบัตรเงินสด" : "ถอนเงิน";
      await downloadSlipFile("wallet-slip", `สลิป${kindLabel}-${walletResult.memberNumber}-${stamp}`, format);
    } finally { setWalletSlipBusy(""); }
  };
  const walletTarget = members.find((member) => member.memberNumber === (walletMemberNumber || selectedMemberNumber)) ?? null;
  const walletAfterPreview = walletTarget ? Math.round((walletTarget.balance + (shortcut === "เติมเงิน" ? 1 : -1) * (Number(walletAmount) || 0)) * 100) / 100 : 0;
  const submitSpecial = () => {
    const name = specialName.trim();
    const price = Number(specialPrice);
    const qty = Math.max(1, Math.floor(Number(specialQty) || 1));
    const unit = specialUnit.trim() || "รายการ";
    if (!name) { setError("กรุณาระบุชื่อรายการพิเศษ"); blocker.warning("กรุณาระบุชื่อรายการพิเศษ", "เช่น ข้าวราดแกงนอกรายการ / ค่าฝากของ"); return; }
    if (!(price > 0)) { setError("ราคาต่อหน่วยต้องมากกว่า 0"); blocker.warning("ราคาต่อหน่วยต้องมากกว่า 0", "ใส่ราคาของรายการพิเศษนี้ให้ถูกต้องก่อนเพิ่มเข้าบิล"); return; }
    const specialId = -(Date.now() + ++specialSeq.current);
    setCart((items) => [...items, { id: specialId, name, price, qty, unit, special: true }]);
    setSpecialName("");
    setSpecialPrice("");
    setSpecialQty("1");
    setSpecialUnit("รายการ");
    clearNotices();
    setMessage(`เพิ่มรายการพิเศษ ${name} · ${qty} ${unit} · ${money(price * qty)} แล้ว · แก้จำนวนที่ช่องจำนวนได้เลย`);
    toast.success("เพิ่มรายการพิเศษเข้าบิลแล้ว", { description: `${name} · ${qty} ${unit} · ${money(price * qty)} · ไม่ตัดสต็อก`, duration: 2200 });
    window.requestAnimationFrame(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>("input[id^='bill-qty-']");
      const last = inputs[inputs.length - 1];
      if (last) { last.focus(); last.select(); }
    });
    setShortcut("");
    focusScan();
  };
  // พักบิล: park the current bill on this device, then start fresh — the
  // cashier swaps between customers without losing a half-built bill.
  const holdBill = () => {
    if (cart.length === 0) {
      if (heldBills.length > 0) { setMessage(`มีบิลที่ถูกพักอยู่ ${heldBills.length} บิล · เรียกคืนได้จากแถบใต้ช่องสแกน`); toast.info(`มีบิลที่พักอยู่ ${heldBills.length} บิล`, { description: "เรียกคืนได้จากแถบใต้ช่องสแกน" }); }
      else { setError("ยังไม่มีรายการในบิลปัจจุบันที่จะพักไว้"); blocker.warning("ยังไม่มีรายการในบิลที่จะพักไว้", "เพิ่มสินค้าเข้าบิลก่อน แล้วกดพักบิล (F5)"); }
      return;
    }
    if (heldBills.length >= HELD_BILLS_LIMIT) {
      setError(`พักบิลได้สูงสุด ${HELD_BILLS_LIMIT} บิล · เรียกคืนหรือยกเลิกบิลที่พักไว้ก่อน`);
      blocker.warning(`พักบิลได้สูงสุด ${HELD_BILLS_LIMIT} บิล`, "เรียกคืนหรือยกเลิกบิลที่พักไว้ก่อน แล้วจึงพักบิลใหม่ได้");
      return;
    }
    setHeldBills((bills) => [...bills, { id: Date.now(), savedAt: Date.now(), items: cart, discount, memberNumber: selectedMemberNumber }]);
    setCart([]);
    setDiscount("0");
    setSelectedMemberNumber(null);
    clearNotices();
    setMessage(`พักบิลแล้ว (${cartPieces} ชิ้น · ${money(payable)}) · กดบิลที่พักใต้ช่องสแกนเพื่อเรียกคืน`);
    toast.success("พักบิลแล้ว", { description: `${cartPieces} ชิ้น · ${money(payable)} · กดบิลที่พักใต้ช่องสแกนเพื่อเรียกคืน`, duration: 2600 });
    focusScan();
  };
  const restoreHeld = (id: number) => {
    const bill = heldBills.find((entry) => entry.id === id);
    if (!bill) return;
    let note = `เรียกคืนบิลที่พักไว้ (${bill.items.reduce((sum, item) => sum + item.qty, 0)} ชิ้น)`;
    if (cart.length > 0) {
      setHeldBills((bills) => [...bills.filter((entry) => entry.id !== id), { id: Date.now(), savedAt: Date.now(), items: cart, discount, memberNumber: selectedMemberNumber }]);
      note += " · บิลที่กำลังทำถูกพักแทนโดยอัตโนมัติ";
    } else {
      setHeldBills((bills) => bills.filter((entry) => entry.id !== id));
    }
    setCart(bill.items);
    setDiscount(bill.discount);
    setSelectedMemberNumber(bill.memberNumber);
    clearNotices();
    setMessage(note);
    toast.info("เรียกคืนบิลที่พักไว้แล้ว", { description: note, duration: 2600 });
    focusScan();
  };
  const discardHeld = (id: number) => {
    setHeldBills((bills) => bills.filter((entry) => entry.id !== id));
    setMessage("ยกเลิกบิลที่พักไว้แล้ว");
    toast.info("ยกเลิกบิลที่พักไว้แล้ว", { description: "รายการในบิลนั้นถูกล้างออกจากอุปกรณ์นี้" });
  };
  const startNewSale = async () => {
    setCart([]);
    setDiscount("0");
    setSelectedMemberNumber(null);
    setShortcut("");
    setSlipName("");
    setSlipPreview("");
    setReceiptOpen(false);
    setReceipt(null);
    setWalletAmount("");
    setWalletNote("");
    setWalletMemberNumber("");
    setWalletStep("form");
    setWalletResult(null);
    clearNotices();
    setMessage("เริ่มรายการขายใหม่แล้ว");
    toast.info("เริ่มรายการขายใหม่แล้ว", { description: "ล้างบิลเดิมเรียบร้อย · ยิงบาร์โค้ดรายการถัดไปได้เลย", duration: 2200 });
    await Promise.allSettled([
      utils.product.list.invalidate(),
      utils.member.list.invalidate(),
      utils.logs.list.invalidate(),
      utils.dashboard.stats.invalidate(),
      utils.stock.rows.invalidate(),
    ]);
    focusScan();
  };
  const payDisabled = cart.length === 0 || checkoutMutation.isPending;
  // P1-UX-05 — transaction state banner: บอกสถานะบิลปัจจุบันชัดเจน (บิลใหม่/กำลังขาย/
  // พักบิล/กำลังบันทึก) เพื่อลดการกดผิด — พนักงานเห็นสถานะเด่นชัดก่อนตัดสินใจ
  const txState = checkoutMutation.isPending
    ? { tone: "pending", label: "กำลังบันทึกบิล…", sub: "ห้ามกดซ้ำ · ห้ามปิดหน้าต่าง — รอจนบันทึกเสร็จ" }
    : cart.length === 0
      ? { tone: "idle", label: "บิลใหม่", sub: "ยังไม่มีรายการ — สแกนบาร์โค้ดหรือเลือกสินค้าจากแผง" }
      : heldBills.length > 0
        ? { tone: "held", label: `กำลังขาย · ${cart.length} รายการ · ${cartPieces} ชิ้น`, sub: `พักบิลแล้ว ${heldBills.length} รายการ · ยอดต้องชำระ ${money(payable)}` }
        : { tone: "active", label: `กำลังขาย · ${cart.length} รายการ · ${cartPieces} ชิ้น`, sub: `ยอดต้องชำระ ${money(payable)}${selectedMember ? ` · ${selectedMember.memberNumber}` : " · ลูกค้าทั่วไป"}` };
  const idleStatus = cart.length === 0
    ? "พร้อมสแกนสินค้า · F8 โฟกัสช่องสแกน · Esc เมนูหลัก"
    : selectedMember
      ? "ตรวจรายการแล้วกดชำระเงินด้านล่าง · F2 เติมเงิน · F3 ถอนเงิน · F4 รายการพิเศษ · F5 พักบิล · F8 สแกน · Esc เมนูหลัก"
      : "บิลนี้เป็นลูกค้าทั่วไป (ไม่ใช่สมาชิก) · ชำระด้วยเงินสดหรือ QR ได้เลย · F4 รายการพิเศษ · F5 พักบิล · Esc เมนูหลัก";
  // Parked bills persist on this device; announce the count so the Home rail
  // badge (⏸️) stays in sync with what POS is holding.
  useEffect(() => {
    try { localStorage.setItem("png-held-bills-v1", JSON.stringify(heldBills)); } catch { /* storage full/blocked — park-in-session only */ }
    window.dispatchEvent(new CustomEvent("pos-held", { detail: heldBills.length }));
  }, [heldBills]);
  // F2/F3/F4 — action forms open as MODALS (user mandate): they overlay
  // the bill instead of pushing rows around; the first field autofocuses.
  useEffect(() => {
    if (!shortcut) return;
    const timer = window.setTimeout(() => {
      const first = document.querySelector<HTMLDivElement>(".wallet-modal")?.querySelector<HTMLInputElement | HTMLSelectElement>(".wallet-form input, .special-form input");
      first?.focus();
    }, 40);
    return () => window.clearTimeout(timer);
  }, [shortcut, walletStep]);
  // Thin left rail (Home) talks to POS through window events: scan focus,
  // member picker, hold bill, register, quick-manage. Fresh-closure effect.
  useEffect(() => {
    const onRail = (event: Event) => {
      const action = (event as CustomEvent<string>).detail;
      if (action === "scan") focusScan();
      else if (action === "member") focusScan();
      else if (action === "hold") holdBill();
      else if (action === "limit" && !railHidden.has("limit")) { setLimitMember(selectedMember); setLimitShortcutOpen(true); }
      else if (action === "register") openRegister();
      else if (action === "quickmanage") { setQuickManageOpen(true); setQuickManageSearch(""); setQuickManageNotice(""); setQuickManageShowAll(false); }
      else if (action === "receive" || action === "add") { setInventoryQuickAction(action); setInventoryQuickOpen(true); }
    };
    window.addEventListener("pos-rail", onRail);
    return () => window.removeEventListener("pos-rail", onRail);
  });
  // F1–F9 — ปุ่มลัดครบทุกปุ่มบนราง (round 32-14 + r73 F9): ลูกค้า/เติม/ถอน/พิเศษ/พักบิล/เมนู/
  // สมาชิกใหม่/จัดแผง/สแกน — Esc ค่อยๆ ถอยทีละขั้น
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isShortcut(event, "limit", "") && !railHidden.has("limit")) { event.preventDefault(); setLimitMember(selectedMember); setLimitShortcutOpen(true); return; }
      if (isShortcut(event, "deposit", "F2") && !railHidden.has("deposit")) { event.preventDefault(); setShortcut(shortcut === "เติมเงิน" ? "" : "เติมเงิน"); return; }
      if (isShortcut(event, "withdraw", "F3") && !railHidden.has("withdraw")) { event.preventDefault(); setShortcut(shortcut === "ถอนเงิน" ? "" : "ถอนเงิน"); return; }
      if (isShortcut(event, "special", "F4") && !railHidden.has("special")) { event.preventDefault(); toggleSpecial(); return; }
      if (isShortcut(event, "customer", "F1") && !railHidden.has("customer")) { event.preventDefault(); focusScan(); return; }
      if (isShortcut(event, "hold", "F5") && !railHidden.has("hold")) { event.preventDefault(); holdBill(); return; }
      if (isShortcut(event, "register", "F6") && !railHidden.has("register")) { event.preventDefault(); setRegisterOpen((open) => !open); return; }
      if (isShortcut(event, "manage", "F7") && !railHidden.has("manage")) { event.preventDefault(); setQuickManageOpen((open) => !open); return; }
      if (isShortcut(event, "scan", "F8") && !railHidden.has("scan")) { event.preventDefault(); focusScan(); return; }
      if (isShortcut(event, "receive", "F9") && !railHidden.has("receive")) { event.preventDefault(); setInventoryQuickAction("receive"); setInventoryQuickOpen(true); return; }
      if (isShortcut(event, "add", "F10") && !railHidden.has("add")) { event.preventDefault(); setInventoryQuickAction("add"); setInventoryQuickOpen(true); return; }
      if (event.key === "Escape" && !receiptOpen) {
        if (payConfirm) { setPayConfirm(null); return; }
        if (scanMember) { setScanMember(null); return; }
        if (cardForNew) { setCardForNew(null); return; }
        if (registerOpen) { setRegisterOpen(false); return; }
        if (quickManageOpen) { setQuickManageOpen(false); return; }
        if (inventoryQuickOpen) { setInventoryQuickOpen(false); return; }
        if (shortcut === "เติมเงิน" || shortcut === "ถอนเงิน") {
          if (walletStep === "success") { finishWallet(); return; }
          if (walletStep === "confirm") { setWalletStep("form"); return; }
        }
        if (shortcut) { setShortcut(""); return; }
        if (scanOpen) { setScanOpen(false); setScanHighlight(-1); return; }
        if (query) { setQuery(""); focusScan(); return; }
        // กำลังพิมพ์อยู่ในช่องไหน (ส่วนลด/เลขสมาชิก/จำนวน) — Esc แค่ออกจากช่องนั้น ไม่เด้งหน้า
        // (ช่องสแกนไม่นับ — เป็น "บ้าน" ของ POS ที่โฟกัสอยู่เป็นปกติ กด Esc ต้องเปิดเมนูได้)
        const target = event.target as HTMLElement | null;
        if (target && target !== scanRef.current && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) { target.blur(); focusScan(); return; }
        // โมดัลที่ไม่ได้อยู่ในลำดับข้างบน (กล้อง/ยืนยันอื่น ๆ) — ปล่อยผ่าน ไม่เปิดเมนูทับ
        if (document.querySelector(".modal-backdrop")) return;
        // ROUND 75 (user) — เมนูหลักใช้ Esc แทน F9: มือถือไม่มีปุ่ม F9 แต่มี Esc บนคีย์บอร์ดเสมือน
        // เมื่อไม่มีอะไรเปิดอยู่ Esc = เปิดเมนูหลักกลับสู่ภาพรวมระบบ
        window.dispatchEvent(new CustomEvent("pos-open-menu"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  // Coming back to the tab → the scanner must be ready again (unless the
  // cashier is mid-typing somewhere else, e.g. wallet form or discount).
  useEffect(() => {
    const onWindowFocus = () => {
      const active = document.activeElement;
      if (active === document.body || active === document.documentElement) focusScan();
    };
    window.addEventListener("focus", onWindowFocus);
    return () => window.removeEventListener("focus", onWindowFocus);
  }, []);
  // ROUND 41 — คลิกนอกช่องสแกน = ปิดรายการให้เลือก · แถวที่ไฮไลต์ต้องเสมอมองเห็น
  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (scanHeroRef.current && !scanHeroRef.current.contains(event.target as Node)) { setScanOpen(false); setScanHighlight(-1); }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  useEffect(() => {
    if (scanHighlight < 0) return;
    document.querySelector(".scan-drop-row.active")?.scrollIntoView({ block: "nearest" });
  }, [scanHighlight]);
  return <>
    {inventoryQuickOpen && <div className="modal-backdrop pos-inventory-backdrop" role="dialog" aria-modal="true" aria-label="จัดการสินค้าและรับสินค้าเข้า" onClick={() => setInventoryQuickOpen(false)}><div className="pos-inventory-modal" onClick={(event) => event.stopPropagation()}><div className="pos-inventory-modal-body"><Stock role={role} userName={userName} initialAction={inventoryQuickAction} embeddedAction onClose={() => setInventoryQuickOpen(false)} /></div></div></div>}
    <SectionHeader eyebrow="หน้าร้าน / จุดขายสินค้า" title="POS · ขายสินค้า" description="สแกนบาร์โค้ดที่ช่องด้านบน · สินค้าไม่มีบาร์โค้ดปรับจำนวนได้ที่การ์ดด้านขวา · สรุปยอดและปุ่มชำระเงินล็อคอยู่ด้านล่างตลอดเวลา" action={<div className="pos-header-actions"><div className="pos-status"><span className="live-dot" /> จุดขายที่ 01 · เปิดให้บริการ</div></div>} />
    <div className="pos-layout pos-premium-layout">
      <section className="panel cart-panel pos-premium-bill" ref={cartPanelRef}>
        <div className="pos-sale-workspace">
        <div className="pos-head">
        <div className="pos-bill-search" data-pos-search-host />
        <SharedSearch label="POS · สินค้าและสมาชิก">
        <div className="scan-hero" ref={scanHeroRef}>
          <ScanLine size={22} className="scan-hero-icon" />
          <input ref={scanRef} name={`${formNoiseRef.current}-scan`} value={query} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} onKeyDownCapture={scanLayout.onKeyDownCapture} onChange={(event) => { setQuery(event.target.value); setScanOpen(true); setScanHighlight(-1); }} onFocus={() => setScanOpen(true)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); handleScanSubmit(); return; } if (event.key === "ArrowDown" && scanRows.length > 0) { event.preventDefault(); setScanOpen(true); setScanHighlight((current) => Math.min(current + 1, scanRows.length - 1)); return; } if (event.key === "ArrowUp" && scanRows.length > 0) { event.preventDefault(); setScanHighlight((current) => Math.max(current - 1, 0)); return; } if (event.key === "Escape" && scanOpen && (query.trim() !== "" || recentScanProducts.length > 0)) { event.preventDefault(); event.stopPropagation(); closeScanDrop(); } }} placeholder="สแกน / ค้นหาสินค้าหรือสมาชิก" autoFocus aria-label="ช่องสแกนบาร์โค้ดและค้นหาสินค้าหรือสมาชิก" title="ค้นหาสินค้า (ชื่อ/SKU/บาร์โค้ด) และสมาชิก (เลข/ชื่อ) — เลือกจากรายการใต้ช่อง · ไม่เก็บประวัติการคีย์ในเบราว์เซอร์" />
          <button type="button" className="scan-camera-btn scan-camera-hero" onClick={openCamera} aria-label="สแกนด้วยกล้อง" title={hasCameraScan ? "สแกนด้วยกล้องโทรศัพท์/เว็บแคม — ไม่มีปืนสแกนก็ยิงบาร์โค้ดได้ อ่านได้ทั้งสินค้าและบัตรสมาชิก (QR ด้วย)" : "กล้องสแกนบาร์โค้ดเป็นฟีเจอร์เวอร์ชันโปรพลัส — กดเพื่อดูรายละเอียด"}><Camera size={16} />{!hasCameraScan && <Lock size={10} style={{ position: "absolute", right: 3, bottom: 3 }} />}</button>{query ? <button type="button" className="scan-clear" onClick={() => { setQuery(""); setScanHighlight(-1); focusScan(); }} aria-label="ล้างคำค้นหา"><X size={15} /></button> : <span className="scan-live"><span className="live-dot" /> พร้อมสแกน</span>}
          <kbd>Enter</kbd>
          {scanOpen && (query.trim() !== "" || recentScanProducts.length > 0) && (
            <div className="scan-drop" role="listbox" aria-label="รายการให้เลือกจากช่องสแกน">
              {query.trim() === "" ? (
                <>
                  <div className="scan-drop-head"><span><History size={13} /> รายการที่เพิ่งเลือก · แตะเพื่อเพิ่มซ้ำ</span><button type="button" onClick={clearRecentScan}>ล้างประวัติ</button></div>
                  {recentScanProducts.map((product, index) => (
                    <button type="button" className={`scan-drop-row${scanHighlight === index ? " active" : ""}`} key={`recent-${product.id}`} role="option" aria-selected={scanHighlight === index} onClick={() => pickScanProduct(product)}>
                      <span className="scan-drop-thumb">{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <span>{product.emoji}</span>}</span>
                      <div className="scan-drop-info"><b>{product.name}</b><small>{product.sku} · คงเหลือ {formatBillQty(product.stock, product.unit)}{product.sellMode === "money" ? " · ขายเป็นราคาตามขนาด" : ""}</small></div>
                      <strong className="scan-drop-price">{money(product.price)}</strong>
                    </button>
                  ))}
                </>
              ) : scanSuggestions.length === 0 && scanMemberSuggestions.length === 0 ? (
                <div className="scan-drop-empty"><Search size={17} /><b>ไม่พบสินค้าหรือสมาชิก “{query.trim()}”</b><small>ลองยิงบาร์โค้ดเต็ม หรือพิมพ์ชื่อสินค้า / รหัส SKU / เลขสมาชิก</small></div>
              ) : (
                <>
                  {scanSuggestions.length > 0 && <div className="scan-drop-head"><span><PackageSearch size={13} /> สินค้า · {scanSuggestions.length} รายการ</span></div>}
                  {scanSuggestions.map((product, index) => (
                    <button type="button" className={`scan-drop-row${scanHighlight === index ? " active" : ""}`} key={`product-${product.id}`} role="option" aria-selected={scanHighlight === index} onClick={() => pickScanProduct(product)}>
                      <span className="scan-drop-thumb">{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <span>{product.emoji}</span>}</span>
                      <div className="scan-drop-info"><b>{product.name}</b><small>{product.sku}{product.barcode ? ` · ${product.barcode}` : " · ไม่มีบาร์โค้ด"} · คงเหลือ {formatBillQty(product.stock, product.unit)}{product.sellMode === "money" ? " · ขายเป็นราคาตามขนาด" : ""}</small></div>
                      <strong className="scan-drop-price">{money(product.price)}</strong>
                    </button>
                  ))}
                  {scanMemberSuggestions.length > 0 && <div className="scan-drop-head"><span><IdCard size={13} /> สมาชิก · {scanMemberSuggestions.length} รายการ</span></div>}
                  {scanMemberSuggestions.map((member, index) => {
                    const rowIndex = scanSuggestions.length + index;
                    return (
                      <button type="button" className={`scan-drop-row member${scanHighlight === rowIndex ? " active" : ""}`} key={`member-${member.memberNumber}`} role="option" aria-selected={scanHighlight === rowIndex} disabled={member.status === "suspended"} onClick={() => pickScanMember(member)}>
                        <MemberAvatar member={member} size={30} />
                        <div className="scan-drop-info"><b>{member.memberNumber} · สมาชิก{memberFullName(member)}</b><small>ยอดคงเหลือ {money(member.balance)}</small></div>
                        {member.status === "suspended" ? <span className="suspended-tag">ระงับ</span> : <span className="scan-drop-kind">สมาชิก</span>}
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>
        </SharedSearch>
        <div className="pos-customer-row">
          <span className="pos-customer-label"><UserRound size={18} /> ลูกค้า</span>
          {selectedMember ? <MemberScanPicker members={members} selectedNumber={selectedMemberNumber} onSelect={(member) => { setSelectedMemberNumber(member ? member.memberNumber : null); clearNotices(); focusScan(); }} requireConfirm confirmContext="บิลนี้" inputId="pos-member-input" /> : <strong>ทั่วไป</strong>}
          <button type="button" className="outline-button pos-select-member" onClick={focusScan} title="ค้นหาชื่อหรือเลขสมาชิกในช่องสแกน (F1)">{selectedMember ? "เปลี่ยนสมาชิก" : "เลือกสมาชิก"}<kbd>F1</kbd></button>
          {selectedMember && <button type="button" className="ghost-button" onClick={() => { setSelectedMemberNumber(null); clearNotices(); focusScan(); }}>ลูกค้าทั่วไป</button>}
        </div>
        </div>
        <div className="cart-mid" ref={cartMidRef}>
        {/* P1-UX-05 — transaction state banner: สถานะบิลเด่นชัด (บิลใหม่/กำลังขาย/พักบิล/กำลังบันทึก) */}
        <div className={`cart-state-banner ${txState.tone}`} role="status" aria-live={txState.tone === "pending" ? "assertive" : "polite"}>
          {txState.tone === "pending" ? <span className="state-spinner" aria-hidden="true" /> : <span className="state-dot" aria-hidden="true" />}
          <b>{txState.label}</b>
          <small>{txState.sub}</small>
        </div>
        {heldBills.length > 0 && <div className="held-chips" aria-label="บิลที่ถูกพักไว้">{heldBills.map((bill) => <div className="held-chip" key={bill.id}><Pause size={13} /><b>{bill.items.reduce((sum, item) => sum + item.qty, 0)} ชิ้น</b><time>{holdTimeLabel(bill.savedAt)}</time><button type="button" className="chip-restore" onClick={() => restoreHeld(bill.id)} aria-label="เรียกคืนบิลที่พักไว้" title="เรียกคืนบิลนี้"><RotateCcw size={14} /></button><button type="button" className="chip-discard" onClick={() => discardHeld(bill.id)} aria-label="ยกเลิกบิลที่พักไว้" title="ยกเลิกบิลนี้"><X size={13} /></button></div>)}</div>}
        <div className="cart-heading"><div><h2>รายการขาย · บิลปัจจุบัน</h2><p>{cartPieces} ชิ้น · {cart.length} แถว</p></div><button className="icon-button" onClick={() => setCancelOpen(true)} title="ยกเลิกรายการขาย"><Trash2 size={17} /></button></div>
        <div className="cart-items">{cart.length === 0 ? <div className="empty-cart"><ScanLine size={26} /><b>ยังไม่มีสินค้าในบิล</b><span>ยิงบาร์โค้ดที่ช่องด้านบน หรือกดสินค้าจากแผงด้านขวา</span></div> : <><div className="cart-items-head"><span>รายการ</span><span>จำนวน <em className="head-hint">พิมพ์ทับได้เลย</em></span><span>ราคา/หน่วย</span><span>รวม</span></div>{cart.map((item) => { const key = billRowKey(item); return <div className="cart-item" key={key}><b className="cart-item-name" title={item.name}>{item.special && <i className="special-tag">พิเศษ</i>}{item.name}</b><div className="qty-control"><button aria-label={`ลดจำนวน ${item.name}`} onClick={() => updateQty(item.id, -1, item.variant, item.step ?? 1)}><Minus size={12} /></button><input id={`bill-qty-${key}`} name={`${formNoiseRef.current}-${key}`} className="qty-input" type="text" inputMode="numeric" autoComplete="off" value={qtyDrafts[key] ?? String(item.qty)} onKeyDownCapture={scanLayout.onKeyDownCapture} onFocus={(event) => event.currentTarget.select()} onBlur={() => clearQtyDraft(key)} onChange={(event) => handleQtyInput(item, key, event.target.value)} onKeyDown={(event) => handleQtyKey(item, key, event)} aria-label={`จำนวน ${item.name}${item.variant ? " (กรัม)" : ""}`} title={item.variant ? `${item.qty} ${item.unit} — พิมพ์จำนวนกรัมทับได้ · Enter กลับช่องสแกน · ยิงบาร์โค้ดใส่ช่องนี้ก็ได้` : "คลิกแล้วพิมพ์จำนวนใหม่ · Enter กลับช่องสแกน · ยิงบาร์โค้ดใส่ช่องนี้ก็ได้"} /><button aria-label={`เพิ่มจำนวน ${item.name}`} onClick={() => updateQty(item.id, 1, item.variant, item.step ?? 1)}><Plus size={12} /></button></div><span className="cart-item-unit" title={`${money(item.price)} / ${item.unit}`}>{money(item.price)}</span><strong className="cart-item-amount">{money(item.variant ? item.price * (item.qty / (item.step || 1)) : item.price * item.qty)}</strong></div>; })}</>}</div></div>
        </div>
        <div className="cart-foot pos-payment-summary"><div className="pos-summary-heading"><h2>สรุปการชำระเงิน</h2><span className="pos-summary-badge">บิลปัจจุบัน</span></div><div className="pos-summary-count"><span>รายการสินค้า</span><strong>{cart.length} รายการ · {cartPieces} ชิ้น</strong></div><div className="cart-totals"><div><span>ยอดรวมสินค้า</span><strong>{money(subtotal)}</strong></div><div><span>ส่วนลดสมาชิก</span><strong className="discount discount-edit">- ฿<input type="number" min="0" step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)} aria-label="ส่วนลด (บาท)" /></strong></div><div className="total-line"><span>ยอดที่ต้องชำระ</span><strong>{money(payable)}</strong></div></div><div className="payment-actions"><button className="pay-button member-pay" disabled={payDisabled} onClick={() => requestPayment("หักบัญชีสมาชิก")}><CreditCard size={18} /> หักบัญชีสมาชิก</button><div className="pay-split"><button disabled={payDisabled} onClick={() => requestPayment("เงินสด")}><span className="pay-icon cash"><WalletCards size={16} /></span> เงินสด</button><button disabled={payDisabled} onClick={() => requestPayment("QR / สแกน")}><span className="pay-icon qr"><QrCode size={16} /></span> QR / สแกน</button></div></div>{isAdminRole(role) && <div className="admin-pos-note"><Sparkles size={14} /><span>ผู้บริหารสามารถแก้ไขราคา/ตรวจสอบรายการก่อนปิดบิล</span></div>}<div className={`cart-status-line${error ? " error" : message ? " ok" : ""}`} role="status" aria-live="polite">{error ? <><CircleAlert size={14} /> <span className="cart-status-text">{error}</span> <button onClick={() => setError("")} aria-label="ปิดข้อความแจ้งเหตุ"><X size={13} /></button></> : message ? <><Check size={14} /> <span className="cart-status-text">{message}</span></> : <><span className="live-dot" /> <span className="cart-status-text">{idleStatus}</span></>}</div></div>
      </section>
      <aside className="panel product-panel quick-pick-panel">
        <div className="quick-pick-head"><div><h2>แผงลัดหน้าร้าน</h2></div><span className="quick-pick-count">{panelList.length} รายการ</span><button type="button" className="outline-button compact quick-manage-open-btn" onClick={() => { setQuickManageOpen(true); setQuickManageSearch(""); setQuickManageNotice(""); setQuickManageShowAll(false); }} title="เพิ่ม/นำออก สินค้าที่ขึ้นแผงนี้"><Star size={14} /> จัดแผง</button></div>
        <div className="category-tabs">{["ทั้งหมด", "เครื่องดื่ม", "ขนม", "อาหาร", "ของใช้"].map((item) => <button className={category === item ? "active" : ""} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div>
        <div className="product-scroll">{productsQuery.isLoading ? <div className="product-grid" aria-busy="true">{Array.from({ length: 6 }, (_, index) => <div aria-hidden="true" className="product-card skeleton-card" key={`skeleton-${index}`}><div className="product-art"><span className="skeleton-avatar" /></div><div className="product-card-info"><span className="skeleton-cell-w" /><span className="skeleton-cell-n" /><span className="skeleton-price" /></div></div>)}</div> : productsQuery.isError ? <div className="inline-message error"><CircleAlert size={15} /> โหลดรายการสินค้าไม่สำเร็จ · {getErrorMessage(productsQuery.error)}</div> : panelList.length === 0 ? <div className="pos-loading"><Search size={26} /><b>ไม่พบสินค้าตามเงื่อนไข</b><span>ลองเปลี่ยนคำค้นหาหรือหมวดหมู่</span></div> : <div className="product-grid">{panelList.map((product) => { const tiers = product.sellMode === "money" ? parsePriceTiers(product.priceTiers) : []; if (tiers.length > 0) { return <div className={`product-card money-card${qtyInBill(product.id) > 0 ? " in-bill" : ""}`} key={product.id} aria-label={`${product.name} — สินค้าขายเป็นราคา เลือกขนาดที่ปุ่มราคา`} title={`${product.name} · ขายเป็นราคาตามขนาด`}><div className={`product-art ${product.color}`}>{product.imageUrl ? <img className="product-art-img" src={product.imageUrl} alt="" /> : <span>{product.emoji}</span>}{product.stock <= 10 && <i>เหลือ {formatBillQty(product.stock, product.unit)}</i>}{qtyInBill(product.id) > 0 && <b className="pick-qty-badge">{formatBillQty(qtyInBill(product.id), product.unit)}</b>}</div><div className="product-card-info"><b>{product.name}</b><small>{product.unit} · คงเหลือ {formatBillQty(product.stock, product.unit)}</small></div><div className="tier-stepper" onClick={(event) => event.stopPropagation()}>{tiers.map((tier) => <button type="button" className="tier-button" key={tier.label} disabled={product.stock < tier.qty} onClick={() => addTier(product, tier)} aria-label={`เพิ่ม ${product.name} ${tier.label} ${money(tier.price)}`}><b>฿{tier.price}</b><small>{tier.label}</small></button>)}</div></div>; } return <div className={`product-card${qtyInBill(product.id) > 0 ? " in-bill" : ""}`} key={product.id} role="button" tabIndex={0} aria-label={`เพิ่ม ${product.name} เข้าบิล`} onClick={() => addProduct(product)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); addProduct(product); } }}><div className={`product-art ${product.color}`}>{product.imageUrl ? <img className="product-art-img" src={product.imageUrl} alt="" /> : <span>{product.emoji}</span>}{product.stock <= 10 && <i>เหลือ {product.stock}</i>}{qtyInBill(product.id) > 0 && <b className="pick-qty-badge">{qtyInBill(product.id)}</b>}</div><div className="product-card-info"><b>{product.name}</b><small>{product.size ? `${product.size} · ` : ""}{product.unit} · คงเหลือ {product.stock}</small><strong>{money(product.price)}</strong></div><div className="pick-stepper" onClick={(event) => event.stopPropagation()}><button type="button" aria-label={`ลดจำนวน ${product.name} ในบิล`} disabled={qtyInBill(product.id) === 0} onClick={() => bumpPick(product, -1)}><Minus size={13} /></button><span className={qtyInBill(product.id) === 0 ? "pick-qty zero" : "pick-qty"} aria-label={`จำนวน ${product.name} ในบิล`}>{qtyInBill(product.id)}</span><button type="button" aria-label={`เพิ่มจำนวน ${product.name} ในบิล`} disabled={product.stock <= 0 || qtyInBill(product.id) >= product.stock} onClick={() => bumpPick(product, 1)}><Plus size={13} /></button></div></div>; })}</div>}</div>
        <HelpDisclosure id="pos-scan-help" label="ตัวอย่างการค้นหา / ยิงบาร์โค้ด"><span>ตัวอย่างบาร์โค้ด {sampleCodes[0]?.barcode ?? "8850000000017"} · รหัส SKU เช่น DRK-001 · พิมพ์เลข 3 ตัวท้ายก็ค้นเจอ · เพิ่มแล้วพิมพ์จำนวนที่ช่องจำนวนได้เลย · ยิงตอนวินโดว์เป็นภาษาไทยก็ได้ — ระบบแปลงให้อัตโนมัติ</span></HelpDisclosure>
      </aside>
    </div>
    {limitShortcutOpen && (limitMember ? <LimitReductionModal member={limitMember} role={role} userName={userName} onClose={() => setLimitShortcutOpen(false)} onSuccess={(message) => toast.success(message)} /> : <div className="modal-backdrop"><div className="form-modal" role="dialog" aria-modal="true" aria-label="เลือกสมาชิกเพื่อขอลดวงเงิน"><div className="modal-heading"><h2>เลือกสมาชิกเพื่อขอลดวงเงิน</h2><button className="icon-button" aria-label="ปิดหน้าต่าง" onClick={() => setLimitShortcutOpen(false)}><X size={17} /></button></div><MemberScanPicker members={members} selectedNumber={null} onSelect={setLimitMember} requireConfirm confirmContext="คำขอลดวงเงิน" inputId="pos-limit-member" /></div></div>)}
    {cart.length > 0 && !receiptOpen && <div className="pos-mobile-bar"><span className="pos-mobile-count"><ShoppingCart size={15} /> {cartPieces} รายการ</span><strong>{money(payable)}</strong><button onClick={() => cartPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}><CreditCard size={16} /> ชำระเงิน</button></div>}
    {receiptOpen && receipt && <ReceiptModal receipt={receipt} onClose={startNewSale} onNewSale={startNewSale} onPrinted={() => { setMessage("ส่งใบเสร็จไปพิมพ์แล้ว"); toast.info("ส่งใบเสร็จไปพิมพ์แล้ว", { description: `บิล ${receipt.orderNumber} · ตรวจเครื่องพิมพ์ที่เคาน์เตอร์`, duration: 2600 }); }} />}{cardForNew && <MemberCardModal member={cardForNew} onClose={() => setCardForNew(null)} />}{scanMember && <MemberCardModal member={scanMember} confirmForBill onClose={() => { setScanMember(null); focusScan(); }} onConfirm={confirmScanMember} />}{registerOpen && <MemberRegistrationModal actor={cashier} actorRole={actorRole} onClose={() => setRegisterOpen(false)} onRegistered={onMemberRegistered} />}{quickManageOpen && <div className="modal-backdrop" onClick={() => setQuickManageOpen(false)}><div className="form-modal quick-manage-modal" role="dialog" aria-modal="true" aria-label="จัดแผงลัดหน้าร้าน" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">POS SHORTCUT RAIL</span><h2>จัดแผงลัดหน้าร้าน</h2><p>ของเดิมที่อยู่บนแผงแสดงที่รายการบนสุดทั้งหมด — กดปุ่มแดง “นำออก” ลบได้ทันที · ส่วนล่างคือสินค้าทั้งหมดในคลัง กด “ขึ้นแผง” เพื่อเพิ่มของใหม่</p></div><button className="icon-button" onClick={() => setQuickManageOpen(false)} aria-label="ปิดหน้าต่าง"><X size={17} /></button></div><div className="quick-manage-tools"><div className="search-field"><Search size={16} /><input autoFocus value={quickManageSearch} onChange={(event) => setQuickManageSearch(event.target.value)} placeholder="ค้นหาชื่อสินค้า หรือรหัส SKU / บาร์โค้ด" /></div><span className="quick-manage-count">{quickManageSearch.trim() !== "" ? `พบ ${quickManageMatches.length} รายการ` : `${shortcuts.length} รายการบนแผง`}</span></div><div className="quick-manage-section-title"><Star size={13} /> อยู่บนแผงตอนนี้ ({quickPanelItems.length})</div><div className="quick-manage-list on-panel" role="list">{quickPanelItems.length === 0 ? <div className="quick-manage-empty">{shortcuts.length === 0 ? "ยังไม่มีสินค้าบนแผง — เลือกจากรายการสินค้าด้านล่างแล้วกด “ขึ้นแผง”" : "ไม่พบของที่อยู่บนแผงตามคำค้นหานี้"}</div> : quickPanelItems.map((product) => <div className="quick-manage-row active" key={`on-panel-${product.id}`} role="listitem"><span className="quick-manage-thumb">{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <span>{product.emoji}</span>}</span><div className="quick-manage-info"><b>{product.name}</b><small>{product.sku}{product.barcode ? ` · ${product.barcode}` : " · ไม่มีบาร์โค้ด"}{product.sellMode === "money" ? " · ขายเป็นราคา" : ""}</small></div><button type="button" className="danger-outline-button compact" disabled={quickPickMutation.isPending} onClick={() => quickPickMutation.mutate({ productId: product.id, quickPick: 0, actor: cashier, actorRole })} aria-label={`นำ ${product.name} ออกจากแผงลัดหน้าร้าน`} title={`นำ ${product.name} ออกจากแผงลัดหน้าร้าน — การ์ดจะหายจากหน้า POS ทันที ข้อมูลสินค้ายังอยู่ครบในคลัง`} ><StarOff size={14} /> นำออก</button></div>)}</div><div className="quick-manage-section-title"><LayoutGrid size={13} /> สินค้าทั้งหมดในคลัง ({quickManageMatches.length})</div><div className="quick-manage-list" role="list">{quickManageMatches.length === 0 ? <div className="quick-manage-empty">ไม่พบสินค้าตามคำค้นหานี้</div> : <>{quickManageMatches.slice(0, quickManageShowAll ? undefined : QUICK_MANAGE_PAGE).map((product) => { const active = product.quickPick === 1; return <div className={`quick-manage-row${active ? " active" : ""}`} key={product.id} role="listitem"><span className="quick-manage-thumb">{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <span>{product.emoji}</span>}</span><div className="quick-manage-info"><b>{product.name}</b><small>{product.sku}{product.barcode ? ` · ${product.barcode}` : " · ไม่มีบาร์โค้ด"}{product.sellMode === "money" ? " · ขายเป็นราคา" : ""}</small></div><button type="button" className={active ? "primary-button compact" : "outline-button compact"} disabled={quickPickMutation.isPending} onClick={() => quickPickMutation.mutate({ productId: product.id, quickPick: active ? 0 : 1, actor: cashier, actorRole })} aria-pressed={active} title={active ? "นำออกจากแผงลัด" : "ขึ้นแผงลัดหน้าร้าน"}><Star size={14} /> {active ? "อยู่บนแผง" : "ขึ้นแผง"}</button></div>; })}{!quickManageShowAll && quickManageMatches.length > QUICK_MANAGE_PAGE && <button type="button" className="quick-manage-more" onClick={() => setQuickManageShowAll(true)} title="แสดงสินค้าที่เหลือทั้งหมดในคลัง"><ChevronDown size={14} /> แสดงเพิ่มอีก {quickManageMatches.length - QUICK_MANAGE_PAGE} รายการ · ทั้งหมด {quickManageMatches.length} รายการ</button>}</>}</div>{quickManageNotice && <div className="notice-bar"><Check size={16} /> {quickManageNotice}<button onClick={() => setQuickManageNotice("")}><X size={14} /></button></div>}<div className="initial-balance-note"><LayoutGrid size={15} /><span>แผงลัดคือการ์ดสินค้าที่ขึ้นหน้า POS ทันที — เหมาะกับของที่ลูกค้าซื้อบ่อยและไม่ต้องยิงบาร์โค้ดทุกครั้ง · ลบของเดิมด้วยปุ่ม “นำออก” ที่รายการบนสุด · สินค้าขายเป็นราคา (เช่น น้ำแข็ง) ตั้งช่องราคาได้ที่หน้าสต็อก</span></div><div className="modal-actions"><button className="primary-button" onClick={() => setQuickManageOpen(false)}><Check size={16} /> เสร็จสิ้น</button></div></div></div>}<ConfirmDialog open={cancelOpen} title="ยืนยันการยกเลิกรายการขาย?" description="สินค้าที่อยู่ในบิลนี้จะถูกล้างออก และยังไม่บันทึกเป็นธุรกรรม (บิลที่พักไว้จะไม่ถูกกระทบ)" confirmLabel="ยืนยันยกเลิกบิล" onCancel={() => setCancelOpen(false)} onConfirm={() => { setCart([]); setCancelOpen(false); setMessage("ยกเลิกรายการขายแล้ว"); toast.info("ยกเลิกรายการขายแล้ว", { description: "ล้างบิลปัจจุบันทิ้ง — เริ่มรายการใหม่ได้ทันที" }); }} />{payConfirm && !receiptOpen && <div className="modal-backdrop" onClick={() => { if (!checkoutMutation.isPending) setPayConfirm(null); }}><div className="form-modal pay-confirm-modal" role="dialog" aria-modal="true" aria-label="ยืนยันการชำระเงิน" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">CONFIRM · CHECKOUT</span><h2>ยืนยันการชำระเงิน</h2><p>ตรวจรายการ ยอดเงิน และวิธีชำระให้ถูกต้อง — บิลจะยังไม่ถูกบันทึก ไม่ตัดสต็อก และไม่พิมพ์ จนกว่าจะกดยืนยัน</p></div><button className="icon-button" onClick={() => { if (!checkoutMutation.isPending) setPayConfirm(null); }} aria-label="ปิดหน้าต่าง"><X size={17} /></button></div><div className="pay-confirm-body"><div className="pay-confirm-items" aria-label="รายการในบิลที่กำลังจะชำระ"><div className="pay-confirm-items-head"><span>รายการ</span><span>จำนวน</span><span>ยอด</span></div>{cart.map((item) => <div className="pay-confirm-item" key={billRowKey(item)}><b>{item.special && <i className="special-tag">พิเศษ</i>}{item.name}</b><span>{item.variant ? `${item.qty} ${item.unit}` : `${item.qty} × ${money(item.price)}`}</span><strong>{money(item.variant ? item.price * (item.qty / (item.step || 1)) : item.price * item.qty)}</strong></div>)}</div><div className="wallet-confirm-rows pay-confirm-rows"><div><span>จำนวนรายการ</span><b>{cart.length} แถว · {cartPieces} ชิ้น</b></div><div><span>ยอดรวมสินค้า</span><b>{money(subtotal)}</b></div>{discountValue > 0 && <div><span>ส่วนลด</span><b className="green-text">- {money(discountValue)}</b></div>}<div><span>วิธีชำระเงิน</span><b>{payConfirm}</b></div>{selectedMember ? <div><span>สมาชิก</span><b>{memberFullName(selectedMember)} · {selectedMember.memberNumber}{payConfirm === "หักบัญชีสมาชิก" ? ` · คงเหลือ ${money(selectedMember.balance)}` : ""}</b></div> : <div><span>ผู้ซื้อ</span><b>ลูกค้าทั่วไป · ไม่ใช่สมาชิก</b></div>}{payConfirm === "หักบัญชีสมาชิก" && selectedMember && <div><span>ยอดคงเหลือหลังชำระ</span><b className={selectedMember.balance - payable < 0 ? "red-text" : ""}>{money(selectedMember.balance - payable)}</b></div>}<div><span>ผู้ขาย</span><b>{cashier} · {actorRole}</b></div><div className="pay-confirm-total"><span>ยอดที่ต้องชำระ</span><b>{money(payable)}</b></div></div>{payConfirm === "หักบัญชีสมาชิก" && selectedMember && selectedMember.balance < payable && <div className="notice-bar error"><CircleAlert size={16} /> เงินในบัญชีสมาชิกไม่พอสำหรับบิลนี้ — เติมเงินก่อน หรือเปลี่ยนไปชำระด้วยเงินสด/QR<button onClick={() => setError("")} aria-label="ปิดข้อความแจ้งเหตุ"><X size={14} /></button></div>}{payConfirm === "QR / สแกน" && <div className="pay-qr-block">{payQrUrl ? <div className="pay-qr-figure"><img src={payQrUrl} alt={`คิวอาร์พร้อมเพย์ ยอด ${money(payable)}`} /><div className="pay-qr-caption"><b><QrCode size={15} /> ให้ลูกค้าสแกนจ่าย {money(payable)}</b><small>เปิดแอปธนาคาร → สแกนคิวอาร์นี้ → ยอดถูกกรอกให้อัตโนมัติ (บัญชีพร้อมเพย์ของร้าน)</small></div></div> : <div className="pay-qr-missing"><CircleHelp size={17} /><span>ยังไม่ได้ตั้งบัญชีพร้อมเพย์ร้าน — ตั้งค่า → การชำระเงิน ใส่เบอร์โทรหรือเลขบัตรประชาชนของร้านแล้ว QR จะขึ้นที่นี่ให้ลูกค้าสแกนจ่ายได้เลย</span></div>}{(settingsQuery.data?.bankAccounts ?? []).filter(a => a.active).length > 0 && <div className="pay-bank-accounts"><div className="pay-bank-head"><Bank size={14} /><span>หรือโอนผ่านบัญชีธนาคาร</span><small>หน้านี้แสดงเฉพาะบัญชีที่เปิดใช้งาน — ตั้งค่าที่เมนู การชำระเงิน</small></div><ul className="pay-bank-list">{(settingsQuery.data?.bankAccounts ?? []).filter(a => a.active).map(account => <li className="pay-bank-row" key={account.id}><div className="pay-bank-row-info"><b>{account.bankName}{account.bankCode && <em className="bank-code-pill">{account.bankCode}</em>}</b><small>เลขที่ <i>{account.accountNumber}</i> · ชื่อ <i>{account.accountName}</i>{account.branch ? ` · สาขา ${account.branch}` : ""}{account.note ? ` · ${account.note}` : ""}</small></div><button type="button" className="icon-button pay-bank-copy" onClick={() => { navigator.clipboard?.writeText(account.accountNumber).then(() => toast.success("คัดลอกเลขบัญชีแล้ว", { description: account.bankName, duration: 2000 })).catch(() => toast.info("คัดลอกเอง", { description: account.accountNumber, duration: 3500 })); }} title={`คัดลอกเลขบัญชี ${account.bankName}`} aria-label={`คัดลอกเลขบัญชี ${account.bankName}`}><Copy size={14} /></button></li>)}</ul><div className="pay-bank-hint"><ShieldCheck size={13} /> ถ้าลูกค้าโอนผ่านแอปธนาคาร (ไม่สแกน QR) — ให้แนบสลิปหลักฐานด้านล่างเพื่อเก็บไว้กับบิล</div></div>}<div className="pay-slip-block"><div className="slip-heading"><span><FileImage size={16} /> หลักฐานการชำระ (สลิปโอน / หน้าจอสแกนจ่าย)</span><small>ไม่บังคับ · เก็บไว้กับบิลเพื่อยืนยันย้อนหลัง</small></div>{paySlip ? <div className="slip-preview"><img src={paySlip.dataUrl} alt="หลักฐานการชำระที่แนบ" /><div><b>{paySlip.name}</b><small>จะถูกเก็บไปกับบิลนี้</small></div><button onClick={() => setPaySlip(null)} aria-label="ลบรูปหลักฐาน" title="ลบรูปหลักฐานออกจากบิล"><X size={14} /></button></div> : <div className="pay-slip-actions"><button type="button" className="outline-button compact" onClick={() => setPaySlipCameraOpen(true)}><Camera size={15} /> ถ่ายรูปสลิป</button><label className="outline-button compact pay-slip-file" title="เลือกรูปสลิปจากไฟล์ในเครื่อง"><Upload size={15} /> แนบรูปจากไฟล์<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { void handlePaySlipFile(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label></div>}</div></div>}{error && <div className="notice-bar error"><CircleAlert size={16} /> {error}<button onClick={() => setError("")} aria-label="ปิดข้อความแจ้งเหตุ"><X size={14} /></button></div>}{payConfirm === "เงินสด" && <div className="pay-cash-block"><div className="pay-cash-head"><WalletCards size={15} /><b>รับเงินมา (บาท)</b><small>กรอกยอดเงินที่ลูกค้าให้มา — ระบบคำนวณเงินทอนให้</small></div><div className="pay-cash-input-row"><input type="text" inputMode="decimal" value={cashReceived} onChange={(event) => setCashReceived(event.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" aria-label="ยอดเงินที่รับมา" /><button type="button" className="outline-button compact" onClick={() => setCashReceived("")} disabled={!cashReceived} title="ล้างยอดเงิน">ล้าง</button></div><div className="pay-cash-quick">{QUICK_CASH_AMOUNTS.map((amt) => <button key={amt} type="button" className="quick-amount-btn" onClick={() => pickQuickCash(amt)} title={`เพิ่ม ${amt} บาท (สะสม)`}>+{amt}</button>)}<button type="button" className="quick-amount-btn exact" onClick={() => pickQuickCash("exact")} title="ตั้งยอดรับเท่ากับยอดบิลพอดี">รับตรงยอด</button></div><div className={`pay-cash-summary${cashReceived === "" ? "" : cashSufficient ? " sufficient" : " short"}`}>{cashReceived === "" ? <><CircleHelp size={14} /><span>ยังไม่กรอกยอดรับเงิน — ปุ่มยืนยันจะใช้งานไม่ได้จนกว่าจะกรอก</span></> : cashSufficient ? <><Check size={14} /><b>ทอน {money(changeDue)}</b><small>รับ {money(cashReceivedNum)} · บิล {money(payable)}</small></> : <><CircleAlert size={14} /><b>ขาดอีก {money(cashShortfall)}</b><small>รับ {money(cashReceivedNum)} · บิล {money(payable)}</small></>}</div></div>}{payConfirm === "QR / สแกน" && <div className="pay-verify-block"><label className="pay-verify-checkbox"><input type="checkbox" checked={qrVerified} onChange={(event) => setQrVerified(event.target.checked)} /><span className="pay-verify-text"><ShieldCheck size={15} /><b>ฉันตรวจสอบการชำระเงินแล้ว</b><small>ลูกค้าสแกนจ่าย / โอนเงินมาแล้วจริง — ติ๊กเพื่อยืนยัน ก่อนกด “ยืนยันการชำระเงิน” (ป้องกันกดผิดก่อนลูกค้าจ่ายจริง)</small></span></label></div>}<div className="wallet-confirm-warning"><ShieldCheck size={16} /><span>กด “ยืนยันการชำระเงิน” แล้วระบบจะบันทึกบิลและตัดสต็อกทันที — จากนั้นขึ้นหน้าใบเสร็จให้เลือกพิมพ์ บันทึกรูป หรือดาวน์โหลด PDF เอง</span></div></div><div className="modal-actions"><button className="outline-button" disabled={checkoutMutation.isPending} onClick={() => setPayConfirm(null)}><RotateCcw size={15} /> ย้อนกลับแก้ไข</button>{payConfirm === "QR / สแกน" && <button className="outline-button payment-notice-trigger" disabled={!payQrUrl || checkoutMutation.isPending} onClick={() => setPaymentNoticeOpen(true)}><Printer size={16} /> พิมพ์ใบแจ้งชำระ</button>}<button className="primary-button pay-confirm-button pos-premium-confirm" disabled={checkoutMutation.isPending || (payConfirm === "หักบัญชีสมาชิก" && !!selectedMember && selectedMember.balance < payable) || (payConfirm === "เงินสด" && !cashSufficient) || (payConfirm === "QR / สแกน" && !qrVerified)} onClick={() => completePayment(payConfirm)}><Check size={16} /> {checkoutMutation.isPending ? "กำลังบันทึก…" : payConfirm === "เงินสด" && !cashSufficient ? "กรอกยอดรับเงินก่อน" : payConfirm === "QR / สแกน" && !qrVerified ? "ติ๊กตรวจสอบก่อน" : `ยืนยันการชำระเงิน ${money(payable)}`}</button></div></div></div>}{paymentNoticeOpen && payConfirm === "QR / สแกน" && <PaymentNotice storeName={settingsQuery.data?.storeName || "ร้านค้า"} total={payable} qr={payQrUrl} items={cart.map(item => ({ name: item.name, qty: item.qty }))} onClose={() => setPaymentNoticeOpen(false)} />}{shortcut && <div className="modal-backdrop" onClick={() => { if (walletStep !== "success") setShortcut(""); }}><div className="form-modal wallet-modal" role="dialog" aria-modal="true" aria-label={shortcutTitle} onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">{shortcut === "เติมเงิน" ? (walletStep === "success" ? "WALLET SLIP · DEPOSIT" : walletStep === "confirm" ? "CONFIRM · DEPOSIT" : "WALLET DEPOSIT") : shortcut === "ถอนเงิน" ? (walletStep === "success" ? "WALLET SLIP · WITHDRAWAL" : walletStep === "confirm" ? "CONFIRM · WITHDRAWAL" : "WALLET WITHDRAWAL") : "SPECIAL LINE ITEM"}</span><h2>{(shortcut === "เติมเงิน" || shortcut === "ถอนเงิน") && walletStep === "success" ? (shortcut === "เติมเงิน" ? "สลิปเติมเงิน" : "สลิปถอนเงิน") : shortcutTitle}</h2><p>{shortcut === SPECIAL_SHORTCUT ? "รายการตามจริง · ไม่ตัดสต็อก เช่น ของสั่ง ค่าบริการ" : walletStep === "form" ? "เลือกสมาชิกและระบุจำนวนเงิน · ระบบจะให้ยืนยันรายละเอียดก่อนบันทึกทุกครั้ง" : walletStep === "confirm" ? "ตรวจสอบให้ถูกต้อง — ยอดเงินจะยังไม่เข้า/ออกจากบัญชีสมาชิกจนกว่าจะกดยืนยัน" : "รายการถูกบันทึกลงประวัติธุรกรรมของสมาชิกเรียบร้อยแล้ว"}</p></div><button className="icon-button" onClick={() => { if (walletStep !== "success") setShortcut(""); }} aria-label="ปิดหน้าต่าง"><X size={17} /></button></div><div className="wallet-modal-body">{shortcut === SPECIAL_SHORTCUT && <div className="wallet-form special-form"><div className="wallet-heading"><span className="special-icon"><Sparkles size={16} /></span><div><b>เพิ่มรายการพิเศษเข้าบิล</b><small>สำหรับของสั่ง ค่าบริการ หรือรายการนอกแค็ตตาล็อก · ไม่ตัดสต็อก</small></div></div><label>ชื่อรายการ<input value={specialName} onChange={(event) => setSpecialName(event.target.value)} placeholder="เช่น ข้าวราดแกงนอกรายการ / ค่าฝากของ" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitSpecial(); } }} /></label><div className="special-grid"><label>ราคา/หน่วย (฿)<input type="number" min="0" step="0.01" value={specialPrice} onChange={(event) => setSpecialPrice(event.target.value)} placeholder="0.00" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitSpecial(); } }} /></label><label>จำนวน<input type="number" min="1" step="1" value={specialQty} onChange={(event) => setSpecialQty(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitSpecial(); } }} /></label><label>หน่วย<input value={specialUnit} onChange={(event) => setSpecialUnit(event.target.value)} placeholder="รายการ" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitSpecial(); } }} /></label></div><button className="primary-button" disabled={!(specialName.trim() && Number(specialPrice) > 0)} onClick={submitSpecial}><Plus size={16} /> เพิ่มเข้าบิล</button></div>}{(shortcut === "เติมเงิน" || shortcut === "ถอนเงิน") && walletStep === "form" && <div className="wallet-form"><div className="wallet-heading"><span>{shortcut === "เติมเงิน" ? <ArrowDownToLine size={16} /> : <ArrowUpFromLine size={16} />}</span><div><b>{shortcut === "เติมเงิน" ? "เติมเงินเข้าบัญชีสมาชิก" : "ถอนเงินจากบัญชีสมาชิก"}</b><small>ขั้นตอนที่ 1 จาก 2 · กรอกข้อมูล แล้วกด “ต่อไป” เพื่อตรวจสอบก่อนบันทึก</small></div></div><div className="wallet-picker-row"><MemberScanPicker members={members} selectedNumber={walletMemberNumber || selectedMemberNumber} onSelect={(member) => setWalletMemberNumber(member ? member.memberNumber : "")} placeholder="คีย์เลขสมาชิก หรือยิงบาร์โค้ด / คิวอาร์โค้ด" confirmContext="การเติม/ถอนเงินนี้" /></div><label>จำนวนเงิน (฿)<input type="number" min="0" step="0.01" value={walletAmount} onChange={(event) => setWalletAmount(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitWallet(); } }} placeholder="0.00" /></label><label>หมายเหตุ<input value={walletNote} onChange={(event) => setWalletNote(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitWallet(); } }} placeholder={shortcut === "เติมเงิน" ? "เช่น เติมเงินสดที่เคาน์เตอร์" : "เช่น ถอนเพื่อใช้จ่ายส่วนตัว"} /></label><button className="primary-button" disabled={!(Number(walletAmount) > 0) || !(walletMemberNumber || selectedMemberNumber)} onClick={submitWallet}><ShieldCheck size={16} /> ต่อไป: ตรวจสอบรายการ</button></div>}{(shortcut === "เติมเงิน" || shortcut === "ถอนเงิน") && walletStep === "confirm" && walletTarget && <div className="wallet-confirm"><div className="wallet-confirm-warning"><ShieldCheck size={16} /><span>ยอดเงินจะยังไม่ถูกบันทึกเข้าบัญชี จนกว่าจะกด “ยืนยันการทำรายการ”</span></div><div className="wallet-confirm-member"><MemberAvatar member={walletTarget} size={58} /><div><b>สมาชิก{memberFullName(walletTarget)}</b><small>เลขสมาชิก <i>{walletTarget.memberNumber}</i> · ประเภท {walletTarget.type}</small></div></div><div className="wallet-confirm-rows"><div><span>ประเภทรายการ</span><b className={shortcut === "เติมเงิน" ? "green-text" : "amber-text"}>{shortcut}</b></div><div><span>จำนวนเงิน</span><b>{money(Number(walletAmount))}</b></div><div><span>ยอดคงเหลือก่อนรายการ</span><b>{money(walletTarget.balance)}</b></div><div><span>ยอดคงเหลือหลังยืนยัน</span><b className={walletAfterPreview < 0 ? "red-text" : ""}>{money(walletAfterPreview)}</b></div><div><span>ผู้ทำรายการ</span><b>{cashier} · {actorRole}</b></div>{walletNote.trim() && <div><span>หมายเหตุ</span><b>{walletNote.trim()}</b></div>}{slipName && <div><span>หลักฐานแนบ</span><b><FileImage size={13} /> {slipName}</b></div>}</div>{walletAfterPreview < 0 && <div className="notice-bar error"><CircleAlert size={16} /> ยอดเงินคงเหลือไม่พอสำหรับถอนจำนวนนี้ — ลดจำนวนเงินหรือย้อนกลับแก้ไข<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="wallet-confirm-actions"><button className="outline-button" onClick={() => setWalletStep("form")}><RotateCcw size={15} /> ย้อนกลับแก้ไข</button><button className="primary-button" disabled={walletMutation.isPending || walletAfterPreview < 0} onClick={confirmWallet}><Check size={16} /> {walletMutation.isPending ? "กำลังบันทึก…" : "ยืนยันการทำรายการ"}</button></div></div>}{(shortcut === "เติมเงิน" || shortcut === "ถอนเงิน") && walletStep === "success" && walletResult && <div className="wallet-success"><div className="receipt-paper wallet-slip" id="wallet-slip"><div className="receipt-success slip"><span>{shortcut === "เติมเงิน" ? <ArrowDownToLine size={22} /> : <ArrowUpFromLine size={22} />}</span><div><b>{shortcut === "เติมเงิน" ? "เติมเงินสำเร็จ" : "ถอนเงินสำเร็จ"}</b><small>บันทึกลงรายการธุรกรรมของสมาชิกแล้ว</small></div></div><div className="receipt-divider" /><div className="receipt-meta"><span>{shortcut === "เติมเงิน" ? "ใบยืนยันการเติมเงิน" : "ใบยืนยันการถอนเงิน"}</span><b>{walletDoneAt ? slipTimeLabel(walletDoneAt) : ""}</b></div><div className="receipt-customer"><span>สมาชิก</span><b>{walletResult.memberName} · {walletResult.memberNumber}</b></div><div className="receipt-line"><span>{shortcut === "เติมเงิน" ? "จำนวนเงินที่เติม" : "จำนวนเงินที่ถอน"}</span><b>{money(walletResult.amount)}</b></div><div className="receipt-line"><span>ยอดคงเหลือก่อนรายการ</span><b>{money(walletResult.balanceBefore)}</b></div><div className="receipt-total"><span>ยอดคงเหลือหลังรายการ</span><b>{money(walletResult.balanceAfter)}</b></div><div className="receipt-payment"><span>ผู้ทำรายการ</span><b>{cashier} · {actorRole}</b></div><div className="receipt-thanks">บันทึกเข้าระบบเรียบร้อย ตรวจสอบยอดได้ที่เมนูรายงาน · ประวัติธุรกรรม<br /><small>ข้อมูลถูกบันทึกในระบบ Log แล้ว</small></div></div><div className="wallet-success-actions"><button className="outline-button" disabled={Boolean(walletSlipBusy)} onClick={() => void downloadWalletSlip("pdf")}><Download size={16} /> {walletSlipBusy === "pdf" ? "กำลังสร้าง PDF..." : "ดาวน์โหลด PDF"}</button><button className="outline-button" disabled={Boolean(walletSlipBusy)} onClick={() => void downloadWalletSlip("image")}><FileImage size={16} /> {walletSlipBusy === "image" ? "กำลังสร้างรูป..." : "ดาวน์โหลดรูปภาพ"}</button><button className="outline-button" onClick={() => setWalletPrintPreview(true)}><Printer size={16} /> พิมพ์สลิป</button><button className="primary-button" onClick={finishWallet}><Check size={16} /> เสร็จสิ้น · เริ่มรายการใหม่</button></div></div>}{(shortcut === "เติมเงิน" || shortcut === "ถอนเงิน") && walletStep !== "success" && <div className="slip-uploader"><div className="slip-heading"><span><FileImage size={16} /> หลักฐานการโอน / สลิป</span><small>ไม่บังคับ · เก็บไว้กับรายการเพื่อยืนยันย้อนหลัง</small></div>{slipPreview ? <div className="slip-preview"><img src={slipPreview} alt="ตัวอย่างสลิป" /><div><b>{slipName}</b><small>พร้อมแนบกับรายการ {shortcut}</small></div><button onClick={() => { setSlipPreview(""); setSlipName(""); setSlipDataUrl(""); }} title="ลบรูปสลิปออกจากรายการ"><X size={14} /></button></div> : <div className="slip-uploader-row"><label className="upload-drop" htmlFor="slip-upload"><Upload size={17} /><span><b>คลิกเพื่ออัปโหลดรูปสลิป</b><small>รองรับ JPG, PNG ขนาดไม่เกิน 10 MB</small></span><input id="slip-upload" type="file" accept="image/png,image/jpeg" onChange={(event) => { void handleSlip(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label><button type="button" className="outline-button compact slip-camera-btn" onClick={() => setSlipCameraOpen(true)} title="ถ่ายรูปสลิปจากกล้องเลย (มือถือ/แท็บเล็ต/เว็บแคม)"><Camera size={15} /> ถ่ายรูปสลิป</button></div>}</div>}</div><div className="wallet-modal-foot"><small>{(shortcut === "เติมเงิน" || shortcut === "ถอนเงิน") && walletStep !== "success" ? "Esc ย้อนหน้า · F2/F3/F4 สลับโหมด" : "Esc ปิดหน้าต่าง · F2/F3/F4 สลับโหมด"}</small><button type="button" className="outline-button" onClick={() => { if (walletStep === "success") finishWallet(); else setShortcut(""); }}>{(shortcut === "เติมเงิน" || shortcut === "ถอนเงิน") && walletStep === "success" ? "ปิดหน้าต่าง (ล้างรายการ)" : "ปิดหน้าต่าง"}</button></div></div></div>}{walletPrintPreview && walletResult && <PrintPreviewModal targetId="wallet-slip" title={shortcut === "เติมเงิน" ? "พรีวิวก่อนพิมพ์สลิปเติมเงิน" : "พรีวิวก่อนพิมพ์สลิปถอนเงิน"} subtitle={`${walletResult.memberName} · ${walletResult.memberNumber} · ${money(walletResult.amount)}`} paper="thermal" chips={[shortcut === "เติมเงิน" ? "เติมเงินเข้าบัญชีสมาชิก" : "ถอนเงินจากบัญชีสมาชิก", `คงเหลือ ${money(walletResult.balanceAfter)}`]} onClose={() => setWalletPrintPreview(false)} />}{cameraOpen && <BarcodeCameraModal open title="สแกนด้วยกล้อง" hint="เล็งบาร์โค้ดสินค้าหรือบัตรสมาชิก (คิวอาร์โค้ดก็ได้) — อ่านได้แล้วเข้าบิลให้ทันที ไม่ต้องมีปืนสแกน" onClose={() => setCameraOpen(false)} onDetect={(code) => { setCameraOpen(false); handleScanSubmit(code); }} />}{slipCameraOpen && <CameraCaptureModal open facing="environment" title="ถ่ายรูปสลิปหลักฐาน" hint="เล็งสลิปโอนเงิน/หน้าจอแจ้งเตือน แล้วกดถ่าย — รูปจะถูกเก็บไปกับรายการเติม/ถอนเงินนี้" onClose={() => setSlipCameraOpen(false)} onCapture={(dataUrl) => { setSlipDataUrl(dataUrl); setSlipName("ถ่ายจากกล้อง.jpg"); setSlipPreview(dataUrl); setMessage("ถ่ายสลิปเรียบร้อย · พร้อมบันทึกไปกับรายการ"); }} />}{paySlipCameraOpen && <CameraCaptureModal open facing="environment" title="ถ่ายรูปหลักฐานการชำระ" hint="เล็งสลิปโอนเงิน/หน้าจอจ่ายของลูกค้า แล้วกดถ่าย — รูปจะถูกเก็บไปกับบิลนี้" onClose={() => setPaySlipCameraOpen(false)} onCapture={(dataUrl) => { setPaySlip({ dataUrl, name: "ถ่ายจากกล้อง.jpg" }); setError(""); setMessage("ถ่ายหลักฐานการชำระเรียบร้อย · จะบันทึกไปกับบิลเมื่อกดยืนยัน"); }} />}{upgradeFeature && <EditionUpgradeModal open onClose={() => setUpgradeFeature(null)} status={edition.status} focusFeature={upgradeFeature} onApplied={() => void edition.refetch()} />}</>;
}
