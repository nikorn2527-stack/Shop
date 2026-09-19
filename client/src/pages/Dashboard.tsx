import { useMemo, useState } from "react";
import {
  Activity, BarChart3, CalendarClock, CalendarDays, Check, CircleAlert, Crown, MoreHorizontal, PackageSearch, Printer, ReceiptText, ShieldCheck, ShoppingBag, X,
} from "lucide-react";
import type { BusinessPeriodStatus, DayClosureRow } from "../../../server/sqliteStore";
import type { Role, View } from "./pageData";
import { money } from "./pageData";
import { ConfirmDialog, SectionHeader } from "./PagePrimitives";
import { trpc } from "@/lib/trpc";
import { formatAxisLabel, formatThaiDate, formatTimeShort, parseBahtFromDetail } from "./viewFormat";

const THAI_WEEKDAYS = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const THAI_SHORT_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const RANGE_DAYS: Record<string, number> = { "7 วัน": 7, "30 วัน": 30, "12 เดือน": 365 };

type ChartPoint = { label: string; date: string; revenue: number; deposit: number };
type DashTab = "sales" | "best" | "watch" | "activity" | "cutoff";

const DASH_TABS: { id: DashTab; label: string }[] = [
  { id: "sales", label: "ยอดขาย" },
  { id: "best", label: "สินค้าขายดี" },
  { id: "watch", label: "ต้องติดตาม" },
  { id: "activity", label: "กิจกรรมล่าสุด" },
  // Round 32-20 — รอบตัดยอดเป็นแท็บของตัวเอง ไม่แทรกเนื้อหาเดิมให้หน้าหลุดเฟรม
  { id: "cutoff", label: "รอบตัดยอดวันนี้" },
];

/** Sums "เติมเงินสมาชิก" audit entries per calendar day for the lilac chart line. */
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

/**
 * รอบตัดยอดประจำวัน (round 31-①) — a compact live strip between the KPI row and
 * the tab workbench. Shows what the CURRENT business period has accumulated
 * (bills / pieces / revenue / by payment channel / deposits / withdrawals) and
 * carries the ตัดยอด button: manual cut-off for staff, or the countdown to the
 * next automatic one. After a cut, the period summary turns into a printable
 * Z-report slip (สรุปยอดรอบ) the cashier can hand to the admin.
 */
