"use client";

/**
 * ReportsPage — real reports module (replaces placeholder).
 *
 * Tabs:
 *   1. ยอดขายรายวัน (daily)        — chart + table with COGS/profit
 *   2. ตามหมวด (by-category)       — bar chart + table
 *   3. ตามสินค้า (by-product)       — top sellers table
 *   4. ตามพนักงาน (by-cashier)      — sales per cashier
 *   5. รายการในบิล (line-items)     — detailed line items
 *   6. ธุรกรรมสมาชิก (member-tx)     — wallet transactions
 *   7. ยอดเงินคงเหลือ (balances)    — member balances
 *   8. สินค้าคงคลัง (stock-balance) — stock movement report
 *   9. ปิดรอบขาย (cutoff)           — Z-report + close day
 *
 * Each tab supports date range (today/yesterday/7d/30d/custom) + CSV export.
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3, Calendar, Download, Printer, TrendingUp, Package,
  Users, Wallet, FileText, Scissors,
} from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ThaiDatePicker } from "@/components/shared/ThaiDatePicker";
import { money, formatThaiDate, compactBaht } from "@/lib/format";

type RangePreset = "today" | "yesterday" | "7d" | "30d" | "custom";

const PRESETS: { id: RangePreset; label: string }[] = [
  { id: "today", label: "วันนี้" },
  { id: "yesterday", label: "เมื่อวาน" },
  { id: "7d", label: "7 วัน" },
  { id: "30d", label: "30 วัน" },
  { id: "custom", label: "กำหนดเอง" },
];

function presetToRange(preset: RangePreset): { from?: string; to?: string; days?: number } {
  const now = new Date();
  const fmt = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(d);
  switch (preset) {
    case "today": return { from: fmt(now), to: fmt(now) };
    case "yesterday": {
      const y = new Date(now.getTime() - 86400000);
      return { from: fmt(y), to: fmt(y) };
    }
    case "7d": return { days: 7 };
    case "30d": return { days: 30 };
    default: return {};
  }
}

export function ReportsPage() {
  const [tab, setTab] = React.useState("daily");
  const [preset, setPreset] = React.useState<RangePreset>("30d");
  const [from, setFrom] = React.useState<string>("");
  const [to, setTo] = React.useState<string>("");

  const range = React.useMemo(() => {
    if (preset === "custom") return { from, to };
    return presetToRange(preset);
  }, [preset, from, to]);

  const qs = React.useMemo(() => {
    const params = new URLSearchParams();
    if (range.from) params.set("from", range.from);
    if (range.to) params.set("to", range.to);
    if (range.days) params.set("days", String(range.days));
    return params.toString();
  }, [range]);

  return (
    <div className="space-y-4">
      <SectionHeader
        eyebrow="รายงาน"
        title="วิเคราะห์และส่งออก"
        description="ยอดขาย · กำไร · สต็อกคงคลัง · ธุรกรรมสมาชิก"
        actions={<Download className="size-4 text-muted-foreground" />}
      />

      {/* Date range filter */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">ช่วงเวลา</Label>
              <div className="flex gap-1 mt-1">
                {PRESETS.map(p => (
                  <Button
                    key={p.id}
                    size="sm"
                    variant={preset === p.id ? "default" : "outline"}
                    onClick={() => setPreset(p.id)}
                    className="text-xs h-7"
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>
            {preset === "custom" && (
              <div className="flex items-end gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground">จาก</Label>
                  <ThaiDatePicker value={from} onChange={setFrom} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">ถึง</Label>
                  <ThaiDatePicker value={to} onChange={setTo} />
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="daily" className="text-xs"><Calendar className="size-3.5" />รายวัน</TabsTrigger>
          <TabsTrigger value="by-category" className="text-xs"><BarChart3 className="size-3.5" />หมวด</TabsTrigger>
          <TabsTrigger value="by-product" className="text-xs"><Package className="size-3.5" />สินค้า</TabsTrigger>
          <TabsTrigger value="by-cashier" className="text-xs"><Users className="size-3.5" />พนักงาน</TabsTrigger>
          <TabsTrigger value="line-items" className="text-xs"><FileText className="size-3.5" />รายการในบิล</TabsTrigger>
          <TabsTrigger value="member-tx" className="text-xs"><Wallet className="size-3.5" />ธุรกรรมสมาชิก</TabsTrigger>
          <TabsTrigger value="balances" className="text-xs"><Wallet className="size-3.5" />ยอดเงินคงเหลือ</TabsTrigger>
          <TabsTrigger value="stock-balance" className="text-xs"><Package className="size-3.5" />สินค้าคงคลัง</TabsTrigger>
          <TabsTrigger value="cutoff" className="text-xs"><Scissors className="size-3.5" />ปิดรอบขาย</TabsTrigger>
        </TabsList>

        <TabsContent value="daily" className="mt-4">
          <DailyReport qs={qs} />
        </TabsContent>
        <TabsContent value="by-category" className="mt-4">
          <ByCategoryReport qs={qs} />
        </TabsContent>
        <TabsContent value="by-product" className="mt-4">
          <ByProductReport qs={qs} />
        </TabsContent>
        <TabsContent value="by-cashier" className="mt-4">
          <ByCashierReport qs={qs} />
        </TabsContent>
        <TabsContent value="line-items" className="mt-4">
          <LineItemsReport qs={qs} />
        </TabsContent>
        <TabsContent value="member-tx" className="mt-4">
          <MemberTransactionsReport qs={qs} />
        </TabsContent>
        <TabsContent value="balances" className="mt-4">
          <MemberBalancesReport />
        </TabsContent>
        <TabsContent value="stock-balance" className="mt-4">
          <StockBalanceReport qs={qs} />
        </TabsContent>
        <TabsContent value="cutoff" className="mt-4">
          <CutoffReport />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper: KPI card
// ---------------------------------------------------------------------------

function KpiCard({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "emerald" | "amber" | "red" }) {
  const toneClass = {
    default: "text-foreground",
    emerald: "text-emerald-600",
    amber: "text-amber-600",
    red: "text-red-600",
  }[tone];
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Helper: CSV export
// ---------------------------------------------------------------------------

function exportCsv(filename: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map(r => headers.map(h => {
      const v = r[h];
      if (v === null || v === undefined) return "";
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    }).join(",")),
  ].join("\n");
  // UTF-8 BOM for Thai
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// 1. Daily Report
// ---------------------------------------------------------------------------

interface DailyData {
  rows: { date: string; orders: number; items: number; revenue: number; cogs: number; profit: number }[];
  totals: { orders: number; items: number; revenue: number; cogs: number; profit: number };
}

function DailyReport({ qs }: { qs: string }) {
  const { data, isLoading } = useQuery<DailyData>({
    queryKey: ["reports", "daily", qs],
    queryFn: () => apiGet<DailyData>(`/api/reports/daily?${qs}`),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">กำลังโหลด...</div>;
  if (!data) return null;

  const maxRevenue = Math.max(...data.rows.map(r => r.revenue), 1);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <KpiCard label="ยอดขายรวม" value={money(data.totals.revenue)} tone="emerald" />
        <KpiCard label="กำไรขั้นต้น" value={money(data.totals.profit)} tone="emerald" />
        <KpiCard label="ต้นทุนขาย" value={money(data.totals.cogs)} />
        <KpiCard label="จำนวนบิล" value={String(data.totals.orders)} />
        <KpiCard label="จำนวนชิ้น" value={String(data.totals.items)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2"><TrendingUp className="size-4 text-emerald-600" />ยอดขายรายวัน</span>
            <Button size="sm" variant="outline" onClick={() => exportCsv("daily-sales.csv", data.rows)}>
              <Download className="size-3.5" />CSV
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Simple bar chart */}
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {data.rows.map(r => (
              <div key={r.date} className="flex items-center gap-2 text-xs">
                <div className="w-24 text-muted-foreground tabular-nums">{formatThaiDate(r.date)}</div>
                <div className="flex-1 bg-muted rounded h-5 relative overflow-hidden">
                  <div
                    className="bg-emerald-500 h-full rounded"
                    style={{ width: `${(r.revenue / maxRevenue) * 100}%` }}
                  />
                  <span className="absolute inset-0 flex items-center px-2 text-foreground font-medium tabular-nums">
                    {money(r.revenue)}
                  </span>
                </div>
                <div className="w-16 text-right text-muted-foreground tabular-nums">{r.orders} บิล</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. By Category Report
// ---------------------------------------------------------------------------

interface CategoryData {
  rows: { category: string; orderCount: number; qty: number; revenue: number }[];
  totals: { revenue: number; qty: number };
}

function ByCategoryReport({ qs }: { qs: string }) {
  const { data, isLoading } = useQuery<CategoryData>({
    queryKey: ["reports", "by-category", qs],
    queryFn: () => apiGet<CategoryData>(`/api/reports/by-category?${qs}`),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">กำลังโหลด...</div>;
  if (!data) return null;

  const maxRev = Math.max(...data.rows.map(r => r.revenue), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span>ยอดขายตามหมวดสินค้า</span>
          <Button size="sm" variant="outline" onClick={() => exportCsv("by-category.csv", data.rows)}>
            <Download className="size-3.5" />CSV
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {data.rows.map(r => (
          <div key={r.category} className="flex items-center gap-2 text-sm py-1">
            <div className="w-32 truncate">{r.category}</div>
            <div className="flex-1 bg-muted rounded h-6 relative overflow-hidden">
              <div className="bg-emerald-500 h-full rounded" style={{ width: `${(r.revenue / maxRev) * 100}%` }} />
              <span className="absolute inset-0 flex items-center px-2 font-medium tabular-nums">{money(r.revenue)}</span>
            </div>
            <div className="w-20 text-right text-muted-foreground text-xs tabular-nums">{r.qty} ชิ้น</div>
            <div className="w-16 text-right text-muted-foreground text-xs tabular-nums">{r.orderCount} บิล</div>
          </div>
        ))}
        <div className="border-t pt-2 mt-2 flex justify-between text-sm font-semibold">
          <span>รวม</span>
          <span className="tabular-nums">{money(data.totals.revenue)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 3. By Product Report
// ---------------------------------------------------------------------------

interface ProductData {
  rows: { productId: string | null; name: string; sku: string | null; unit: string | null; qty: number; revenue: number; billCount: number }[];
  totals: { revenue: number; qty: number };
}

function ByProductReport({ qs }: { qs: string }) {
  const { data, isLoading } = useQuery<ProductData>({
    queryKey: ["reports", "by-product", qs],
    queryFn: () => apiGet<ProductData>(`/api/reports/by-product?${qs}`),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">กำลังโหลด...</div>;
  if (!data) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span>สินค้าขายดี</span>
          <Button size="sm" variant="outline" onClick={() => exportCsv("by-product.csv", data.rows)}>
            <Download className="size-3.5" />CSV
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-card border-b">
              <tr className="text-left">
                <th className="py-[12px] px-[9px]">#</th>
                <th className="py-[12px] px-[9px]">สินค้า</th>
                <th className="py-2 px-2 text-right">จำนวน</th>
                <th className="py-2 px-2 text-right">ยอดขาย</th>
                <th className="py-2 px-2 text-right">บิล</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={r.productId ?? r.name} className="border-b hover:bg-muted/50">
                  <td className="py-1.5 px-2 text-muted-foreground tabular-nums">{i + 1}</td>
                  <td className="py-1.5 px-2">
                    <div className="font-medium">{r.name}</div>
                    {r.sku && <div className="text-xs text-muted-foreground font-mono">{r.sku}</div>}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{r.qty} {r.unit}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums font-medium">{money(r.revenue)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">{r.billCount}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 font-semibold">
              <tr>
                <td colSpan={2} className="py-[12px] px-[9px]">รวม</td>
                <td className="py-2 px-2 text-right tabular-nums">{data.totals.qty}</td>
                <td className="py-2 px-2 text-right tabular-nums">{money(data.totals.revenue)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 4. By Cashier Report
// ---------------------------------------------------------------------------

interface CashierData {
  rows: { cashierName: string; orders: number; items: number; revenue: number; discount: number; walletBills: number }[];
  totals: { orders: number; revenue: number };
}

function ByCashierReport({ qs }: { qs: string }) {
  const { data, isLoading } = useQuery<CashierData>({
    queryKey: ["reports", "by-cashier", qs],
    queryFn: () => apiGet<CashierData>(`/api/reports/by-cashier?${qs}`),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">กำลังโหลด...</div>;
  if (!data) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span>ยอดขายตามพนักงาน</span>
          <Button size="sm" variant="outline" onClick={() => exportCsv("by-cashier.csv", data.rows)}>
            <Download className="size-3.5" />CSV
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <table className="w-full text-[11px]">
          <thead className="border-b">
            <tr className="text-left">
              <th className="py-[12px] px-[9px]">พนักงาน</th>
              <th className="py-2 px-2 text-right">บิล</th>
              <th className="py-2 px-2 text-right">ชิ้น</th>
              <th className="py-2 px-2 text-right">ยอดขาย</th>
              <th className="py-2 px-2 text-right">ส่วนลด</th>
              <th className="py-2 px-2 text-right">หักบัญชี</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map(r => (
              <tr key={r.cashierName} className="border-b hover:bg-muted/50">
                <td className="py-2 px-2 font-medium">{r.cashierName}</td>
                <td className="py-2 px-2 text-right tabular-nums">{r.orders}</td>
                <td className="py-2 px-2 text-right tabular-nums">{r.items}</td>
                <td className="py-2 px-2 text-right tabular-nums font-medium">{money(r.revenue)}</td>
                <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{money(r.discount)}</td>
                <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{r.walletBills}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 font-semibold">
            <tr>
              <td className="py-[12px] px-[9px]">รวม</td>
              <td className="py-2 px-2 text-right tabular-nums">{data.totals.orders}</td>
              <td colSpan={4} className="py-2 px-2 text-right tabular-nums">{money(data.totals.revenue)}</td>
            </tr>
          </tfoot>
        </table>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 5. Line Items Report
// ---------------------------------------------------------------------------

interface LineItemsData {
  rows: { id: string; orderNumber: string; date: string; cashier: string; paymentMethod: string; productName: string; qty: number; price: number; total: number; cost: number; profit: number }[];
}

function LineItemsReport({ qs }: { qs: string }) {
  const { data, isLoading } = useQuery<LineItemsData>({
    queryKey: ["reports", "line-items", qs],
    queryFn: () => apiGet<LineItemsData>(`/api/reports/line-items?${qs}`),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">กำลังโหลด...</div>;
  if (!data) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span>รายการสินค้าในบิล ({data.rows.length} รายการ)</span>
          <Button size="sm" variant="outline" onClick={() => exportCsv("line-items.csv", data.rows)}>
            <Download className="size-3.5" />CSV
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-card border-b">
              <tr className="text-left">
                <th className="py-[12px] px-[9px]">เลขบิล</th>
                <th className="py-[12px] px-[9px]">วันที่</th>
                <th className="py-[12px] px-[9px]">สินค้า</th>
                <th className="py-2 px-2 text-right">จำนวน</th>
                <th className="py-2 px-2 text-right">ราคา/หน่วย</th>
                <th className="py-2 px-2 text-right">ยอด</th>
                <th className="py-2 px-2 text-right">กำไร</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.slice(0, 500).map(r => (
                <tr key={r.id} className="border-b hover:bg-muted/50">
                  <td className="py-1 px-2 font-mono text-xs">{r.orderNumber}</td>
                  <td className="py-1 px-2 text-xs text-muted-foreground">{formatThaiDate(r.date)}</td>
                  <td className="py-1 px-2">{r.productName}</td>
                  <td className="py-1 px-2 text-right tabular-nums">{r.qty}</td>
                  <td className="py-1 px-2 text-right tabular-nums">{money(r.price)}</td>
                  <td className="py-1 px-2 text-right tabular-nums font-medium">{money(r.total)}</td>
                  <td className="py-1 px-2 text-right tabular-nums text-emerald-600">{money(r.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 6. Member Transactions Report
// ---------------------------------------------------------------------------

interface MemberTxData {
  rows: { id: string; memberNumber: string; type: string; detail: string; amount: number; balanceAfter: number | null; paymentMethod: string | null; actor: string | null; date: string; dateLabel: string }[];
}

const TX_TYPE_LABEL: Record<string, string> = {
  purchase: "ซื้อสินค้า",
  deposit: "เติมเงิน",
  withdrawal: "ถอนเงิน",
  activation: "เปิดบัญชี",
  refund: "คืนบัตรเงินสด",
};

function MemberTransactionsReport({ qs }: { qs: string }) {
  const [memberNumber, setMemberNumber] = React.useState("");
  const qs2 = memberNumber ? `${qs}&memberNumber=${encodeURIComponent(memberNumber)}` : qs;

  const { data, isLoading } = useQuery<MemberTxData>({
    queryKey: ["reports", "member-tx", qs2],
    queryFn: () => apiGet<MemberTxData>(`/api/reports/member-transactions?${qs2}`),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">กำลังโหลด...</div>;
  if (!data) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span>ธุรกรรมสมาชิก ({data.rows.length} รายการ)</span>
          <div className="flex items-center gap-2">
            <Input
              placeholder="ค้นหาเลขสมาชิก..."
              value={memberNumber}
              onChange={(e) => setMemberNumber(e.target.value)}
              className="w-48 h-8 text-xs"
            />
            <Button size="sm" variant="outline" onClick={() => exportCsv("member-tx.csv", data.rows)}>
              <Download className="size-3.5" />CSV
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-card border-b">
              <tr className="text-left">
                <th className="py-[12px] px-[9px]">วันที่</th>
                <th className="py-[12px] px-[9px]">สมาชิก</th>
                <th className="py-[12px] px-[9px]">ประเภท</th>
                <th className="py-[12px] px-[9px]">รายละเอียด</th>
                <th className="py-2 px-2 text-right">จำนวน</th>
                <th className="py-2 px-2 text-right">คงเหลือ</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.slice(0, 500).map(r => (
                <tr key={r.id} className="border-b hover:bg-muted/50">
                  <td className="py-1 px-2 text-xs text-muted-foreground">{r.dateLabel}</td>
                  <td className="py-1 px-2 font-mono text-xs">{r.memberNumber}</td>
                  <td className="py-1 px-2">
                    <Badge variant="outline" className="text-xs">{TX_TYPE_LABEL[r.type] ?? r.type}</Badge>
                  </td>
                  <td className="py-1 px-2 max-w-xs truncate" title={r.detail}>{r.detail}</td>
                  <td className={`py-1 px-2 text-right tabular-nums ${r.amount >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {r.amount >= 0 ? "+" : ""}{money(r.amount)}
                  </td>
                  <td className="py-1 px-2 text-right tabular-nums">{r.balanceAfter !== null ? money(r.balanceAfter) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 7. Member Balances Report
// ---------------------------------------------------------------------------

interface BalancesData {
  rows: { id: string; memberNumber: string; name: string; type: string; balance: number; totalIn: number; totalOut: number; status: string; cardNumber: string | null; patientCode: string | null; createdLabel: string }[];
  totals: { memberCount: number; totalBalance: number; totalIn: number; totalOut: number };
}

function MemberBalancesReport() {
  const [search, setSearch] = React.useState("");
  const qs = search ? `?search=${encodeURIComponent(search)}` : "";

  const { data, isLoading } = useQuery<BalancesData>({
    queryKey: ["reports", "member-balances", qs],
    queryFn: () => apiGet<BalancesData>(`/api/reports/member-balances${qs}`),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">กำลังโหลด...</div>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="สมาชิกทั้งหมด" value={String(data.totals.memberCount)} />
        <KpiCard label="ยอดเงินรวม" value={money(data.totals.totalBalance)} tone="emerald" />
        <KpiCard label="เติมเข้ารวม" value={money(data.totals.totalIn)} />
        <KpiCard label="ถอนออกรวม" value={money(data.totals.totalOut)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>ยอดเงินคงเหลือสมาชิก</span>
            <div className="flex items-center gap-2">
              <Input
                placeholder="ค้นหา..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-48 h-8 text-xs"
              />
              <Button size="sm" variant="outline" onClick={() => exportCsv("member-balances.csv", data.rows)}>
                <Download className="size-3.5" />CSV
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-card border-b">
                <tr className="text-left">
                  <th className="py-[12px] px-[9px]">เลขสมาชิก</th>
                  <th className="py-[12px] px-[9px]">ชื่อ</th>
                  <th className="py-[12px] px-[9px]">บัตร</th>
                  <th className="py-2 px-2 text-right">เติมเข้า</th>
                  <th className="py-2 px-2 text-right">ถอนออก</th>
                  <th className="py-2 px-2 text-right">คงเหลือ</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(r => (
                  <tr key={r.id} className="border-b hover:bg-muted/50">
                    <td className="py-1.5 px-2 font-mono text-xs">{r.memberNumber}</td>
                    <td className="py-1.5 px-2">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">{r.type}</div>
                    </td>
                    <td className="py-1.5 px-2 text-xs">
                      {r.cardNumber && <div className="font-mono">{r.cardNumber}</div>}
                      {r.patientCode && <div className="text-muted-foreground">HN: {r.patientCode}</div>}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-emerald-600">{money(r.totalIn)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-red-600">{money(r.totalOut)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums font-medium">{money(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 8. Stock Balance Report
// ---------------------------------------------------------------------------

interface StockData {
  rows: { id: string; sku: string; name: string; unit: string; opening: number; received: number; receivedValue: number; sold: number; soldRevenue: number; soldCogs: number; remaining: number; remainingValue: number }[];
}

function StockBalanceReport({ qs }: { qs: string }) {
  const { data, isLoading } = useQuery<StockData>({
    queryKey: ["reports", "stock-balance", qs],
    queryFn: () => apiGet<StockData>(`/api/reports/stock-balance?${qs}`),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">กำลังโหลด...</div>;
  if (!data) return null;

  const totalRemainingValue = data.rows.reduce((s, r) => s + r.remainingValue, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span>รายงานสินค้าคงคลัง (มูลค่าคงคลัง {money(totalRemainingValue)})</span>
          <Button size="sm" variant="outline" onClick={() => exportCsv("stock-balance.csv", data.rows)}>
            <Download className="size-3.5" />CSV
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-card border-b">
              <tr className="text-left">
                <th className="py-[12px] px-[9px]">สินค้า</th>
                <th className="py-2 px-2 text-right">ยกมา</th>
                <th className="py-2 px-2 text-right">รับเข้า</th>
                <th className="py-2 px-2 text-right">ขายออก</th>
                <th className="py-2 px-2 text-right">คงเหลือ</th>
                <th className="py-2 px-2 text-right">มูลค่าคงเหลือ</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map(r => (
                <tr key={r.id} className="border-b hover:bg-muted/50">
                  <td className="py-1.5 px-2">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{r.sku}</div>
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{r.opening} {r.unit}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-emerald-600">+{r.received}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-red-600">-{r.sold}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums font-medium">{r.remaining} {r.unit}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{money(r.remainingValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 9. Cutoff / Z-Report
// ---------------------------------------------------------------------------

interface CutoffData {
  periodStart: string;
  nextCutOffAt: string;
  lastClosureAt: string | null;
  totals: { bills: number; pieces: number; revenue: number; cash: number; qr: number; wallet: number; deposits: number; withdrawals: number };
}

function CutoffReport() {
  const { data, isLoading, refetch } = useQuery<CutoffData>({
    queryKey: ["reports", "business-period"],
    queryFn: () => apiGet<CutoffData>("/api/reports/business-period"),
    refetchInterval: 60_000,
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">กำลังโหลด...</div>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">รอบขายปัจจุบัน</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm text-muted-foreground">
            เริ่มตั้งแต่: <span className="font-medium text-foreground">{formatThaiDate(data.periodStart)}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <KpiCard label="บิล" value={String(data.totals.bills)} />
            <KpiCard label="ชิ้น" value={String(data.totals.pieces)} />
            <KpiCard label="ยอดขาย" value={money(data.totals.revenue)} tone="emerald" />
            <KpiCard label="เงินสด" value={money(data.totals.cash)} />
            <KpiCard label="QR / สแกน" value={money(data.totals.qr)} />
            <KpiCard label="หักบัญชีสมาชิก" value={money(data.totals.wallet)} />
            <KpiCard label="เติมเงิน" value={money(data.totals.deposits)} tone="emerald" />
            <KpiCard label="ถอนเงิน" value={money(data.totals.withdrawals)} tone="red" />
          </div>
          <Button
            variant="default"
            className="w-full bg-emerald-600 hover:bg-emerald-700"
            onClick={async () => {
              if (!confirm("ยืนยันการปิดรอบขาย? จะสร้าง Z-report และเริ่มรอบใหม่")) return;
              try {
                await fetch("/api/reports/business-period", { method: "POST" });
                toast.success("ปิดรอบขายสำเร็จ");
                refetch();
              } catch {
                toast.error("ปิดรอบขายไม่สำเร็จ");
              }
            }}
          >
            <Scissors className="size-4" />
            ปิดรอบขาย (Z-Report)
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// Need to import toast
import { toast } from "sonner";

export default ReportsPage;
