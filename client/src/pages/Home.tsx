import { useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  Bell,
  Boxes,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  CreditCard,
  Download,
  FileBarChart,
  LayoutDashboard,
  Menu,
  Minus,
  MoreHorizontal,
  PackagePlus,
  PackageSearch,
  Plus,
  QrCode,
  ReceiptText,
  Search,
  ScanLine,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Trash2,
  UserCircle2,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";

type View = "dashboard" | "pos" | "stock" | "members" | "reports" | "settings" | "logs";
type CartItem = { id: number; name: string; price: number; qty: number; unit: string };

type Product = {
  id: number;
  name: string;
  category: string;
  price: number;
  stock: number;
  unit: string;
  color: string;
  emoji: string;
};

export function calculateCartSubtotal(items: CartItem[]) {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

export function addScannedItem(items: CartItem[], product: Product) {
  const existing = items.find((item) => item.id === product.id);
  if (existing) {
    return items.map((item) => item.id === product.id ? { ...item, qty: item.qty + 1 } : item);
  }
  return [...items, { id: product.id, name: product.name, price: product.price, qty: 1, unit: product.unit }];
}

const navItems: { id: View; label: string; caption: string; icon: LucideIcon }[] = [
  { id: "dashboard", label: "ภาพรวม", caption: "สรุปการดำเนินงาน", icon: LayoutDashboard },
  { id: "pos", label: "หน้าร้าน / POS", caption: "ขายสินค้าและรับชำระ", icon: ShoppingCart },
  { id: "stock", label: "สต็อกสินค้า", caption: "รับเข้าและนับสต็อก", icon: PackageSearch },
  { id: "members", label: "สมาชิกและบัญชี", caption: "ผู้ป่วยและเจ้าหน้าที่", icon: UsersRound },
  { id: "reports", label: "รายงาน", caption: "วิเคราะห์และส่งออก", icon: BarChart3 },
];

const products: Product[] = [
  { id: 1, name: "น้ำดื่มคริสตัล 600 มล.", category: "เครื่องดื่ม", price: 7, stock: 124, unit: "ขวด", color: "blue", emoji: "💧" },
  { id: 2, name: "กาแฟกระป๋อง เบอร์ดี้", category: "เครื่องดื่ม", price: 18, stock: 42, unit: "กระป๋อง", color: "amber", emoji: "☕" },
  { id: 3, name: "ข้าวกล่องกะเพราไก่", category: "อาหาร", price: 45, stock: 18, unit: "กล่อง", color: "orange", emoji: "🍱" },
  { id: 4, name: "นมยูเอชที รสจืด", category: "เครื่องดื่ม", price: 13, stock: 65, unit: "กล่อง", color: "sky", emoji: "🥛" },
  { id: 5, name: "ขนมปังแซนด์วิช", category: "อาหาร", price: 25, stock: 9, unit: "ชิ้น", color: "rose", emoji: "🥪" },
  { id: 6, name: "สบู่เหลวล้างมือ", category: "ของใช้", price: 32, stock: 28, unit: "ขวด", color: "mint", emoji: "🧴" },
  { id: 7, name: "หน้ากากอนามัย 3 ชิ้น", category: "ของใช้", price: 20, stock: 86, unit: "แพ็ก", color: "violet", emoji: "😷" },
  { id: 8, name: "น้ำแข็งถุงเล็ก", category: "ของใช้", price: 10, stock: 35, unit: "ถุง", color: "cyan", emoji: "🧊" },
];

const stockRows = [
  { sku: "DRK-001", name: "น้ำดื่มคริสตัล 600 มล.", lot: "CR-2608-01", expiry: "18/08/2027", qty: "124 ขวด", cost: "฿4.20", retail: "฿7.00", status: "ปกติ", tone: "green" },
  { sku: "FD-014", name: "ข้าวกล่องกะเพราไก่", lot: "ครัวกลาง-17", expiry: "18/09/2026", qty: "18 กล่อง", cost: "฿32.00", retail: "฿45.00", status: "ใกล้หมดอายุ", tone: "amber" },
  { sku: "SNK-008", name: "ขนมปังแซนด์วิช", lot: "BR-260917-A", expiry: "20/09/2026", qty: "9 ชิ้น", cost: "฿18.00", retail: "฿25.00", status: "สต็อกต่ำ", tone: "red" },
  { sku: "HYG-032", name: "สบู่เหลวล้างมือ", lot: "HM-2606-03", expiry: "04/06/2028", qty: "28 ขวด", cost: "฿24.00", retail: "฿32.00", status: "ปกติ", tone: "green" },
  { sku: "ICE-004", name: "น้ำแข็งถุงเล็ก", lot: "รับรายวัน", expiry: "ไม่ระบุ", qty: "35 ถุง", cost: "฿6.00", retail: "฿10.00", status: "ปกติ", tone: "green" },
];

const memberRows = [
  { id: "M-000218", name: "นางสาวอรทัย ส.", type: "ผู้ป่วย", balance: "฿1,240.00", last: "วันนี้ 14:24", status: "ใช้งาน", tone: "green" },
  { id: "M-000184", name: "นายธนกร พ.", type: "เจ้าหน้าที่", balance: "฿860.00", last: "วันนี้ 12:08", status: "ใช้งาน", tone: "green" },
  { id: "M-000092", name: "นางสาวพิมพ์ชนก ร.", type: "ผู้ป่วย", balance: "฿0.00", last: "16 ก.ย. 09:12", status: "ระงับ", tone: "red" },
  { id: "M-000241", name: "นายสมชาย ว.", type: "ผู้ป่วย", balance: "฿340.00", last: "15 ก.ย. 15:46", status: "ใช้งาน", tone: "green" },
  { id: "M-000119", name: "นางสาวจุฑามาศ ก.", type: "เจ้าหน้าที่", balance: "฿2,180.00", last: "14 ก.ย. 10:21", status: "ใช้งาน", tone: "green" },
];

const logs = [
  { time: "17 ก.ย. 2569 14:38", actor: "น.ส.กัญญาณัฐ พ.", role: "เจ้าหน้าที่", action: "ขายสินค้า", detail: "บิล #INV-260917-038 · ฿186.00", tone: "blue" },
  { time: "17 ก.ย. 2569 14:32", actor: "น.ส.กัญญาณัฐ พ.", role: "เจ้าหน้าที่", action: "เติมเงินสมาชิก", detail: "M-000218 · ฿500.00 · เงินสด", tone: "green" },
  { time: "17 ก.ย. 2569 13:51", actor: "นายวรพจน์ ด.", role: "ผู้บริหาร", action: "แก้ไขสต็อก", detail: "น้ำดื่มคริสตัล · +24 ขวด", tone: "amber" },
  { time: "17 ก.ย. 2569 12:06", actor: "น.ส.กัญญาณัฐ พ.", role: "เจ้าหน้าที่", action: "ถอนเงินสมาชิก", detail: "M-000092 · ฿200.00 · ถอนเพื่อถอนฟัน", tone: "purple" },
];

const money = (value: number) => `฿${value.toLocaleString("th-TH", { minimumFractionDigits: 2 })}`;

function StatusPill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

function SectionHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="section-header">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <div className="section-actions">{action}</div>}
    </div>
  );
}