function CutoffWidget({ role, userName }: { role: Role; userName: string }) {
  const utils = trpc.useUtils();
  const periodQuery = trpc.reports.businessPeriod.useQuery(undefined, { refetchInterval: 60_000 });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [closed, setClosed] = useState<DayClosureRow | null>(null);
  const closeMutation = trpc.reports.closeDay.useMutation({
    onSuccess: (closure) => {
      setClosed(closure);
      setConfirmOpen(false);
      void utils.reports.businessPeriod.invalidate();
      void utils.logs.list.invalidate();
    },
  });
  const period: BusinessPeriodStatus | undefined = periodQuery.data;
  const actorRole = role === "admin" ? "ผู้บริหาร" : "เจ้าหน้าที่";
  const periodTotals = closed
    ? { bills: closed.bills, pieces: closed.pieces, revenue: closed.revenue, cashTotal: closed.cashTotal, qrTotal: closed.qrTotal, walletTotal: closed.walletTotal, deposits: closed.deposits, withdrawals: closed.withdrawals }
    : period?.totals;
  return <section className="panel cutoff-widget" aria-label="รอบตัดยอดประจำวัน">
    <div className="cutoff-widget-main">
      <div className="cutoff-widget-head">
        <span className="cutoff-widget-icon"><CalendarClock size={17} /></span>
        <div>
          <b>รอบตัดยอดวันนี้</b>
          <small>{period
            ? period.mode === "auto"
              ? `ระบบตัดอัตโนมัติ ${period.cutOffTime} น. ทุกวัน · รอบเริ่ม ${formatTimeShort(period.periodStart)}${period.nextCutOffAt ? ` · ตัดรอบถัดไป ${formatTimeShort(period.nextCutOffAt)}` : ""}`
              : `เจ้าหน้าที่ตัดยอดเองเมื่อพร้อม · รอบเริ่ม ${formatTimeShort(period.periodStart)}`
            : "กำลังโหลดข้อมูลรอบปัจจุบัน…"}</small>
        </div>
        <span className={`cutoff-mode-pill ${period?.mode === "manual" ? "manual" : ""}`}>{period?.mode === "manual" ? "ตัดเอง" : "อัตโนมัติ"}</span>
      </div>
      <div className="cutoff-widget-stats">
        <div><small>บิลในรอบ</small><strong>{periodTotals ? periodTotals.bills.toLocaleString("th-TH") : "—"}</strong></div>
        <div><small>ชิ้นที่ขาย</small><strong>{periodTotals ? periodTotals.pieces.toLocaleString("th-TH") : "—"}</strong></div>
        <div><small>ยอดขายรอบนี้</small><strong className="teal">{periodTotals ? money(periodTotals.revenue) : "—"}</strong></div>
        <div><small>เงินสด / QR</small><strong>{periodTotals ? `${money(periodTotals.cashTotal)} / ${money(periodTotals.qrTotal)}` : "—"}</strong></div>
        <div><small>หักบัญชีสมาชิก</small><strong>{periodTotals ? money(periodTotals.walletTotal) : "—"}</strong></div>
        <div><small>เติม / ถอน</small><strong>{periodTotals ? `${money(periodTotals.deposits)} / ${money(periodTotals.withdrawals)}` : "—"}</strong></div>
      </div>
    </div>
    <div className="cutoff-widget-actions">
      {closed ? <>
        <div className="cutoff-done-note"><Check size={14} /> ตัดยอดเรียบร้อย {formatTimeShort(closed.closedAt)} · โดย {closed.closedBy ?? "—"}</div>
        <button type="button" className="outline-button" onClick={() => window.print()}><Printer size={15} /> พิมพ์สรุปรอบ</button>
        <button type="button" className="primary-button" onClick={() => setClosed(null)}><CalendarClock size={15} /> เริ่มรอบใหม่</button>
      </> : <>
        <button type="button" className="primary-button cutoff-trigger" onClick={() => setConfirmOpen(true)} disabled={closeMutation.isPending}><CalendarClock size={15} /> ตัดยอดรอบนี้</button>
        {period?.lastClosure && <div className="cutoff-last-note"><CalendarDays size={13} /> ตัดล่าสุด {formatTimeShort(period.lastClosure.closedAt)} · {period.lastClosure.bills} บิล · {money(period.lastClosure.revenue)}</div>}
      </>}
    </div>
    {/* สรุปรอบ (Z-report) — แสดงเฉพาะหลังกดตัดยอด เพื่อพิมพ์เก็บ / ส่งผู้บริหาร */}
    {closed && periodTotals && <div className="receipt-paper cutoff-report" id="cutoff-report">
      <div className="receipt-brand"><div className="brand-mark small"><span>ส</span></div><div><b>ร้านค้าสวัสดิการ</b><small>สรุปยอดรอบตัดบัญชี</small></div></div>
      <div className="receipt-divider" />
      <div className="receipt-meta"><span>ตัดยอดเมื่อ <b>{formatThaiDate(closed.closedAt)} · {formatTimeShort(closed.closedAt)}</b></span><span>โดย {closed.closedBy ?? "—"}</span></div>
      <div className="receipt-meta"><span>รอบตั้งแต่ <b>{formatThaiDate(closed.periodStart)} · {formatTimeShort(closed.periodStart)}</b></span><span>ถึงเวลาตัดยอด</span></div>
      <div className="receipt-divider" />
      <div className="receipt-line"><span>จำนวนบิล</span><b>{closed.bills.toLocaleString("th-TH")} บิล</b></div>
      <div className="receipt-line"><span>ชิ้นที่ขาย</span><b>{closed.pieces.toLocaleString("th-TH")} ชิ้น</b></div>
      <div className="receipt-total"><span>ยอดขายรอบนี้</span><b>{money(closed.revenue)}</b></div>
      <div className="receipt-line"><span>รับเงินสด</span><b>{money(closed.cashTotal)}</b></div>
      <div className="receipt-line"><span>QR / สแกน</span><b>{money(closed.qrTotal)}</b></div>
      <div className="receipt-line"><span>หักบัญชีสมาชิก</span><b>{money(closed.walletTotal)}</b></div>
      <div className="receipt-divider" />
      <div className="receipt-line"><span>เติมเงินสมาชิก</span><b>{money(closed.deposits)}</b></div>
      <div className="receipt-line"><span>ถอนเงินสมาชิก</span><b>{money(closed.withdrawals)}</b></div>
      {closed.note && <div className="receipt-line"><span>หมายเหตุ</span><b>{closed.note}</b></div>}
      <div className="receipt-thanks">ตัดยอดโดย {closed.closedBy ?? "—"} · {actorRole} {userName ? `(${userName})` : ""}<br /><small>สรุปรอบนี้บันทึกลงระบบ Log แล้ว · รอบใหม่เริ่มทันทีหลังตัดยอด</small></div>
    </div>}
    <ConfirmDialog open={confirmOpen} title="ยืนยันตัดยอดรอบนี้?" description={`สรุปยอดตั้งแต่ ${period ? `${formatThaiDate(period.periodStart)} ${formatTimeShort(period.periodStart)}` : "ต้นรอบ"} จนถึงตอนนี้ แล้วเริ่มรอบใหม่ทันที · ยอดขายรอบนี้ ${period ? money(period.totals.revenue) : "—"} (${period?.totals.bills ?? 0} บิล) · ระบบจะสร้างสรุปรอบให้พิมพ์เก็บไว้ และบันทึกลง Log`} confirmLabel="ตัดยอดรอบนี้" onCancel={() => setConfirmOpen(false)} onConfirm={() => closeMutation.mutate({ actor: userName || "เจ้าหน้าที่ร้านค้า", actorRole: role })} />
    {closeMutation.isError && <div className="notice-bar error" role="alert"><CircleAlert size={16} /> {closeMutation.error.message}<button onClick={() => closeMutation.reset()}><X size={14} /></button></div>}
  </section>;
}

