import { useMemo, useState } from "react";
import {
  Activity, ArrowDownToLine, ArrowUpFromLine, BarChart3, CalendarDays, ChevronDown, Crown, MoreHorizontal, PackageSearch, ReceiptText, ShieldCheck, ShoppingBag, SlidersHorizontal, WalletCards,
} from "lucide-react";
import type { Role, View } from "./pageData";
import { money } from "./pageData";
import { SectionHeader } from "./PagePrimitives";
import { trpc } from "@/lib/trpc";
import { formatAxisLabel, formatThaiDate, formatTimeShort, parseBahtFromDetail } from "./viewFormat";

const THAI_WEEKDAYS = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const THAI_SHORT_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const RANGE_DAYS: Record<string, number> = { "7 วัน": 7, "30 วัน": 30, "12 เดือน": 365 };

type ChartPoint = { label: string; value: number; revenue: number; deposit: number; top: number; bottom: number };

/** Sums "เติมเงินสมาชิก" audit entries per calendar day for the lilac chart segment. */
function buildDepositsByDay(logs: { action: string; detail: string; createdAt: string }[]) {
  const map = new Map<string, number>();
  for (const log of logs) {
    if (log.action !== "เติมเงินสมาชิก") continue;
    const date = log.createdAt.slice(0, 10);
    if (!date) continue;
    map.set(date, (map.get(date) ?? 0) + parseBahtFromDetail(log.detail));
  }
  return map;
}