function Dashboard({ setView, setPosShortcut }: { setView: (view: View) => void; setPosShortcut: (shortcut: string) => void }) {
  const bars = [42, 56, 48, 71, 64, 82, 74, 92, 67, 88, 81, 96];
  return (
    <>
      <SectionHeader eyebrow="ภาพรวมการดำเนินงาน · วันพฤหัสบดี 17 กันยายน 2569" title="สวัสดีค่ะ, กัญญาณัฐ" description="ดูภาพรวมร้านค้าสวัสดิการและรายการที่ควรติดตามวันนี้" action={<button className="outline-button"><CalendarDays size={16} /> วันนี้ <ChevronDown size={15} /></button>} />
      <div className="metric-grid">
        <div className="metric-card highlight"><div className="metric-top"><span>ยอดขายวันนี้</span><span className="metric-icon green"><ShoppingBag size={18} /></span></div><strong>฿18,460.00</strong><div className="metric-foot positive"><span>↑ 12.8%</span><span>เทียบกับเมื่อวาน</span></div></div>
        <div className="metric-card"><div className="metric-top"><span>สมาชิกที่ใช้งาน</span><span className="metric-icon blue"><UsersRound size={18} /></span></div><strong>1,248 <small>ราย</small></strong><div className="metric-foot"><span className="positive">+24 ราย</span><span>ในเดือนนี้</span></div></div>
        <div className="metric-card"><div className="metric-top"><span>สินค้าต้องติดตาม</span><span className="metric-icon amber"><PackageSearch size={18} /></span></div><strong>9 <small>รายการ</small></strong><div className="metric-foot warning"><span>3 รายการ</span><span>สต็อกต่ำมาก</span></div></div>
        <div className="metric-card"><div className="metric-top"><span>ยอดเงินคงเหลือสมาชิก</span><span className="metric-icon purple"><WalletCards size={18} /></span></div><strong>฿86,250.00</strong><div className="metric-foot"><span>↑ 4.2%</span><span>จากสัปดาห์ก่อน</span></div></div>
      </div>
      <div className="dashboard-grid">
        <section className="panel chart-panel"><div className="panel-heading"><div><h2>ยอดขายร้านค้า</h2><p>ภาพรวมยอดขายย้อนหลัง 12 เดือน</p></div><div className="legend"><span><i className="dot teal" /> ยอดขายสินค้า</span><span><i className="dot lilac" /> เติมเงินสมาชิก</span></div></div><div className="chart-wrap"><div className="y-labels"><span>20k</span><span>15k</span><span>10k</span><span>5k</span><span>0</span></div><div className="bar-chart">{bars.map((height, index) => <div className="bar-column" key={index}><div className="bar-stack"><div className="bar lilac" style={{ height: `${height * 0.28}%` }} /><div className="bar teal" style={{ height: `${height}%` }} /></div><span>{["ต.ค.", "พ.ย.", "ธ.ค.", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย."][index]}</span></div>)}</div></div><div className="chart-summary"><div><span>ยอดขายรวมเดือนนี้</span><strong>฿286,420.00</strong></div><div><span>ค่าเฉลี่ยต่อวัน</span><strong>฿16,824.70</strong></div><div><span>จำนวนบิล</span><strong>1,684 <small>บิล</small></strong></div></div></section>
        <section className="panel quick-panel"><div className="panel-heading"><div><h2>ทางลัดสำหรับเจ้าหน้าที่</h2><p>การทำรายการที่ใช้บ่อย</p></div><MoreHorizontal size={19} className="muted-icon" /></div><button className="quick-action teal-action" onClick={() => { setView("pos"); setPosShortcut("เติมเงิน") }}><span className="shortcut-icon"><ArrowDownToLine size={19} /></span><span><b>เติมเงินสมาชิก</b><small>รับฝากเงินเข้าบัญชี</small></span><span className="shortcut-arrow">→</span></button><button className="quick-action purple-action" onClick={() => { setView("pos"); setPosShortcut("ถอนเงิน") }}><span className="shortcut-icon"><ArrowUpFromLine size={19} /></span><span><b>ถอนเงินสมาชิก</b><small>ระบุหมายเหตุและแนบสลิปได้</small></span><span className="shortcut-arrow">→</span></button><button className="quick-action amber-action" onClick={() => { setView("pos"); setPosShortcut("สินค้าไม่ระบุตายตัว") }}><span className="shortcut-icon"><SlidersHorizontal size={19} /></span><span><b>สินค้า / รายการพิเศษ</b><small>สินค้าที่ไม่ระบุยูนิตตายตัว</small></span><span className="shortcut-arrow">→</span></button><div className="divider" /><div className="mini-note"><ShieldCheck size={17} /><span>ข้อมูลทุกธุรกรรมถูกบันทึกในระบบ Log อัตโนมัติ</span></div></section>
      </div>
      <div className="dashboard-grid lower"><section className="panel"><div className="panel-heading"><div><h2>สินค้าขายดีวันนี้</h2><p>เรียงตามจำนวนที่ขายออก</p></div><button className="text-button" onClick={() => setView("reports")}>ดูรายงานทั้งหมด →</button></div><div className="best-sellers">{[["น้ำดื่มคริสตัล 600 มล.", "124 ขวด", "฿868.00", "01"], ["ข้าวกล่องกะเพราไก่", "46 กล่อง", "฿2,070.00", "02"], ["กาแฟกระป๋อง เบอร์ดี้", "38 กระป๋อง", "฿684.00", "03"]].map(([name, qty, total, rank]) => <div className="seller-row" key={name}><span className={`rank rank-${rank}`}>{rank}</span><div className="product-thumb">{name.startsWith("น้ำ") ? "💧" : name.startsWith("ข้าว") ? "🍱" : "☕"}</div><div className="seller-name"><b>{name}</b><small>{qty}</small></div><strong>{total}</strong><MoreHorizontal size={18} className="muted-icon" /></div>)}</div></section><section className="panel"><div className="panel-heading"><div><h2>กิจกรรมล่าสุด</h2><p>รายการที่เกิดขึ้นในระบบ</p></div><Activity size={19} className="muted-icon" /></div><div className="activity-list">{logs.slice(0, 4).map((log) => <div className="activity-row" key={log.time}><span className={`activity-dot ${log.tone}`} /><div><b>{log.action}</b><p>{log.actor} · {log.detail}</p></div><time>{log.time.split(" ").slice(-1)[0]}</time></div>)}</div></section></div>
    </>
  );
}

function Pos({ shortcut, setShortcut }: { shortcut: string; setShortcut: (value: string) => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("ทั้งหมด");
  const [cart, setCart] = useState<CartItem[]>([
    { id: 1, name: "น้ำดื่มคริสตัล 600 มล.", price: 7, qty: 2, unit: "ขวด" },
    { id: 3, name: "ข้าวกล่องกะเพราไก่", price: 45, qty: 1, unit: "กล่อง" },
  ]);
  const [member, setMember] = useState(true);
  const [message, setMessage] = useState("");
  const filtered = useMemo(() => products.filter((product) => (category === "ทั้งหมด" || product.category === category) && product.name.toLowerCase().includes(query.toLowerCase())), [category, query]);
  const subtotal = calculateCartSubtotal(cart);
  const addProduct = (product: Product) => { setCart((items) => addScannedItem(items, product)); setMessage(`เพิ่ม ${product.name} แล้ว`); };
  const updateQty = (id: number, delta: number) => setCart((items) => items.flatMap((item) => item.id === id ? (item.qty + delta <= 0 ? [] : [{ ...item, qty: item.qty + delta }]) : [item]));
  const runShortcut = (name: string) => { setShortcut(name); setMessage(`${name}: เปิดช่องทำรายการเรียบร้อย`); };
  return <>
    <SectionHeader eyebrow="หน้าร้าน / จุดขายสินค้า" title="POS · ขายสินค้า" description="สแกนบาร์โค้ดหรือค้นหาสินค้า แล้วเลือกวิธีชำระเงินที่ต้องการ" action={<div className="pos-status"><span className="live-dot" /> จุดขายที่ 01 · เปิดให้บริการ</div>} />
    <div className="pos-layout">
      <section className="panel product-panel"><div className="pos-search-row"><div className="search-field large"><Search size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาชื่อสินค้า หรือสแกนบาร์โค้ด..." autoFocus /><kbd>⌘ K</kbd></div><button className="scan-button" onClick={() => setMessage("พร้อมสแกนบาร์โค้ดสินค้า")}><ScanLine size={18} /> สแกน</button></div><div className="category-tabs">{["ทั้งหมด", "อาหาร", "เครื่องดื่ม", "ของใช้"].map((item) => <button className={category === item ? "active" : ""} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div><div className="product-grid">{filtered.map((product) => <button className="product-card" key={product.id} onClick={() => addProduct(product)}><div className={`product-art ${product.color}`}><span>{product.emoji}</span>{product.stock <= 10 && <i>เหลือ {product.stock}</i>}</div><div className="product-card-info"><b>{product.name}</b><small>{product.unit} · คงเหลือ {product.stock}</small><strong>{money(product.price)}</strong></div><span className="add-product"><Plus size={15} /></span></button>)}</div><div className="pos-help"><CircleHelp size={16} /><span>สแกนสินค้าเดิมซ้ำได้ทันทีเพื่อเพิ่มจำนวน · กดที่สินค้าเพื่อเพิ่ม 1 ชิ้น</span></div></section>
      <aside className="panel cart-panel"><div className="cart-heading"><div><h2>รายการขาย</h2><p>{cart.reduce((sum, item) => sum + item.qty, 0)} รายการ · บิลใหม่</p></div><button className="icon-button" onClick={() => setCart([])} title="ล้างรายการ"><Trash2 size={17} /></button></div>{shortcut && <div className="shortcut-banner"><span className="shortcut-banner-icon">{shortcut === "เติมเงิน" ? <ArrowDownToLine size={17} /> : shortcut === "ถอนเงิน" ? <ArrowUpFromLine size={17} /> : <SlidersHorizontal size={17} />}</span><div><b>{shortcut}</b><small>{shortcut === "เติมเงิน" ? "เลือกสมาชิกและระบุจำนวนเงิน" : shortcut === "ถอนเงิน" ? "บันทึกหมายเหตุการถอนเงิน" : "ระบุราคาและหน่วยตามจริง"}</small></div><button onClick={() => setShortcut("")}><X size={15} /></button></div>}<div className="cart-items">{cart.length === 0 ? <div className="empty-cart"><ShoppingCart size={28} /><b>ยังไม่มีสินค้าในบิล</b><span>เลือกสินค้าจากรายการด้านซ้าย</span></div> : cart.map((item) => <div className="cart-item" key={item.id}><div className="cart-item-icon">{item.name.startsWith("น้ำ") ? "💧" : item.name.startsWith("ข้าว") ? "🍱" : "🛍️"}</div><div className="cart-item-main"><b>{item.name}</b><span>{money(item.price)} / {item.unit}</span><div className="qty-control"><button onClick={() => updateQty(item.id, -1)}><Minus size={13} /></button><span>{item.qty}</span><button onClick={() => updateQty(item.id, 1)}><Plus size={13} /></button></div></div><strong>{money(item.price * item.qty)}</strong><button className="remove-item" onClick={() => updateQty(item.id, -item.qty)}><X size={14} /></button></div>)}</div><div className="member-select" onClick={() => setMember(!member)}><div className="member-avatar"><UserCircle2 size={18} /></div><div><b>{member ? "M-000218 · นางสาวอรทัย ส." : "บุคคลทั่วไป"}</b><small>{member ? "ยอดคงเหลือ ฿1,240.00" : "ชำระเงินสดหรือ QR"}</small></div><ChevronDown size={16} className="muted-icon" /></div><div className="cart-totals"><div><span>ยอดรวมสินค้า</span><strong>{money(subtotal)}</strong></div><div><span>ส่วนลดสมาชิก</span><strong className="discount">- ฿0.00</strong></div><div className="total-line"><span>ยอดที่ต้องชำระ</span><strong>{money(subtotal)}</strong></div></div><div className="payment-actions"><button className="pay-button member-pay" onClick={() => setMessage(member ? "พร้อมหักจากยอดเงินสมาชิก" : "กรุณาเลือกสมาชิกก่อนชำระแบบหักบัญชี")}><CreditCard size={18} /> หักบัญชีสมาชิก</button><div className="pay-split"><button onClick={() => setMessage("รับชำระเงินสดแล้ว กรุณาออกใบเสร็จ")}><span className="pay-icon cash"><WalletCards size={16} /></span> เงินสด</button><button onClick={() => setMessage("เปิดหน้าสแกน QR สำหรับบุคคลทั่วไป")}><span className="pay-icon qr"><QrCode size={16} /></span> QR / สแกน</button></div></div>{message && <div className="inline-message"><Check size={15} /> {message}</div>}</aside>
    </div>
    <div className="shortcut-strip"><div><span className="eyebrow">ทางลัด</span><b>รายการที่ไม่ใช่สินค้า</b><small>เติมเงิน ถอนเงิน หรือรายการที่ระบุยูนิตไม่ได้</small></div><button onClick={() => runShortcut("เติมเงิน")}><ArrowDownToLine size={17} /><span>เติมเงินสมาชิก</span><kbd>F2</kbd></button><button onClick={() => runShortcut("ถอนเงิน")}><ArrowUpFromLine size={17} /><span>ถอนเงินสมาชิก</span><kbd>F3</kbd></button><button onClick={() => runShortcut("สินค้าไม่ระบุตายตัว")}><SlidersHorizontal size={17} /><span>เพิ่มรายการพิเศษ</span><kbd>F4</kbd></button></div>
  </>;
}

function Stock() {
  const [notice, setNotice] = useState("");
  return <><SectionHeader eyebrow="คลังสินค้าและต้นทุน" title="สต็อกสินค้า" description="ติดตามจำนวนคงเหลือ Lot วันหมดอายุ และต้นทุนสินค้าในคลัง" action={<><button className="outline-button" onClick={() => setNotice("เปิดตัวกรองสต็อกแล้ว")}><SlidersHorizontal size={16} /> ตัวกรอง</button><button className="primary-button" onClick={() => setNotice("เปิดแบบฟอร์มรับเข้าสินค้าแล้ว")}><PackagePlus size={16} /> รับเข้าสินค้า</button></>} /><div className="stock-overview"><div className="stock-stat"><span className="stat-icon blue"><Boxes size={18} /></span><div><small>มูลค่าสต็อกทั้งหมด</small><strong>฿184,280.00</strong></div></div><div className="stock-stat"><span className="stat-icon amber"><PackageSearch size={18} /></span><div><small>รายการทั้งหมด</small><strong>248 <em>SKU</em></strong></div></div><div className="stock-stat"><span className="stat-icon red"><Activity size={18} /></span><div><small>ต้องสั่งซื้อ</small><strong className="red-text">9 <em>รายการ</em></strong></div></div><div className="stock-stat"><span className="stat-icon green"><FileBarChart size={18} /></span><div><small>กำไรขั้นต้นเฉลี่ย</small><strong className="green-text">24.8%</strong></div></div></div><section className="panel table-panel"><div className="table-toolbar"><div><h2>รายการคงคลัง</h2><p>อัปเดตล่าสุดเมื่อ 17 ก.ย. 2569 เวลา 14:40 น.</p></div><div className="toolbar-actions"><button className="outline-button" onClick={() => setNotice("เปิดโหมดนับสต็อกแล้ว")}><ClipboardList size={16} /> นับสต็อก</button><button className="outline-button" onClick={() => setNotice("ส่งออกรายงานสต็อกแล้ว")}><Download size={16} /> ส่งออก</button></div></div><div className="table-wrap"><table><thead><tr><th>รหัส / สินค้า</th><th>Lot / วันหมดอายุ</th><th>คงเหลือ</th><th>ต้นทุน</th><th>ราคาขาย</th><th>สถานะ</th><th /></tr></thead><tbody>{stockRows.map((row) => <tr key={row.sku}><td><b>{row.name}</b><small>{row.sku}</small></td><td><b>{row.lot}</b><small>{row.expiry}</small></td><td><b>{row.qty}</b></td><td>{row.cost}</td><td>{row.retail}</td><td><StatusPill tone={row.tone}>{row.status}</StatusPill></td><td><button className="table-more" onClick={() => setNotice(`เลือก ${row.name}`)}><MoreHorizontal size={18} /></button></td></tr>)}</tbody></table></div>{notice && <div className="notice-bar"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}</section></>;
}

function Members() {
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const filtered = memberRows.filter((row) => `${row.name} ${row.id}`.toLowerCase().includes(query.toLowerCase()));
  return <><SectionHeader eyebrow="สมาชิกและบัญชีสวัสดิการ" title="จัดการสมาชิก" description="ลงทะเบียน เติมเงิน ระงับการใช้งาน และดูประวัติธุรกรรมรายบุคคล" action={<><button className="outline-button" onClick={() => setNotice("เปิดแบบฟอร์มเติมเงินด่วนแล้ว")}><WalletCards size={16} /> เติมเงิน</button><button className="primary-button" onClick={() => setNotice("เปิดแบบฟอร์มลงทะเบียนสมาชิกแล้ว")}><Plus size={16} /> ลงทะเบียนสมาชิก</button></>} /><div className="member-top-grid"><div className="member-balance-card"><div><span className="eyebrow">ยอดเงินในบัญชีสมาชิกทั้งหมด</span><strong>฿86,250.00</strong><small>เพิ่มขึ้น 4.2% จากสัปดาห์ก่อน</small></div><div className="balance-orb"><WalletCards size={26} /></div></div><div className="member-mini-card"><span className="stat-icon green"><UsersRound size={18} /></span><div><small>สมาชิกทั้งหมด</small><strong>1,324 <em>ราย</em></strong><p><span className="green-text">1,248 ใช้งาน</span> · 76 ระงับ</p></div></div><div className="member-mini-card"><span className="stat-icon purple"><ArrowDownToLine size={18} /></span><div><small>เติมเงินวันนี้</small><strong>฿12,500</strong><p>31 รายการ · เงินสดและ QR</p></div></div></div><section className="panel table-panel"><div className="table-toolbar"><div><h2>สมาชิกทั้งหมด</h2><p>เลือกบุคคลเพื่อดูประวัติและยอดเงินคงเหลือ</p></div><div className="toolbar-actions"><div className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาชื่อ หรือเลขสมาชิก" /></div><button className="outline-button"><SlidersHorizontal size={16} /> ตัวกรอง</button></div></div><div className="table-wrap"><table><thead><tr><th>สมาชิก</th><th>ประเภท</th><th>ยอดเงินคงเหลือ</th><th>รายการล่าสุด</th><th>สถานะ</th><th /></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}><td><div className="member-cell"><span className="member-table-avatar">{row.name.slice(3, 4)}</span><div><b>{row.name}</b><small>{row.id}</small></div></div></td><td>{row.type}</td><td><b>{row.balance}</b></td><td>{row.last}</td><td><StatusPill tone={row.tone}>{row.status}</StatusPill></td><td><button className="row-action" onClick={() => setNotice(`กำลังเปิดประวัติของ ${row.name}`)}>ดูประวัติ <span>→</span></button></td></tr>)}</tbody></table></div>{notice && <div className="notice-bar"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}</section></>;
}

function Reports() {
  const [period, setPeriod] = useState("รายวัน");
  const [notice, setNotice] = useState("");
  return <><SectionHeader eyebrow="สรุปผลและวิเคราะห์ข้อมูล" title="รายงาน" description="เลือกช่วงเวลา รายบุคคล หรือหมวดรายงานเพื่อดูและส่งออกข้อมูล" action={<button className="outline-button" onClick={() => setNotice("เปิดตัวเลือกช่วงวันที่แล้ว")}><CalendarDays size={16} /> 17 ก.ย. 2569 <ChevronDown size={15} /></button>} /><div className="report-tabs">{["รายวัน", "รายสัปดาห์", "รายเดือน", "กำหนดช่วงเวลา"].map((item) => <button className={period === item ? "active" : ""} key={item} onClick={() => setPeriod(item)}>{item}</button>)}</div><div className="report-cards"><div className="report-card"><span>ยอดขายสินค้า</span><strong>฿18,460.00</strong><small className="green-text">↑ 12.8% จากช่วงก่อน</small><div className="sparkline teal-spark"><i /><i /><i /><i /><i /><i /><i /></div></div><div className="report-card"><span>เติมเงินสมาชิก</span><strong>฿12,500.00</strong><small className="green-text">↑ 8.4% จากช่วงก่อน</small><div className="sparkline purple-spark"><i /><i /><i /><i /><i /><i /><i /></div></div><div className="report-card"><span>ถอนเงินสมาชิก</span><strong>฿2,300.00</strong><small>31 รายการวันนี้</small><div className="sparkline amber-spark"><i /><i /><i /><i /><i /><i /><i /></div></div><div className="report-card"><span>กำไรขั้นต้นโดยประมาณ</span><strong>฿4,682.00</strong><small className="green-text">คิดเป็น 25.4%</small><div className="sparkline green-spark"><i /><i /><i /><i /><i /><i /><i /></div></div></div><div className="dashboard-grid report-lower"><section className="panel"><div className="panel-heading"><div><h2>สรุปยอดขายตามหมวด</h2><p>{period} · 17 กันยายน 2569</p></div><button className="outline-button compact" onClick={() => setNotice("เตรียมไฟล์ Excel, PDF และ CSV แล้ว")}><Download size={15} /> ส่งออก</button></div><div className="category-report"><div className="category-row"><div><b>อาหาร</b><span>42 บิล</span></div><div className="progress"><i style={{ width: "78%" }} /></div><strong>฿8,620.00</strong></div><div className="category-row"><div><b>เครื่องดื่ม</b><span>86 บิล</span></div><div className="progress blue"><i style={{ width: "64%" }} /></div><strong>฿5,480.00</strong></div><div className="category-row"><div><b>ของใช้</b><span>38 บิล</span></div><div className="progress purple"><i style={{ width: "41%" }} /></div><strong>฿3,240.00</strong></div><div className="category-row"><div><b>สินค้าอื่น ๆ</b><span>12 บิล</span></div><div className="progress amber"><i style={{ width: "22%" }} /></div><strong>฿1,120.00</strong></div></div></section><section className="panel"><div className="panel-heading"><div><h2>การส่งออกข้อมูล</h2><p>ไฟล์พร้อมดาวน์โหลดตามสิทธิ์ของคุณ</p></div><FileBarChart size={19} className="muted-icon" /></div><div className="export-list"><button onClick={() => setNotice("ส่งออกรายงานเป็น Excel แล้ว")}><span className="file-icon xls">XLS</span><span><b>รายงานยอดขาย.xlsx</b><small>ยอดขายและกำไร · วันนี้</small></span><Download size={16} /></button><button onClick={() => setNotice("ส่งออกรายงานเป็น PDF แล้ว")}><span className="file-icon pdf">PDF</span><span><b>สรุปบัญชีสมาชิก.pdf</b><small>เติมเงิน ถอนเงิน และยอดคงเหลือ</small></span><Download size={16} /></button><button onClick={() => setNotice("ส่งออกรายงานเป็น CSV แล้ว")}><span className="file-icon csv">CSV</span><span><b>ประวัติธุรกรรม.csv</b><small>ข้อมูลรายการทั้งหมด · วันนี้</small></span><Download size={16} /></button></div></section></div>{notice && <div className="notice-bar floating-notice"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}</>;
}

function Settings() {
  const [saved, setSaved] = useState(false);
  const [receipt, setReceipt] = useState(true);
  const [memberAlert, setMemberAlert] = useState(true);
  return <><SectionHeader eyebrow="ระบบและการกำหนดค่า" title="ตั้งค่า" description="จัดการข้อมูลร้านค้า ใบเสร็จ การแจ้งเตือน และสิทธิ์การใช้งาน" action={<button className="primary-button" onClick={() => setSaved(true)}><Check size={16} /> บันทึกการตั้งค่า</button>} /><div className="settings-layout"><div className="settings-nav"><button className="active"><ReceiptText size={17} /> ใบเสร็จและการขาย</button><button><WalletCards size={17} /> รูปแบบการชำระเงิน</button><button><Bell size={17} /> การแจ้งเตือน</button><button><ShieldCheck size={17} /> สิทธิ์และบทบาท</button><button><Activity size={17} /> การบันทึก Log</button></div><div className="settings-content"><section className="panel settings-card"><div className="settings-heading"><div><h2>ข้อมูลร้านค้า</h2><p>ข้อมูลจะแสดงบนหัวใบเสร็จและรายงาน</p></div><ShoppingBag size={20} className="muted-icon" /></div><div className="form-grid"><label>ชื่อร้านค้า<input defaultValue="ร้านค้าสวัสดิการโรงพยาบาลผู้ป่วยจิตเวช" /></label><label>รหัสร้านค้า<input defaultValue="WEL-PSY-001" /></label><label className="wide">ที่อยู่<input defaultValue="โรงพยาบาลผู้ป่วยจิตเวช · ฝ่ายสวัสดิการ" /></label></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>ใบเสร็จรับเงิน</h2><p>กำหนดรายละเอียดที่ต้องการแสดงบนใบเสร็จ</p></div><ReceiptText size={20} className="muted-icon" /></div><div className="toggle-row"><div><b>พิมพ์ใบเสร็จอัตโนมัติหลังชำระเงิน</b><small>ใช้กับเครื่องพิมพ์ใบเสร็จที่เชื่อมต่ออยู่</small></div><button className={`toggle ${receipt ? "on" : ""}`} onClick={() => setReceipt(!receipt)}><span /></button></div><div className="toggle-row"><div><b>แสดงยอดคงเหลือสมาชิกบนใบเสร็จ</b><small>แสดงยอดก่อนและหลังรายการ</small></div><button className="toggle on"><span /></button></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>การแจ้งเตือน</h2><p>ช่วยให้เจ้าหน้าที่ติดตามรายการสำคัญได้ทันเวลา</p></div><Bell size={20} className="muted-icon" /></div><div className="toggle-row"><div><b>แจ้งเตือนเมื่อสมาชิกมียอดคงเหลือต่ำ</b><small>แจ้งเตือนเมื่อยอดต่ำกว่า ฿100.00</small></div><button className={`toggle ${memberAlert ? "on" : ""}`} onClick={() => setMemberAlert(!memberAlert)}><span /></button></div><div className="toggle-row"><div><b>แจ้งเตือนสินค้าใกล้หมดอายุ</b><small>แจ้งเตือนล่วงหน้า 30 วัน</small></div><button className="toggle on"><span /></button></div></section>{saved && <div className="notice-bar"><Check size={16} /> บันทึกการตั้งค่าเรียบร้อยแล้ว<button onClick={() => setSaved(false)}><X size={14} /></button></div>}</div></div></>;
}

function Logs() {
  return <><SectionHeader eyebrow="ตรวจสอบย้อนหลังและความโปร่งใส" title="ระบบ Log" description="บันทึกทุกกิจกรรมสำคัญของผู้ใช้งานและธุรกรรมในระบบ" action={<button className="outline-button"><Download size={16} /> ส่งออก Log</button>} /><div className="log-summary"><div><Activity size={18} /><span>รายการวันนี้<strong>386</strong></span></div><div><ShieldCheck size={18} /><span>ผู้ใช้งานในระบบ<strong>12</strong></span></div><div><ReceiptText size={18} /><span>ธุรกรรมที่บันทึก<strong>100%</strong></span></div></div><section className="panel table-panel"><div className="table-toolbar"><div><h2>กิจกรรมทั้งหมด</h2><p>ข้อมูลสำหรับตรวจสอบย้อนหลังของเจ้าหน้าที่และผู้บริหาร</p></div><div className="toolbar-actions"><div className="search-field"><Search size={16} /><input placeholder="ค้นหากิจกรรม หรือผู้ใช้งาน" /></div><button className="outline-button"><CalendarDays size={16} /> ช่วงเวลา</button></div></div><div className="table-wrap"><table><thead><tr><th>วันและเวลา</th><th>ผู้ทำรายการ</th><th>กิจกรรม</th><th>รายละเอียด</th><th>ระดับสิทธิ์</th><th /></tr></thead><tbody>{logs.concat(logs).map((log, index) => <tr key={`${log.time}-${index}`}><td>{log.time}</td><td><b>{log.actor}</b></td><td><StatusPill tone={log.tone}>{log.action}</StatusPill></td><td>{log.detail}</td><td>{log.role}</td><td><button className="table-more"><MoreHorizontal size={18} /></button></td></tr>)}</tbody></table></div></section></>;
}

export default function Home() {
  const [activeView, setActiveView] = useState<View>("dashboard");
  const [mobileNav, setMobileNav] = useState(false);
  const [posShortcut, setPosShortcut] = useState("");
  const pageTitle = navItems.find((item) => item.id === activeView)?.label ?? "ภาพรวม";
  return <div className="app-shell"><aside className={`sidebar ${mobileNav ? "open" : ""}`}><div className="brand"><div className="brand-mark"><span>ส</span></div><div><b>สวัสดิการ รพจ.</b><small>Hospital Welfare Store</small></div><button className="mobile-close" onClick={() => setMobileNav(false)}><X size={19} /></button></div><div className="role-card"><div className="role-avatar">ก</div><div><b>กัญญาณัฐ พ.</b><span>เจ้าหน้าที่ร้านค้า</span></div><ChevronDown size={15} className="muted-icon" /></div><nav>{navItems.map(({ id, label, caption, icon: Icon }) => <button className={activeView === id ? "active" : ""} key={id} onClick={() => { setActiveView(id); setMobileNav(false); }}><Icon size={19} /><span><b>{label}</b><small>{caption}</small></span>{id === "stock" && <i className="nav-badge">9</i>}</button>)}</nav><div className="nav-separator" /><nav className="secondary-nav"><button className={activeView === "settings" ? "active" : ""} onClick={() => { setActiveView("settings"); setMobileNav(false); }}><Settings2 size={19} /><span><b>ตั้งค่า</b><small>ระบบและใบเสร็จ</small></span></button><button className={activeView === "logs" ? "active" : ""} onClick={() => { setActiveView("logs"); setMobileNav(false); }}><Activity size={19} /><span><b>ระบบ Log</b><small>ประวัติการใช้งาน</small></span></button></nav><div className="sidebar-footer"><div className="secure-badge"><ShieldCheck size={17} /><span><b>ระบบปลอดภัย</b><small>ข้อมูลถูกเข้ารหัสและสำรอง</small></span></div><div className="sidebar-version">v1.0.0 · ฝ่ายสวัสดิการ</div></div></aside><main className="main-shell"><header className="topbar"><button className="mobile-menu" onClick={() => setMobileNav(true)}><Menu size={21} /></button><div className="breadcrumb"><span>ร้านค้าสวัสดิการ</span><b>/</b><strong>{pageTitle}</strong></div><div className="topbar-actions"><div className="global-search"><Search size={17} /><span>ค้นหาเมนูหรือรายการ...</span><kbd>⌘ K</kbd></div><button className="top-icon"><Bell size={18} /><i /></button><div className="profile-pill"><span className="profile-avatar">ก</span><div><b>กัญญาณัฐ พ.</b><small>เจ้าหน้าที่</small></div><ChevronDown size={15} className="muted-icon" /></div></div></header><div className="page-content">{activeView === "dashboard" && <Dashboard setView={setActiveView} setPosShortcut={setPosShortcut} />}{activeView === "pos" && <Pos shortcut={posShortcut} setShortcut={setPosShortcut} />}{activeView === "stock" && <Stock />}{activeView === "members" && <Members />}{activeView === "reports" && <Reports />}{activeView === "settings" && <Settings />}{activeView === "logs" && <Logs />}</div><footer className="app-footer"><span>ร้านค้าสวัสดิการโรงพยาบาลผู้ป่วยจิตเวช</span><span>ศูนย์ช่วยเหลือ <CircleHelp size={14} /> · 02-XXX-XXXX</span></footer></main></div>;
}