export function Dashboard({ setView, role, userName }: { setView: (view: View) => void; role: Role; userName: string }) {
  const [range, setRange] = useState("30 วัน");
  const [selectedBar, setSelectedBar] = useState(5);
  const [bestMode, setBestMode] = useState("จำนวนขาย");
  const [selectedProduct, setSelectedProduct] = useState(0);
  const [tab, setTab] = useState<DashTab>("sales");
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
    let points: ChartPoint[];
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
      points,
      axisMax,
      yLabels: [4, 3, 2, 1].map((multiplier) => formatAxisLabel(multiplier * step)).concat("0"),
    };
  }, [stats, deposits, rangeDays]);

  const chartData = chart.points;
  const safeSelectedBar = Math.min(selectedBar, Math.max(chartData.length - 1, 0));
  const selected = chartData[safeSelectedBar];
  // Round 31-11 — line chart geometry: revenue (teal) is the hero line, member
  // deposits (lilac) a thin companion; the area under revenue gets a soft
  // gradient fill. Hit-zones stay as HTML buttons for keyboard + tooltips.
  const lineGeom = useMemo(() => {
    const count = chartData.length;
    if (count === 0) return null;
    const width = 1000;
    const height = 100;
    const xAt = (index: number) => ((index + 0.5) / count) * width;
    const yAt = (value: number) => height - (value / chart.axisMax) * height;
    const revenuePoints = chartData.map((point, index) => `${xAt(index).toFixed(2)},${Math.max(yAt(point.revenue), 1).toFixed(2)}`).join(" ");
    const depositPoints = chartData.map((point, index) => `${xAt(index).toFixed(2)},${Math.max(yAt(point.deposit), 1).toFixed(2)}`).join(" ");
    const areaPath = `M ${xAt(0).toFixed(2)},${height} L ${chartData.map((point, index) => `${xAt(index).toFixed(2)},${Math.max(yAt(point.revenue), 1).toFixed(2)}`).join(" L ")} L ${xAt(count - 1).toFixed(2)},${height} Z`;
    return {
      width, height, xAt, yAt, revenuePoints, depositPoints, areaPath,
      selectedX: xAt(safeSelectedBar),
      selectedY: Math.max(yAt(chartData[safeSelectedBar]?.revenue ?? 0), 1),
      selectedDepositY: Math.max(yAt(chartData[safeSelectedBar]?.deposit ?? 0), 1),
      labelStep: count > 20 ? Math.ceil(count / 8) : 1,
    };
  }, [chartData, chart.axisMax, safeSelectedBar]);
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
      <SectionHeader eyebrow={`ภาพรวมการดำเนินงาน · ${role === "admin" ? "มุมมองผู้บริหาร" : "มุมมองเจ้าหน้าที่"}`} title={`${greetingWord}, ${firstName}`} description="สรุปตัวเลขสำคัญอยู่บนสุด · เลือกมุมมองข้อมูลจากแถบด้านล่างเพื่อดูรายละเอียดแบบเต็มพื้นที่" action={<><div className={`permission-chip ${role}`}><span>{role === "admin" ? <Crown size={14} /> : <ShieldCheck size={14} />}</span>{role === "admin" ? "สิทธิ์ผู้บริหาร · วิเคราะห์เต็มรูปแบบ" : "สิทธิ์เจ้าหน้าที่ · ปฏิบัติงานหน้าร้าน"}</div><div className="permission-chip neutral" title="วันที่ปัจจุบัน"><span><CalendarDays size={14} /></span>วันนี้ · {formatThaiDate(new Date())}</div></>} />
      <div className="metric-grid">
        <div className="metric-card highlight"><div className="metric-top"><span>ยอดขายทั้งหมด · {range}</span><span className="metric-icon green"><ShoppingBag size={18} /></span></div><strong>{loading ? "…" : money(stats?.totalSales ?? 0)}</strong><div className="metric-foot"><span>{stats?.totalOrders ?? 0} บิล</span><span>สูงสุด {money(Math.max(...(stats?.revenueByDay ?? []).map((day) => day.total), 0))} ในหนึ่งวัน</span></div></div>
        <div className="metric-card"><div className="metric-top"><span>ออเดอร์ทั้งหมด</span><span className="metric-icon blue"><ReceiptText size={18} /></span></div><strong>{loading ? "…" : (stats?.totalOrders ?? 0).toLocaleString("th-TH")} <small>บิล</small></strong><div className="metric-foot"><span>เฉลี่ย {((stats?.totalOrders ?? 0) / rangeDays).toFixed(1)} บิล/วัน</span><span>ในช่วง{range}</span></div></div>
        <div className="metric-card"><div className="metric-top"><span>สินค้าขายดี</span><span className="metric-icon amber"><BarChart3 size={18} /></span></div><strong>{loading ? "…" : (stats?.bestSellerCount ?? 0).toLocaleString("th-TH")} <small>ชิ้น</small></strong><div className="metric-foot warning"><span>{bestSellers[0]?.name ?? "ยังไม่มีข้อมูลการขาย"}</span><span>อันดับ 1 ในช่วง{range}</span></div></div>
        <div className="metric-card"><div className="metric-top"><span>ยอดขายเฉลี่ยต่อวัน</span><span className="metric-icon purple"><CalendarDays size={18} /></span></div><strong>{loading ? "…" : money(stats?.avgDailySales ?? 0)}</strong><div className="metric-foot"><span>ขายไป {stats?.itemsSold ?? 0} ชิ้น</span><span>ในช่วง{range}</span></div></div>
      </div>
      <section className="dash-workbench" aria-label="มุมมองข้อมูลภาพรวม">
        <div className="dash-tabbar" role="tablist" aria-label="เลือกมุมมองข้อมูล">
          {DASH_TABS.map((item) => <button type="button" role="tab" aria-selected={tab === item.id} className={`dash-tab${tab === item.id ? " active" : ""}`} key={item.id} onClick={() => setTab(item.id)}>{item.id === "sales" ? <BarChart3 size={15} /> : item.id === "best" ? <Crown size={15} /> : item.id === "watch" ? <PackageSearch size={15} /> : item.id === "activity" ? <Activity size={15} /> : <CalendarClock size={15} />}{item.label}{item.id === "watch" && lowStock.length > 0 && <i className="tab-badge red" title={`สินค้าใกล้หมดสต็อก ${lowStock.length} รายการ`}>{lowStock.length}</i>}{item.id === "watch" && expirySoon.length > 0 && <i className="tab-badge amber" title={`ใกล้หมดอายุ ${expirySoon.length} รายการ`}>{expirySoon.length}</i>}</button>)}
          <span className="dash-tabbar-spacer" aria-hidden="true" />
        </div>
        <div className="dash-tab-body" role="tabpanel">
          {tab === "sales" && <section className="panel chart-panel interactive-chart-panel"><div className="panel-heading"><div><h2>ยอดขายร้านค้า</h2><p>กราฟเส้นแนวโน้ม · เลือกช่วงเวลา แล้วชี้หรือกดจุดเพื่อดูรายละเอียด</p></div><div className="chart-controls">{["7 วัน", "30 วัน", "12 เดือน"].map((item) => <button className={range === item ? "active" : ""} onClick={() => { setRange(item); setSelectedBar(0); }} key={item}>{item}</button>)}</div></div><div className="chart-interactive-meta"><span><i className="dot teal" /> ยอดขายสินค้า</span><span><i className="dot lilac" /> เติมเงินสมาชิก</span><b>{loading ? "กำลังโหลดข้อมูลจากระบบ…" : selected ? `${selected.label} · ยอดขาย ${money(selected.revenue)}${selected.deposit > 0 ? ` (เติมเงิน ${money(selected.deposit)})` : ""}` : "ยังไม่มีข้อมูล"}</b></div><div className="chart-wrap chart-wrap-line">{lineGeom ? <><div className="y-labels">{chart.yLabels.map((label) => <span key={label}>{label}</span>)}</div><div className="line-chart" role="img" aria-label={`กราฟเส้นยอดขาย ${chartData.length} จุด ช่วง${range} สูงสุด ${money(Math.max(...chartData.map((point) => point.revenue), 0))}`}><svg viewBox={`0 0 ${lineGeom.width} ${lineGeom.height}`} preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="revenue-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="rgba(61,140,113,.30)" /><stop offset="100%" stopColor="rgba(61,140,113,0)" /></linearGradient></defs>{[0.25, 0.5, 0.75, 1].map((ratio) => <line key={ratio} className="line-grid" x1="0" x2={lineGeom.width} y1={lineGeom.height * (1 - ratio)} y2={lineGeom.height * (1 - ratio)} />)}<path className="line-area" d={lineGeom.areaPath} /><polyline className="line-deposit" points={lineGeom.depositPoints} /><polyline className="line-revenue" points={lineGeom.revenuePoints} /><line className="line-cursor" x1={lineGeom.selectedX} x2={lineGeom.selectedX} y1="0" y2={lineGeom.height} /><circle className="line-dot deposit" cx={lineGeom.selectedX} cy={lineGeom.selectedDepositY} r="2.2" /><circle className="line-dot revenue" cx={lineGeom.selectedX} cy={lineGeom.selectedY} r="3.2" /></svg><div className="line-hits">{chartData.map((point, index) => <button type="button" key={`${point.label}-${index}`} className={safeSelectedBar === index ? "selected" : ""} style={{ left: `${(index / chartData.length) * 100}%`, width: `${100 / chartData.length}%` }} onClick={() => setSelectedBar(index)} title={`${point.label}: ยอดขาย ${money(point.revenue)}${point.deposit > 0 ? ` (เติมเงิน ${money(point.deposit)})` : ""}`} aria-label={`${point.label} ยอดขาย ${money(point.revenue)}`} />)}</div></div><div className="line-x-labels">{chartData.map((point, index) => <span key={`${point.label}-x-${index}`} className={safeSelectedBar === index || lineGeom.labelStep === 1 || index % lineGeom.labelStep === 0 ? `show${safeSelectedBar === index ? " picked" : ""}` : ""}>{point.label}</span>)}</div></> : <div className="chart-empty-note">ยังไม่มีข้อมูลยอดขายในช่วงนี้</div>}</div><div className="chart-summary"><div><span>ยอดขายรวมช่วงนี้</span><strong>{money(stats?.totalSales ?? 0)}</strong></div><div><span>ค่าเฉลี่ยต่อวัน</span><strong>{money(stats?.avgDailySales ?? 0)}</strong></div><div><span>จำนวนบิล</span><strong>{(stats?.totalOrders ?? 0).toLocaleString("th-TH")} <small>บิล</small></strong></div></div></section>}
          {tab === "best" && <section className="panel best-seller-panel"><div className="panel-heading"><div><h2>สินค้าขายดี 10 อันดับ</h2><p>สรุปจากรายการขายจริงในช่วง{range} · กดรายการเพื่อเลือกข้อมูล</p></div><div className="chart-controls small">{["จำนวนขาย", "ยอดขาย"].map((item) => <button className={bestMode === item ? "active" : ""} onClick={() => { setBestMode(item); setSelectedProduct(0); }} key={item}>{item}</button>)}</div></div><div className="product-ranking-chart">{loading ? <div className="table-loading"><BarChart3 size={22} /><b>กำลังโหลดอันดับสินค้าขายดี</b><span>สรุปจากรายการขายจริงในช่วง{range}</span></div> : bestSellersRanked.length === 0 ? <div className="table-loading"><BarChart3 size={22} /><b>ยังไม่มีข้อมูลการขาย</b><span>เริ่มขายสินค้าผ่าน POS เพื่อดูอันดับ</span></div> : bestSellersRanked.map(({ name, qtyLabel, total, emoji, width, rank }, index) => <button className={`product-rank-row ${selectedProduct === index ? "selected" : ""}`} key={name} onClick={() => setSelectedProduct(index)}><span className={`rank rank-0${rank}`}>{`0${rank}`}</span><span className="product-thumb">{emoji}</span><span className="seller-name"><b>{name}</b><small>{qtyLabel}</small><i className="rank-progress"><em style={{ width: `${width}%` }} /></i></span><strong>{total}</strong><MoreHorizontal size={17} className="muted-icon" /></button>)}</div><div className="ranking-insight"><BarChart3 size={15} /><span>{bestSellersRanked[selectedProduct]?.name ?? "สินค้าขายดี"} ทำยอดสูงสุดในมุมมอง{bestMode === "ยอดขาย" ? "มูลค่า" : "จำนวน"} · คลิกแถวเพื่อเลือกข้อมูล</span></div></section>}
          {tab === "watch" && <div className="inventory-alert-grid"><section className="panel alert-panel stock-alert-panel"><div className="alert-heading"><div><span className="eyebrow">ควรติดตามวันนี้</span><h2>สินค้าใกล้หมดสต็อก</h2><p>ช่วยวางแผนสั่งซื้อให้เพียงพอต่อการใช้งาน</p></div><span className="alert-count red">{lowStock.length}</span></div><div className="alert-list">{loading ? <div className="table-loading"><PackageSearch size={22} /><b>กำลังโหลดข้อมูลสต็อก</b><span>ดึงข้อมูลจากฐานข้อมูลสวัสดิการ</span></div> : lowStock.length === 0 ? <div className="table-loading"><PackageSearch size={22} /><b>สต็อกเพียงพอทุกรายการ</b><span>ไม่มีสินค้าที่ต่ำกว่าจุดสั่งซื้อ</span></div> : lowStock.map((row) => <button className="alert-row" key={row.id} onClick={() => setView("stock")}><span className="alert-item-icon red-bg"><PackageSearch size={15} /></span><span><b>{row.name}</b><small>เหลือ {row.stock} {row.unit} · สั่งซื้อแนะนำ {row.reorderPoint * 2} {row.unit}</small></span><span className="alert-arrow">→</span></button>)}</div><button className="alert-footer-action" onClick={() => setView("stock")}>ดูรายการและวางแผนสั่งซื้อ <span>→</span></button></section><section className="panel alert-panel expiry-alert-panel"><div className="alert-heading"><div><span className="eyebrow">ภายใน 30 วัน</span><h2>สินค้าใกล้หมดอายุ</h2><p>ตรวจสอบ Lot เพื่อวางแผนจัดจำหน่าย</p></div><span className="alert-count amber">{expirySoon.length}</span></div><div className="alert-list">{loading ? <div className="table-loading"><CalendarDays size={22} /><b>กำลังโหลดข้อมูลวันหมดอายุ</b><span>ตรวจสอบ Lot ที่ใกล้หมดอายุ</span></div> : expirySoon.length === 0 ? <div className="table-loading"><CalendarDays size={22} /><b>ไม่มีสินค้าใกล้หมดอายุ</b><span>ภายใน 30 วันข้างหน้า</span></div> : expirySoon.map((row) => <button className="alert-row" key={row.id} onClick={() => setView("stock")}><span className="alert-item-icon amber-bg"><CalendarDays size={15} /></span><span><b>{row.name}</b><small>หมดอายุ {formatThaiDate(row.expiry)} · Lot {row.lot} · เหลือ {row.qty} {row.unit}</small></span><span className="alert-arrow">→</span></button>)}</div><button className="alert-footer-action amber-action-text" onClick={() => setView("stock")}>เปิดรายงานวันหมดอายุ <span>→</span></button></section></div>}
          {tab === "activity" && <section className="panel"><div className="panel-heading"><div><h2>กิจกรรมล่าสุดในระบบ</h2><p>ธุรกรรมและการเปลี่ยนแปลงที่บันทึกอัตโนมัติ</p></div><Activity size={19} className="muted-icon" /></div><div className="dash-activity-scroll">{loading ? <div className="table-loading"><Activity size={22} /><b>กำลังโหลดกิจกรรมล่าสุด</b><span>ดึงข้อมูลจากระบบ Log</span></div> : recentActivities.length === 0 ? <div className="table-loading"><Activity size={22} /><b>ยังไม่มีกิจกรรม</b><span>รายการจะแสดงเมื่อมีการทำธุรกรรม</span></div> : <table className="log-table compact" aria-label="รายการกิจกรรมล่าสุด"><thead><tr><th aria-label="ระดับกิจกรรม" /><th>เวลา</th><th>ผู้ทำรายการ</th><th>กิจกรรม</th><th>รายละเอียด</th></tr></thead><tbody>{recentActivities.map((log) => <tr key={log.id}><td className="log-tone-cell"><i className={`log-dot-mini tone-${log.tone ?? "green"}`} aria-hidden="true" /></td><td><small className="cell-mono">{formatTimeShort(log.createdAt)}</small></td><td><b>{log.actor}</b><small>{log.actorRole === "admin" ? "ผู้บริหาร" : "เจ้าหน้าที่"}</small></td><td><b>{log.action}</b></td><td><span className="log-detail-text">{log.detail}</span></td></tr>)}</tbody></table>}</div>{role === "admin" ? <button className="alert-footer-action" onClick={() => setView("logs")}>ดูกิจกรรมทั้งหมดในระบบ Log <span>→</span></button> : <div className="ranking-insight"><ShieldCheck size={15} /><span>ข้อมูลทุกธุรกรรมถูกบันทึกในระบบ Log อัตโนมัติ · ประวัติฉบับเต็มเปิดได้โดยผู้บริหาร</span></div>}</section>}
          {tab === "cutoff" && <CutoffWidget role={role} userName={userName} />}
        </div>
      </section>
    </>
  );
}
