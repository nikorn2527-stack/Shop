import { useEffect, useMemo, useRef, useState } from "react";
import { TRPCClientError } from "@trpc/client";
import {
  ArrowDownToLine, ArrowUpFromLine, Check, CircleAlert, CircleHelp, CreditCard, FileImage, Minus, Pause, Plus, QrCode, RotateCcw, ScanLine, Search, ShieldCheck, SlidersHorizontal, Sparkles, ShoppingCart, Trash2, Upload, UserPlus, WalletCards, X,
} from "lucide-react";
import type { CartItem, HeldBill, MemberLite, Product, Role } from "./pageData";
import { HELD_BILLS_LIMIT, addScannedItem, calculateCartSubtotal, loadHeldBills, money, scanMatches } from "./pageData";
import { ConfirmDialog, SectionHeader } from "./PagePrimitives";
import { ReceiptModal } from "@/components/ReceiptModal";
import { MemberScanPicker } from "@/components/ScanPickers";
import { trpc } from "@/lib/trpc";

/** Product row straight from trpc.product.list (backend SqliteProduct). */
type StoreProduct = Product & {
  sku: string;
  barcode: string | null;
  cost: number;
  reorderPoint: number;
  size: string | null;
  imageUrl: string | null;
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
};

type PaymentMethod = "เงินสด" | "QR / สแกน" | "หักบัญชีสมาชิก";

const SPECIAL_SHORTCUT = "สินค้าไม่ระบุตายตัว";

function getErrorMessage(error: unknown) {
  if (error instanceof TRPCClientError) return error.message;
  return "เกิดข้อผิดพลาดในการเชื่อมต่อระบบ กรุณาลองอีกครั้ง";
}

