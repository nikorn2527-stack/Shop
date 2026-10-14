import { useMemo, useState } from "react";
import {
  Activity, BarChart3, CalendarClock, CalendarDays, Check, CircleAlert, Crown, FileText, MoreHorizontal, PackageSearch, Printer, ReceiptText, ShieldCheck, ShoppingBag, Terminal, Wallet, X, UsersRound,
} from "@/lib/icons";
import type { BusinessPeriodStatus, DashboardStats, DayClosureRow } from "../../../server/sqliteStore";
import type { Role, View } from "./pageData";
import { isAdminRole, money, roleThaiLabel } from "./pageData";
import { ConfirmDialog, SectionHeader } from "./PagePrimitives";
import { PrintPreviewModal } from "@/components/PrintPreviewModal";
import { downloadReportPdf, printReportDoc, type ReportDocConfig } from "@/reportDoc";
import { OnboardingBanner } from "@/components/OnboardingBanner";
import { RecentBillsWidget } from "@/components/RecentBillsWidget";
import { trpc } from "@/lib/trpc";
import { formatAxisLabel, formatThaiDate, formatTimeShort, parseBahtFromDetail } from "./viewFormat";

const THAI_WEEKDAYS = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const THAI_SHORT_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const RANGE_DAYS: Record<string, number> = { "7 วัน": 7, "30 วัน": 30, "12 เดือน": 365 };

/**
 * STYLE-9 — TodaySnapshot: a compact always-visible strip above the metric
 * grid that shows today's sales / bills / deposits at a glance. The last
 * entry of `stats.revenueByDay` IS today (the dashboardStats loop fills
 * from `range-1` days ago through today). Clicking any stat jumps to the
 * relevant view for deeper drill-down.
 */
function TodaySnapshot({
  stats,
  deposits,
  loading,
  rangeDays,
  setView,
}: {
  stats: DashboardStats | undefined;
  deposits: Map<string, number>;
  loading: boolean;
  rangeDays: number;
  setView: (view: View) => void;
}) {
  const todayKey = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  })();
  const todayRevenue = stats?.revenueByDay?.find((d) => d.date === todayKey)?.total ?? 0;
  const todayDeposits = deposits.get(todayKey) ?? 0;
  // Avg daily from range gives a "today vs avg" comparison
  const avgDaily = stats?.avgDailySales ?? 0;
  const vsAvgPct = avgDaily > 0 ? Math.round((todayRevenue / avgDaily) * 100) : 0;
  return (
    <section className="today-snapshot" aria-label="สรุปยอดวันนี้">
      <div className="today-snapshot-head">
        <span className="today-snapshot-label"><CalendarDays size={13} /> สรุปวันนี้</span>
        <span className="today-snapshot-date">{formatThaiDate(new Date())}</span>
      </div>
      <div className="today-snapshot-grid">
        <button
          className="today-snapshot-stat"
          onClick={() => setView("reports")}
          title="ดูรายงานยอดขายเต็มรูปแบบ"
        >
          <span className="ts-icon green"><ShoppingBag size={15} /></span>
          <span className="ts-body">
            <small>ยอดขายวันนี้</small>
            <b>{loading ? "…" : money(todayRevenue)}</b>
          </span>
          {todayRevenue > 0 && avgDaily > 0 && (
            <span className={`ts-delta ${vsAvgPct >= 100 ? "up" : "down"}`} title={`เทียบค่าเฉลี่ย ${money(avgDaily)}/วัน ในช่วง ${rangeDays} วัน`}>
              {vsAvgPct >= 100 ? "▲" : "▼"} {vsAvgPct}%
            </span>
          )}
        </button>
        <button
          className="today-snapshot-stat"
          onClick={() => setView("members")}
          title="ไปที่สมาชิกและบัญชี — ดูสมาชิกทั้งหมด"
        >
          <span className="ts-icon blue"><UsersRound size={15} /></span>
          <span className="ts-body">
            <small>สมาชิกทั้งหมด</small>
            <b>{loading ? "…" : (stats?.memberCount?.total ?? 0)} <small>คน</small></b>
          </span>
        </button>
        <button
          className="today-snapshot-stat"
          onClick={() => setView("members")}
          title="ไปที่สมาชิกและบัญชี"
        >
          <span className="ts-icon purple"><Wallet size={15} /></span>
          <span className="ts-body">
            <small>เติมเงินวันนี้</small>
            <b>{loading ? "…" : money(todayDeposits)}</b>
          </span>
        </button>
        <button
          className="today-snapshot-stat"
          onClick={() => setView("stock")}
          title="ไปที่สต็อกสินค้า"
        >
          <span className="ts-icon amber"><PackageSearch size={15} /></span>
          <span className="ts-body">
            <small>สินค้าใกล้หมดสต็อก</small>
            <b>{loading ? "…" : (stats?.lowStock?.length ?? 0)} <small>รายการ</small></b>
          </span>
        </button>
      </div>
    </section>
  );
}



/** Round 34 — compact baht for on-chart chips: 14900 → "฿14.9k", 1200000 → "฿1.2M", 0 → "฿0". */
function compactBaht(value: number) {
  if (value <= 0) return "฿0";
  const trim = (n: number) => (n >= 100 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, ""));
  if (value >= 1_000_000) return `฿${trim(value / 1_000_000)}M`;
  if (value >= 1000) return `฿${trim(value / 1000)}k`;
  return `฿${Math.round(value)}`;
}

