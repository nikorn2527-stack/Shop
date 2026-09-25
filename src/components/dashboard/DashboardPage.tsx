"use client";

/**
 * DashboardPage — KPIs + sales SVG line chart + best-sellers ranking + watch
 * panels (low stock / expiry soon) + recent activity table.
 *
 * Data source: GET /api/dashboard/stats?rangeDays=…  (TanStack Query).
 *
 * The chart is a pure SVG with Fritsch–Carlson monotone cubic smoothing,
 * viewBox 1000×100 + preserveAspectRatio="none", 4 horizontal grid lines,
 * an average dashed line, weekend highlight bands when rangeDays ≤ 60, and
 * a hover tooltip showing date + revenue + % vs yesterday. We deliberately
 * avoid recharts so the markup stays lightweight and the design language
 * matches the original Shop exactly.
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  CalendarClock,
  BarChart3,
  CalendarDays,
  Crown,
  PackageSearch,
  ReceiptText,
  ShoppingBag,
  Wallet,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { apiGet } from "@/lib/api-client";
import { compactBaht, formatThaiDate, money } from "@/lib/format";
import { roleLabel } from "@/lib/rbac";
import { isAdminRole, type View } from "@/lib/view-data";
import { cn } from "@/lib/utils";

interface RevenueByDay {
  date: string;
  label: string;
  orders: number;
  revenue: number;
  pieces: number;
}

interface BestSeller {
  name: string;
  qty: number;
  revenue: number;
  emoji?: string;
}

interface LowStockRow {
  id: string;
  name: string;
  stock: number;
  unit: string;
  reorderPoint: number;
}

interface ExpiryRow {
  lotId: string;
  productId: string;
  productName: string;
  unit: string;
  lot: string;
  expiryDate: string | null;
  expiryLabel: string;
  qty: number;
}

interface RecentActivity {
  id: string;
  action: string;
  actor: string | null;
  actorRole: string | null;
  detail: string;
  tone: string;
  createdAt: string;
  createdAtLabel: string;
}

interface DashboardStats {
  totalSales: number;
  totalOrders: number;
  totalPieces: number;
  itemsSold: number;
  avgDailySales: number;
  revenueByDay: RevenueByDay[];
  bestSellers: BestSeller[];
  bestSellerCount: number;
  maxDailyRevenue: number;
  lowStock: LowStockRow[];
  expirySoon: ExpiryRow[];
  memberWalletTotal: number;
  memberCount: number;
  newMembersThisMonth: number;
  recentActivities: RecentActivity[];
}

interface DashboardPageProps {
  role: string;
  userName: string;
  onNavigate?: (view: View) => void;
}

const RANGE_PRESETS: { id: string; label: string; days: number }[] = [
  { id: "7", label: "7 วัน", days: 7 },
  { id: "30", label: "30 วัน", days: 30 },
  { id: "365", label: "365 วัน", days: 365 },
];

const THAI_SHORT_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const THAI_WEEKDAYS = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "สวัสดีตอนเช้า";
  if (h < 17) return "สวัสดีตอนบ่าย";
  return "สวัสดีตอนเย็น";
}

function firstNameOf(name: string): string {
  return (name || "ผู้ใช้ระบบ").trim().split(/\s+/)[0]!;
}

/**
 * Fritsch–Carlson monotone cubic smoothing — never overshoots past neighbours
 * so flat zero-days don't fake a dip below the data.
 */
function buildSmoothPath(points: { x: number; y: number }[]): string {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M ${points[0]!.x.toFixed(2)},${points[0]!.y.toFixed(2)}`;
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const dx = points[i + 1]!.x - points[i]!.x;
    slopes.push(dx > 0 ? (points[i + 1]!.y - points[i]!.y) / dx : 0);
  }
  const tangents: number[] = [slopes[0]!];
  for (let i = 1; i < n - 1; i += 1) {
    tangents.push(slopes[i - 1]! * slopes[i]! <= 0 ? 0 : (slopes[i - 1]! + slopes[i]!) / 2);
  }
  tangents.push(slopes[n - 2]!);
  for (let i = 0; i < n - 1; i += 1) {
    if (slopes[i] === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const alpha = tangents[i]! / slopes[i]!;
    const beta = tangents[i + 1]! / slopes[i]!;
    const square = alpha * alpha + beta * beta;
    if (square > 9) {
      const tau = 3 / Math.sqrt(square);
      tangents[i] = tau * alpha * slopes[i]!;
      tangents[i + 1] = tau * beta * slopes[i]!;
    }
  }
  let path = `M ${points[0]!.x.toFixed(2)},${points[0]!.y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i += 1) {
    const dx = points[i + 1]!.x - points[i]!.x;
    path += ` C ${(points[i]!.x + dx / 3).toFixed(2)},${(points[i]!.y + (tangents[i]! * dx) / 3).toFixed(2)} ${(points[i + 1]!.x - dx / 3).toFixed(2)},${(points[i + 1]!.y + (tangents[i + 1]! * dx) / 3).toFixed(2)} ${points[i + 1]!.x.toFixed(2)},${points[i + 1]!.y.toFixed(2)}`;
  }
  return path;
}