export function Dashboard({ setView, setPosShortcut, role, userName }: { setView: (view: View) => void; setPosShortcut: (shortcut: string) => void; role: Role; userName: string }) {
  const [range, setRange] = useState("30 วัน");
  const [selectedBar, setSelectedBar] = useState(5);
  const [bestMode, setBestMode] = useState("จำนวนขาย");
  const [selectedProduct, setSelectedProduct] = useState(0);
  const rangeDays = RANGE_DAYS[range] ?? 30;
  const statsQuery = trpc.dashboard.stats.useQuery({ rangeDays });
  const logsQuery = trpc.logs.list.useQuery({ limit: 1000 });
  const productsQuery = trpc.product.list.useQuery(undefined);
  const stats = statsQuery.data;

  const firstName = (userName || "ผู้ใช้ระบบ").trim().split(/\s+/)[0];
  const clockHour = new Date().getHours();
  const greetingWord = clockHour < 12 ? "สวัสดีตอนเช้า" : clockHour < 17 ? "สวัสดีตอนบ่าย" : "สวัสดีตอนเย็น";
  const emojiByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of productsQuery.data ?? []) map.set(product.name, product.emoji ?? "🛍️");
    return map;
  }, [productsQuery.data]);

  const deposits = useMemo(() => buildDepositsByDay(logsQuery.data ?? []), [logsQuery.data]);

  const chart = useMemo(() => {
    const base = (stats?.revenueByDay ?? []).map((day) => ({ date: day.date, revenue: day.total, deposit: deposits.get(day.date) ?? 0 }));
    let points: { label: string; date: string; revenue: number; deposit: number }[];
    if (rangeDays > 60) {
      points = [];
      for (const point of base) {
        const key = point.date.slice(0, 7);
        let group = points.find((entry) => entry.date.slice(0, 7) === key);
        if (!group) {
          group = { label: THAI_SHORT_MONTHS[Number(key.slice(5, 7)) - 1] ?? key, date: point.date, revenue: 0, deposit: 0 };
          points.push(group);
        }
        group.revenue += point.revenue;
        group.deposit += point.deposit;
      }
    } else {
      points = base.map((point) => ({
        label: rangeDays <= 7 ? THAI_WEEKDAYS[new Date(`${point.date}T00:00:00`).getDay()] : String(Number(point.date.slice(8, 10))),
        ...point,
      }));
    }
    const maxValue = Math.max(...points.map((point) => point.revenue + point.deposit), 1);
    const step = Math.max(1000, Math.ceil(maxValue / 4 / 1000) * 1000);
    const axisMax = step * 4;
    return {
      points: points.map((point) => {
        const bottom = Math.min(96, Math.round((point.revenue / axisMax) * 100));
        const top = Math.max(0, Math.min(96 - bottom, Math.round((point.deposit / axisMax) * 100)));
        return { ...point, value: point.revenue + point.deposit, top, bottom };
      }) as ChartPoint[],
      yLabels: [4, 3, 2, 1].map((multiplier) => formatAxisLabel(multiplier * step)).concat("0"),
    };
  }, [stats, deposits, rangeDays]);

  const chartData = chart.points;
  const safeSelectedBar = Math.min(selectedBar, Math.max(chartData.length - 1, 0));
  const selected = chartData[safeSelectedBar];
  const bestSellers = stats?.bestSellers ?? [];
  const bestSellersRanked = bestSellers.map((item, index) => ({
    name: item.name,
    qtyLabel: bestMode === "จำนวนขาย" ? `${item.qty} ชิ้น` : money(item.revenue),
    total: money(item.revenue),
    emoji: emojiByName.get(item.name) ?? "🛍️",
    width: bestMode === "จำนวนขาย"
      ? Math.round((item.qty / Math.max(...bestSellers.map((seller) => seller.qty), 1)) * 100)
      : Math.round((item.revenue / Math.max(...bestSellers.map((seller) => seller.revenue), 1)) * 100),
    rank: index + 1,
  }));
  const lowStock = stats?.lowStock ?? [];
  const expirySoon = stats?.expirySoon ?? [];
  const recentActivities = stats?.recentActivities ?? [];
  const loading = statsQuery.isLoading;
  return (
    <>
      <SectionHeader eyebrow={`ภาพรวมการดำเนินงาน · ${role === "admin" ? "มุมมองผู้บริหาร" : "มุมมองเจ้าหน้าที่"}`} title={`${greetingWord}, ${firstName}`} description={`ยินดีต้อนรับ ${userName} เข้าสู่ระบบ · ดูภาพรวมร้านค้าสวัสดิการและรายการที่ควรติดตามวันนี้`} action={<><div className={`permission-chip ${role}`}><span>{role === "admin" ? <Crown size={14} /> : <ShieldCheck size={14} />}</span>{role === "admin" ? "สิทธิ์ผู้บริหาร · วิเคราะห์เต็มรูปแบบ" : "สิทธิ์เจ้าหน้าที่ · ปฏิบัติงานหน้าร้าน"}</div><button className="outline-button"><CalendarDays size={16} /> วันนี้ <ChevronDown size={15} /></button></>} />
      <div className="metric-grid">
        <div className="metric-card highlight"><div className="metric-top"><span>ยอดขายทั้งหมด · {range}</span><span className="metric-icon green"><ShoppingBag size={18} /></span></div><strong>{loading ? "…" : money(stats?.totalSales ?? 0)}</strong><div className="metric-foot"><span>{stats?.totalOrders ?? 0} บิล</span><span>สูงสุด {money(Math.max(...(stats?.revenueByDay ?? []).map((day) => day.total), 0))} ในหนึ่งวัน</span></div></div>
        <div className="metric-card"><div className="metric-top"><span>ออเดอร์ทั้งหมด</span><span className="metric-icon blue"><ReceiptText size={18} /></span></div><strong>{loading ? "…" : (stats?.totalOrders ?? 0).toLocaleString("th-TH")} <small>บิล</small></strong><div className="metric-foot"><span>เฉลี่ย {((stats?.totalOrders ?? 0) / rangeDays).toFixed(1)} บิล/วัน</span><span>ในช่วง{range}</span></div></div>
        <div className="metric-card"><div className="metric-top"><span>สินค้าขายดี</span><span className="metric-icon amber"><BarChart3 size={18} /></span></div><strong>{loading ? "…" : (stats?.bestSellerCount ?? 0).toLocaleString("th-TH")} <small>ชิ้น</small></strong><div className="metric-foot warning"><span>{bestSellers[0]?.name ?? "ยังไม่มีข้อมูลการขาย"}</span><span>อันดับ 1 ในช่วง{range}</span></div></div>
        <div className="metric-card"><div className="metric-top"><span>ยอดขายเฉลี่ยต่อวัน</span><span className="metric-icon purple"><CalendarDays size={18} /></span></div><strong>{loading ? "…" : money(stats?.avgDailySales ?? 0)}</strong><div className="metric-foot"><span>ขายไป {stats?.itemsSold ?? 0} ชิ้น</span><span>ในช่วง{range}</span></div></div>
      </div>
      <div className="dashboard-grid">
        <section className="panel chart-panel interactive-chart-panel"><div className="panel-heading"><div><h2>ยอดขายร้านค้า</h2><p>เลือกช่วงเวลาและกดแท่งกราฟเพื่อดูรายละเอียด</p></div><div className="chart-controls">{["7 วัน", "30 วัน", "12 เดือน"].map((item) => <button className={range === item ? "active" : ""} onClick={() => { setRange(item); setSelectedBar(0); }} key={item}>{item}</button>)}</div></div><div className="chart-interactive-meta"><span><i className="dot teal" /> ยอดขายสินค้า</span><span><i className="dot lilac" /> เติมเงินสมาชิก</span><b>{loading ? "กำลังโหลดข้อมูลจากระบบ…" : selected ? `${selected.label} · ยอดรวม ${money(selected.value)}${selected.deposit > 0 ? ` (เติมเงิน ${money(selected.deposit)})` : ""}` : "ยังไม่มีข้อมูล"}</b></div><div className="chart-wrap"><div className="y-labels">{chart.yLabels.map((label) => <span key={label}>{label}</span>)}</div><div className="bar-chart">{chartData.map((bar, index) => <button className={`bar-column ${safeSelectedBar === index ? "selected" : ""}`} key={`${bar.label}-${index}`} onClick={() => setSelectedBar(index)} title={`${bar.label}: ยอดรวม ${money(bar.value)}${bar.deposit > 0 ? ` (เติมเงิน ${money(bar.deposit)})` : ""}`}><div className="bar-stack"><div className="bar lilac" style={{ height: `${bar.top}%` }} /><div className="bar teal" style={{ height: `${bar.bottom}%` }} /></div><span>{bar.label}</span></button>)}</div></div><div className="chart-summary"><div><span>ยอดขายรวมช่วงนี้</span><strong>{money(stats?.totalSales ?? 0)}</strong></div><div><span>ค่าเฉลี่ยต่อวัน</span><strong>{money(stats?.avgDailySales ?? 0)}</strong></div><div><span>จำนวนบิล</span><strong>{(stats?.totalOrders ?? 0).toLocaleString("th-TH")} <small>บิล</small></strong></div></div></section>
        <section className="panel quick-panel"><div className="panel-heading"><div><h2>ทางลัดสำหรับเจ้าหน้าที่</h2><p>การทำรายการที่ใช้บ่อย</p></div><MoreHorizontal size={19} className="muted-icon" /></div><button className="quick-action teal-action" onClick={() => { setView("pos"); setPosShortcut("เติมเงิน") }}><span className="shortcut-icon"><ArrowDownToLine size={19} /></span><span><b>เติมเงินสมาชิก</b><small>รับฝากเงินเข้าบัญชี</small></span><span className="shortcut-arrow">→</span></button><button className="quick-action purple-action" onClick={() => { setView("pos"); setPosShortcut("ถอนเงิน") }}><span className="shortcut-icon"><ArrowUpFromLine size={19} /></span><span><b>ถอนเงินสมาชิก</b><small>ระบุหมายเหตุและแนบสลิปได้</small></span><span className="shortcut-arrow">→</span></button><button className="quick-action amber-action" onClick={() => { setView("pos"); setPosShortcut("สินค้าไม่ระบุตายตัว") }}><span className="shortcut-icon"><SlidersHorizontal size={19} /></span><span><b>สินค้า / รายการพิเศษ</b><small>สินค้าที่ไม่ระบุยูนิตตายตัว</small></span><span className="shortcut-arrow">→</span></button><div className="divider" /><div className="mini-note"><ShieldCheck size={17} /><span>ข้อมูลทุกธุรกรรมถูกบันทึกในระบบ Log อัตโนมัติ</span></div></section>
      </div>
      <div className="inventory-alert-grid"><section className="panel alert-panel stock-alert-panel"><div className="alert-heading"><div><span className="eyebrow">ควรติดตามวันนี้</span><h2>สินค้าใกล้หมดสต็อก</h2><p>ช่วยวางแผนสั่งซื้อให้เพียงพอต่อการใช้งาน</p></div><span className="alert-count red">{lowStock.length}</span></div><div className="alert-list">{loading ? <div className="table-loading"><PackageSearch size={22} /><b>กำลังโหลดข้อมูลสต็อก</b><span>ดึงข้อมูลจากฐานข้อมูลสวัสดิการ</span></div> : lowStock.length === 0 ? <div className="table-loading"><PackageSearch size={22} /><b>สต็อกเพียงพอทุกรายการ</b><span>ไม่มีสินค้าที่ต่ำกว่าจุดสั่งซื้อ</span></div> : lowStock.map((row) => <button className="alert-row" key={row.id} onClick={() => setView("stock")}><span className="alert-item-icon red-bg"><PackageSearch size={15} /></span><span><b>{row.name}</b><small>เหลือ {row.stock} {row.unit} · สั่งซื้อแนะนำ {row.reorderPoint * 2} {row.unit}</small></span><span className="alert-arrow">→</span></button>)}</div><button className="alert-footer-action" onClick={() => setView("stock")}>ดูรายการและวางแผนสั่งซื้อ <span>→</span></button></section><section className="panel alert-panel expiry-alert-panel"><div className="alert-heading"><div><span className="eyebrow">ภายใน 30 วัน</span><h2>สินค้าใกล้หมดอายุ</h2><p>ตรวจสอบ Lot เพื่อวางแผนจัดจำหน่าย</p></div><span className="alert-count amber">{expirySoon.length}</span></div><div className="alert-list">{loading ? <div className="table-loading"><CalendarDays size={22} /><b>กำลังโหลดข้อมูลวันหมดอายุ</b><span>ตรวจสอบ Lot ที่ใกล้หมดอายุ</span></div> : expirySoon.length === 0 ? <div className="table-loading"><CalendarDays size={22} /><b>ไม่มีสินค้าใกล้หมดอายุ</b><span>ภายใน 30 วันข้างหน้า</span></div> : expirySoon.map((row) => <button className="alert-row" key={row.id} onClick={() => setView("stock")}><span className="alert-item-icon amber-bg"><CalendarDays size={15} /></span><span><b>{row.name}</b><small>หมดอายุ {formatThaiDate(row.expiry)} · Lot {row.lot} · เหลือ {row.qty} {row.unit}</small></span><span className="alert-arrow">→</span></button>)}</div><button className="alert-footer-action amber-action-text" onClick={() => setView("stock")}>เปิดรายงานวันหมดอายุ <span>→</span></button></section></div>
      <div className="dashboard-grid lower"><section className="panel best-seller-panel"><div className="panel-heading"><div><h2>สินค้าขายดี</h2><p>กดรายการเพื่อดูอันดับและมูลค่ารวม</p></div><div className="chart-controls small">{["จำนวนขาย", "ยอดขาย"].map((item) => <button className={bestMode === item ? "active" : ""} onClick={() => { setBestMode(item); setSelectedProduct(0); }} key={item}>{item}</button>)}</div></div><div className="product-ranking-chart">{loading ? <div className="table-loading"><BarChart3 size={22} /><b>กำลังโหลดอันดับสินค้าขายดี</b><span>สรุปจากรายการขายจริงในช่วง{range}</span></div> : bestSellersRanked.length === 0 ? <div className="table-loading"><BarChart3 size={22} /><b>ยังไม่มีข้อมูลการขาย</b><span>เริ่มขายสินค้าผ่าน POS เพื่อดูอันดับ</span></div> : bestSellersRanked.map(({ name, qtyLabel, total, emoji, width, rank }, index) => <button className={`product-rank-row ${selectedProduct === index ? "selected" : ""}`} key={name} onClick={() => setSelectedProduct(index)}><span className={`rank rank-0${rank}`}>{`0${rank}`}</span><span className="product-thumb">{emoji}</span><span className="seller-name"><b>{name}</b><small>{qtyLabel}</small><i className="rank-progress"><em style={{ width: `${width}%` }} /></i></span><strong>{total}</strong><MoreHorizontal size={17} className="muted-icon" /></button>)}</div><div className="ranking-insight"><BarChart3 size={15} /><span>{bestSellersRanked[selectedProduct]?.name ?? "สินค้าขายดี"} ทำยอดสูงสุดในมุมมอง{bestMode === "ยอดขาย" ? "มูลค่า" : "จำนวน"} · คลิกแถวเพื่อเลือกข้อมูล</span></div></section><section className="panel"><div className="panel-heading"><div><h2>กิจกรรมล่าสุด</h2><p>รายการที่เกิดขึ้นในระบบ</p></div><Activity size={19} className="muted-icon" /></div><div className="activity-list">{loading ? <div className="table-loading"><Activity size={22} /><b>กำลังโหลดกิจกรรมล่าสุด</b><span>ดึงข้อมูลจากระบบ Log</span></div> : recentActivities.length === 0 ? <div className="table-loading"><Activity size={22} /><b>ยังไม่มีกิจกรรม</b><span>รายการจะแสดงเมื่อมีการทำธุรกรรม</span></div> : recentActivities.slice(0, 4).map((log) => <div className="activity-row" key={log.id}><span className={`activity-dot ${log.tone}`} /><div><b>{log.action}</b><p>{log.actor} · {log.detail}</p></div><time>{formatTimeShort(log.createdAt)}</time></div>)}</div></section></div>
    </>
  );
}