/**
 * Round 34 — smooth monotone cubic path (Fritsch–Carlson). Returns an SVG "M … C …"
 * path through every point that never overshoots past its neighbours, so flat
 * zero-days can't fake a dip below the data the way a jagged polyline does.
 */
function buildSmoothPath(points: { x: number; y: number }[]) {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M ${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const dx = points[i + 1].x - points[i].x;
    slopes.push(dx > 0 ? (points[i + 1].y - points[i].y) / dx : 0);
  }
  const tangents: number[] = [slopes[0]];
  for (let i = 1; i < n - 1; i += 1) {
    tangents.push(slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2);
  }
  tangents.push(slopes[n - 2]);
  for (let i = 0; i < n - 1; i += 1) {
    if (slopes[i] === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const alpha = tangents[i] / slopes[i];
    const beta = tangents[i + 1] / slopes[i];
    const square = alpha * alpha + beta * beta;
    if (square > 9) {
      const tau = 3 / Math.sqrt(square);
      tangents[i] = tau * alpha * slopes[i];
      tangents[i + 1] = tau * beta * slopes[i];
    }
  }
  let path = `M ${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i += 1) {
    const dx = points[i + 1].x - points[i].x;
    path += ` C ${(points[i].x + dx / 3).toFixed(2)},${(points[i].y + (tangents[i] * dx) / 3).toFixed(2)} ${(points[i + 1].x - dx / 3).toFixed(2)},${(points[i + 1].y + (tangents[i + 1] * dx) / 3).toFixed(2)} ${points[i + 1].x.toFixed(2)},${points[i + 1].y.toFixed(2)}`;
  }
  return path;
}

/** Tooltip delta cell — ↑ green (ดีขึ้น) / ↓ red-ish (ตามธรรมเนียมไทย), หรือข้อความจางถ้าไม่มีจุดเทียบ */
const deltaChip = (delta: number | null, fallback: string) => (delta === null
  ? <em className="muted">{fallback}</em>
  : <em className={delta >= 0 ? "up" : "down"}>{delta >= 0 ? "↑" : "↓"} {Math.abs(delta).toFixed(1)}%</em>);

type ChartPoint = { label: string; date: string; revenue: number; deposit: number };
type DashTab = "sales" | "bills" | "best" | "watch" | "activity" | "cutoff";

const DASH_TABS: { id: DashTab; label: string }[] = [
  { id: "sales", label: "ยอดขาย" },
  { id: "bills", label: "บิลล่าสุด" },
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
  const settingsQuery = trpc.settings.get.useQuery(undefined);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [closed, setClosed] = useState<DayClosureRow | null>(null);
  // ROUND 51 — พิมพ์สรุปรอบผ่านพรีวิวก่อน (เหมือนจุดพิมพ์อื่นทั้งระบบ)
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const closeMutation = trpc.reports.closeDay.useMutation({
    onSuccess: (closure) => {
      setClosed(closure);
      setConfirmOpen(false);
      void utils.reports.businessPeriod.invalidate();
      void utils.logs.list.invalidate();
    },
  });
  const period: BusinessPeriodStatus | undefined = periodQuery.data;
  const actorRole = roleThaiLabel(role);
  const periodTotals = period?.totals;
  const isAutomaticClosure = closed?.closedBy === "ระบบอัตโนมัติ";
  const dailyCoverDoc = (closure: DayClosureRow): ReportDocConfig => {
    const receiptCount = closure.depositCount + closure.activationCount;
    const receiptAmount = closure.depositAmount + closure.activationAmount;
    const paymentCount = closure.withdrawalCount + closure.refundCount;
    const paymentAmount = closure.withdrawalAmount + closure.refundAmount;
    return {
      fileName: `daily-report-cover-${closure.closedAt.slice(0, 10)}.pdf`,
      title: "สรุปรอบตัดยอด",
      periodLabel: `รอบ ${formatThaiDate(closure.periodStart)} ${formatTimeShort(closure.periodStart)} – ${formatThaiDate(closure.closedAt)} ${formatTimeShort(closure.closedAt)}`,
      meta: [["เจ้าหน้าที่", closure.closedBy ?? "ไม่ระบุ"], ["วันที่ตัดยอด", `${formatThaiDate(closure.closedAt)} ${formatTimeShort(closure.closedAt)}`]],
      summaryBlocks: [["ยอดรวมรับ", `${receiptCount.toLocaleString("th-TH")} รายการ · ${money(receiptAmount)}`], ["ยอดรวมจ่าย", `${paymentCount.toLocaleString("th-TH")} รายการ · ${money(paymentAmount)}`]],
      columns: ["รายการ", "จำนวนรายการ", "จำนวนเงิน (บาท)"],
      numericCols: [1, 2],
      groupStartRows: [0, 3],
      borderlessGroups: true,
      rows: [
        ["ยอดรวมรับ", receiptCount.toLocaleString("th-TH"), money(receiptAmount)],
        ["เติมเงินบัตร", closure.depositCount.toLocaleString("th-TH"), closure.depositAmount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })],
        ["เปิดใช้บัตร", closure.activationCount.toLocaleString("th-TH"), closure.activationAmount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })],
        ["ยอดรวมจ่าย", paymentCount.toLocaleString("th-TH"), money(paymentAmount)],
        ["ถอนเงินจากบัตร", closure.withdrawalCount.toLocaleString("th-TH"), closure.withdrawalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })],
        ["คืนบัตรเงินสด", closure.refundCount.toLocaleString("th-TH"), closure.refundAmount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })],
      ],
      brandName: (settingsQuery.data?.storeName ?? settingsQuery.data?.appName ?? "").trim() || "ร้านค้าสวัสดิการ",
    };
  };
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
      <button type="button" className="primary-button cutoff-trigger" onClick={() => { closeMutation.reset(); setConfirmOpen(true); }} disabled={closeMutation.isPending || !period}><CalendarClock size={15} /> ตัดยอดรอบนี้</button>
      {period?.lastClosure && <><div className="cutoff-last-note"><CalendarDays size={13} /> ตัดล่าสุด {formatTimeShort(period.lastClosure.closedAt)} · {period.lastClosure.bills} บิล · {money(period.lastClosure.revenue)}</div><button type="button" className="outline-button" aria-expanded={!!closed} aria-controls="cutoff-summary-details" onClick={() => setClosed(closed ? null : period.lastClosure)}><ReceiptText size={15} /> {closed ? "ซ่อนสรุปรอบ" : "ดูสรุปรอบล่าสุด"}</button></>}
    </div>
    <div id="cutoff-summary-details" className="cutoff-summary-details">
      {closed ? <>
        <div className="cutoff-done-note"><Check size={14} /> ตัดยอดเรียบร้อย {formatTimeShort(closed.closedAt)} · โดย {closed.closedBy ?? "—"}</div>
        <button type="button" className="outline-button" onClick={() => void downloadReportPdf(dailyCoverDoc(closed))}><FileText size={15} /> PDF สรุปรอบ</button>
        <button type="button" className="outline-button" onClick={() => printReportDoc(dailyCoverDoc(closed))}><Printer size={15} /> พิมพ์ A4</button>
        <button type="button" className="outline-button" onClick={() => setPrintPreviewOpen(true)}><Printer size={15} /> พิมพ์สรุปรอบ</button>
        <button type="button" className="outline-button" onClick={() => setClosed(null)}>ปิดสรุปรอบ</button>
      </> : null}
    </div>
    {/* สรุปรอบ (Z-report) — แสดงเฉพาะหลังกดตัดยอด เพื่อพิมพ์เก็บ / ส่งผู้บริหาร */}
    {closed && periodTotals && <div className="receipt-paper cutoff-report" id="cutoff-report">
      <style>{`
        .cutoff-report :is(.receipt-line, .receipt-total, section) { border: 0 !important; }
        .cutoff-report .receipt-divider { display: none !important; }
        .cutoff-report section + section { margin-top: 24px !important; }
        .cutoff-report section .receipt-total { font-weight: 800; margin-bottom: 8px; }
      `}</style>
      <div className="receipt-brand"><div className="brand-mark small"><span>ส</span></div><div><b>ร้านค้าสวัสดิการ</b><small>สรุปยอดรอบตัดบัญชี</small></div></div>
      <div className="receipt-divider" />
      <div className="receipt-meta"><span>ตัดยอด <b>{formatThaiDate(closed.closedAt)} · {formatTimeShort(closed.closedAt)}</b></span>{!isAutomaticClosure && <span>{closed.closedBy ?? "—"}</span>}</div>
      <div className="receipt-meta"><span>เริ่มรอบ <b>{formatThaiDate(closed.periodStart)} · {formatTimeShort(closed.periodStart)}</b></span></div>
      <div className="receipt-divider" />
      <section aria-label="ยอดรวมรับ" style={{ display: "block", gridColumn: "1 / -1", padding: "10px 0", breakInside: "avoid" }}>
      <div className="receipt-total"><span>ยอดรวมรับ</span><b>{money(closed.depositAmount + closed.activationAmount)}</b></div>
      <div className="receipt-line"><span>จำนวนรายการรับ</span><b>{closed.depositCount + closed.activationCount} รายการ</b></div>
      <div className="receipt-line"><span>เติมเงินบัตร · {closed.depositCount} รายการ</span><b>{money(closed.depositAmount)}</b></div>
      <div className="receipt-line"><span>เปิดใช้บัตร · {closed.activationCount} รายการ</span><b>{money(closed.activationAmount)}</b></div>
      </section>
      <section aria-label="ยอดรวมจ่าย" style={{ display: "block", gridColumn: "1 / -1", marginTop: "12px", padding: "10px 0", breakInside: "avoid" }}>
      <div className="receipt-total"><span>ยอดรวมจ่าย</span><b>{money(closed.withdrawalAmount + closed.refundAmount)}</b></div>
      <div className="receipt-line"><span>จำนวนรายการจ่าย</span><b>{closed.withdrawalCount + closed.refundCount} รายการ</b></div>
      <div className="receipt-line"><span>ถอนเงินจากบัตร · {closed.withdrawalCount} รายการ</span><b>{money(closed.withdrawalAmount)}</b></div>
      <div className="receipt-line"><span>คืนบัตรเงินสด · {closed.refundCount} รายการ</span><b>{money(closed.refundAmount)}</b></div>
      </section>
      {closed.note && closed.note !== "ตัดยอดตามเวลาที่กำหนด" && <div className="receipt-line"><span>หมายเหตุ</span><b>{closed.note}</b></div>}
      {!isAutomaticClosure && <div className="receipt-thanks">ผู้ตัดยอด {closed.closedBy ?? "—"}</div>}
    </div>}
    <ConfirmDialog open={confirmOpen} title="ยืนยันตัดยอดรอบนี้?" description={`สรุปยอดตั้งแต่ ${period ? `${formatThaiDate(period.periodStart)} ${formatTimeShort(period.periodStart)}` : "ต้นรอบ"} จนถึงตอนนี้ แล้วเริ่มรอบใหม่ทันที · ยอดขายรอบนี้ ${period ? money(period.totals.revenue) : "—"} (${period?.totals.bills ?? 0} บิล) · ระบบจะสร้างสรุปรอบให้พิมพ์เก็บไว้ และบันทึกลง Log`} confirmLabel={closeMutation.isPending ? "กำลังตัดยอด…" : "ตัดยอดรอบนี้"} pending={closeMutation.isPending} error={closeMutation.isError ? closeMutation.error.message : undefined} onCancel={() => { if (closeMutation.isPending) return; setConfirmOpen(false); closeMutation.reset(); }} onConfirm={() => { if (!closeMutation.isPending) closeMutation.mutate({ actor: userName || "เจ้าหน้าที่ร้านค้า", actorRole: role }); }} />
    {printPreviewOpen && closed && <PrintPreviewModal targetId="cutoff-report" title="สรุปรอบตัดยอด" subtitle={`${formatThaiDate(closed.closedAt)} · ${formatTimeShort(closed.closedAt)}`} paper="thermal" showContentLength={false} showPrintHelp={false} onClose={() => setPrintPreviewOpen(false)} />}
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
  const membersQuery = trpc.member.list.useQuery(undefined);
  const settingsQuery = trpc.settings.get.useQuery(undefined);
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
    // Round 34 — หนึ่งเส้นฮีโร่: สเกลดูจากยอดขายอย่างเดียว (เติมเงินย้ายไปแถบสรุป+ทูลทิป)
    // พร้อมคำอธิบาย เฉลี่ย/สูงสุด/วันนี้ แทนเส้นเติมเงินสีม่วงที่แบนราบเหมือนข้อผิดพลาด
    const maxValue = Math.max(...points.map((point) => point.revenue), 1);
    const step = Math.max(1000, Math.ceil(maxValue / 4 / 1000) * 1000);
    const axisMax = step * 4;
    let maxIndex = 0;
    points.forEach((point, index) => {
      if (point.revenue > points[maxIndex].revenue) maxIndex = index;
    });
    const lastIndex = points.length - 1;
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return {
      points,
      axisMax,
      maxIndex,
      lastIndex,
      isTodayLast: lastIndex >= 0 && points[lastIndex].date === todayKey,
      avg: points.length > 0 ? points.reduce((sum, point) => sum + point.revenue, 0) / points.length : 0,
      totalDeposit: points.reduce((sum, point) => sum + point.deposit, 0),
      // ป้ายบนสุดของแกน y มี ฿ นำหน้า ให้รู้ทันทีว่าหน่วยเป็นเงิน
      yLabels: [4, 3, 2, 1].map((multiplier) => `${multiplier === 4 ? "฿" : ""}${formatAxisLabel(multiplier * step)}`).concat("0"),
    };
  }, [stats, deposits, rangeDays]);

  const chartData = chart.points;
  const safeSelectedBar = Math.min(selectedBar, Math.max(chartData.length - 1, 0));
  const selected = chartData[safeSelectedBar];
  const prevPoint = safeSelectedBar > 0 ? chartData[safeSelectedBar - 1] : null;
  const vsPrev = selected && prevPoint && prevPoint.revenue > 0 ? ((selected.revenue - prevPoint.revenue) / prevPoint.revenue) * 100 : null;
  const vsAvg = selected && chart.avg > 0 ? ((selected.revenue - chart.avg) / chart.avg) * 100 : null;
  // Round 34 — เรขาคณิตเส้นเดียวเรียบลื่น (viewBox 1000×100 + preserveAspectRatio none):
  // เส้นโค้งเป็น monotone cubic แนบข้อมูลโดยไม่หล่นต่ำกว่าค่าจริง ส่วนจุด/ป้ายเป็น HTML
  // overlay (วงกลม SVG จะถูกยืดบี้เมื่อภาชน์ไม่รักษาสัดส่วน)
  const lineGeom = useMemo(() => {
    const count = chartData.length;
    if (count === 0) return null;
    const width = 1000;
    const height = 100;
    const clampY = (value: number) => Math.min(Math.max(height - (value / chart.axisMax) * height, 1), height - 1);
    const xAt = (index: number) => ((index + 0.5) / count) * width;
    const yPercent = (value: number) => Math.min(Math.max((1 - value / chart.axisMax) * 100, 1.5), 96.5);
    const revenuePath = buildSmoothPath(chartData.map((point, index) => ({ x: xAt(index), y: clampY(point.revenue) })));
    return {
      width, height, xAt, yPercent,
      revenuePath,
      areaPath: `${revenuePath} L ${xAt(count - 1).toFixed(2)},${height} L ${xAt(0).toFixed(2)},${height} Z`,
      avgY: chart.avg > 0 ? clampY(chart.avg) : null,
      selectedX: xAt(safeSelectedBar),
      labelStep: count > 14 ? Math.ceil(count / 8) : 1,
    };
  }, [chartData, chart.axisMax, chart.avg, safeSelectedBar]);
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
  // QA-FEAT-1 — onboarding banner shows when the store is in early state
  // (no products/members/sales). Each step has a CTA that jumps to the right view.
  // FEAT-5 — added "ตั้งค่าร้าน" step: considered configured when appName has
  // been changed from the default, OR appLogo is set, OR ≥1 bank account exists.
  const storeConfigured = useMemo(() => {
    const s = settingsQuery.data;
    if (!s) return false;
    const hasCustomName = (s.appName ?? "").trim() !== "" && s.appName !== "ร้านค้าสวัสดิการ";
    const hasLogo = Boolean(s.appLogo);
    const hasBank = (s.bankAccounts ?? []).length > 0;
    return hasCustomName || hasLogo || hasBank;
  }, [settingsQuery.data]);
  const onboardingProgress = {
    storeConfigured,
    productCount: productsQuery.data?.length ?? 0,
    memberCount: membersQuery.data?.length ?? 0,
    salesCount: stats?.totalOrders ?? 0,
  };
  return (
    <>
      <SectionHeader eyebrow={`ภาพรวมการดำเนินงาน · ${role === "admin" ? "มุมมองผู้บริหาร" : role === "dev" ? "มุมมองผู้พัฒนา" : "มุมมองเจ้าหน้าที่"}`} title={`${greetingWord}, ${firstName}`} description="" action={<><div className={`permission-chip ${role}`}><span>{role === "admin" ? <Crown size={14} /> : role === "dev" ? <Terminal size={14} /> : <ShieldCheck size={14} />}</span>{role === "admin" ? "สิทธิ์ผู้บริหาร · วิเคราะห์เต็มรูปแบบ" : role === "dev" ? "สิทธิ์ผู้พัฒนา · เข้าถึงทุกส่วนของระบบ" : "สิทธิ์เจ้าหน้าที่ · ปฏิบัติงานหน้าร้าน"}</div><div className="permission-chip neutral" title="วันที่ปัจจุบัน"><span><CalendarDays size={14} /></span>วันนี้ · {formatThaiDate(new Date())}</div></>} />
      <OnboardingBanner progress={onboardingProgress} setView={setView} />
      {/* STYLE-9 — Today's snapshot mini-stats row (always visible, quick glance at today) */}
      <TodaySnapshot stats={stats} deposits={deposits} loading={loading} rangeDays={rangeDays} setView={setView} />
      <div className="metric-grid">
        <div className="metric-card highlight"><div className="metric-top"><span>ยอดขายทั้งหมด · {range}</span><span className="metric-icon green"><ShoppingBag size={18} /></span></div><strong>{loading ? "…" : money(stats?.totalSales ?? 0)}</strong><div className="metric-foot"><span>{stats?.totalOrders ?? 0} บิล</span><span>สูงสุด {money(Math.max(...(stats?.revenueByDay ?? []).map((day) => day.total), 0))} ในหนึ่งวัน</span></div></div>
        <div className="metric-card"><div className="metric-top"><span>ออเดอร์ทั้งหมด</span><span className="metric-icon blue"><ReceiptText size={18} /></span></div><strong>{loading ? "…" : (stats?.totalOrders ?? 0).toLocaleString("th-TH")} <small>บิล</small></strong><div className="metric-foot"><span>เฉลี่ย {((stats?.totalOrders ?? 0) / rangeDays).toFixed(1)} บิล/วัน</span><span>ในช่วง{range}</span></div></div>
        <div className="metric-card"><div className="metric-top"><span>สินค้าขายดี</span><span className="metric-icon amber"><BarChart3 size={18} /></span></div><strong>{loading ? "…" : (stats?.bestSellerCount ?? 0).toLocaleString("th-TH")} <small>ชิ้น</small></strong><div className="metric-foot warning"><span>{bestSellers[0]?.name ?? "ยังไม่มีข้อมูลการขาย"}</span><span>อันดับ 1 ในช่วง{range}</span></div></div>
        <div className="metric-card"><div className="metric-top"><span>ยอดขายเฉลี่ยต่อวัน</span><span className="metric-icon purple"><CalendarDays size={18} /></span></div><strong>{loading ? "…" : money(stats?.avgDailySales ?? 0)}</strong><div className="metric-foot"><span>ขายไป {stats?.itemsSold ?? 0} ชิ้น</span><span>ในช่วง{range}</span></div></div>
      </div>
      <section className="dash-workbench" aria-label="มุมมองข้อมูลภาพรวม">
        <div className="dash-tabbar" role="tablist" aria-label="เลือกมุมมองข้อมูล">
          {DASH_TABS.map((item) => <button type="button" role="tab" aria-selected={tab === item.id} className={`dash-tab${tab === item.id ? " active" : ""}`} key={item.id} onClick={() => setTab(item.id)}>{item.id === "sales" ? <BarChart3 size={15} /> : item.id === "bills" ? <ReceiptText size={15} /> : item.id === "best" ? <Crown size={15} /> : item.id === "watch" ? <PackageSearch size={15} /> : item.id === "activity" ? <Activity size={15} /> : <CalendarClock size={15} />}{item.label}{item.id === "watch" && lowStock.length > 0 && <i className="tab-badge red" title={`สินค้าใกล้หมดสต็อก ${lowStock.length} รายการ`}>{lowStock.length}</i>}{item.id === "watch" && expirySoon.length > 0 && <i className="tab-badge amber" title={`ใกล้หมดอายุ ${expirySoon.length} รายการ`}>{expirySoon.length}</i>}</button>)}
          <span className="dash-tabbar-spacer" aria-hidden="true" />
        </div>
        <div className="dash-tab-body" role="tabpanel">
          {/* Round 34 — กราฟยอดขายออกแบบใหม่: เส้นเดียวอ่านง่าย + คำอธิบายครบ (จุด/ป้ายค่า/
              เส้นเฉลี่ย/แถบสุดสัปดาห์/ป้ายวันนี้ยังไม่ครบวัน/การ์ดสรุปจุดที่เลือก) */}
          {tab === "bills" && <RecentBillsWidget setView={setView} range={range} />}
          {tab === "sales" && <section className="panel chart-panel interactive-chart-panel">
            <div className="panel-heading">
              <div>
                <h2>ยอดขายร้านค้า</h2>
                <p>{rangeDays > 60 ? "กราฟยอดขายรายเดือน · แตะ/คลิกจุดเพื่อดูรายละเอียด" : "กราฟยอดขายรายวัน · แตะ/คลิกจุดเพื่อดูรายละเอียด · แถบสีอ่อน = สุดสัปดาห์"}</p>
              </div>
              <div className="chart-controls">{["7 วัน", "30 วัน", "12 เดือน"].map((item) => <button className={range === item ? "active" : ""} onClick={() => { setRange(item); setSelectedBar(0); }} key={item}>{item}</button>)}</div>
            </div>
            <div className="chart-interactive-meta">
              <span><i className="dot teal" /> ยอดขายสินค้า (บาท/วัน)</span>
              <span><i className="avg-dash" /> เส้นค่าเฉลี่ย</span>
              <b>{loading ? "กำลังโหลดข้อมูลจากระบบ…" : selected ? `${selected.label} · ยอดขาย ${money(selected.revenue)}` : "ยังไม่มีข้อมูล"}</b>
            </div>
            <div className="chart-wrap chart-wrap-line">
              {lineGeom ? <>
                <div className="y-labels">{chart.yLabels.map((label) => <span key={label}>{label}</span>)}</div>
                <div className="line-chart" role="img" aria-label={`กราฟยอดขาย ${chartData.length} จุด ช่วง${range} สูงสุด ${money(Math.max(...chartData.map((point) => point.revenue), 0))} ค่าเฉลี่ย ${money(chart.avg)}`}>
                  {rangeDays <= 60 && chartData.map((point, index) => {
                    const weekday = new Date(`${point.date}T00:00:00`).getDay();
                    return weekday === 0 || weekday === 6 ? <div key={`weekend-${index}`} className="weekend-band" aria-hidden="true" style={{ left: `${(index / chartData.length) * 100}%`, width: `${100 / chartData.length}%` }} /> : null;
                  })}
                  <svg viewBox={`0 0 ${lineGeom.width} ${lineGeom.height}`} preserveAspectRatio="none" aria-hidden="true">
                    <defs><linearGradient id="revenue-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-revenue)" stopOpacity={0.2} /><stop offset="100%" stopColor="var(--chart-revenue)" stopOpacity={0} /></linearGradient></defs>
                    {[0.25, 0.5, 0.75, 1].map((ratio) => <line key={ratio} className="line-grid" x1="0" x2={lineGeom.width} y1={lineGeom.height * (1 - ratio)} y2={lineGeom.height * (1 - ratio)} />)}
                    <path className="line-area" d={lineGeom.areaPath} />
                    <path className="line-revenue" d={lineGeom.revenuePath} />
                    {lineGeom.avgY !== null && <line className="line-avg" x1="0" x2={lineGeom.width} y1={lineGeom.avgY} y2={lineGeom.avgY} />}
                    <line className="line-cursor" x1={lineGeom.selectedX} x2={lineGeom.selectedX} y1="0" y2={lineGeom.height} />
                  </svg>
                  {chartData.map((point, index) => {
                    if (chartData.length > 14 && index !== safeSelectedBar && index !== chart.maxIndex && index !== chart.lastIndex) return null;
                    const classes = ["chart-dot", chart.maxIndex === index && point.revenue > 0 ? "max" : "", chart.isTodayLast && index === chart.lastIndex ? "today" : "", safeSelectedBar === index ? "selected" : ""].filter(Boolean).join(" ");
                    return <div key={`dot-${index}`} className={classes} aria-hidden="true" style={{ left: `${((index + 0.5) / chartData.length) * 100}%`, top: `${lineGeom.yPercent(point.revenue)}%` }} />;
                  })}
                  {chartData.length <= 14 && chartData.map((point, index) => <div key={`value-${index}`} className="chart-value" aria-hidden="true" style={{ left: `${((index + 0.5) / chartData.length) * 100}%`, top: `${Math.max(lineGeom.yPercent(point.revenue), 16)}%` }}>{compactBaht(point.revenue)}</div>)}
                  {chartData.length > 14 && (chartData[chart.maxIndex]?.revenue ?? 0) > 0 && <div className="chart-tag max" aria-hidden="true" style={{ left: `clamp(52px, ${((chart.maxIndex + 0.5) / chartData.length) * 100}%, calc(100% - 52px))`, top: `${Math.min(lineGeom.yPercent(chartData[chart.maxIndex].revenue) + 5, 78)}%` }}>สูงสุด {compactBaht(chartData[chart.maxIndex].revenue)}</div>}
                  {chart.isTodayLast && <div className="chart-today-pill" aria-hidden="true">วันนี้ · ยังไม่ครบวัน</div>}
                  {chart.avg > 0 && <div className="chart-avg-chip" aria-hidden="true" style={{ top: `${Math.min(Math.max(lineGeom.yPercent(chart.avg), 8), 86)}%` }}>เฉลี่ย {compactBaht(chart.avg)}</div>}
                  {selected && <div className="chart-tooltip" style={{ left: `clamp(2px, calc(${((safeSelectedBar + 0.5) / chartData.length) * 100}% - 89px), calc(100% - 180px))`, top: ((safeSelectedBar + 0.5) / chartData.length) * 100 >= 80 ? 30 : 8 }}>
                    <small>{formatThaiDate(selected.date)}</small>
                    <b>{money(selected.revenue)}</b>
                    <div className="tt-row"><span>{rangeDays > 60 ? "เทียบเดือนก่อน" : "เทียบเมื่อวาน"}</span>{deltaChip(vsPrev, prevPoint ? "—" : "จุดแรกของช่วง")}</div>
                    <div className="tt-row"><span>เทียบค่าเฉลี่ย</span>{deltaChip(vsAvg, "—")}</div>
                    {selected.deposit > 0 && <div className="tt-row deposit"><span>{rangeDays > 60 ? "เติมเงินในเดือนนี้" : "เติมเงินวันนี้"}</span><em>{money(selected.deposit)}</em></div>}
                    {chart.isTodayLast && safeSelectedBar === chart.lastIndex && <div className="tt-today-note">วันนี้ · ยังไม่ครบวัน — ตัวเลขยังเพิ่มได้ตลอดวัน</div>}
                  </div>}
                  <div className="line-hits">{chartData.map((point, index) => <button type="button" key={`${point.label}-${index}`} className={safeSelectedBar === index ? "selected" : ""} style={{ left: `${(index / chartData.length) * 100}%`, width: `${100 / chartData.length}%` }} onClick={() => setSelectedBar(index)} title={`${point.label}: ยอดขาย ${money(point.revenue)}${point.deposit > 0 ? ` (เติมเงิน ${money(point.deposit)})` : ""}`} aria-label={`${point.label} ยอดขาย ${money(point.revenue)}`} />)}</div>
                </div>
                <div className="line-x-labels">{chartData.map((point, index) => <span key={`${point.label}-x-${index}`} className={safeSelectedBar === index || lineGeom.labelStep === 1 || index % lineGeom.labelStep === 0 ? `show${safeSelectedBar === index ? " picked" : ""}` : ""}>{point.label}</span>)}</div>
              </> : <div className="chart-empty-note">ยังไม่มีข้อมูลยอดขายในช่วงนี้</div>}
            </div>
            <div className="chart-summary">
              <div><span>ยอดขายรวมช่วงนี้</span><strong>{money(stats?.totalSales ?? 0)}</strong></div>
              <div><span>ค่าเฉลี่ยต่อวัน</span><strong>{money(stats?.avgDailySales ?? 0)}</strong></div>
              <div><span>จำนวนบิล</span><strong>{(stats?.totalOrders ?? 0).toLocaleString("th-TH")} <small>บิล</small></strong></div>
              <div><span className="summary-with-icon"><Wallet size={12} /> เติมเงินรวมช่วงนี้</span><strong>{money(chart.totalDeposit)}</strong></div>
            </div>
          </section>}
          {tab === "best" && <section className="panel best-seller-panel"><div className="panel-heading"><div><h2>สินค้าขายดี 10 อันดับ</h2><p>สรุปจากรายการขายจริงในช่วง{range} · กดรายการเพื่อเลือกข้อมูล</p></div><div className="chart-controls small">{["จำนวนขาย", "ยอดขาย"].map((item) => <button className={bestMode === item ? "active" : ""} onClick={() => { setBestMode(item); setSelectedProduct(0); }} key={item}>{item}</button>)}</div></div><div className="product-ranking-chart">{loading ? <div className="table-loading"><BarChart3 size={22} /><b>กำลังโหลดอันดับสินค้าขายดี</b><span>สรุปจากรายการขายจริงในช่วง{range}</span></div> : bestSellersRanked.length === 0 ? <div className="table-loading"><BarChart3 size={22} /><b>ยังไม่มีข้อมูลการขาย</b><span>เริ่มขายสินค้าผ่าน POS เพื่อดูอันดับ</span></div> : bestSellersRanked.map(({ name, qtyLabel, total, emoji, width, rank }, index) => <button className={`product-rank-row ${selectedProduct === index ? "selected" : ""}`} key={name} onClick={() => setSelectedProduct(index)}><span className={`rank rank-0${rank}`}>{`0${rank}`}</span><span className="product-thumb">{emoji}</span><span className="seller-name"><b>{name}</b><small>{qtyLabel}</small><i className="rank-progress"><em style={{ width: `${width}%` }} /></i></span><strong>{total}</strong><MoreHorizontal size={17} className="muted-icon" /></button>)}</div><div className="ranking-insight"><BarChart3 size={15} /><span>{bestSellersRanked[selectedProduct]?.name ?? "สินค้าขายดี"} ทำยอดสูงสุดในมุมมอง{bestMode === "ยอดขาย" ? "มูลค่า" : "จำนวน"} · คลิกแถวเพื่อเลือกข้อมูล</span></div></section>}
          {tab === "watch" && <div className="inventory-alert-grid"><section className="panel alert-panel stock-alert-panel"><div className="alert-heading"><div><span className="eyebrow">ควรติดตามวันนี้</span><h2>สินค้าใกล้หมดสต็อก</h2><p>ช่วยวางแผนสั่งซื้อให้เพียงพอต่อการใช้งาน</p></div><span className="alert-count red">{lowStock.length}</span></div><div className="alert-list">{loading ? <div className="table-loading"><PackageSearch size={22} /><b>กำลังโหลดข้อมูลสต็อก</b><span>ดึงข้อมูลจากฐานข้อมูลสวัสดิการ</span></div> : lowStock.length === 0 ? <div className="table-loading"><PackageSearch size={22} /><b>สต็อกเพียงพอทุกรายการ</b><span>ไม่มีสินค้าที่ต่ำกว่าจุดสั่งซื้อ</span></div> : lowStock.map((row) => <button className="alert-row" key={row.id} onClick={() => setView("stock")}><span className="alert-item-icon red-bg"><PackageSearch size={15} /></span><span><b>{row.name}</b><small>เหลือ {row.stock} {row.unit} · สั่งซื้อแนะนำ {row.reorderPoint * 2} {row.unit}</small></span><span className="alert-arrow">→</span></button>)}</div><button className="alert-footer-action" onClick={() => setView("stock")}>ดูรายการและวางแผนสั่งซื้อ <span>→</span></button></section><section className="panel alert-panel expiry-alert-panel"><div className="alert-heading"><div><span className="eyebrow">ภายใน 30 วัน</span><h2>สินค้าใกล้หมดอายุ</h2><p>ตรวจสอบ Lot เพื่อวางแผนจัดจำหน่าย</p></div><span className="alert-count amber">{expirySoon.length}</span></div><div className="alert-list">{loading ? <div className="table-loading"><CalendarDays size={22} /><b>กำลังโหลดข้อมูลวันหมดอายุ</b><span>ตรวจสอบ Lot ที่ใกล้หมดอายุ</span></div> : expirySoon.length === 0 ? <div className="table-loading"><CalendarDays size={22} /><b>ไม่มีสินค้าใกล้หมดอายุ</b><span>ภายใน 30 วันข้างหน้า</span></div> : expirySoon.map((row) => <button className="alert-row" key={row.id} onClick={() => setView("stock")}><span className="alert-item-icon amber-bg"><CalendarDays size={15} /></span><span><b>{row.name}</b><small>หมดอายุ {formatThaiDate(row.expiry)} · Lot {row.lot} · เหลือ {row.qty} {row.unit}</small></span><span className="alert-arrow">→</span></button>)}</div><button className="alert-footer-action amber-action-text" onClick={() => setView("stock")}>เปิดรายงานวันหมดอายุ <span>→</span></button></section></div>}
          {tab === "activity" && <section className="panel"><div className="panel-heading"><div><h2>กิจกรรมล่าสุดในระบบ</h2><p>ธุรกรรมและการเปลี่ยนแปลงที่บันทึกอัตโนมัติ</p></div><Activity size={19} className="muted-icon" /></div><div className="dash-activity-scroll">{loading ? <div className="table-loading"><Activity size={22} /><b>กำลังโหลดกิจกรรมล่าสุด</b><span>ดึงข้อมูลจากระบบ Log</span></div> : recentActivities.length === 0 ? <div className="table-loading"><Activity size={22} /><b>ยังไม่มีกิจกรรม</b><span>รายการจะแสดงเมื่อมีการทำธุรกรรม</span></div> : <table className="log-table compact" aria-label="รายการกิจกรรมล่าสุด"><thead><tr><th aria-label="ระดับกิจกรรม" /><th>เวลา</th><th>ผู้ทำรายการ</th><th>กิจกรรม</th><th>รายละเอียด</th></tr></thead><tbody>{recentActivities.map((log) => <tr key={log.id}><td className="log-tone-cell"><i className={`log-dot-mini tone-${log.tone ?? "green"}`} aria-hidden="true" /></td><td><small className="cell-mono">{formatTimeShort(log.createdAt)}</small></td><td><b>{log.actor}</b><small>{log.actorRole ?? ""}</small></td><td><b>{log.action}</b></td><td><span className="log-detail-text">{log.detail}</span></td></tr>)}</tbody></table>}</div>{isAdminRole(role) ? <button className="alert-footer-action" onClick={() => setView("logs")}>ดูกิจกรรมทั้งหมดในระบบ Log <span>→</span></button> : <div className="ranking-insight"><ShieldCheck size={15} /><span>ข้อมูลทุกธุรกรรมถูกบันทึกในระบบ Log อัตโนมัติ · ประวัติฉบับเต็มเปิดได้โดยผู้บริหาร</span></div>}</section>}
          {tab === "cutoff" && <CutoffWidget role={role} userName={userName} />}
        </div>
      </section>
    </>
  );
}
