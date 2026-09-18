import { useMemo, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { TRPCClientError } from "@trpc/client";
import {
  Activity, ArrowDownToLine, ArrowUpFromLine, BarChart3, Bell, Camera, Crown, Boxes, CalendarDays, Check, ChevronDown, CircleAlert, CircleHelp, ClipboardList, CreditCard, Download, FileBarChart, FileImage, LayoutDashboard, Menu, Minus, LockKeyhole, MoreHorizontal, PackagePlus, PackageSearch, Plus, Printer, QrCode, ReceiptText, RotateCcw, Search, ScanLine, Settings2, ShieldCheck, ShoppingBag, ShoppingCart, SlidersHorizontal, Trash2, Upload, UserCircle2, UsersRound, WalletCards, X,
} from "lucide-react";
import type { CartItem, MemberLite, Product, Role } from "./pageData";
import { addScannedItem, calculateCartSubtotal, money } from "./pageData";
import { ConfirmDialog, SectionHeader } from "./PagePrimitives";
import { trpc } from "@/lib/trpc";

/** Product row straight from trpc.product.list (backend SqliteProduct). */
type StoreProduct = Product & {
  sku: string;
  barcode: string | null;
  cost: number;
  reorderPoint: number;
};

type CheckoutReceipt = {
  orderNumber: string;
  createdAt: string;
  items: { productId: number; name: string; unit: string; qty: number; price: number; amount: number }[];
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: string;
  memberNumber: string | null;
  memberName: string | null;
  balanceAfter: number | null;
};

type PaymentMethod = "เงินสด" | "QR / สแกน" | "หักบัญชีสมาชิก";

function getErrorMessage(error: unknown) {
  if (error instanceof TRPCClientError) return error.message;
  return "เกิดข้อผิดพลาดในการเชื่อมต่อระบบ กรุณาลองอีกครั้ง";
}

/** "2026-09-18 14:42:33" → "18 ก.ย. 2569 · 14:42 น." */
function formatReceiptDateTime(value: string) {
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" })} · ${date.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })} น.`;
}

export function Pos({ shortcut, setShortcut, role }: { shortcut: string; setShortcut: (value: string) => void; role: Role }) {
  const utils = trpc.useUtils();
  const productsQuery = trpc.product.list.useQuery(undefined);
  const membersQuery = trpc.member.list.useQuery();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("ทั้งหมด");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedMemberNumber, setSelectedMemberNumber] = useState<string | null>(null);
  const [memberMenuOpen, setMemberMenuOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [slipPreview, setSlipPreview] = useState("");
  const [slipName, setSlipName] = useState("");
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receipt, setReceipt] = useState<CheckoutReceipt | null>(null);
  const [discount, setDiscount] = useState("0");
  const [walletAmount, setWalletAmount] = useState("");
  const [walletNote, setWalletNote] = useState("");
  const [walletMemberNumber, setWalletMemberNumber] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [receiptBusy, setReceiptBusy] = useState("");
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
  })), [productsQuery.data]);
  const members = membersQuery.data ?? [];
  const selectedMember: MemberLite | null = members.find((member) => member.memberNumber === selectedMemberNumber) ?? null;
  const filtered = useMemo(() => products.filter((product) => (category === "ทั้งหมด" || product.category === category) && product.name.toLowerCase().includes(query.toLowerCase())), [category, products, query]);
  const sampleCodes = useMemo(() => products.filter((product) => product.barcode).slice(0, 3), [products]);
  const subtotal = calculateCartSubtotal(cart);
  const discountValue = Math.max(0, Number(discount) || 0);
  const payable = Math.max(0, subtotal - discountValue);
  const cashier = role === "admin" ? "วรพจน์ ด." : "กัญญาณัฐ พ.";
  const actorRole = role === "admin" ? "ผู้บริหาร" : "เจ้าหน้าที่";
  const checkoutMutation = trpc.pos.checkout.useMutation({
    onSuccess: (result) => {
      setReceipt(result);
      setReceiptOpen(true);
      setError("");
      setMessage(`ชำระเงินสำเร็จด้วย${result.paymentMethod} · บิล ${result.orderNumber}`);
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
    },
    onError: (mutationError) => setError(getErrorMessage(mutationError)),
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
  };
  const runShortcut = (name: string) => { setShortcut(name); setMessage(`${name}: เปิดช่องทำรายการเรียบร้อย`); };
  const simulateScan = (value = barcode) => {
    const code = value.trim();
    const match = products.find((product) => (product.barcode && product.barcode === code) || product.sku === code);
    if (!match) {
      setError(`ไม่พบสินค้าในรหัส ${code || "ที่ระบุ"} · ลองใช้บาร์โค้ดจริง เช่น ${sampleCodes[0]?.barcode ?? "8850000000017"} หรือรหัส SKU เช่น DRK-001`);
      return;
    }
    addProduct(match);
    setBarcode("");
    setScanOpen(false);
  };
  const handleSlip = (file?: File) => { if (!file) return; setSlipName(file.name); setSlipPreview(URL.createObjectURL(file)); setMessage(`แนบสลิป ${file.name} แล้ว · พร้อมบันทึกไปกับรายการ`); };
  const completePayment = (method: PaymentMethod) => {
    if (cart.length === 0) return;
    if (discountValue > subtotal) { setError("ส่วนลดมากกว่ายอดรวมสินค้า"); return; }
    clearNotices();
    checkoutMutation.mutate({
      items: cart.map((item) => ({ productId: item.id, qty: item.qty })),
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
  };
  const downloadReceipt = async (format: "pdf" | "image") => {
    const element = document.getElementById("receipt-paper");
    if (!element || !receipt) return;
    setReceiptBusy(format);
    try {
      const canvas = await html2canvas(element, { scale: 2, backgroundColor: "#ffffff" });
      const filename = `${receipt.orderNumber}.${format === "pdf" ? "pdf" : "png"}`;
      if (format === "image") {
        const link = document.createElement("a");
        link.download = filename;
        link.href = canvas.toDataURL("image/png");
        link.click();
      } else {
        const pdf = new jsPDF({ orientation: "portrait", unit: "px", format: [canvas.width, canvas.height] });
        pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, canvas.width, canvas.height);
        pdf.save(filename);
      }
      setMessage(`ดาวน์โหลดใบเสร็จ ${format === "pdf" ? "PDF" : "รูปภาพ"} แล้ว`);
    } finally { setReceiptBusy(""); }
  };
  const payDisabled = cart.length === 0 || checkoutMutation.isPending;
  return <>
    <SectionHeader eyebrow="หน้าร้าน / จุดขายสินค้า" title="POS · ขายสินค้า" description="สแกนบาร์โค้ดหรือค้นหาสินค้า แล้วเลือกวิธีชำระเงินที่ต้องการ" action={<div className="pos-status"><span className="live-dot" /> จุดขายที่ 01 · เปิดให้บริการ</div>} />
    <div className="pos-layout">
      <section className="panel product-panel"><div className="pos-search-row"><div className="search-field large"><Search size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาชื่อสินค้า หรือสแกนบาร์โค้ด..." autoFocus /><kbd>⌘ K</kbd></div><button className="scan-button" onClick={() => { setScanOpen(true); setMessage("เปิดกล้องจำลองแล้ว · เลือกหรือพิมพ์รหัสบาร์โค้ด"); }}><ScanLine size={18} /> สแกน</button></div><div className="scan-status-strip"><div className="scan-status-icon"><Camera size={17} /></div><div><b>เครื่องสแกนพร้อมใช้งาน</b><small>จำลองการอ่านบาร์โค้ด · กด “สแกน” เพื่อเปิดหน้าต่าง</small></div><span className="live-dot" /></div><div className="category-tabs">{["ทั้งหมด", "อาหาร", "เครื่องดื่ม", "ของใช้"].map((item) => <button className={category === item ? "active" : ""} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div>{productsQuery.isLoading ? <div className="pos-loading"><ShoppingBag size={28} /><b>กำลังโหลดสินค้าจากระบบ</b><span>เชื่อมต่อฐานข้อมูลสวัสดิการ</span></div> : productsQuery.isError ? <div className="inline-message error"><CircleAlert size={15} /> โหลดรายการสินค้าไม่สำเร็จ · {getErrorMessage(productsQuery.error)}</div> : filtered.length === 0 ? <div className="pos-loading"><Search size={26} /><b>ไม่พบสินค้าตามเงื่อนไข</b><span>ลองเปลี่ยนคำค้นหาหรือหมวดหมู่</span></div> : <div className="product-grid">{filtered.map((product) => <button className="product-card" key={product.id} onClick={() => addProduct(product)}><div className={`product-art ${product.color}`}><span>{product.emoji}</span>{product.stock <= 10 && <i>เหลือ {product.stock}</i>}</div><div className="product-card-info"><b>{product.name}</b><small>{product.unit} · คงเหลือ {product.stock}</small><strong>{money(product.price)}</strong></div><span className="add-product"><Plus size={15} /></span></button>)}</div>}<div className="pos-help"><CircleHelp size={16} /><span>สแกนสินค้าเดิมซ้ำได้ทันทีเพื่อเพิ่มจำนวน · กดที่สินค้าเพื่อเพิ่ม 1 ชิ้น</span></div></section>
      <aside className="panel cart-panel"><div className="cart-heading"><div><h2>รายการขาย</h2><p>{cart.reduce((sum, item) => sum + item.qty, 0)} รายการ · บิลใหม่</p></div><button className="icon-button" onClick={() => setCancelOpen(true)} title="ยกเลิกรายการขาย"><Trash2 size={17} /></button></div>{shortcut && <div className="shortcut-banner"><span className="shortcut-banner-icon">{shortcut === "เติมเงิน" ? <ArrowDownToLine size={17} /> : shortcut === "ถอนเงิน" ? <ArrowUpFromLine size={17} /> : <SlidersHorizontal size={17} />}</span><div><b>{shortcut}</b><small>{shortcut === "เติมเงิน" ? "เลือกสมาชิกและระบุจำนวนเงิน" : shortcut === "ถอนเงิน" ? "บันทึกหมายเหตุและแนบสลิปได้" : "ระบุราคาและหน่วยตามจริง"}</small></div><button onClick={() => setShortcut("")}><X size={15} /></button></div>}<div className="cart-items">{cart.length === 0 ? <div className="empty-cart"><ShoppingCart size={28} /><b>ยังไม่มีสินค้าในบิล</b><span>เลือกสินค้าจากรายการด้านซ้าย</span></div> : cart.map((item) => <div className="cart-item" key={item.id}><div className="cart-item-icon">{item.name.startsWith("น้ำ") ? "💧" : item.name.startsWith("ข้าว") ? "🍱" : "🛍️"}</div><div className="cart-item-main"><b>{item.name}</b><span>{money(item.price)} / {item.unit}</span><div className="qty-control"><button onClick={() => updateQty(item.id, -1)}><Minus size={13} /></button><span>{item.qty}</span><button onClick={() => updateQty(item.id, 1)}><Plus size={13} /></button></div></div><strong>{money(item.price * item.qty)}</strong><button className="remove-item" onClick={() => updateQty(item.id, -item.qty)}><X size={14} /></button></div>)}</div><div className="member-select-wrap"><div className="member-select" onClick={() => setMemberMenuOpen(!memberMenuOpen)}><div className="member-avatar"><UserCircle2 size={18} /></div><div><b>{selectedMember ? `${selectedMember.memberNumber} · สมาชิก${selectedMember.firstName} ${selectedMember.lastName}` : "บุคคลทั่วไป"}</b><small>{selectedMember ? `ยอดคงเหลือ ${money(selectedMember.balance)}` : "ชำระเงินสดหรือ QR"}</small></div><ChevronDown size={16} className="muted-icon" /></div>{memberMenuOpen && <div className="member-dropdown"><button className="member-option" onClick={() => { setSelectedMemberNumber(null); setMemberMenuOpen(false); clearNotices(); }}><div><b>บุคคลทั่วไป</b><small>ชำระเงินสดหรือ QR</small></div>{!selectedMember && <Check size={15} className="option-check" />}</button>{membersQuery.isLoading ? <div className="member-option disabled"><div><b>กำลังโหลดรายการสมาชิก…</b><small>ดึงข้อมูลจากฐานข้อมูลสวัสดิการ</small></div></div> : members.map((member) => <button className="member-option" key={member.memberNumber} disabled={member.status === "suspended"} onClick={() => { setSelectedMemberNumber(member.memberNumber); setMemberMenuOpen(false); clearNotices(); }}><div><b>{member.memberNumber} · สมาชิก{member.firstName} {member.lastName}</b><small>ยอดคงเหลือ {money(member.balance)}</small></div>{member.status === "suspended" ? <span className="suspended-tag">ระงับ</span> : selectedMember?.memberNumber === member.memberNumber && <Check size={15} className="option-check" />}</button>)}</div>}</div>{(shortcut === "เติมเงิน" || shortcut === "ถอนเงิน") && <div className="wallet-form"><div className="wallet-heading"><span>{shortcut === "เติมเงิน" ? <ArrowDownToLine size={16} /> : <ArrowUpFromLine size={16} />}</span><div><b>{shortcut === "เติมเงิน" ? "เติมเงินเข้าบัญชีสมาชิก" : "ถอนเงินจากบัญชีสมาชิก"}</b><small>บันทึกธุรกรรมลงบัญชีจริงทันที</small></div></div><label>สมาชิก<select value={walletMemberNumber || selectedMemberNumber || ""} onChange={(event) => setWalletMemberNumber(event.target.value)}>{!walletMemberNumber && !selectedMemberNumber && <option value="">เลือกสมาชิก</option>}{members.map((member) => <option key={member.memberNumber} value={member.memberNumber} disabled={member.status === "suspended"}>{member.memberNumber} · {member.firstName} {member.lastName}</option>)}</select></label><label>จำนวนเงิน (฿)<input type="number" min="0" step="0.01" value={walletAmount} onChange={(event) => setWalletAmount(event.target.value)} placeholder="0.00" /></label><label>หมายเหตุ<input value={walletNote} onChange={(event) => setWalletNote(event.target.value)} placeholder={shortcut === "เติมเงิน" ? "เช่น เติมเงินสดที่เคาน์เตอร์" : "เช่น ถอนเพื่อใช้จ่ายส่วนตัว"} /></label><button className="primary-button" disabled={walletMutation.isPending || !(Number(walletAmount) > 0) || !(walletMemberNumber || selectedMemberNumber)} onClick={submitWallet}><Check size={16} /> {walletMutation.isPending ? "กำลังบันทึก…" : `บันทึก${shortcut}`}</button></div>}{(shortcut === "เติมเงิน" || shortcut === "ถอนเงิน") && <div className="slip-uploader"><div className="slip-heading"><span><FileImage size={16} /> หลักฐานการโอน / สลิป</span><small>ไม่บังคับ</small></div>{slipPreview ? <div className="slip-preview"><img src={slipPreview} alt="ตัวอย่างสลิป" /><div><b>{slipName}</b><small>พร้อมแนบกับรายการ {shortcut}</small></div><button onClick={() => { setSlipPreview(""); setSlipName(""); }}><X size={14} /></button></div> : <label className="upload-drop" htmlFor="slip-upload"><Upload size={17} /><span><b>คลิกเพื่ออัปโหลดรูปสลิป</b><small>รองรับ JPG, PNG ขนาดไม่เกิน 10 MB</small></span><input id="slip-upload" type="file" accept="image/png,image/jpeg" onChange={(event) => handleSlip(event.target.files?.[0])} /></label>}</div>}<div className="cart-totals"><div><span>ยอดรวมสินค้า</span><strong>{money(subtotal)}</strong></div><div><span>ส่วนลดสมาชิก</span><strong className="discount discount-edit">- ฿<input type="number" min="0" step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)} aria-label="ส่วนลด (บาท)" /></strong></div><div className="total-line"><span>ยอดที่ต้องชำระ</span><strong>{money(payable)}</strong></div></div><div className="payment-actions"><button className="pay-button member-pay" disabled={payDisabled} onClick={() => selectedMember ? completePayment("หักบัญชีสมาชิก") : setError("กรุณาเลือกสมาชิกก่อนชำระแบบหักบัญชี")}><CreditCard size={18} /> หักบัญชีสมาชิก</button><div className="pay-split"><button disabled={payDisabled} onClick={() => completePayment("เงินสด")}><span className="pay-icon cash"><WalletCards size={16} /></span> เงินสด</button><button disabled={payDisabled} onClick={() => completePayment("QR / สแกน")}><span className="pay-icon qr"><QrCode size={16} /></span> QR / สแกน</button></div></div>{role === "admin" && <div className="admin-pos-note"><Crown size={14} /><span>ผู้บริหารสามารถแก้ไขราคา/ตรวจสอบรายการก่อนปิดบิล</span></div>}{message && <div className="inline-message"><Check size={15} /> {message}</div>}{error && <div className="inline-message error"><CircleAlert size={15} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}</aside>
    </div>
    <div className="shortcut-strip"><div><span className="eyebrow">ทางลัด</span><b>รายการที่ไม่ใช่สินค้า</b><small>เติมเงิน ถอนเงิน หรือรายการที่ระบุยูนิตไม่ได้</small></div><button onClick={() => runShortcut("เติมเงิน")}><ArrowDownToLine size={17} /><span>เติมเงินสมาชิก</span><kbd>F2</kbd></button><button onClick={() => runShortcut("ถอนเงิน")}><ArrowUpFromLine size={17} /><span>ถอนเงินสมาชิก</span><kbd>F3</kbd></button><button onClick={() => runShortcut("สินค้าไม่ระบุตายตัว")}><SlidersHorizontal size={17} /><span>เพิ่มรายการพิเศษ</span><kbd>F4</kbd></button></div>
    {scanOpen && <div className="modal-backdrop" onClick={() => setScanOpen(false)}><div className="scanner-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">SIMULATED SCANNER</span><h2>สแกนบาร์โค้ดสินค้า</h2><p>จำลองการเปิดกล้องเพื่ออ่านรหัสสินค้า</p></div><button className="icon-button" onClick={() => setScanOpen(false)}><X size={17} /></button></div><div className="scanner-viewport"><div className="scanner-corner tl" /><div className="scanner-corner tr" /><div className="scanner-corner bl" /><div className="scanner-corner br" /><div className="scanner-line" /><ScanLine size={46} /><span>เล็งบาร์โค้ดให้อยู่ในกรอบ</span></div><div className="scanner-input"><label>รหัสบาร์โค้ดตัวอย่าง</label><div className="search-field"><ScanLine size={16} /><input autoFocus value={barcode} onChange={(event) => setBarcode(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") simulateScan(); }} placeholder="เช่น 8850000000017 หรือ DRK-001" /><button onClick={() => simulateScan()}><Check size={16} /></button></div></div>{error && <div className="inline-message error"><CircleAlert size={15} /> {error}</div>}<div className="sample-codes"><span>ลองสแกน:</span>{sampleCodes.map((product) => <button key={product.barcode} onClick={() => { setBarcode(product.barcode!); simulateScan(product.barcode!); }}>{product.barcode} · {product.name.split(" ").slice(0, 2).join(" ")}</button>)}</div><div className="scanner-footer"><span><RotateCcw size={14} /> สแกนซ้ำเพื่อเพิ่มจำนวนสินค้า</span><button className="outline-button" onClick={() => setScanOpen(false)}>ยกเลิก</button></div></div></div>}
    {receiptOpen && receipt && <div className="modal-backdrop" onClick={() => setReceiptOpen(false)}><div className="receipt-modal" onClick={(event) => event.stopPropagation()}><div className="receipt-success"><span><Check size={22} /></span><div><b>ชำระเงินสำเร็จ</b><small>ตรวจสอบรายละเอียดก่อนพิมพ์หรือเริ่มรายการใหม่</small></div><button className="icon-button" onClick={() => setReceiptOpen(false)}><X size={17} /></button></div><div className="receipt-paper" id="receipt-paper"><div className="receipt-brand"><div className="brand-mark small"><span>ส</span></div><div><b>ร้านค้าสวัสดิการ รพจ.</b><small>โรงพยาบาลผู้ป่วยจิตเวช</small></div></div><div className="receipt-divider" /><div className="receipt-meta"><span>ใบเสร็จเลขที่ <b>{receipt.orderNumber}</b></span><span>{formatReceiptDateTime(receipt.createdAt)}</span></div><div className="receipt-customer"><span>ผู้ซื้อ</span><b>{receipt.memberName ? `สมาชิก${receipt.memberName} · ${receipt.memberNumber}` : "บุคคลทั่วไป"}</b></div>{receipt.items.map((item) => <div className="receipt-line" key={`${item.productId}-${item.name}`}><span>{item.name}<small>{item.qty} {item.unit} × {money(item.price)}</small></span><b>{money(item.amount)}</b></div>)}<div className="receipt-line"><span>ยอดรวมสินค้า</span><b>{money(receipt.subtotal)}</b></div>{receipt.discount > 0 && <div className="receipt-line"><span>ส่วนลด</span><b>- {money(receipt.discount)}</b></div>}<div className="receipt-total"><span>ยอดชำระทั้งหมด</span><b>{money(receipt.total)}</b></div><div className="receipt-payment"><span>วิธีชำระเงิน</span><b>{receipt.paymentMethod}</b></div>{receipt.paymentMethod === "หักบัญชีสมาชิก" && receipt.balanceAfter !== null && <div className="receipt-balance"><span>ยอดคงเหลือหลังรายการ</span><b>{money(receipt.balanceAfter)}</b></div>}<div className="receipt-thanks">ขอบคุณที่ใช้บริการ<br /><small>ข้อมูลรายการถูกบันทึกในระบบ Log แล้ว</small></div></div><div className="receipt-actions"><button className="outline-button" disabled={Boolean(receiptBusy)} onClick={() => downloadReceipt("pdf")}><Download size={16} /> {receiptBusy === "pdf" ? "กำลังสร้าง PDF..." : "ดาวน์โหลด PDF"}</button><button className="outline-button" disabled={Boolean(receiptBusy)} onClick={() => downloadReceipt("image")}><FileImage size={16} /> {receiptBusy === "image" ? "กำลังสร้างรูป..." : "ดาวน์โหลดรูปภาพ"}</button><button className="outline-button" onClick={() => { setReceiptOpen(false); setMessage("ส่งใบเสร็จไปพิมพ์แล้ว"); }}><Printer size={16} /> พิมพ์ใบเสร็จ</button><button className="primary-button" onClick={startNewSale}><Plus size={16} /> เริ่มรายการขายใหม่</button></div></div></div>}<ConfirmDialog open={cancelOpen} title="ยืนยันการยกเลิกรายการขาย?" description="สินค้าที่อยู่ในบิลนี้จะถูกล้างออก และยังไม่บันทึกเป็นธุรกรรม" confirmLabel="ยืนยันยกเลิกบิล" onCancel={() => setCancelOpen(false)} onConfirm={() => { setCart([]); setCancelOpen(false); setMessage("ยกเลิกรายการขายแล้ว"); }} /></>;
}