function holdTimeLabel(savedAt: number) {
  return new Date(savedAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

export function Pos({ shortcut, setShortcut, role, userName }: { shortcut: string; setShortcut: (value: string) => void; role: Role; userName: string }) {
  const utils = trpc.useUtils();
  const productsQuery = trpc.product.list.useQuery(undefined);
  const membersQuery = trpc.member.list.useQuery();
  // Store settings drive POS behavior: autoPrintReceipt fires window.print()
  // right after a successful checkout (passed to ReceiptModal), and
  // showBalanceOnReceipt is read inside ReceiptModal for every slip.
  const settingsQuery = trpc.settings.get.useQuery(undefined);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("ทั้งหมด");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedMemberNumber, setSelectedMemberNumber] = useState<string | null>(null);
  // Round 29 — member selection is a scan/key box (no more picking from a long
  // list), plus an on-the-spot "สมาชิกใหม่" register modal right inside the POS.
  const [newMemberOpen, setNewMemberOpen] = useState(false);
  const [newMemberForm, setNewMemberForm] = useState({ firstName: "", lastName: "", phone: "", initialDeposit: "" });
  const [newMemberError, setNewMemberError] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [slipPreview, setSlipPreview] = useState("");
  const [slipName, setSlipName] = useState("");
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receipt, setReceipt] = useState<CheckoutReceipt | null>(null);
  const [discount, setDiscount] = useState("0");
  const [walletAmount, setWalletAmount] = useState("");
  const [walletNote, setWalletNote] = useState("");
  const [walletMemberNumber, setWalletMemberNumber] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
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
  const cartPanelRef = useRef<HTMLElement | null>(null);
  // Round 21 — the bill pane's middle zone is the ONLY scroll area; ref it so
  // action forms (F2/F3/F4) can be scrolled into view the moment they open.
  const cartMidRef = useRef<HTMLDivElement | null>(null);
  const focusScan = () => {
    const input = scanRef.current;
    if (!input) return;
    input.focus();
    input.select();
  };
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
  })), [productsQuery.data]);
  const members = membersQuery.data ?? [];
  const selectedMember: MemberLite | null = members.find((member) => member.memberNumber === selectedMemberNumber) ?? null;
  const filtered = useMemo(() => products.filter((product) => (category === "ทั้งหมด" || product.category === category) && product.name.toLowerCase().includes(query.toLowerCase())), [category, products, query]);
  const sampleCodes = useMemo(() => products.filter((product) => product.barcode).slice(0, 3), [products]);
  const subtotal = calculateCartSubtotal(cart);
  const discountValue = Math.max(0, Number(discount) || 0);
  const payable = Math.max(0, subtotal - discountValue);
  const cashier = userName || "ผู้ใช้ระบบ";
  const actorRole = role === "admin" ? "ผู้บริหาร" : "เจ้าหน้าที่";
  const cartPieces = cart.reduce((sum, item) => sum + item.qty, 0);
  const shortcutTitle = shortcut === SPECIAL_SHORTCUT ? "เพิ่มรายการพิเศษ" : shortcut;
  const checkoutMutation = trpc.pos.checkout.useMutation({
    onSuccess: (result) => {
      setReceipt(result);
      setReceiptOpen(true);
      setError("");
      setMessage(`ชำระเงินสำเร็จด้วย${result.paymentMethod} · บิล ${result.orderNumber}`);
      if (settingsQuery.data?.autoPrintReceipt) setMessage(`ชำระเงินสำเร็จด้วย${result.paymentMethod} · บิล ${result.orderNumber} · สั่งพิมพ์ใบเสร็จอัตโนมัติแล้ว`);
    },
    onError: (mutationError) => setError(getErrorMessage(mutationError)),
  });
  const walletMutation = trpc.member.wallet.useMutation({
    onSuccess: (result) => {
      setShortcut("");
      setWalletAmount("");
      setWalletNote("");
      setWalletMemberNumber("");
      setError("");
      setMessage(`${result.type === "deposit" ? "เติมเงิน" : "ถอนเงิน"} ${result.memberNumber} · ${result.memberName} สำเร็จ · ยอดคงเหลือ ${money(result.balanceAfter)}`);
      void utils.member.list.invalidate();
      focusScan();
    },
    onError: (mutationError) => setError(getErrorMessage(mutationError)),
  });
  const newMemberMutation = trpc.member.register.useMutation({
    onSuccess: (result) => {
      setNewMemberOpen(false);
      setNewMemberForm({ firstName: "", lastName: "", phone: "", initialDeposit: "" });
      setNewMemberError("");
      setSelectedMemberNumber(result.member.memberNumber);
      setError("");
      setMessage(`ลงทะเบียนสมาชิก ${result.member.memberNumber} · สมาชิก${result.member.firstName} ${result.member.lastName} เรียบร้อย · เลือกในบิลนี้แล้ว`);
      void utils.member.list.invalidate();
      focusScan();
    },
    onError: (mutationError) => setNewMemberError(getErrorMessage(mutationError)),
  });
  const clearNotices = () => { setMessage(""); setError(""); };
  const addProduct = (product: Product) => {
    const store = products.find((item) => item.id === product.id);
    const currentQty = cart.find((item) => item.id === product.id)?.qty ?? 0;
    if (store && currentQty + 1 > store.stock) {
      setError(`สต็อกไม่พอ · ${product.name} เหลือ ${store.stock} ${store.unit}`);
      return;
    }
    setCart((items) => addScannedItem(items, product));
    clearNotices();
    setMessage(`เพิ่ม ${product.name} แล้ว · สแกนซ้ำเพื่อเพิ่มจำนวน`);
    focusScan();
  };
  const updateQty = (id: number, delta: number) => {
    if (delta > 0) {
      const store = products.find((item) => item.id === id);
      const current = cart.find((item) => item.id === id);
      if (store && current && current.qty + delta > store.stock) {
        setError(`สต็อกไม่พอ · ${store.name} เหลือ ${store.stock} ${store.unit}`);
        return;
      }
    }
    clearNotices();
    setCart((items) => items.flatMap((item) => item.id === id ? (item.qty + delta <= 0 ? [] : [{ ...item, qty: item.qty + delta }]) : [item]));
    focusScan();
  };
  // Quick picks (สินค้าไม่มีบาร์โค้ด) get their own stepper on the card itself —
  // the cashier can เพิ่ม/ลด directly on the grid without hunting the bill row.
  const qtyInBill = (id: number) => cart.find((item) => item.id === id)?.qty ?? 0;
  const bumpPick = (product: StoreProduct, delta: number) => {
    if (qtyInBill(product.id) === 0 && delta > 0) {
      addProduct(product);
      return;
    }
    updateQty(product.id, delta);
  };
  const runShortcut = (name: string) => { setShortcut(name); setMessage(`${name === SPECIAL_SHORTCUT ? "เพิ่มรายการพิเศษ" : name}: เปิดหน้าต่างทำรายการเรียบร้อย`); };
  // Enter in the scan hero = pull the trigger: an exact barcode/SKU match lands
  // in the bill instantly (scanner behaviour); otherwise typing filters the
  // quick-pick grid on the right and Enter picks it when exactly one is left.
  const handleScanSubmit = () => {
    const code = query.trim();
    if (!code) return;
    const exact = products.find((product) => scanMatches(product.barcode, code) || scanMatches(product.sku, code));
    if (exact) {
      addProduct(exact);
      setQuery("");
      focusScan();
      return;
    }
    if (filtered.length === 1) {
      addProduct(filtered[0]);
      setQuery("");
      focusScan();
      return;
    }
    if (filtered.length > 1) {
      setMessage(`พบ ${filtered.length} รายการสำหรับ "${code}" · เลือกจากแผงด้านขวา หรือยิงบาร์โค้ดเต็ม`);
      return;
    }
    setError(`ไม่พบสินค้าสำหรับ "${code}" · ลองยิงบาร์โค้ดจริง เช่น ${sampleCodes[0]?.barcode ?? "8850000000017"} หรือรหัส SKU เช่น DRK-001`);
  };
  const handleSlip = (file?: File) => { if (!file) return; setSlipName(file.name); setSlipPreview(URL.createObjectURL(file)); setMessage(`แนบสลิป ${file.name} แล้ว · พร้อมบันทึกไปกับรายการ`); };
  const completePayment = (method: PaymentMethod) => {
    if (cart.length === 0) return;
    if (discountValue > subtotal) { setError("ส่วนลดมากกว่ายอดรวมสินค้า"); return; }
    clearNotices();
    checkoutMutation.mutate({
      items: cart.map((item) => item.special
        ? { name: item.name, price: item.price, qty: item.qty, unit: item.unit }
        : { productId: item.id, qty: item.qty }),
      paymentMethod: method,
      memberNumber: selectedMember?.memberNumber ?? null,
      discount: discountValue,
      cashier,
      actorRole,
    });
  };
  const submitWallet = () => {
    const memberNumber = walletMemberNumber || selectedMemberNumber;
    if (!memberNumber) { setError("กรุณาเลือกสมาชิกก่อนบันทึกรายการ"); return; }
    const amount = Number(walletAmount);
    if (!(amount > 0)) { setError("กรุณาระบุจำนวนเงินมากกว่า 0"); return; }
    clearNotices();
    walletMutation.mutate({
      memberNumber,
      type: shortcut === "ถอนเงิน" ? "withdrawal" : "deposit",
      amount,
      note: walletNote.trim() || undefined,
      actor: cashier,
      actorRole,
    });
  };
  const submitNewMember = () => {
    const firstName = newMemberForm.firstName.trim();
    const lastName = newMemberForm.lastName.trim();
    if (!firstName || !lastName) { setNewMemberError("กรุณาระบุชื่อและนามสกุลสมาชิก"); return; }
    const initialDeposit = newMemberForm.initialDeposit.trim() === "" ? undefined : Number(newMemberForm.initialDeposit);
    if (initialDeposit !== undefined && !(initialDeposit > 0)) { setNewMemberError("เงินเริ่มต้นต้องมากกว่า 0"); return; }
    setNewMemberError("");
    newMemberMutation.mutate({
      firstName,
      lastName,
      phone: newMemberForm.phone.trim() || undefined,
      initialDeposit,
      actor: cashier,
      actorRole,
    });
  };
  const submitSpecial = () => {
    const name = specialName.trim();
    const price = Number(specialPrice);
    const qty = Math.max(1, Math.floor(Number(specialQty) || 1));
    const unit = specialUnit.trim() || "รายการ";
    if (!name) { setError("กรุณาระบุชื่อรายการพิเศษ"); return; }
    if (!(price > 0)) { setError("ราคาต่อหน่วยต้องมากกว่า 0"); return; }
    setCart((items) => [...items, { id: -(Date.now() + ++specialSeq.current), name, price, qty, unit, special: true }]);
    setSpecialName("");
    setSpecialPrice("");
    setSpecialQty("1");
    setSpecialUnit("รายการ");
    clearNotices();
    setMessage(`เพิ่มรายการพิเศษ ${name} · ${qty} ${unit} · ${money(price * qty)} แล้ว`);
    setShortcut("");
    focusScan();
  };
  // พักบิล: park the current bill on this device, then start fresh — the
  // cashier swaps between customers without losing a half-built bill.
  const holdBill = () => {
    if (cart.length === 0) {
      if (heldBills.length > 0) setMessage(`มีบิลที่ถูกพักอยู่ ${heldBills.length} บิล · เรียกคืนได้จากแถบใต้ช่องสแกน`);
      else setError("ยังไม่มีรายการในบิลปัจจุบันที่จะพักไว้");
      return;
    }
    if (heldBills.length >= HELD_BILLS_LIMIT) {
      setError(`พักบิลได้สูงสุด ${HELD_BILLS_LIMIT} บิล · เรียกคืนหรือยกเลิกบิลที่พักไว้ก่อน`);
      return;
    }
    setHeldBills((bills) => [...bills, { id: Date.now(), savedAt: Date.now(), items: cart, discount, memberNumber: selectedMemberNumber }]);
    setCart([]);
    setDiscount("0");
    setSelectedMemberNumber(null);
    clearNotices();
    setMessage(`พักบิลแล้ว (${cartPieces} ชิ้น · ${money(payable)}) · กดบิลที่พักใต้ช่องสแกนเพื่อเรียกคืน`);
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
    focusScan();
  };
  const discardHeld = (id: number) => {
    setHeldBills((bills) => bills.filter((entry) => entry.id !== id));
    setMessage("ยกเลิกบิลที่พักไว้แล้ว");
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
    clearNotices();
    setMessage("เริ่มรายการขายใหม่แล้ว");
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
  const idleStatus = cart.length === 0
    ? "พร้อมรับรายการ · ยิงบาร์โค้ดที่ช่องด้านบน หรือกดสินค้าจากแผงด้านขวา"
    : "ตรวจรายการแล้วกดชำระเงินด้านล่าง · F2 เติมเงิน · F3 ถอนเงิน · F4 รายการพิเศษ";
  // Parked bills persist on this device; announce the count so the Home rail
  // badge (⏸️) stays in sync with what POS is holding.
  useEffect(() => {
    try { localStorage.setItem("png-held-bills-v1", JSON.stringify(heldBills)); } catch { /* storage full/blocked — park-in-session only */ }
    window.dispatchEvent(new CustomEvent("pos-held", { detail: heldBills.length }));
  }, [heldBills]);
  // Thin left rail (Home) talks to POS through window events: scan focus,
  // member picker, hold bill. Fresh-closure effect — no stale handlers.
  useEffect(() => {
    const onRail = (event: Event) => {
      const action = (event as CustomEvent<string>).detail;
      if (action === "scan") focusScan();
      else if (action === "member") document.getElementById("pos-member-input")?.focus();
      else if (action === "hold") holdBill();
    };
    window.addEventListener("pos-rail", onRail);
    return () => window.removeEventListener("pos-rail", onRail);
  });
  // F2/F3/F4 — action forms open as MODALS (user mandate): they overlay
  // the bill instead of pushing rows around; the first field autofocuses.
  useEffect(() => {
    if (!shortcut) return;
    const timer = window.setTimeout(() => {
      const first = document.querySelector<HTMLDivElement>(".wallet-modal")?.querySelector<HTMLInputElement | HTMLSelectElement>("input, select");
      first?.focus();
    }, 40);
    return () => window.clearTimeout(timer);
  }, [shortcut]);
  // Real keyboard shortcuts for the quick actions (labels have advertised
  // F2/F3/F4 since round 14 — now they actually fire). Esc unwinds one step.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "F2") { event.preventDefault(); setShortcut(shortcut === "เติมเงิน" ? "" : "เติมเงิน"); return; }
      if (event.key === "F3") { event.preventDefault(); setShortcut(shortcut === "ถอนเงิน" ? "" : "ถอนเงิน"); return; }
      if (event.key === "F4") { event.preventDefault(); setShortcut(shortcut === SPECIAL_SHORTCUT ? "" : SPECIAL_SHORTCUT); return; }
      if (event.key === "Escape" && !receiptOpen) {
        if (newMemberOpen) { setNewMemberOpen(false); return; }
        if (shortcut) { setShortcut(""); return; }
        if (query) { setQuery(""); }
        focusScan();
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
  return <>
    <SectionHeader eyebrow="หน้าร้าน / จุดขายสินค้า" title="POS · ขายสินค้า" description="สแกนบาร์โค้ดที่ช่องด้านบน · สินค้าไม่มีบาร์โค้ดปรับจำนวนได้ที่การ์ดด้านขวา · สรุปยอดและปุ่มชำระเงินล็อคอยู่ด้านล่างตลอดเวลา" action={<div className="pos-status"><span className="live-dot" /> จุดขายที่ 01 · เปิดให้บริการ</div>} />
    <div className="pos-layout">
      <section className="panel cart-panel" ref={cartPanelRef}>
        <div className="pos-head">
        <div className="scan-hero">
          <ScanLine size={22} className="scan-hero-icon" />
          <input ref={scanRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); handleScanSubmit(); } }} placeholder="สแกนบาร์โค้ด / ชื่อสินค้า แล้วกด Enter · ยิงซ้ำ = เพิ่มจำนวน…" autoFocus aria-label="ช่องสแกนบาร์โค้ดและค้นหาสินค้า" />
          {query ? <button type="button" className="scan-clear" onClick={() => { setQuery(""); focusScan(); }} aria-label="ล้างคำค้นหา"><X size={15} /></button> : <span className="scan-live"><span className="live-dot" /> พร้อมสแกน</span>}
          <kbd>Enter</kbd>
        </div>
        <div className="member-select-wrap"><MemberScanPicker members={members} selectedNumber={selectedMemberNumber} onSelect={(member) => { setSelectedMemberNumber(member ? member.memberNumber : null); clearNotices(); focusScan(); }} onNewMember={() => { setNewMemberOpen(true); setNewMemberError(""); }} inputId="pos-member-input" /></div>
        </div>
        <div className="cart-mid" ref={cartMidRef}>
        {heldBills.length > 0 && <div className="held-chips" aria-label="บิลที่ถูกพักไว้">{heldBills.map((bill) => <div className="held-chip" key={bill.id}><Pause size={13} /><b>{bill.items.reduce((sum, item) => sum + item.qty, 0)} ชิ้น</b><time>{holdTimeLabel(bill.savedAt)}</time><button type="button" className="chip-restore" onClick={() => restoreHeld(bill.id)} aria-label="เรียกคืนบิลที่พักไว้" title="เรียกคืนบิลนี้"><RotateCcw size={14} /></button><button type="button" className="chip-discard" onClick={() => discardHeld(bill.id)} aria-label="ยกเลิกบิลที่พักไว้" title="ยกเลิกบิลนี้"><X size={13} /></button></div>)}</div>}
        <div className="cart-heading"><div><h2>รายการขาย · บิลปัจจุบัน</h2><p>{cartPieces} ชิ้น · {cart.length} แถว</p></div><button className="icon-button" onClick={() => setCancelOpen(true)} title="ยกเลิกรายการขาย"><Trash2 size={17} /></button></div>
        <div className="cart-items">{cart.length === 0 ? <div className="empty-cart"><ScanLine size={26} /><b>ยังไม่มีสินค้าในบิล</b><span>ยิงบาร์โค้ดที่ช่องด้านบน หรือกดสินค้าจากแผงด้านขวา</span></div> : <><div className="cart-items-head"><span>รายการ</span><span>จำนวน</span><span>ราคา/หน่วย</span><span>รวม</span></div>{cart.map((item) => <div className="cart-item" key={item.id}><b className="cart-item-name" title={item.name}>{item.special && <i className="special-tag">พิเศษ</i>}{item.name}</b><div className="qty-control"><button aria-label={`ลดจำนวน ${item.name}`} onClick={() => updateQty(item.id, -1)}><Minus size={12} /></button><span>{item.qty}</span><button aria-label={`เพิ่มจำนวน ${item.name}`} onClick={() => updateQty(item.id, 1)}><Plus size={12} /></button></div><span className="cart-item-unit" title={`${money(item.price)} / ${item.unit}`}>{money(item.price)}</span><strong className="cart-item-amount">{money(item.price * item.qty)}</strong></div>)}</>}</div></div>
        <div className="cart-foot"><div className="cart-totals"><div><span>ยอดรวมสินค้า</span><strong>{money(subtotal)}</strong></div><div><span>ส่วนลดสมาชิก</span><strong className="discount discount-edit">- ฿<input type="number" min="0" step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)} aria-label="ส่วนลด (บาท)" /></strong></div><div className="total-line"><span>ยอดที่ต้องชำระ</span><strong>{money(payable)}</strong></div></div><div className="payment-actions"><button className="pay-button member-pay" disabled={payDisabled} onClick={() => selectedMember ? completePayment("หักบัญชีสมาชิก") : setError("กรุณาเลือกสมาชิกก่อนชำระแบบหักบัญชี")}><CreditCard size={18} /> หักบัญชีสมาชิก</button><div className="pay-split"><button disabled={payDisabled} onClick={() => completePayment("เงินสด")}><span className="pay-icon cash"><WalletCards size={16} /></span> เงินสด</button><button disabled={payDisabled} onClick={() => completePayment("QR / สแกน")}><span className="pay-icon qr"><QrCode size={16} /></span> QR / สแกน</button></div></div>{role === "admin" && <div className="admin-pos-note"><Sparkles size={14} /><span>ผู้บริหารสามารถแก้ไขราคา/ตรวจสอบรายการก่อนปิดบิล</span></div>}<div className={`cart-status-line${error ? " error" : message ? " ok" : ""}`} role="status" aria-live="polite">{error ? <><CircleAlert size={14} /> <span className="cart-status-text">{error}</span> <button onClick={() => setError("")} aria-label="ปิดข้อความแจ้งเหตุ"><X size={13} /></button></> : message ? <><Check size={14} /> <span className="cart-status-text">{message}</span></> : <><span className="live-dot" /> <span className="cart-status-text">{idleStatus}</span></>}</div></div>
      </section>
      <aside className="panel product-panel quick-pick-panel">
        <div className="quick-pick-head"><div><h2>สินค้าไม่มีบาร์โค้ด</h2><p>กดการ์ดหรือปุ่ม + เพื่อเพิ่ม · ปรับลดจำนวนได้ที่ปุ่ม − + บนการ์ด</p></div><span className="quick-pick-count">{filtered.length} รายการ</span></div>
        <div className="category-tabs">{["ทั้งหมด", "อาหาร", "เครื่องดื่ม", "ของใช้"].map((item) => <button className={category === item ? "active" : ""} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div>
        <div className="product-scroll">{productsQuery.isLoading ? <div className="product-grid" aria-busy="true">{Array.from({ length: 6 }, (_, index) => <div aria-hidden="true" className="product-card skeleton-card" key={`skeleton-${index}`}><div className="product-art"><span className="skeleton-avatar" /></div><div className="product-card-info"><span className="skeleton-cell-w" /><span className="skeleton-cell-n" /><span className="skeleton-price" /></div></div>)}</div> : productsQuery.isError ? <div className="inline-message error"><CircleAlert size={15} /> โหลดรายการสินค้าไม่สำเร็จ · {getErrorMessage(productsQuery.error)}</div> : filtered.length === 0 ? <div className="pos-loading"><Search size={26} /><b>ไม่พบสินค้าตามเงื่อนไข</b><span>ลองเปลี่ยนคำค้นหาหรือหมวดหมู่</span></div> : <div className="product-grid">{filtered.map((product) => <div className={`product-card${qtyInBill(product.id) > 0 ? " in-bill" : ""}`} key={product.id} role="button" tabIndex={0} aria-label={`เพิ่ม ${product.name} เข้าบิล`} onClick={() => addProduct(product)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); addProduct(product); } }}><div className={`product-art ${product.color}`}>{product.imageUrl ? <img className="product-art-img" src={product.imageUrl} alt="" /> : <span>{product.emoji}</span>}{product.stock <= 10 && <i>เหลือ {product.stock}</i>}{qtyInBill(product.id) > 0 && <b className="pick-qty-badge">{qtyInBill(product.id)}</b>}</div><div className="product-card-info"><b>{product.name}</b><small>{product.size ? `${product.size} · ` : ""}{product.unit} · คงเหลือ {product.stock}</small><strong>{money(product.price)}</strong></div><div className="pick-stepper" onClick={(event) => event.stopPropagation()}><button type="button" aria-label={`ลดจำนวน ${product.name} ในบิล`} disabled={qtyInBill(product.id) === 0} onClick={() => bumpPick(product, -1)}><Minus size={13} /></button><span className={qtyInBill(product.id) === 0 ? "pick-qty zero" : "pick-qty"} aria-label={`จำนวน ${product.name} ในบิล`}>{qtyInBill(product.id)}</span><button type="button" aria-label={`เพิ่มจำนวน ${product.name} ในบิล`} disabled={product.stock <= 0 || qtyInBill(product.id) >= product.stock} onClick={() => bumpPick(product, 1)}><Plus size={13} /></button></div></div>)}</div>}</div>
        <div className="pos-help"><CircleHelp size={15} /><span>ตัวอย่างบาร์โค้ด {sampleCodes[0]?.barcode ?? "8850000000017"} · รหัส SKU เช่น DRK-001 · สแกนซ้ำเพื่อเพิ่มจำนวน</span></div>
      </aside>
    </div>
    <div className="shortcut-strip"><button onClick={() => runShortcut("เติมเงิน")}><ArrowDownToLine size={17} /><span>เติมเงิน</span><kbd>F2</kbd></button><button onClick={() => runShortcut("ถอนเงิน")}><ArrowUpFromLine size={17} /><span>ถอนเงิน</span><kbd>F3</kbd></button><button onClick={() => runShortcut(SPECIAL_SHORTCUT)}><SlidersHorizontal size={17} /><span>รายการพิเศษ</span><kbd>F4</kbd></button><button onClick={holdBill} className="strip-hold"><Pause size={17} /><span>พักบิล</span>{heldBills.length > 0 && <i className="dock-badge">{heldBills.length}</i>}</button></div>
    {cart.length > 0 && !receiptOpen && <div className="pos-mobile-bar"><span className="pos-mobile-count"><ShoppingCart size={15} /> {cartPieces} รายการ</span><strong>{money(payable)}</strong><button onClick={() => cartPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}><CreditCard size={16} /> ชำระเงิน</button></div>}
    {receiptOpen && receipt && <ReceiptModal receipt={receipt} onClose={startNewSale} onNewSale={startNewSale} onPrinted={() => setMessage("ส่งใบเสร็จไปพิมพ์แล้ว")} autoPrint={settingsQuery.data?.autoPrintReceipt === true} />}<ConfirmDialog open={cancelOpen} title="ยืนยันการยกเลิกรายการขาย?" description="สินค้าที่อยู่ในบิลนี้จะถูกล้างออก และยังไม่บันทึกเป็นธุรกรรม (บิลที่พักไว้จะไม่ถูกกระทบ)" confirmLabel="ยืนยันยกเลิกบิล" onCancel={() => setCancelOpen(false)} onConfirm={() => { setCart([]); setCancelOpen(false); setMessage("ยกเลิกรายการขายแล้ว"); }} />{newMemberOpen && <div className="modal-backdrop" onClick={() => setNewMemberOpen(false)}><div className="form-modal" role="dialog" aria-modal="true" aria-label="ลงทะเบียนสมาชิกใหม่" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">NEW MEMBER · POS</span><h2>สมาชิกใหม่</h2><p>ลงทะเบียนที่เคาน์เตอร์ได้ทันที · หมายเลขสมาชิกรันอัตโนมัติตามการตั้งค่า · บันทึกเสร็จระบบเลือกสมาชิกไว้ในบิลนี้ให้ทันที</p></div><button className="icon-button" onClick={() => setNewMemberOpen(false)} aria-label="ปิดหน้าต่าง"><X size={17} /></button></div><div className="form-grid compact-form"><label>ชื่อ *<input autoFocus value={newMemberForm.firstName} onChange={(event) => setNewMemberForm({ ...newMemberForm, firstName: event.target.value })} placeholder="เช่น สมศรี" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitNewMember(); } }} /></label><label>นามสกุล *<input value={newMemberForm.lastName} onChange={(event) => setNewMemberForm({ ...newMemberForm, lastName: event.target.value })} placeholder="เช่น ใจดี" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitNewMember(); } }} /></label><label className="wide">เบอร์โทรศัพท์<input value={newMemberForm.phone} onChange={(event) => setNewMemberForm({ ...newMemberForm, phone: event.target.value })} placeholder="ไม่บังคับ · เช่น 08x-xxx-xxxx" inputMode="tel" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitNewMember(); } }} /></label><label>เงินเริ่มต้น (฿)<input type="number" min="0" step="0.01" value={newMemberForm.initialDeposit} onChange={(event) => setNewMemberForm({ ...newMemberForm, initialDeposit: event.target.value })} placeholder="ไม่บังคับ · 0.00" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitNewMember(); } }} /></label></div><div className="initial-balance-note"><ShieldCheck size={15} /> หมายเลขสมาชิกออกตามรูปแบบที่ผู้บริหารตั้งไว้ในเมนูตั้งค่า · การลงทะเบียนบันทึกลงระบบทันที</div>{newMemberError && <div className="notice-bar error"><CircleAlert size={16} /> {newMemberError}<button onClick={() => setNewMemberError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={() => setNewMemberOpen(false)}>ยกเลิก</button><button className="primary-button" disabled={newMemberMutation.isPending} onClick={submitNewMember}><UserPlus size={16} /> {newMemberMutation.isPending ? "กำลังบันทึก…" : "บันทึกและใช้ในบิลนี้"}</button></div></div></div>}{shortcut && <div className="modal-backdrop" onClick={() => setShortcut("")}><div className="form-modal wallet-modal" role="dialog" aria-modal="true" aria-label={shortcutTitle} onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">{shortcut === "เติมเงิน" ? "WALLET DEPOSIT" : shortcut === "ถอนเงิน" ? "WALLET WITHDRAWAL" : "SPECIAL LINE ITEM"}</span><h2>{shortcutTitle}</h2><p>{shortcut === "เติมเงิน" ? "เลือกสมาชิกและระบุจำนวนเงิน · รายการบันทึกลงบัญชีและตารางทันที" : shortcut === "ถอนเงิน" ? "ระบุจำนวนเงินและหมายเหตุ · แนบสลิปหลักฐานได้" : "รายการตามจริง · ไม่ตัดสต็อก เช่น ของชั่ง ค่าบริการ"}</p></div><button className="icon-button" onClick={() => setShortcut("")} aria-label="ปิดหน้าต่าง"><X size={17} /></button></div><div className="wallet-modal-body">{shortcut === SPECIAL_SHORTCUT && <div className="wallet-form special-form"><div className="wallet-heading"><span className="special-icon"><Sparkles size={16} /></span><div><b>เพิ่มรายการพิเศษเข้าบิล</b><small>สำหรับของชั่ง ค่าบริการ หรือรายการนอกแค็ตตาล็อก · ไม่ตัดสต็อก</small></div></div><label>ชื่อรายการ<input value={specialName} onChange={(event) => setSpecialName(event.target.value)} placeholder="เช่น ข้าวราดแกงนอกรายการ / ค่าฝากของ" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitSpecial(); } }} /></label><div className="special-grid"><label>ราคา/หน่วย (฿)<input type="number" min="0" step="0.01" value={specialPrice} onChange={(event) => setSpecialPrice(event.target.value)} placeholder="0.00" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitSpecial(); } }} /></label><label>จำนวน<input type="number" min="1" step="1" value={specialQty} onChange={(event) => setSpecialQty(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitSpecial(); } }} /></label><label>หน่วย<input value={specialUnit} onChange={(event) => setSpecialUnit(event.target.value)} placeholder="รายการ" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitSpecial(); } }} /></label></div><button className="primary-button" disabled={!(specialName.trim() && Number(specialPrice) > 0)} onClick={submitSpecial}><Plus size={16} /> เพิ่มเข้าบิล</button></div>}{(shortcut === "เติมเงิน" || shortcut === "ถอนเงิน") && <div className="wallet-form"><div className="wallet-heading"><span>{shortcut === "เติมเงิน" ? <ArrowDownToLine size={16} /> : <ArrowUpFromLine size={16} />}</span><div><b>{shortcut === "เติมเงิน" ? "เติมเงินเข้าบัญชีสมาชิก" : "ถอนเงินจากบัญชีสมาชิก"}</b><small>บันทึกธุรกรรมลงบัญชีจริงทันที</small></div></div><div className="wallet-picker-row"><MemberScanPicker members={members} selectedNumber={walletMemberNumber || selectedMemberNumber} onSelect={(member) => setWalletMemberNumber(member ? member.memberNumber : "")} placeholder="คีย์เลขสมาชิก หรือยิงบาร์โค้ด / คิวอาร์โค้ด" /></div><label>จำนวนเงิน (฿)<input type="number" min="0" step="0.01" value={walletAmount} onChange={(event) => setWalletAmount(event.target.value)} placeholder="0.00" /></label><label>หมายเหตุ<input value={walletNote} onChange={(event) => setWalletNote(event.target.value)} placeholder={shortcut === "เติมเงิน" ? "เช่น เติมเงินสดที่เคาน์เตอร์" : "เช่น ถอนเพื่อใช้จ่ายส่วนตัว"} /></label><button className="primary-button" disabled={walletMutation.isPending || !(Number(walletAmount) > 0) || !(walletMemberNumber || selectedMemberNumber)} onClick={submitWallet}><Check size={16} /> {walletMutation.isPending ? "กำลังบันทึก…" : `บันทึก${shortcut}`}</button></div>}{(shortcut === "เติมเงิน" || shortcut === "ถอนเงิน") && <div className="slip-uploader"><div className="slip-heading"><span><FileImage size={16} /> หลักฐานการโอน / สลิป</span><small>ไม่บังคับ</small></div>{slipPreview ? <div className="slip-preview"><img src={slipPreview} alt="ตัวอย่างสลิป" /><div><b>{slipName}</b><small>พร้อมแนบกับรายการ {shortcut}</small></div><button onClick={() => { setSlipPreview(""); setSlipName(""); }}><X size={14} /></button></div> : <label className="upload-drop" htmlFor="slip-upload"><Upload size={17} /><span><b>คลิกเพื่ออัปโหลดรูปสลิป</b><small>รองรับ JPG, PNG ขนาดไม่เกิน 10 MB</small></span><input id="slip-upload" type="file" accept="image/png,image/jpeg" onChange={(event) => handleSlip(event.target.files?.[0])} /></label>}</div>}</div><div className="wallet-modal-foot"><small>Esc ปิดหน้าต่าง · F2/F3/F4 สลับโหมด</small><button type="button" className="outline-button" onClick={() => setShortcut("")}>ปิดหน้าต่าง</button></div></div></div>}</>;
}
