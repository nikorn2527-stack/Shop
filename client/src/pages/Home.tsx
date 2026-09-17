import { useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  Bell,
  Camera,
  Crown,
  Boxes,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  CreditCard,
  Download,
  FileBarChart,
  FileImage,
  LayoutDashboard,
  Menu,
  Minus,
  LockKeyhole,
  MoreHorizontal,
  PackagePlus,
  PackageSearch,
  Plus,
  Printer,
  QrCode,
  ReceiptText,
  RotateCcw,
  Search,
  ScanLine,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Trash2,
  Upload,
  UserCircle2,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";

type View = "dashboard" | "pos" | "stock" | "members" | "reports" | "settings" | "logs";
type Role = "staff" | "admin";
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

export function canAccessView(role: Role, view: View) {
  return role === "admin" || !["settings", "logs"].includes(view);
}

export function isStockAlert(stock: number, reorderLevel = 10) {
  return stock <= reorderLevel;
}

export function formatMemberNumber(mode: "running" | "year" | "manual", sequence: number) {
  if (mode === "manual") return "กรอกเอง";
  if (mode === "year") return `69-${String(sequence).padStart(5, "0")}`;
  return `M-${String(sequence).padStart(6, "0")}`;
}

const navItems: { id: View; label: string; caption: string; icon: LucideIcon }[] = [
  { id: "dashboard", label: "ภาพรวม", caption: "สรุปการดำเนินงาน", icon: LayoutDashboard },
  { id: "pos", label: "หน้าร้าน / POS", caption: "ขายสินค้าและรับชำระ", icon: ShoppingCart },
  { id: "stock", label: "สต็อกสินค้า", caption: "รับเข้าและนับสต็อก", icon: PackageSearch },
  { id: "members", label: "สมาชิกและบัญชี", caption: "สมาชิกและเจ้าหน้าที่", icon: UsersRound },
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
  { id: "M-000218", name: "นางสาวอรทัย ส.", type: "สมาชิก", balance: "฿1,240.00", last: "วันนี้ 14:24", status: "ใช้งาน", tone: "green" },
  { id: "M-000184", name: "นายธนกร พ.", type: "เจ้าหน้าที่", balance: "฿860.00", last: "วันนี้ 12:08", status: "ใช้งาน", tone: "green" },
  { id: "M-000092", name: "นางสาวพิมพ์ชนก ร.", type: "สมาชิก", balance: "฿0.00", last: "16 ก.ย. 09:12", status: "ระงับ", tone: "red" },
  { id: "M-000241", name: "นายสมชาย ว.", type: "สมาชิก", balance: "฿340.00", last: "15 ก.ย. 15:46", status: "ใช้งาน", tone: "green" },
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

function Dashboard({ setView, setPosShortcut, role }: { setView: (view: View) => void; setPosShortcut: (shortcut: string) => void; role: Role }) {
  const [range, setRange] = useState("30 วัน");
  const [selectedBar, setSelectedBar] = useState(5);
  const [bestMode, setBestMode] = useState("จำนวนขาย");
  const [selectedProduct, setSelectedProduct] = useState(0);
  const chartSets: Record<string, { label: string; value: number; top: number; bottom: number }[]> = {
    "7 วัน": ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."].map((label, index) => ({ label, value: [62, 76, 58, 88, 72, 94, 81][index], top: [18, 22, 16, 26, 20, 29, 24][index], bottom: [31, 40, 30, 47, 38, 52, 44][index] })),
    "30 วัน": ["1", "5", "10", "15", "20", "25", "30"].map((label, index) => ({ label, value: [44, 58, 50, 72, 64, 83, 75][index], top: [13, 17, 15, 21, 19, 24, 22][index], bottom: [27, 35, 31, 45, 39, 55, 48][index] })),
    "12 เดือน": ["ต.ค.", "พ.ย.", "ธ.ค.", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย."].map((label, index) => ({ label, value: [42, 56, 48, 71, 64, 82, 74, 92, 67, 88, 81, 96][index], top: [12, 16, 14, 20, 18, 23, 21, 27, 19, 25, 23, 29][index], bottom: [30, 39, 34, 49, 44, 57, 51, 64, 47, 61, 57, 67][index] })),
  };
  const chartData = chartSets[range];
  const bestSellers = bestMode === "จำนวนขาย"
    ? [["น้ำดื่มคริสตัล 600 มล.", "124 ขวด", "฿868.00", "💧", 88], ["ข้าวกล่องกะเพราไก่", "46 กล่อง", "฿2,070.00", "🍱", 61], ["กาแฟกระป๋อง เบอร์ดี้", "38 กระป๋อง", "฿684.00", "☕", 48], ["นมยูเอชที รสจืด", "32 กล่อง", "฿416.00", "🥛", 39]]
    : [["ข้าวกล่องกะเพราไก่", "฿2,070.00", "฿2,070.00", "🍱", 94], ["น้ำดื่มคริสตัล 600 มล.", "฿868.00", "฿868.00", "💧", 68], ["กาแฟกระป๋อง เบอร์ดี้", "฿684.00", "฿684.00", "☕", 54], ["นมยูเอชที รสจืด", "฿416.00", "฿416.00", "🥛", 38]];
  return (
    <>
      <SectionHeader eyebrow={`ภาพรวมการดำเนินงาน · ${role === "admin" ? "มุมมองผู้บริหาร" : "มุมมองเจ้าหน้าที่"}`} title="สวัสดีค่ะ, กัญญาณัฐ" description="ดูภาพรวมร้านค้าสวัสดิการและรายการที่ควรติดตามวันนี้" action={<><div className={`permission-chip ${role}`}><span>{role === "admin" ? <Crown size={14} /> : <ShieldCheck size={14} />}</span>{role === "admin" ? "สิทธิ์ผู้บริหาร · วิเคราะห์เต็มรูปแบบ" : "สิทธิ์เจ้าหน้าที่ · ปฏิบัติงานหน้าร้าน"}</div><button className="outline-button"><CalendarDays size={16} /> วันนี้ <ChevronDown size={15} /></button></>} />
      <div className="metric-grid">
        <div className="metric-card highlight"><div className="metric-top"><span>ยอดขายวันนี้</span><span className="metric-icon green"><ShoppingBag size={18} /></span></div><strong>฿18,460.00</strong><div className="metric-foot positive"><span>↑ 12.8%</span><span>เทียบกับเมื่อวาน</span></div></div>
        <div className="metric-card"><div className="metric-top"><span>สมาชิกที่ใช้งาน</span><span className="metric-icon blue"><UsersRound size={18} /></span></div><strong>1,248 <small>ราย</small></strong><div className="metric-foot"><span className="positive">+24 ราย</span><span>ในเดือนนี้</span></div></div>
        <div className="metric-card"><div className="metric-top"><span>สินค้าต้องติดตาม</span><span className="metric-icon amber"><PackageSearch size={18} /></span></div><strong>9 <small>รายการ</small></strong><div className="metric-foot warning"><span>3 รายการ</span><span>สต็อกต่ำมาก</span></div></div>
        <div className="metric-card"><div className="metric-top"><span>ยอดเงินคงเหลือสมาชิก</span><span className="metric-icon purple"><WalletCards size={18} /></span></div><strong>฿86,250.00</strong><div className="metric-foot"><span>↑ 4.2%</span><span>จากสัปดาห์ก่อน</span></div></div>
      </div>
      <div className="dashboard-grid">
        <section className="panel chart-panel interactive-chart-panel"><div className="panel-heading"><div><h2>ยอดขายร้านค้า</h2><p>เลือกช่วงเวลาและกดแท่งกราฟเพื่อดูรายละเอียด</p></div><div className="chart-controls">{["7 วัน", "30 วัน", "12 เดือน"].map((item) => <button className={range === item ? "active" : ""} onClick={() => { setRange(item); setSelectedBar(0); }} key={item}>{item}</button>)}</div></div><div className="chart-interactive-meta"><span><i className="dot teal" /> ยอดขายสินค้า</span><span><i className="dot lilac" /> เติมเงินสมาชิก</span><b>{chartData[selectedBar]?.label} · ยอดรวม ฿{(chartData[selectedBar]?.value * 315).toLocaleString("th-TH")}</b></div><div className="chart-wrap"><div className="y-labels"><span>20k</span><span>15k</span><span>10k</span><span>5k</span><span>0</span></div><div className="bar-chart">{chartData.map((bar, index) => <button className={`bar-column ${selectedBar === index ? "selected" : ""}`} key={bar.label} onClick={() => setSelectedBar(index)} title={`${bar.label}: ยอดรวม ฿${(bar.value * 315).toLocaleString("th-TH")}`}><div className="bar-stack"><div className="bar lilac" style={{ height: `${bar.top}%` }} /><div className="bar teal" style={{ height: `${bar.bottom}%` }} /></div><span>{bar.label}</span></button>)}</div></div><div className="chart-summary"><div><span>ยอดขายรวมช่วงนี้</span><strong>฿286,420.00</strong></div><div><span>ค่าเฉลี่ยต่อวัน</span><strong>฿16,824.70</strong></div><div><span>จำนวนบิล</span><strong>1,684 <small>บิล</small></strong></div></div></section>
        <section className="panel quick-panel"><div className="panel-heading"><div><h2>ทางลัดสำหรับเจ้าหน้าที่</h2><p>การทำรายการที่ใช้บ่อย</p></div><MoreHorizontal size={19} className="muted-icon" /></div><button className="quick-action teal-action" onClick={() => { setView("pos"); setPosShortcut("เติมเงิน") }}><span className="shortcut-icon"><ArrowDownToLine size={19} /></span><span><b>เติมเงินสมาชิก</b><small>รับฝากเงินเข้าบัญชี</small></span><span className="shortcut-arrow">→</span></button><button className="quick-action purple-action" onClick={() => { setView("pos"); setPosShortcut("ถอนเงิน") }}><span className="shortcut-icon"><ArrowUpFromLine size={19} /></span><span><b>ถอนเงินสมาชิก</b><small>ระบุหมายเหตุและแนบสลิปได้</small></span><span className="shortcut-arrow">→</span></button><button className="quick-action amber-action" onClick={() => { setView("pos"); setPosShortcut("สินค้าไม่ระบุตายตัว") }}><span className="shortcut-icon"><SlidersHorizontal size={19} /></span><span><b>สินค้า / รายการพิเศษ</b><small>สินค้าที่ไม่ระบุยูนิตตายตัว</small></span><span className="shortcut-arrow">→</span></button><div className="divider" /><div className="mini-note"><ShieldCheck size={17} /><span>ข้อมูลทุกธุรกรรมถูกบันทึกในระบบ Log อัตโนมัติ</span></div></section>
      </div>
      <div className="inventory-alert-grid"><section className="panel alert-panel stock-alert-panel"><div className="alert-heading"><div><span className="eyebrow">ควรติดตามวันนี้</span><h2>สินค้าใกล้หมดสต็อก</h2><p>ช่วยวางแผนสั่งซื้อให้เพียงพอต่อการใช้งาน</p></div><span className="alert-count red">3</span></div><div className="alert-list">{[["ขนมปังแซนด์วิช", "เหลือ 9 ชิ้น", "สั่งซื้อแนะนำ 24 ชิ้น"], ["น้ำแข็งถุงเล็ก", "เหลือ 12 ถุง", "สั่งซื้อแนะนำ 40 ถุง"], ["กาแฟกระป๋อง เบอร์ดี้", "เหลือ 18 กระป๋อง", "สั่งซื้อแนะนำ 36 กระป๋อง"]].map(([name, stock, suggestion]) => <button className="alert-row" key={name} onClick={() => setView("stock")}><span className="alert-item-icon red-bg"><PackageSearch size={15} /></span><span><b>{name}</b><small>{stock} · {suggestion}</small></span><span className="alert-arrow">→</span></button>)}</div><button className="alert-footer-action" onClick={() => setView("stock")}>ดูรายการและวางแผนสั่งซื้อ <span>→</span></button></section><section className="panel alert-panel expiry-alert-panel"><div className="alert-heading"><div><span className="eyebrow">ภายใน 30 วัน</span><h2>สินค้าใกล้หมดอายุ</h2><p>ตรวจสอบ Lot เพื่อวางแผนจัดจำหน่าย</p></div><span className="alert-count amber">4</span></div><div className="alert-list">{[["ข้าวกล่องกะเพราไก่", "หมดอายุ 18 ก.ย. 2569", "Lot ครัวกลาง-17"], ["ขนมปังแซนด์วิช", "หมดอายุ 20 ก.ย. 2569", "Lot BR-260917-A"], ["นมยูเอชที รสจืด", "หมดอายุ 30 ก.ย. 2569", "Lot ML-2608-08"]].map(([name, expiry, lot]) => <button className="alert-row" key={name} onClick={() => setView("stock")}><span className="alert-item-icon amber-bg"><CalendarDays size={15} /></span><span><b>{name}</b><small>{expiry} · {lot}</small></span><span className="alert-arrow">→</span></button>)}</div><button className="alert-footer-action amber-action-text" onClick={() => setView("stock")}>เปิดรายงานวันหมดอายุ <span>→</span></button></section></div>
      <div className="dashboard-grid lower"><section className="panel best-seller-panel"><div className="panel-heading"><div><h2>สินค้าขายดี</h2><p>กดรายการเพื่อดูอันดับและมูลค่ารวม</p></div><div className="chart-controls small">{["จำนวนขาย", "ยอดขาย"].map((item) => <button className={bestMode === item ? "active" : ""} onClick={() => { setBestMode(item); setSelectedProduct(0); }} key={item}>{item}</button>)}</div></div><div className="product-ranking-chart">{bestSellers.map(([name, qty, total, emoji, width], index) => <button className={`product-rank-row ${selectedProduct === index ? "selected" : ""}`} key={name} onClick={() => setSelectedProduct(index)}><span className={`rank rank-0${index + 1}`}>{`0${index + 1}`}</span><span className="product-thumb">{emoji}</span><span className="seller-name"><b>{name}</b><small>{qty}</small><i className="rank-progress"><em style={{ width: `${width}%` }} /></i></span><strong>{total}</strong><MoreHorizontal size={17} className="muted-icon" /></button>)}</div><div className="ranking-insight"><BarChart3 size={15} /><span>{bestSellers[selectedProduct]?.[0]} ทำยอดสูงสุดในมุมมอง{bestMode === "ยอดขาย" ? "มูลค่า" : "จำนวน"} · คลิกแถวเพื่อเลือกข้อมูล</span></div></section><section className="panel"><div className="panel-heading"><div><h2>กิจกรรมล่าสุด</h2><p>รายการที่เกิดขึ้นในระบบ</p></div><Activity size={19} className="muted-icon" /></div><div className="activity-list">{logs.slice(0, 4).map((log) => <div className="activity-row" key={log.time}><span className={`activity-dot ${log.tone}`} /><div><b>{log.action}</b><p>{log.actor} · {log.detail}</p></div><time>{log.time.split(" ").slice(-1)[0]}</time></div>)}</div></section></div>
    </>
  );
}

function Pos({ shortcut, setShortcut, role }: { shortcut: string; setShortcut: (value: string) => void; role: Role }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("ทั้งหมด");
  const [cart, setCart] = useState<CartItem[]>([
    { id: 1, name: "น้ำดื่มคริสตัล 600 มล.", price: 7, qty: 2, unit: "ขวด" },
    { id: 3, name: "ข้าวกล่องกะเพราไก่", price: 45, qty: 1, unit: "กล่อง" },
  ]);
  const [member, setMember] = useState(true);
  const [message, setMessage] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [slipPreview, setSlipPreview] = useState("");
  const [slipName, setSlipName] = useState("");
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("หักบัญชีสมาชิก");
  const [receiptNumber, setReceiptNumber] = useState("RC-260917-038");
  const filtered = useMemo(() => products.filter((product) => (category === "ทั้งหมด" || product.category === category) && product.name.toLowerCase().includes(query.toLowerCase())), [category, query]);
  const subtotal = calculateCartSubtotal(cart);
  const addProduct = (product: Product) => { setCart((items) => addScannedItem(items, product)); setMessage(`เพิ่ม ${product.name} แล้ว · สแกนซ้ำเพื่อเพิ่มจำนวน`); };
  const updateQty = (id: number, delta: number) => setCart((items) => items.flatMap((item) => item.id === id ? (item.qty + delta <= 0 ? [] : [{ ...item, qty: item.qty + delta }]) : [item]));
  const runShortcut = (name: string) => { setShortcut(name); setMessage(`${name}: เปิดช่องทำรายการเรียบร้อย`); };
  const simulateScan = (value = barcode) => { const match = products.find((product) => String(product.id) === value.trim() || value.trim().endsWith(String(product.id).padStart(3, "0"))); if (!match) { setMessage(`ไม่พบสินค้าในรหัส ${value || "ที่ระบุ"} · ลองใช้รหัสตัวอย่าง 001, 003 หรือ 008`); return; } addProduct(match); setBarcode(""); setScanOpen(false); };
  const handleSlip = (file?: File) => { if (!file) return; setSlipName(file.name); setSlipPreview(URL.createObjectURL(file)); setMessage(`แนบสลิป ${file.name} แล้ว · พร้อมบันทึกไปกับรายการ`); };
  const completePayment = (method: string) => { setPaymentMethod(method); setReceiptNumber(`RC-260917-${String(Math.floor(Math.random() * 80) + 40).padStart(3, "0")}`); setMessage(`ชำระเงินสำเร็จด้วย${method}`); setReceiptOpen(true); };
  const startNewSale = () => { setCart([]); setShortcut(""); setSlipName(""); setSlipPreview(""); setReceiptOpen(false); setMessage("เริ่มรายการขายใหม่แล้ว"); };
  return <>
    <SectionHeader eyebrow="หน้าร้าน / จุดขายสินค้า" title="POS · ขายสินค้า" description="สแกนบาร์โค้ดหรือค้นหาสินค้า แล้วเลือกวิธีชำระเงินที่ต้องการ" action={<div className="pos-status"><span className="live-dot" /> จุดขายที่ 01 · เปิดให้บริการ</div>} />
    <div className="pos-layout">
      <section className="panel product-panel"><div className="pos-search-row"><div className="search-field large"><Search size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาชื่อสินค้า หรือสแกนบาร์โค้ด..." autoFocus /><kbd>⌘ K</kbd></div><button className="scan-button" onClick={() => { setScanOpen(true); setMessage("เปิดกล้องจำลองแล้ว · เลือกหรือพิมพ์รหัสบาร์โค้ด"); }}><ScanLine size={18} /> สแกน</button></div><div className="scan-status-strip"><div className="scan-status-icon"><Camera size={17} /></div><div><b>เครื่องสแกนพร้อมใช้งาน</b><small>จำลองการอ่านบาร์โค้ด · กด “สแกน” เพื่อเปิดหน้าต่าง</small></div><span className="live-dot" /></div><div className="category-tabs">{["ทั้งหมด", "อาหาร", "เครื่องดื่ม", "ของใช้"].map((item) => <button className={category === item ? "active" : ""} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div><div className="product-grid">{filtered.map((product) => <button className="product-card" key={product.id} onClick={() => addProduct(product)}><div className={`product-art ${product.color}`}><span>{product.emoji}</span>{product.stock <= 10 && <i>เหลือ {product.stock}</i>}</div><div className="product-card-info"><b>{product.name}</b><small>{product.unit} · คงเหลือ {product.stock}</small><strong>{money(product.price)}</strong></div><span className="add-product"><Plus size={15} /></span></button>)}</div><div className="pos-help"><CircleHelp size={16} /><span>สแกนสินค้าเดิมซ้ำได้ทันทีเพื่อเพิ่มจำนวน · กดที่สินค้าเพื่อเพิ่ม 1 ชิ้น</span></div></section>
      <aside className="panel cart-panel"><div className="cart-heading"><div><h2>รายการขาย</h2><p>{cart.reduce((sum, item) => sum + item.qty, 0)} รายการ · บิลใหม่</p></div><button className="icon-button" onClick={() => setCart([])} title="ล้างรายการ"><Trash2 size={17} /></button></div>{shortcut && <div className="shortcut-banner"><span className="shortcut-banner-icon">{shortcut === "เติมเงิน" ? <ArrowDownToLine size={17} /> : shortcut === "ถอนเงิน" ? <ArrowUpFromLine size={17} /> : <SlidersHorizontal size={17} />}</span><div><b>{shortcut}</b><small>{shortcut === "เติมเงิน" ? "เลือกสมาชิกและระบุจำนวนเงิน" : shortcut === "ถอนเงิน" ? "บันทึกหมายเหตุและแนบสลิปได้" : "ระบุราคาและหน่วยตามจริง"}</small></div><button onClick={() => setShortcut("")}><X size={15} /></button></div>}<div className="cart-items">{cart.length === 0 ? <div className="empty-cart"><ShoppingCart size={28} /><b>ยังไม่มีสินค้าในบิล</b><span>เลือกสินค้าจากรายการด้านซ้าย</span></div> : cart.map((item) => <div className="cart-item" key={item.id}><div className="cart-item-icon">{item.name.startsWith("น้ำ") ? "💧" : item.name.startsWith("ข้าว") ? "🍱" : "🛍️"}</div><div className="cart-item-main"><b>{item.name}</b><span>{money(item.price)} / {item.unit}</span><div className="qty-control"><button onClick={() => updateQty(item.id, -1)}><Minus size={13} /></button><span>{item.qty}</span><button onClick={() => updateQty(item.id, 1)}><Plus size={13} /></button></div></div><strong>{money(item.price * item.qty)}</strong><button className="remove-item" onClick={() => updateQty(item.id, -item.qty)}><X size={14} /></button></div>)}</div><div className="member-select" onClick={() => setMember(!member)}><div className="member-avatar"><UserCircle2 size={18} /></div><div><b>{member ? "M-000218 · สมาชิกอรทัย ส." : "บุคคลทั่วไป"}</b><small>{member ? "ยอดคงเหลือ ฿1,240.00" : "ชำระเงินสดหรือ QR"}</small></div><ChevronDown size={16} className="muted-icon" /></div>{(shortcut === "เติมเงิน" || shortcut === "ถอนเงิน") && <div className="slip-uploader"><div className="slip-heading"><span><FileImage size={16} /> หลักฐานการโอน / สลิป</span><small>ไม่บังคับ</small></div>{slipPreview ? <div className="slip-preview"><img src={slipPreview} alt="ตัวอย่างสลิป" /><div><b>{slipName}</b><small>พร้อมแนบกับรายการ {shortcut}</small></div><button onClick={() => { setSlipPreview(""); setSlipName(""); }}><X size={14} /></button></div> : <label className="upload-drop" htmlFor="slip-upload"><Upload size={17} /><span><b>คลิกเพื่ออัปโหลดรูปสลิป</b><small>รองรับ JPG, PNG ขนาดไม่เกิน 10 MB</small></span><input id="slip-upload" type="file" accept="image/png,image/jpeg" onChange={(event) => handleSlip(event.target.files?.[0])} /></label>}</div>}<div className="cart-totals"><div><span>ยอดรวมสินค้า</span><strong>{money(subtotal)}</strong></div><div><span>ส่วนลดสมาชิก</span><strong className="discount">- ฿0.00</strong></div><div className="total-line"><span>ยอดที่ต้องชำระ</span><strong>{money(subtotal)}</strong></div></div><div className="payment-actions"><button className="pay-button member-pay" onClick={() => member ? completePayment("หักบัญชีสมาชิก") : setMessage("กรุณาเลือกสมาชิกก่อนชำระแบบหักบัญชี")}><CreditCard size={18} /> หักบัญชีสมาชิก</button><div className="pay-split"><button onClick={() => completePayment("เงินสด")}><span className="pay-icon cash"><WalletCards size={16} /></span> เงินสด</button><button onClick={() => completePayment("QR / สแกน")}><span className="pay-icon qr"><QrCode size={16} /></span> QR / สแกน</button></div></div>{role === "admin" && <div className="admin-pos-note"><Crown size={14} /><span>ผู้บริหารสามารถแก้ไขราคา/ตรวจสอบรายการก่อนปิดบิล</span></div>}{message && <div className="inline-message"><Check size={15} /> {message}</div>}</aside>
    </div>
    <div className="shortcut-strip"><div><span className="eyebrow">ทางลัด</span><b>รายการที่ไม่ใช่สินค้า</b><small>เติมเงิน ถอนเงิน หรือรายการที่ระบุยูนิตไม่ได้</small></div><button onClick={() => runShortcut("เติมเงิน")}><ArrowDownToLine size={17} /><span>เติมเงินสมาชิก</span><kbd>F2</kbd></button><button onClick={() => runShortcut("ถอนเงิน")}><ArrowUpFromLine size={17} /><span>ถอนเงินสมาชิก</span><kbd>F3</kbd></button><button onClick={() => runShortcut("สินค้าไม่ระบุตายตัว")}><SlidersHorizontal size={17} /><span>เพิ่มรายการพิเศษ</span><kbd>F4</kbd></button></div>
    {scanOpen && <div className="modal-backdrop" onClick={() => setScanOpen(false)}><div className="scanner-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">SIMULATED SCANNER</span><h2>สแกนบาร์โค้ดสินค้า</h2><p>จำลองการเปิดกล้องเพื่ออ่านรหัสสินค้า</p></div><button className="icon-button" onClick={() => setScanOpen(false)}><X size={17} /></button></div><div className="scanner-viewport"><div className="scanner-corner tl" /><div className="scanner-corner tr" /><div className="scanner-corner bl" /><div className="scanner-corner br" /><div className="scanner-line" /><ScanLine size={46} /><span>เล็งบาร์โค้ดให้อยู่ในกรอบ</span></div><div className="scanner-input"><label>รหัสบาร์โค้ดตัวอย่าง</label><div className="search-field"><ScanLine size={16} /><input autoFocus value={barcode} onChange={(event) => setBarcode(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") simulateScan(); }} placeholder="เช่น 001, 003 หรือ 008" /><button onClick={() => simulateScan()}><Check size={16} /></button></div></div><div className="sample-codes"><span>ลองสแกน:</span>{["001", "003", "008"].map((code) => <button key={code} onClick={() => { setBarcode(code); simulateScan(code); }}>{code} · {products[Number(code) - 1]?.name.split(" ").slice(0, 2).join(" ")}</button>)}</div><div className="scanner-footer"><span><RotateCcw size={14} /> สแกนซ้ำเพื่อเพิ่มจำนวนสินค้า</span><button className="outline-button" onClick={() => setScanOpen(false)}>ยกเลิก</button></div></div></div>}
    {receiptOpen && <div className="modal-backdrop" onClick={() => setReceiptOpen(false)}><div className="receipt-modal" onClick={(event) => event.stopPropagation()}><div className="receipt-success"><span><Check size={22} /></span><div><b>ชำระเงินสำเร็จ</b><small>ตรวจสอบรายละเอียดก่อนพิมพ์หรือเริ่มรายการใหม่</small></div><button className="icon-button" onClick={() => setReceiptOpen(false)}><X size={17} /></button></div><div className="receipt-paper"><div className="receipt-brand"><div className="brand-mark small"><span>ส</span></div><div><b>ร้านค้าสวัสดิการ รพจ.</b><small>โรงพยาบาลผู้ป่วยจิตเวช</small></div></div><div className="receipt-divider" /><div className="receipt-meta"><span>ใบเสร็จเลขที่ <b>{receiptNumber}</b></span><span>17 ก.ย. 2569 · 14:42 น.</span></div><div className="receipt-customer"><span>ผู้ซื้อ</span><b>{member ? "สมาชิกอรทัย ส. · M-000218" : "บุคคลทั่วไป"}</b></div>{cart.map((item) => <div className="receipt-line" key={item.id}><span>{item.name}<small>{item.qty} {item.unit} × {money(item.price)}</small></span><b>{money(item.qty * item.price)}</b></div>)}<div className="receipt-total"><span>ยอดชำระทั้งหมด</span><b>{money(subtotal)}</b></div><div className="receipt-payment"><span>วิธีชำระเงิน</span><b>{paymentMethod}</b></div>{member && paymentMethod === "หักบัญชีสมาชิก" && <div className="receipt-balance"><span>ยอดคงเหลือหลังรายการ</span><b>฿1,181.00</b></div>}<div className="receipt-thanks">ขอบคุณที่ใช้บริการ<br /><small>ข้อมูลรายการถูกบันทึกในระบบ Log แล้ว</small></div></div><div className="receipt-actions"><button className="outline-button" onClick={() => { setReceiptOpen(false); setMessage("ส่งใบเสร็จไปพิมพ์แล้ว"); }}><Printer size={16} /> พิมพ์ใบเสร็จ</button><button className="primary-button" onClick={startNewSale}><Plus size={16} /> เริ่มรายการขายใหม่</button></div></div></div>}
  </>;
}

function Stock({ role }: { role: Role }) {
  const [notice, setNotice] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [newItem, setNewItem] = useState({ name: "", sku: "", unit: "ชิ้น", price: "", reorder: "10" });
  const [addedItems, setAddedItems] = useState<string[]>([]);
  const addItem = () => { if (!newItem.name.trim()) { setNotice("กรุณาระบุชื่อสินค้า"); return; } setAddedItems((items) => [...items, newItem.name]); setAddOpen(false); setNotice(`เพิ่มสินค้า “${newItem.name}” เข้ารายการรอตั้งสต็อกแล้ว`); setNewItem({ name: "", sku: "", unit: "ชิ้น", price: "", reorder: "10" }); };
  return <><SectionHeader eyebrow="คลังสินค้าและต้นทุน" title="สต็อกสินค้า" description="ติดตามจำนวนคงเหลือ Lot วันหมดอายุ และต้นทุนสินค้าในคลัง" action={<><button className="outline-button" onClick={() => setNotice("เปิดตัวกรองสต็อกแล้ว")}><SlidersHorizontal size={16} /> ตัวกรอง</button><button className="outline-button" onClick={() => setAddOpen(true)}><Plus size={16} /> เพิ่มไอเทมสินค้า</button><button className="primary-button" onClick={() => setNotice(role === "admin" ? "เปิดแบบฟอร์มรับเข้าสินค้าแล้ว" : "สิทธิ์เจ้าหน้าที่: ส่งคำขอรับเข้าสินค้าให้ผู้บริหารตรวจสอบแล้ว")}><PackagePlus size={16} /> {role === "admin" ? "รับเข้าสินค้า" : "ขอรับเข้าสินค้า"}</button></>} /><div className="stock-overview"><div className="stock-stat"><span className="stat-icon blue"><Boxes size={18} /></span><div><small>มูลค่าสต็อกทั้งหมด</small><strong>฿184,280.00</strong></div></div><div className="stock-stat"><span className="stat-icon amber"><PackageSearch size={18} /></span><div><small>รายการทั้งหมด</small><strong>{248 + addedItems.length} <em>SKU</em></strong></div></div><div className="stock-stat"><span className="stat-icon red"><Activity size={18} /></span><div><small>ต้องสั่งซื้อ</small><strong className="red-text">9 <em>รายการ</em></strong></div></div><div className="stock-stat"><span className="stat-icon green"><FileBarChart size={18} /></span><div><small>กำไรขั้นต้นเฉลี่ย</small><strong className="green-text">24.8%</strong></div></div></div><section className="panel table-panel"><div className="table-toolbar"><div><h2>รายการคงคลัง</h2><p>อัปเดตล่าสุดเมื่อ 17 ก.ย. 2569 เวลา 14:40 น.</p></div><div className="toolbar-actions"><button className="outline-button" onClick={() => setNotice("เปิดโหมดนับสต็อกแล้ว")}><ClipboardList size={16} /> นับสต็อก</button><button className="outline-button" onClick={() => setNotice("ส่งออกรายงานสต็อกแล้ว")}><Download size={16} /> ส่งออก</button></div></div><div className="table-wrap"><table><thead><tr><th>รหัส / สินค้า</th><th>Lot / วันหมดอายุ</th><th>คงเหลือ</th><th>ต้นทุน</th><th>ราคาขาย</th><th>สถานะ</th><th /></tr></thead><tbody>{stockRows.map((row) => <tr key={row.sku}><td><b>{row.name}</b><small>{row.sku}</small></td><td><b>{row.lot}</b><small>{row.expiry}</small></td><td><b>{row.qty}</b></td><td>{row.cost}</td><td>{row.retail}</td><td><StatusPill tone={row.tone}>{row.status}</StatusPill></td><td><button className="table-more" onClick={() => setNotice(`เลือก ${row.name}`)}><MoreHorizontal size={18} /></button></td></tr>)}{addedItems.map((name, index) => <tr key={`new-${name}-${index}`}><td><b>{name}</b><small>{newItem.sku || "รอตั้งรหัส"}</small></td><td><b>ยังไม่รับเข้า</b><small>ระบุ Lot ภายหลัง</small></td><td><b>0 {newItem.unit || "ชิ้น"}</b></td><td>รอระบุ</td><td>รอระบุ</td><td><StatusPill tone="blue">รายการใหม่</StatusPill></td><td><button className="table-more"><MoreHorizontal size={18} /></button></td></tr>)}</tbody></table></div>{notice && <div className="notice-bar"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}</section>{addOpen && <div className="modal-backdrop" onClick={() => setAddOpen(false)}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">INVENTORY ITEM</span><h2>เพิ่มไอเทมสินค้า</h2><p>สร้างรายการสินค้าใหม่ก่อนรับเข้า Lot และจำนวน</p></div><button className="icon-button" onClick={() => setAddOpen(false)}><X size={17} /></button></div><div className="form-grid compact-form"><label className="wide">ชื่อสินค้า *<input autoFocus value={newItem.name} onChange={(event) => setNewItem({ ...newItem, name: event.target.value })} placeholder="เช่น น้ำดื่มขวดเล็ก" /></label><label>รหัสสินค้า / SKU<input value={newItem.sku} onChange={(event) => setNewItem({ ...newItem, sku: event.target.value })} placeholder="เช่น DRK-009" /></label><label>หน่วยขาย<select value={newItem.unit} onChange={(event) => setNewItem({ ...newItem, unit: event.target.value })}><option>ชิ้น</option><option>ขวด</option><option>ถุง</option><option>กล่อง</option><option>แพ็ก</option></select></label><label>ราคาขายเริ่มต้น<input value={newItem.price} onChange={(event) => setNewItem({ ...newItem, price: event.target.value })} placeholder="฿0.00" /></label><label>จุดสั่งซื้อขั้นต่ำ<input value={newItem.reorder} onChange={(event) => setNewItem({ ...newItem, reorder: event.target.value })} placeholder="10" /></label></div><div className="modal-actions"><button className="outline-button" onClick={() => setAddOpen(false)}>ยกเลิก</button><button className="primary-button" onClick={addItem}><Plus size={16} /> เพิ่มรายการสินค้า</button></div></div></div>}</>;
}

function Members() {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ทั้งหมด");
  const [notice, setNotice] = useState("");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [newMember, setNewMember] = useState({ firstName: "", lastName: "", idCard: "", initialBalance: "" });
  const filtered = memberRows.filter((row) => `${row.name} ${row.id}`.toLowerCase().includes(query.toLowerCase()) && (statusFilter === "ทั้งหมด" || row.status === statusFilter));
  const registerMember = () => { if (!newMember.firstName.trim() || !newMember.lastName.trim()) { setNotice("กรุณาระบุชื่อและนามสกุลสมาชิก"); return; } setRegisterOpen(false); setNotice(`ลงทะเบียนสมาชิก ${newMember.firstName} ${newMember.lastName} แล้ว${newMember.initialBalance ? ` · เงินเริ่มต้น ${money(Number(newMember.initialBalance))}` : " · ยังไม่เติมเงิน"}`); setNewMember({ firstName: "", lastName: "", idCard: "", initialBalance: "" }); };
  return <><SectionHeader eyebrow="สมาชิกและบัญชีสวัสดิการ" title="จัดการสมาชิก" description="ลงทะเบียนสมาชิก ระบุเงินเริ่มต้น (ถ้ามี) ระงับการใช้งาน และดูประวัติรายบุคคล" action={<button className="primary-button" onClick={() => setRegisterOpen(true)}><Plus size={16} /> ลงทะเบียนสมาชิก</button>} /><div className="member-top-grid"><div className="member-balance-card"><div><span className="eyebrow">ยอดเงินในบัญชีสมาชิกทั้งหมด</span><strong>฿86,250.00</strong><small>เพิ่มขึ้น 4.2% จากสัปดาห์ก่อน</small></div><div className="balance-orb"><WalletCards size={26} /></div></div><div className="member-mini-card"><span className="stat-icon green"><UsersRound size={18} /></span><div><small>สมาชิกทั้งหมด</small><strong>1,324 <em>ราย</em></strong><p><span className="green-text">1,248 ใช้งาน</span> · 76 ระงับ</p></div></div><div className="member-mini-card"><span className="stat-icon purple"><ArrowDownToLine size={18} /></span><div><small>ลงทะเบียนเดือนนี้</small><strong>86 <em>ราย</em></strong><p>ข้อมูลสมาชิกใหม่  ·  ไม่รวมการเติมเงิน</p></div></div></div><section className="panel table-panel"><div className="table-toolbar"><div><h2>สมาชิกทั้งหมด</h2><p>ค้นหาและกรองตามสถานะการใช้งานได้ทันที</p></div><div className="toolbar-actions"><div className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาชื่อ หรือเลขสมาชิก" /></div><div className="filter-pills">{["ทั้งหมด", "ใช้งาน", "ระงับ"].map((item) => <button className={statusFilter === item ? "active" : ""} key={item} onClick={() => setStatusFilter(item)}>{item}{item !== "ทั้งหมด" && <span>{memberRows.filter((row) => row.status === item).length}</span>}</button>)}</div></div></div><div className="table-filter-summary"><span><Search size={13} /> {query ? `ค้นหา “${query}”` : "สมาชิกทั้งหมด"}</span><span>แสดง {filtered.length} จาก {memberRows.length} รายการ</span></div><div className="table-wrap"><table><thead><tr><th>สมาชิก</th><th>ประเภท</th><th>ยอดเงินคงเหลือ</th><th>รายการล่าสุด</th><th>สถานะการใช้งาน</th><th /></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}><td><div className="member-cell"><span className="member-table-avatar">{row.name.slice(3, 4)}</span><div><b>{row.name}</b><small>{row.id}</small></div></div></td><td>{row.type === "ผู้ป่วย" ? "สมาชิก" : row.type}</td><td><b>{row.balance}</b></td><td>{row.last}</td><td><StatusPill tone={row.tone}>{row.status === "ใช้งาน" ? "ใช้งานอยู่" : "ระงับการใช้งาน"}</StatusPill></td><td><button className="row-action" onClick={() => setNotice(`กำลังเปิดประวัติของ ${row.name}`)}>ดูประวัติ <span>→</span></button></td></tr>)}</tbody></table></div>{filtered.length === 0 && <div className="empty-filter"><UsersRound size={22} /><b>ไม่พบสมาชิกตามเงื่อนไข</b><span>ลองเปลี่ยนคำค้นหาหรือสถานะ</span></div>}{notice && <div className="notice-bar"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}</section>{registerOpen && <div className="modal-backdrop" onClick={() => setRegisterOpen(false)}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">MEMBER REGISTRATION</span><h2>ลงทะเบียนสมาชิก</h2><p>กรอกข้อมูลสมาชิกและเลือกเติมเงินครั้งแรกหรือไม่ก็ได้</p></div><button className="icon-button" onClick={() => setRegisterOpen(false)}><X size={17} /></button></div><div className="member-number-preview"><span><CreditCard size={16} /> หมายเลขสมาชิกจะกำหนดอัตโนมัติ</span><b>{formatMemberNumber("running", 1325)}</b></div><div className="form-grid compact-form"><label>ชื่อ *<input autoFocus value={newMember.firstName} onChange={(event) => setNewMember({ ...newMember, firstName: event.target.value })} placeholder="ชื่อ" /></label><label>นามสกุล *<input value={newMember.lastName} onChange={(event) => setNewMember({ ...newMember, lastName: event.target.value })} placeholder="นามสกุล" /></label><label className="wide">เลขที่บัตรประชาชน<input value={newMember.idCard} onChange={(event) => setNewMember({ ...newMember, idCard: event.target.value })} placeholder="-" /></label><label className="wide">เงินเริ่มต้น (ถ้ามี)<input type="number" min="0" value={newMember.initialBalance} onChange={(event) => setNewMember({ ...newMember, initialBalance: event.target.value })} placeholder="เว้นว่างได้ หากยังไม่เติมเงิน" /></label></div><div className="initial-balance-note"><ShieldCheck size={15} /> เงินจำนวนนี้เป็นยอดเริ่มต้นตอนลงทะเบียน ไม่ใช่เมนูเติมเงินภายหลัง</div><div className="modal-actions"><button className="outline-button" onClick={() => setRegisterOpen(false)}>ยกเลิก</button><button className="primary-button" onClick={registerMember}><Check size={16} /> บันทึกสมาชิก</button></div></div></div>}</>;
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
  const [numberMode, setNumberMode] = useState("running");
  return <><SectionHeader eyebrow="ระบบและการกำหนดค่า" title="ตั้งค่า" description="จัดการข้อมูลร้านค้า ใบเสร็จ การแจ้งเตือน และรูปแบบเลขสมาชิก" action={<button className="primary-button" onClick={() => setSaved(true)}><Check size={16} /> บันทึกการตั้งค่า</button>} /><div className="settings-layout"><div className="settings-nav"><button className="active"><ReceiptText size={17} /> ใบเสร็จและการขาย</button><button><CreditCard size={17} /> สมาชิกและเลขสมาชิก</button><button><WalletCards size={17} /> รูปแบบการชำระเงิน</button><button><Bell size={17} /> การแจ้งเตือน</button><button><ShieldCheck size={17} /> สิทธิ์และบทบาท</button><button><Activity size={17} /> การบันทึก Log</button></div><div className="settings-content"><section className="panel settings-card"><div className="settings-heading"><div><h2>ข้อมูลร้านค้า</h2><p>ข้อมูลจะแสดงบนหัวใบเสร็จและรายงาน</p></div><ShoppingBag size={20} className="muted-icon" /></div><div className="form-grid"><label>ชื่อร้านค้า<input defaultValue="ร้านค้าสวัสดิการโรงพยาบาลผู้ป่วยจิตเวช" /></label><label>รหัสร้านค้า<input defaultValue="WEL-PSY-001" /></label><label className="wide">ที่อยู่<input defaultValue="โรงพยาบาลผู้ป่วยจิตเวช · ฝ่ายสวัสดิการ" /></label></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>การกำหนดหมายเลขสมาชิก</h2><p>เลือกวิธีสร้างหมายเลขสำหรับสมาชิกใหม่ที่จะลงทะเบียน</p></div><CreditCard size={20} className="muted-icon" /></div><div className="number-mode-grid">{[["running", "รันเลขต่อเนื่อง", "M-000001, M-000002, ..."], ["year", "ขึ้นต้นด้วยปี", "69-00001, 69-00002, ..."], ["manual", "กำหนดเอง", "เจ้าหน้าที่กรอกหมายเลขเอง"]].map(([value, title, detail]) => <button className={numberMode === value ? "selected" : ""} key={value} onClick={() => setNumberMode(value)}><span className="number-radio">{numberMode === value && <i />}</span><span><b>{title}</b><small>{detail}</small></span></button>)}</div><div className="number-preview"><span>ตัวอย่างสมาชิกถัดไป</span><b>{formatMemberNumber(numberMode as "running" | "year" | "manual", 1325)}</b></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>ใบเสร็จรับเงิน</h2><p>กำหนดรายละเอียดที่ต้องการแสดงบนใบเสร็จ</p></div><ReceiptText size={20} className="muted-icon" /></div><div className="toggle-row"><div><b>พิมพ์ใบเสร็จอัตโนมัติหลังชำระเงิน</b><small>ใช้กับเครื่องพิมพ์ใบเสร็จที่เชื่อมต่ออยู่</small></div><button className={`toggle ${receipt ? "on" : ""}`} onClick={() => setReceipt(!receipt)}><span /></button></div><div className="toggle-row"><div><b>แสดงยอดคงเหลือสมาชิกบนใบเสร็จ</b><small>แสดงยอดก่อนและหลังรายการ</small></div><button className="toggle on"><span /></button></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>การแจ้งเตือน</h2><p>ช่วยให้เจ้าหน้าที่ติดตามรายการสำคัญได้ทันเวลา</p></div><Bell size={20} className="muted-icon" /></div><div className="toggle-row"><div><b>แจ้งเตือนเมื่อสมาชิกมียอดคงเหลือต่ำ</b><small>แจ้งเตือนเมื่อยอดต่ำกว่า ฿100.00</small></div><button className={`toggle ${memberAlert ? "on" : ""}`} onClick={() => setMemberAlert(!memberAlert)}><span /></button></div><div className="toggle-row"><div><b>แจ้งเตือนสินค้าใกล้หมดสต็อก</b><small>แจ้งเตือนเมื่อจำนวนต่ำกว่าจุดสั่งซื้อ</small></div><button className="toggle on"><span /></button></div><div className="toggle-row"><div><b>แจ้งเตือนสินค้าใกล้หมดอายุ</b><small>แจ้งเตือนล่วงหน้า 30 วัน</small></div><button className="toggle on"><span /></button></div></section>{saved && <div className="notice-bar"><Check size={16} /> บันทึกการตั้งค่าเรียบร้อยแล้ว<button onClick={() => setSaved(false)}><X size={14} /></button></div>}</div></div></>;
}

function Logs() {
  return <><SectionHeader eyebrow="ตรวจสอบย้อนหลังและความโปร่งใส" title="ระบบ Log" description="บันทึกทุกกิจกรรมสำคัญของผู้ใช้งานและธุรกรรมในระบบ" action={<button className="outline-button"><Download size={16} /> ส่งออก Log</button>} /><div className="log-summary"><div><Activity size={18} /><span>รายการวันนี้<strong>386</strong></span></div><div><ShieldCheck size={18} /><span>ผู้ใช้งานในระบบ<strong>12</strong></span></div><div><ReceiptText size={18} /><span>ธุรกรรมที่บันทึก<strong>100%</strong></span></div></div><section className="panel table-panel"><div className="table-toolbar"><div><h2>กิจกรรมทั้งหมด</h2><p>ข้อมูลสำหรับตรวจสอบย้อนหลังของเจ้าหน้าที่และผู้บริหาร</p></div><div className="toolbar-actions"><div className="search-field"><Search size={16} /><input placeholder="ค้นหากิจกรรม หรือผู้ใช้งาน" /></div><button className="outline-button"><CalendarDays size={16} /> ช่วงเวลา</button></div></div><div className="table-wrap"><table><thead><tr><th>วันและเวลา</th><th>ผู้ทำรายการ</th><th>กิจกรรม</th><th>รายละเอียด</th><th>ระดับสิทธิ์</th><th /></tr></thead><tbody>{logs.concat(logs).map((log, index) => <tr key={`${log.time}-${index}`}><td>{log.time}</td><td><b>{log.actor}</b></td><td><StatusPill tone={log.tone}>{log.action}</StatusPill></td><td>{log.detail}</td><td>{log.role}</td><td><button className="table-more"><MoreHorizontal size={18} /></button></td></tr>)}</tbody></table></div></section></>;
}

function RoleSwitcher({ role, onChange }: { role: Role; onChange: (role: Role) => void }) {
  return <div className="role-switcher" aria-label="สลับสิทธิ์การใช้งาน"><span className="role-switch-label"><ShieldCheck size={13} /> สิทธิ์</span><button className={role === "staff" ? "active" : ""} onClick={() => onChange("staff")}>เจ้าหน้าที่</button><button className={role === "admin" ? "active admin" : ""} onClick={() => onChange("admin")}><Crown size={12} /> ผู้บริหาร</button></div>;
}

export default function Home() {
  const [activeView, setActiveView] = useState<View>("dashboard");
  const [mobileNav, setMobileNav] = useState(false);
  const [posShortcut, setPosShortcut] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const safeView = canAccessView(role, activeView) ? activeView : "dashboard";
  const pageTitle = navItems.find((item) => item.id === safeView)?.label ?? (safeView === "settings" ? "ตั้งค่า" : safeView === "logs" ? "ระบบ Log" : "ภาพรวม");
  const profileName = role === "admin" ? "วรพจน์ ด." : "กัญญาณัฐ พ.";
  const switchRole = (nextRole: Role) => { setRole(nextRole); if (nextRole === "staff" && (activeView === "settings" || activeView === "logs")) setActiveView("dashboard"); };
  return <div className="app-shell"><aside className={`sidebar ${mobileNav ? "open" : ""}`}><div className="brand"><div className="brand-mark"><span>ส</span></div><div><b>สวัสดิการ รพจ.</b><small>Hospital Welfare Store</small></div><button className="mobile-close" onClick={() => setMobileNav(false)}><X size={19} /></button></div><div className="role-card"><div className={`role-avatar ${role}`}>{role === "admin" ? "ว" : "ก"}</div><div><b>{profileName}</b><span>{role === "admin" ? "ผู้บริหารระบบ" : "เจ้าหน้าที่ร้านค้า"}</span></div><ChevronDown size={15} className="muted-icon" /></div><RoleSwitcher role={role} onChange={switchRole} /><nav>{navItems.map(({ id, label, caption, icon: Icon }) => <button className={safeView === id ? "active" : ""} key={id} onClick={() => { setActiveView(id); setMobileNav(false); }}><Icon size={19} /><span><b>{label}</b><small>{caption}</small></span>{id === "stock" && <i className="nav-badge">9</i>}</button>)}</nav><div className="nav-separator" /><nav className="secondary-nav">{role === "admin" ? <><button className={safeView === "settings" ? "active" : ""} onClick={() => { setActiveView("settings"); setMobileNav(false); }}><Settings2 size={19} /><span><b>ตั้งค่า</b><small>ระบบและใบเสร็จ</small></span></button><button className={safeView === "logs" ? "active" : ""} onClick={() => { setActiveView("logs"); setMobileNav(false); }}><Activity size={19} /><span><b>ระบบ Log</b><small>ประวัติการใช้งาน</small></span></button></> : <div className="locked-nav"><LockKeyhole size={15} /><span>เมนูผู้บริหารถูกซ่อน</span></div>}</nav><div className="sidebar-footer"><div className="secure-badge"><ShieldCheck size={17} /><span><b>ระบบปลอดภัย</b><small>ข้อมูลถูกเข้ารหัสและสำรอง</small></span></div><div className="sidebar-version">v1.0.0 · ฝ่ายสวัสดิการ</div></div></aside><main className="main-shell"><header className="topbar"><button className="mobile-menu" onClick={() => setMobileNav(true)}><Menu size={21} /></button><div className="breadcrumb"><span>ร้านค้าสวัสดิการ</span><b>/</b><strong>{pageTitle}</strong></div><div className="topbar-actions"><div className="global-search"><Search size={17} /><span>ค้นหาเมนูหรือรายการ...</span><kbd>⌘ K</kbd></div><RoleSwitcher role={role} onChange={switchRole} /><button className="top-icon"><Bell size={18} /><i /></button><div className="profile-pill"><span className={`profile-avatar ${role}`}>{role === "admin" ? "ว" : "ก"}</span><div><b>{profileName}</b><small>{role === "admin" ? "ผู้บริหาร" : "เจ้าหน้าที่"}</small></div><ChevronDown size={15} className="muted-icon" /></div></div></header><div className="page-content">{safeView === "dashboard" && <Dashboard setView={setActiveView} setPosShortcut={setPosShortcut} role={role} />}{safeView === "pos" && <Pos shortcut={posShortcut} setShortcut={setPosShortcut} role={role} />}{safeView === "stock" && <Stock role={role} />}{safeView === "members" && <Members />}{safeView === "reports" && <Reports />}{safeView === "settings" && role === "admin" && <Settings />}{safeView === "logs" && role === "admin" && <Logs />}</div><footer className="app-footer"><span>ร้านค้าสวัสดิการโรงพยาบาลผู้ป่วยจิตเวช</span><span>ศูนย์ช่วยเหลือ <CircleHelp size={14} /> · 02-XXX-XXXX</span></footer></main></div>;
}