interface ChartPoint extends RevenueByDay {
  label: string;
}

function computeChart(stats: DashboardStats | undefined, rangeDays: number) {
  const base = stats?.revenueByDay ?? [];
  let points: ChartPoint[];
  if (rangeDays > 60) {
    // Group by month
    const groups = new Map<string, ChartPoint>();
    for (const day of base) {
      const monthKey = day.date.slice(0, 7);
      const existing = groups.get(monthKey);
      const label = `${THAI_SHORT_MONTHS[Number(monthKey.slice(5, 7)) - 1] ?? monthKey}`;
      if (existing) {
        existing.revenue += day.revenue;
        existing.orders += day.orders;
        existing.pieces += day.pieces;
      } else {
        groups.set(monthKey, { ...day, label });
      }
    }
    points = [...groups.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  } else {
    points = base.map((day) => ({
      ...day,
      label: rangeDays <= 7
        ? THAI_WEEKDAYS[new Date(`${day.date}T00:00:00`).getDay()]
        : String(Number(day.date.slice(8, 10))),
    }));
  }
  const maxValue = Math.max(...points.map((p) => p.revenue), 1);
  const step = Math.max(1000, Math.ceil(maxValue / 4 / 1000) * 1000);
  const axisMax = step * 4;
  let maxIndex = 0;
  points.forEach((p, i) => {
    if (p.revenue > points[maxIndex]!.revenue) maxIndex = i;
  });
  const lastIndex = points.length - 1;
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const avg = points.length > 0
    ? points.reduce((sum, p) => sum + p.revenue, 0) / points.length
    : 0;
  const yLabels = [4, 3, 2, 1].map((m) => `${m === 4 ? "฿" : ""}${compactBaht(m * step)}`).concat("฿0");
  return {
    points,
    axisMax,
    maxIndex,
    lastIndex,
    isTodayLast: lastIndex >= 0 && points[lastIndex]!.date === todayKey,
    avg,
    yLabels,
  };
}

function DeltaChip({ value, fallback }: { value: number | null; fallback: string }) {
  if (value === null) return <span className="text-muted-foreground/70 text-xs">{fallback}</span>;
  const cls = value >= 0 ? "text-emerald-700" : "text-red-600";
  return (
    <span className={cn("text-xs font-medium", cls)}>
      {value >= 0 ? "↑" : "↓"} {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function KpiCard({
  title,
  value,
  icon: Icon,
  tone,
  foot,
  loading,
}: {
  title: string;
  value: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  tone: "emerald" | "neutral" | "amber" | "purple";
  foot?: React.ReactNode;
  loading?: boolean;
}) {
  const toneClass: Record<typeof tone, string> = {
    emerald: "bg-emerald-100 text-emerald-700",
    neutral: "bg-neutral-100 text-neutral-700",
    amber: "bg-amber-100 text-amber-700",
    purple: "bg-purple-100 text-purple-700",
  };
  return (
    <Card className="py-0">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between">
          <span className="text-xs font-medium text-muted-foreground">{title}</span>
          <span className={cn("size-8 rounded-lg grid place-items-center", toneClass[tone])}>
            <Icon className="size-4" aria-hidden="true" />
          </span>
        </div>
        <div className="text-2xl font-semibold tracking-tight tabular-nums">
          {loading ? <Skeleton className="h-7 w-32" /> : value}
        </div>
        {foot ? <div className="text-xs text-muted-foreground space-y-0.5">{foot}</div> : null}
      </CardContent>
    </Card>
  );
}

export function DashboardPage({ role, userName, onNavigate }: DashboardPageProps) {
  const [rangeId, setRangeId] = React.useState("30");
  const [selectedBar, setSelectedBar] = React.useState(0);
  const [bestMode, setBestMode] = React.useState<"qty" | "revenue">("qty");
  const [dashTab, setDashTab] = React.useState<"sales" | "best" | "watch" | "activity" | "cutoff">("sales");
  const rangeDays = RANGE_PRESETS.find((p) => p.id === rangeId)?.days ?? 30;

  const statsQuery = useQuery({
    queryKey: ["dashboard-stats", rangeDays],
    queryFn: () => apiGet<DashboardStats>(`/api/dashboard/stats?rangeDays=${rangeDays}`),
    staleTime: 30_000,
  });
  const stats = statsQuery.data;
  const loading = statsQuery.isLoading;

  React.useEffect(() => {
    setSelectedBar(0);
  }, [rangeId]);

  const chart = React.useMemo(() => computeChart(stats, rangeDays), [stats, rangeDays]);
  const chartData = chart.points;
  const safeSelected = Math.min(selectedBar, Math.max(chartData.length - 1, 0));
  const selected = chartData[safeSelected];
  const prevPoint = safeSelected > 0 ? chartData[safeSelected - 1] : null;
  const vsPrev = selected && prevPoint && prevPoint.revenue > 0
    ? ((selected.revenue - prevPoint.revenue) / prevPoint.revenue) * 100
    : null;
  const vsAvg = selected && chart.avg > 0
    ? ((selected.revenue - chart.avg) / chart.avg) * 100
    : null;

  const lineGeom = React.useMemo(() => {
    const count = chartData.length;
    if (count === 0) return null;
    const width = 1000;
    const height = 100;
    const clampY = (v: number) => Math.min(Math.max(height - (v / chart.axisMax) * height, 1), height - 1);
    const xAt = (i: number) => ((i + 0.5) / count) * width;
    const yPercent = (v: number) => Math.min(Math.max((1 - v / chart.axisMax) * 100, 1.5), 96.5);
    const revenuePath = buildSmoothPath(chartData.map((p, i) => ({ x: xAt(i), y: clampY(p.revenue) })));
    return {
      width,
      height,
      xAt,
      yPercent,
      revenuePath,
      areaPath: `${revenuePath} L ${xAt(count - 1).toFixed(2)},${height} L ${xAt(0).toFixed(2)},${height} Z`,
      avgY: chart.avg > 0 ? clampY(chart.avg) : null,
      selectedX: xAt(safeSelected),
      labelStep: count > 14 ? Math.ceil(count / 8) : 1,
    };
  }, [chartData, chart.axisMax, chart.avg, safeSelected]);

  const bestSellers = stats?.bestSellers ?? [];
  const bestSellersRanked = bestSellers.map((item, index) => {
    const max = bestMode === "qty"
      ? Math.max(...bestSellers.map((b) => b.qty), 1)
      : Math.max(...bestSellers.map((b) => b.revenue), 1);
    const value = bestMode === "qty" ? item.qty : item.revenue;
    return {
      name: item.name,
      qtyLabel: bestMode === "qty" ? `${item.qty} ชิ้น` : money(item.revenue),
      total: money(item.revenue),
      emoji: item.emoji ?? "🛍️",
      width: Math.round((value / max) * 100),
      rank: index + 1,
    };
  });

  const lowStock = stats?.lowStock ?? [];
  const expirySoon = stats?.expirySoon ?? [];
  const recentActivities = stats?.recentActivities ?? [];

  const firstName = firstNameOf(userName);
  const greetingWord = greeting();

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow={`ภาพรวมการดำเนินงาน · ${isAdminRole(role) ? "มุมมองผู้บริหาร" : "มุมมองเจ้าหน้าที่"}`}
        title={`${greetingWord}, ${firstName}`}
        description="สรุปตัวเลขสำคัญอยู่บนสุด · เลือกช่วงเวลาด้านล่างเพื่อดูกราฟและสินค้าขายดี"
        actions={
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
              {role === "administrator" ? <Crown className="size-3.5" aria-hidden="true" /> : <Activity className="size-3.5" aria-hidden="true" />}
              {roleLabel(role)}
            </span>
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground">
              <CalendarDays className="size-3.5" aria-hidden="true" />
              วันนี้ · {formatThaiDate(new Date())}
            </span>
          </div>
        }
      />

      {/* Dashboard tabs — mirrors original Shop's DASH_TABS */}
      <div className="flex gap-1 border-b pb-2 overflow-x-auto">
        {[
          { id: "sales", label: "ยอดขาย", icon: BarChart3 },
          { id: "best", label: "สินค้าขายดี", icon: Crown },
          { id: "watch", label: "ต้องติดตาม", icon: PackageSearch },
          { id: "activity", label: "กิจกรรมล่าสุด", icon: Activity },
          { id: "cutoff", label: "รอบตัดยอด", icon: CalendarClock },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setDashTab(t.id as typeof dashTab)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors whitespace-nowrap",
              dashTab === t.id
                ? "bg-emerald-50 text-emerald-700 border-b-2 border-emerald-600"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            <t.icon className="size-3.5" />
            {t.label}
            {t.id === "watch" && (lowStock.length > 0 || expirySoon.length > 0) && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full bg-red-500 text-white">
                {lowStock.length + expirySoon.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* KPI grid — always visible */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title={`ยอดขายทั้งหมด · ${RANGE_PRESETS.find((p) => p.id === rangeId)?.label ?? ""}`}
          value={money(stats?.totalSales ?? 0)}
          icon={ShoppingBag}
          tone="emerald"
          loading={loading}
          foot={
            <>
              <p>{stats?.totalOrders ?? 0} บิล</p>
              <p>สูงสุด {money(stats?.maxDailyRevenue ?? 0)} ในหนึ่งวัน</p>
            </>
          }
        />
        <KpiCard
          title="ออเดอร์ทั้งหมด"
          value={
            <span>
              {(stats?.totalOrders ?? 0).toLocaleString("th-TH")}{" "}
              <small className="text-sm font-normal text-muted-foreground">บิล</small>
            </span>
          }
          icon={ReceiptText}
          tone="neutral"
          loading={loading}
          foot={
            <>
              <p>เฉลี่ย {((stats?.totalOrders ?? 0) / rangeDays).toFixed(1)} บิล/วัน</p>
              <p>ในช่วง {RANGE_PRESETS.find((p) => p.id === rangeId)?.label}</p>
            </>
          }
        />
        <KpiCard
          title="สินค้าขายดี"
          value={
            <span>
              {(stats?.bestSellerCount ?? 0).toLocaleString("th-TH")}{" "}
              <small className="text-sm font-normal text-muted-foreground">ชิ้น</small>
            </span>
          }
          icon={BarChart3}
          tone="amber"
          loading={loading}
          foot={
            <>
              <p>{bestSellers[0]?.name ?? "ยังไม่มีข้อมูลการขาย"}</p>
              <p>อันดับ 1 ในช่วง {RANGE_PRESETS.find((p) => p.id === rangeId)?.label}</p>
            </>
          }
        />
        <KpiCard
          title="ยอดขายเฉลี่ยต่อวัน"
          value={money(stats?.avgDailySales ?? 0)}
          icon={CalendarDays}
          tone="purple"
          loading={loading}
          foot={
            <>
              <p>ขายไป {stats?.itemsSold ?? 0} ชิ้น</p>
              <p>ในช่วง {RANGE_PRESETS.find((p) => p.id === rangeId)?.label}</p>
            </>
          }
        />
      </div>

      {/* Sales chart */}
      <Card className="py-0">
        <CardContent className="p-4 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-tight">ยอดขายร้านค้า</h2>
              <p className="text-sm text-muted-foreground">
                {rangeDays > 60
                  ? "กราฟยอดขายรายเดือน · แตะ/คลิกจุดเพื่อดูรายละเอียด"
                  : "กราฟยอดขายรายวัน · แตะ/คลิกจุดเพื่อดูรายละเอียด · แถบสีอ่อน = สุดสัปดาห์"}
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-lg border p-0.5">
              {RANGE_PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  type="button"
                  variant={rangeId === preset.id ? "default" : "ghost"}
                  size="sm"
                  className={cn(
                    "h-7 px-2.5 text-xs",
                    rangeId === preset.id && "bg-emerald-600 text-white hover:bg-emerald-700",
                  )}
                  onClick={() => setRangeId(preset.id)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
              ยอดขายสินค้า (บาท/วัน)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 border-t-2 border-dashed border-emerald-400" aria-hidden="true" />
              เส้นค่าเฉลี่ย
            </span>
            <span className="ml-auto font-medium text-foreground">
              {loading ? "กำลังโหลดข้อมูลจากระบบ…" : selected ? `${selected.label} · ยอดขาย ${money(selected.revenue)}` : "ยังไม่มีข้อมูล"}
            </span>
          </div>

          <div className="flex gap-2">
            {/* Y axis labels */}
            <div className="flex flex-col justify-between py-1 text-[10px] text-muted-foreground tabular-nums">
              {chart.yLabels.map((label) => (
                <span key={label} className="leading-none">{label}</span>
              ))}
            </div>
            {/* Chart area */}
            <div className="relative flex-1 h-44 sm:h-52">
              {lineGeom ? (
                <>
                  {/* Weekend bands */}
                  {rangeDays <= 60 && chartData.map((p, i) => {
                    const weekday = new Date(`${p.date}T00:00:00`).getDay();
                    if (weekday !== 0 && weekday !== 6) return null;
                    return (
                      <div
                        key={`wk-${i}`}
                        className="absolute top-0 bottom-0 bg-emerald-50/70"
                        aria-hidden="true"
                        style={{
                          left: `${(i / chartData.length) * 100}%`,
                          width: `${100 / chartData.length}%`,
                        }}
                      />
                    );
                  })}
                  {/* SVG line */}
                  <svg
                    viewBox={`0 0 ${lineGeom.width} ${lineGeom.height}`}
                    preserveAspectRatio="none"
                    className="absolute inset-0 w-full h-full"
                    aria-hidden="true"
                  >
                    <defs>
                      <linearGradient id="revenue-area" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgba(16,185,129,.32)" />
                        <stop offset="100%" stopColor="rgba(16,185,129,0)" />
                      </linearGradient>
                    </defs>
                    {[0.25, 0.5, 0.75, 1].map((ratio) => (
                      <line
                        key={ratio}
                        stroke="currentColor"
                        className="text-neutral-200"
                        strokeWidth={0.5}
                        x1="0"
                        x2={lineGeom.width}
                        y1={lineGeom.height * (1 - ratio)}
                        y2={lineGeom.height * (1 - ratio)}
                      />
                    ))}
                    <path d={lineGeom.areaPath} fill="url(#revenue-area)" />
                    <path
                      d={lineGeom.revenuePath}
                      fill="none"
                      stroke="rgb(5 150 105)"
                      strokeWidth={1.5}
                      vectorEffect="non-scaling-stroke"
                    />
                    {lineGeom.avgY !== null ? (
                      <line
                        x1="0"
                        x2={lineGeom.width}
                        y1={lineGeom.avgY}
                        y2={lineGeom.avgY}
                        stroke="rgb(20 184 166)"
                        strokeWidth={1}
                        strokeDasharray="4 3"
                        vectorEffect="non-scaling-stroke"
                      />
                    ) : null}
                    <line
                      x1={lineGeom.selectedX}
                      x2={lineGeom.selectedX}
                      y1="0"
                      y2={lineGeom.height}
                      stroke="rgb(5 150 105)"
                      strokeWidth={1}
                      strokeDasharray="2 2"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                  {/* Selected dot (HTML so it doesn't get stretched) */}
                  {chartData.map((p, i) => {
                    if (chartData.length > 14 && i !== safeSelected && i !== chart.maxIndex && i !== chart.lastIndex) return null;
                    const cls = cn(
                      "absolute size-2 rounded-full -translate-x-1/2 -translate-y-1/2 transition-colors",
                      chart.maxIndex === i && p.revenue > 0 ? "bg-emerald-600 ring-2 ring-emerald-200" : "bg-emerald-500",
                      chart.isTodayLast && i === chart.lastIndex ? "ring-2 ring-amber-300" : "",
                      safeSelected === i ? "scale-150 bg-emerald-700" : "",
                    );
                    return (
                      <span
                        key={`dot-${i}`}
                        aria-hidden="true"
                        className={cls}
                        style={{
                          left: `${((i + 0.5) / chartData.length) * 100}%`,
                          top: `${lineGeom.yPercent(p.revenue)}%`,
                        }}
                      />
                    );
                  })}
                  {/* Selected tooltip */}
                  {selected ? (
                    <div
                      className="absolute z-10 pointer-events-none rounded-md border bg-card p-2 shadow-md text-xs min-w-40"
                      style={{
                        left: `clamp(2px, calc(${((safeSelected + 0.5) / chartData.length) * 100}% - 80px), calc(100% - 168px))`,
                        top: ((safeSelected + 0.5) / chartData.length) >= 0.8 ? 28 : 4,
                      }}
                    >
                      <p className="text-muted-foreground">{selected.label}</p>
                      <p className="text-sm font-semibold tabular-nums">{money(selected.revenue)}</p>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">เทียบ{rangeDays > 60 ? "เดือนก่อน" : "เมื่อวาน"}</span>
                        <DeltaChip value={vsPrev} fallback={prevPoint ? "—" : "จุดแรกของช่วง"} />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">เทียบค่าเฉลี่ย</span>
                        <DeltaChip value={vsAvg} fallback="—" />
                      </div>
                    </div>
                  ) : null}
                  {/* Invisible hit-test buttons */}
                  <div className="absolute inset-0 flex">
                    {chartData.map((p, i) => (
                      <button
                        key={`hit-${i}`}
                        type="button"
                        onClick={() => setSelectedBar(i)}
                        title={`${p.label}: ยอดขาย ${money(p.revenue)}`}
                        aria-label={`${p.label} ยอดขาย ${money(p.revenue)}`}
                        className={cn(
                          "flex-1 h-full cursor-pointer",
                          safeSelected === i ? "bg-emerald-500/5" : "hover:bg-emerald-500/5",
                        )}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <EmptyState
                  icon={BarChart3}
                  title="ยังไม่มีข้อมูลยอดขายในช่วงนี้"
                  description="เริ่มขายสินค้าผ่าน POS เพื่อสร้างข้อมูลกราฟยอดขาย"
                />
              )}
            </div>
          </div>
          {/* X axis labels */}
          {lineGeom ? (
            <div className="ml-8 flex justify-between text-[10px] text-muted-foreground">
              {chartData.map((p, i) => (
                <span
                  key={`x-${i}`}
                  className={cn(
                    "tabular-nums",
                    safeSelected === i || lineGeom.labelStep === 1 || i % lineGeom.labelStep === 0 ? "text-foreground/80" : "opacity-0",
                  )}
                >
                  {p.label}
                </span>
              ))}
            </div>
          ) : null}

          {/* Summary strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t">
            <div>
              <p className="text-xs text-muted-foreground">ยอดขายรวมช่วงนี้</p>
              <p className="font-semibold tabular-nums">{money(stats?.totalSales ?? 0)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">ค่าเฉลี่ยต่อวัน</p>
              <p className="font-semibold tabular-nums">{money(stats?.avgDailySales ?? 0)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">จำนวนบิล</p>
              <p className="font-semibold tabular-nums">
                {(stats?.totalOrders ?? 0).toLocaleString("th-TH")}{" "}
                <span className="text-xs text-muted-foreground font-normal">บิล</span>
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Wallet className="size-3" aria-hidden="true" /> เงินในบัญชีสมาชิก
              </p>
              <p className="font-semibold tabular-nums">{money(stats?.memberWalletTotal ?? 0)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Best sellers + Watch grid */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Best sellers */}
        <Card className="py-0">
          <CardContent className="p-4 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">สินค้าขายดี 10 อันดับ</h2>
                <p className="text-sm text-muted-foreground">
                  สรุปจากรายการขายจริงในช่วง {RANGE_PRESETS.find((p) => p.id === rangeId)?.label}
                </p>
              </div>
              <div className="flex items-center gap-1 rounded-lg border p-0.5">
                <Button
                  type="button"
                  variant={bestMode === "qty" ? "default" : "ghost"}
                  size="sm"
                  className={cn("h-7 px-2.5 text-xs", bestMode === "qty" && "bg-emerald-600 text-white hover:bg-emerald-700")}
                  onClick={() => setBestMode("qty")}
                >
                  จำนวนขาย
                </Button>
                <Button
                  type="button"
                  variant={bestMode === "revenue" ? "default" : "ghost"}
                  size="sm"
                  className={cn("h-7 px-2.5 text-xs", bestMode === "revenue" && "bg-emerald-600 text-white hover:bg-emerald-700")}
                  onClick={() => setBestMode("revenue")}
                >
                  ยอดขาย
                </Button>
              </div>
            </div>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : bestSellersRanked.length === 0 ? (
              <EmptyState
                icon={BarChart3}
                title="ยังไม่มีข้อมูลการขาย"
                description="เริ่มขายสินค้าผ่าน POS เพื่อดูอันดับ"
              />
            ) : (
              <ol className="space-y-1.5">
                {bestSellersRanked.map((item) => (
                  <li
                    key={item.name}
                    className="flex items-center gap-3 rounded-lg border px-2.5 py-2"
                  >
                    <span
                      className={cn(
                        "shrink-0 grid place-items-center size-7 rounded-full text-xs font-semibold tabular-nums",
                        item.rank === 1 ? "bg-amber-100 text-amber-700" : "bg-neutral-100 text-neutral-700",
                      )}
                    >
                      {String(item.rank).padStart(2, "0")}
                    </span>
                    <span className="text-lg shrink-0" aria-hidden="true">{item.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{item.name}</p>
                      <div className="mt-1 h-1.5 rounded-full bg-neutral-100 overflow-hidden">
                        <span
                          className="block h-full bg-emerald-500"
                          style={{ width: `${item.width}%` }}
                        />
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-medium tabular-nums">{item.qtyLabel}</p>
                      <p className="text-[10px] text-muted-foreground tabular-nums">{item.total}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        {/* Watch: low stock + expiry */}
        <div className="grid gap-4">
          <Card className="py-0">
            <CardContent className="p-4 sm:p-6 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wider text-red-700">ควรติดตามวันนี้</p>
                  <h2 className="text-lg font-semibold tracking-tight">สินค้าใกล้หมดสต็อก</h2>
                </div>
                <span className="inline-flex items-center justify-center min-w-7 h-7 px-2 rounded-full bg-red-100 text-red-700 text-xs font-semibold">
                  {lowStock.length}
                </span>
              </div>
              {loading ? (
                <Skeleton className="h-32 w-full" />
              ) : lowStock.length === 0 ? (
                <EmptyState
                  icon={PackageSearch}
                  title="สต็อกเพียงพอทุกรายการ"
                  description="ไม่มีสินค้าที่ต่ำกว่าจุดสั่งซื้อ"
                />
              ) : (
                <ul className="space-y-1 max-h-56 overflow-y-auto">
                  {lowStock.slice(0, 8).map((row) => (
                    <li
                      key={row.id}
                      className="flex items-center gap-3 rounded-md border px-2.5 py-2"
                    >
                      <span className="size-7 rounded-md bg-red-100 text-red-700 grid place-items-center shrink-0">
                        <PackageSearch className="size-3.5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{row.name}</p>
                        <p className="text-xs text-muted-foreground">
                          เหลือ {row.stock} {row.unit} · สั่งซื้อแนะนำ {row.reorderPoint * 2} {row.unit}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {onNavigate ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full justify-between text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50"
                  onClick={() => onNavigate("stock")}
                >
                  <span>ดูรายการและวางแผนสั่งซื้อ</span>
                  <span aria-hidden="true">→</span>
                </Button>
              ) : null}
            </CardContent>
          </Card>

          <Card className="py-0">
            <CardContent className="p-4 sm:p-6 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wider text-amber-700">ภายใน 30 วัน</p>
                  <h2 className="text-lg font-semibold tracking-tight">สินค้าใกล้หมดอายุ</h2>
                </div>
                <span className="inline-flex items-center justify-center min-w-7 h-7 px-2 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">
                  {expirySoon.length}
                </span>
              </div>
              {loading ? (
                <Skeleton className="h-32 w-full" />
              ) : expirySoon.length === 0 ? (
                <EmptyState
                  icon={CalendarDays}
                  title="ไม่มีสินค้าใกล้หมดอายุ"
                  description="ภายใน 30 วันข้างหน้า"
                />
              ) : (
                <ul className="space-y-1 max-h-56 overflow-y-auto">
                  {expirySoon.slice(0, 8).map((row) => (
                    <li
                      key={row.lotId}
                      className="flex items-center gap-3 rounded-md border px-2.5 py-2"
                    >
                      <span className="size-7 rounded-md bg-amber-100 text-amber-700 grid place-items-center shrink-0">
                        <CalendarDays className="size-3.5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{row.productName}</p>
                        <p className="text-xs text-muted-foreground">
                          หมดอายุ {row.expiryLabel} · Lot {row.lot} · เหลือ {row.qty} {row.unit}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Recent activity */}
      <Card className="py-0">
        <CardContent className="p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">กิจกรรมล่าสุดในระบบ</h2>
              <p className="text-sm text-muted-foreground">ธุรกรรมและการเปลี่ยนแปลงที่บันทึกอัตโนมัติ</p>
            </div>
            <Activity className="size-5 text-muted-foreground" aria-hidden="true" />
          </div>
          {loading ? (
            <Skeleton className="h-48 w-full" />
          ) : recentActivities.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="ยังไม่มีกิจกรรม"
              description="รายการจะแสดงเมื่อมีการทำธุรกรรม"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="py-2 pr-2 w-8" aria-label="ระดับกิจกรรม" />
                    <th className="py-2 pr-2">เวลา</th>
                    <th className="py-2 pr-2">ผู้ทำรายการ</th>
                    <th className="py-2 pr-2">กิจกรรม</th>
                    <th className="py-2">รายละเอียด</th>
                  </tr>
                </thead>
                <tbody>
                  {recentActivities.map((log) => (
                    <tr key={log.id} className="border-b last:border-b-0">
                      <td className="py-2 pr-2">
                        <span
                          className={cn(
                            "block size-2 rounded-full",
                            log.tone === "red" && "bg-red-500",
                            log.tone === "amber" && "bg-amber-500",
                            log.tone === "green" && "bg-emerald-500",
                            log.tone === "purple" && "bg-purple-500",
                            (log.tone === "blue" || !log.tone) && "bg-sky-400",
                          )}
                          aria-hidden="true"
                        />
                      </td>
                      <td className="py-2 pr-2 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                        {log.createdAtLabel}
                      </td>
                      <td className="py-2 pr-2">
                        <p className="text-sm font-medium">{log.actor ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{log.actorRole ?? ""}</p>
                      </td>
                      <td className="py-2 pr-2 font-medium">{log.action}</td>
                      <td className="py-2 text-muted-foreground">{log.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {isAdminRole(role) && onNavigate ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-between text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50"
              onClick={() => onNavigate("logs")}
            >
              <span>ดูกิจกรรมทั้งหมดในระบบ Log</span>
              <span aria-hidden="true">→</span>
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {/* Cutoff tab — Z-report widget */}
      {dashTab === "cutoff" && <CutoffWidget role={role} userName={userName} />}
    </div>
  );
}

// CutoffWidget — mirrors original Shop's CutoffWidget
// Shows current business period + close day button + Z-report
function CutoffWidget({ role, userName }: { role: string; userName: string }) {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [closedReport, setClosedReport] = React.useState<{
    bills: number; pieces: number; revenue: number;
    cashTotal: number; qrTotal: number; walletTotal: number;
    deposits: number; withdrawals: number; closedAt: string; closedBy: string | null;
    periodStart: string; note: string | null;
  } | null>(null);

  const { data: period, isLoading, refetch } = useQuery({
    queryKey: ["reports", "business-period"],
    queryFn: () => apiGet<{
      periodStart: string; nextCutOffAt: string; lastClosureAt: string | null;
      totals: { bills: number; pieces: number; revenue: number; cash: number; qr: number; wallet: number; deposits: number; withdrawals: number };
    }>("/api/reports/business-period"),
    refetchInterval: 60_000,
  });

  const closeDay = async () => {
    try {
      const res = await fetch("/api/reports/business-period", { method: "POST", credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message ?? "ปิดรอบไม่สำเร็จ");
      }
      const data = await res.json();
      setClosedReport(data.closure);
      setConfirmOpen(false);
      refetch();
      toast.success("ปิดรอบขายสำเร็จ");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ปิดรอบไม่สำเร็จ");
    }
  };

  if (isLoading) return <div className="text-sm text-muted-foreground">กำลังโหลดข้อมูลรอบ...</div>;

  const totals = closedReport
    ? { bills: closedReport.bills, pieces: closedReport.pieces, revenue: closedReport.revenue, cashTotal: closedReport.cashTotal, qrTotal: closedReport.qrTotal, walletTotal: closedReport.walletTotal, deposits: closedReport.deposits, withdrawals: closedReport.withdrawals }
    : period?.totals;

  return (
    <Card className="border-emerald-200">
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <CalendarClock className="size-5 text-emerald-600" />
            รอบตัดยอดวันนี้
          </span>
          {closedReport && <Badge className="bg-emerald-600 text-white">ตัดยอดแล้ว</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground">
          {period ? `รอบเริ่ม ${formatThaiDate(period.periodStart)}` : "กำลังโหลด..."}
        </div>
        {totals && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Stat label="บิลในรอบ" value={String(totals.bills)} />
            <Stat label="ชิ้นที่ขาย" value={String(totals.pieces)} />
            <Stat label="ยอดขายรอบนี้" value={money(totals.revenue)} tone="emerald" />
            <Stat label="เงินสด" value={money(totals.cashTotal)} />
            <Stat label="QR / สแกน" value={money(totals.qrTotal)} />
            <Stat label="หักบัญชีสมาชิก" value={money(totals.walletTotal)} />
            <Stat label="เติมเงิน" value={money(totals.deposits)} tone="emerald" />
            <Stat label="ถอนเงิน" value={money(totals.withdrawals)} tone="red" />
          </div>
        )}
        {closedReport ? (
          <div className="space-y-3">
            <div className="rounded border bg-emerald-50 p-3 text-sm">
              ✓ ตัดยอดเรียบร้อย {formatThaiDate(closedReport.closedAt)} · โดย {closedReport.closedBy ?? "—"}
            </div>
            <Button variant="outline" className="w-full" onClick={() => setClosedReport(null)}>
              <CalendarClock className="size-4" /> เริ่มรอบใหม่
            </Button>
          </div>
        ) : (
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="default" className="w-full bg-emerald-600 hover:bg-emerald-700">
                <CalendarClock className="size-4" /> ตัดยอดรอบนี้
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>ยืนยันตัดยอดรอบนี้?</AlertDialogTitle>
                <AlertDialogDescription>
                  สรุปยอดตั้งแต่ {period ? formatThaiDate(period.periodStart) : "ต้นรอบ"} จนถึงตอนนี้ แล้วเริ่มรอบใหม่ทันที · ยอดขายรอบนี้ {totals ? money(totals.revenue) : "—"} ({totals?.bills ?? 0} บิล)
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
                <AlertDialogAction onClick={closeDay} className="bg-emerald-600 hover:bg-emerald-700">
                  ตัดยอดรอบนี้
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "emerald" | "red" }) {
  const toneClass = { default: "text-foreground", emerald: "text-emerald-600", red: "text-red-600" }[tone];
  return (
    <div className="rounded border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

export default DashboardPage;
