"use client";

/**
 * LogsPage — audit log viewer with search + date range filters + CSV export.
 *
 * Data: GET /api/logs?limit=&search=&from=&to=  → { logs, stats }
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Download, Search } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { ThaiDatePicker } from "@/components/shared/ThaiDatePicker";
import { apiGet } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface AuditLogRow {
  id: string;
  action: string;
  actor: string | null;
  actorRole: string | null;
  actorIp: string | null;
  entity: string | null;
  entityId: string | null;
  detail: string;
  tone: string;
  createdAt: string;
  createdAtLabel: string;
}

interface LogsResponse {
  logs: AuditLogRow[];
  stats: {
    todayCount: number;
    userCount: number;
    txCount: number;
  };
}

function toneClass(tone: string): string {
  switch (tone) {
    case "red": return "bg-red-500";
    case "amber": return "bg-amber-500";
    case "green": return "bg-emerald-500";
    case "purple": return "bg-purple-500";
    case "blue": default: return "bg-sky-400";
  }
}

function toCsvDate(d: Date): string {
  // Bangkok tz yyyy-MM-dd
  const bangkok = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return bangkok.toISOString().slice(0, 19).replace("T", " ");
}

function downloadCsv(rows: AuditLogRow[]) {
  const headers = ["id", "createdAt", "action", "actor", "actorRole", "entity", "entityId", "detail", "tone"];
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push([
      r.id,
      toCsvDate(new Date(r.createdAt)),
      r.action,
      r.actor,
      r.actorRole,
      r.entity,
      r.entityId,
      r.detail,
      r.tone,
    ].map(escape).join(","));
  }
  // Prepend BOM so Excel reads UTF-8 Thai correctly.
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `logs-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function LogsPage() {
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [from, setFrom] = React.useState<string>("");
  const [to, setTo] = React.useState<string>("");
  const [limit, setLimit] = React.useState(30);

  React.useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search), 350);
    return () => window.clearTimeout(t);
  }, [search]);

  const qs = React.useMemo(() => {
    const p = new URLSearchParams();
    if (debouncedSearch) p.set("search", debouncedSearch);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    p.set("limit", String(Math.max(limit, 200)));
    return p.toString();
  }, [debouncedSearch, from, to, limit]);

  const query = useQuery({
    queryKey: ["logs", qs],
    queryFn: () => apiGet<LogsResponse>(`/api/logs?${qs}`),
  });

  const allLogs = query.data?.logs ?? [];
  const visibleLogs = allLogs.slice(0, limit);
  const stats = query.data?.stats;

  const hasMore = allLogs.length > limit;

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="ระบบ Log"
        title="บันทึกการทำธุรกรรม"
        description="ทุกการเปลี่ยนแปลงในระบบถูกบันทึกไว้ที่นี่"
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={() => downloadCsv(allLogs)}
            disabled={allLogs.length === 0}
          >
            <Download className="size-4" aria-hidden="true" />
            ส่งออก Log (CSV)
          </Button>
        }
      />

      {/* Stat cards */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <Card className="py-0">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">รายการวันนี้</p>
            <p className="text-2xl font-semibold tabular-nums">{stats?.todayCount ?? "—"}</p>
          </CardContent>
        </Card>
        <Card className="py-0">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">ผู้ใช้งานในระบบ</p>
            <p className="text-2xl font-semibold tabular-nums">{stats?.userCount ?? "—"}</p>
          </CardContent>
        </Card>
        <Card className="py-0">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">ธุรกรรมที่บันทึก</p>
            <p className="text-2xl font-semibold tabular-nums">{stats?.txCount ?? "—"}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="py-0">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative flex-1 sm:max-w-md">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" aria-hidden="true" />
              <Input
                type="text"
                placeholder="ค้นหา ผู้ทำ / กิจกรรม / รายละเอียด"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
                aria-label="ค้นหา Log"
              />
            </div>
            <div className="flex items-center gap-2">
              <ThaiDatePicker value={from} onChange={setFrom} placeholder="จากวันที่" ariaLabel="จากวันที่" />
              <span className="text-muted-foreground">—</span>
              <ThaiDatePicker value={to} onChange={setTo} placeholder="ถึงวันที่" ariaLabel="ถึงวันที่" />
            </div>
          </div>

          {/* Table */}
          {query.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : visibleLogs.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="ยังไม่มี Log ในช่วงที่เลือก"
              description="ลองเพิ่มช่วงวันที่ หรือล้างคำค้นหา"
            />
          ) : (
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="w-full text-sm min-w-[760px]">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="py-2 px-2 w-8" aria-label="ระดับกิจกรรม" />
                    <th className="py-2 px-2">วันที่-เวลา</th>
                    <th className="py-2 px-2">ผู้ทำ</th>
                    <th className="py-2 px-2">กิจกรรม</th>
                    <th className="py-2 px-2">รายละเอียด</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLogs.map((log) => (
                    <tr key={log.id} className="border-b last:border-b-0 hover:bg-accent/40">
                      <td className="py-2.5 px-2">
                        <span className={cn("block size-2 rounded-full", toneClass(log.tone))} aria-hidden="true" />
                      </td>
                      <td className="py-2.5 px-2 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                        {log.createdAtLabel}
                      </td>
                      <td className="py-2.5 px-2">
                        <p className="text-sm font-medium">{log.actor ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{log.actorRole ?? ""}</p>
                      </td>
                      <td className="py-2.5 px-2 font-medium whitespace-nowrap">{log.action}</td>
                      <td className="py-2.5 px-2 text-muted-foreground">{log.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {hasMore ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50"
              onClick={() => setLimit((n) => n + 30)}
            >
              แสดารายการเพิ่ม (+30) · เหลือ {allLogs.length - limit} รายการ
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export default LogsPage;
