"use client";

/**
 * ShiftPage — Cashier Shift management.
 *
 * Features:
 *   - View current open shift (if any) with live totals
 *   - Open new shift with opening cash
 *   - Close shift with counted cash + difference report
 *   - View history of past shifts (last 30)
 *
 * Per Technical Review Section 7 P1: Cashier Shift feature
 *   - เปิดกะ + เงินตั้งต้น
 *   - ปิดกะ + นับเงินจริง + cash difference
 */

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Clock, Coins, Plus, Printer, Scissors, TrendingUp, Wallet,
} from "lucide-react";
import { apiGet, apiPost } from "@/lib/api-client";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { money, formatThaiDateTime } from "@/lib/format";

interface Shift {
  id: string;
  cashierId: string;
  cashierName: string;
  status: string;
  openingCash: number;
  expectedCash: number;
  countedCash: number | null;
  cashDifference: number | null;
  expectedQr: number;
  expectedWallet: number;
  billsCount: number;
  salesTotal: number;
  note: string | null;
  openedAt: string;
  closedAt: string | null;
}

interface ShiftsResponse { shifts: Shift[] }

export function ShiftPage() {
  const queryClient = useQueryClient();
  const [openForm, setOpenForm] = React.useState(false);
  const [openingCash, setOpeningCash] = React.useState("");
  const [closeForm, setCloseForm] = React.useState<Shift | null>(null);
  const [countedCash, setCountedCash] = React.useState("");

  const { data, isLoading } = useQuery<ShiftsResponse>({
    queryKey: ["shifts"],
    queryFn: () => apiGet<ShiftsResponse>("/api/shifts"),
    refetchInterval: 30_000,
  });

  const shifts = data?.shifts ?? [];
  const openShift = shifts.find(s => s.status === "open");
  const closedShifts = shifts.filter(s => s.status === "closed");

  const openMutation = useMutation({
    mutationFn: (body: { openingCash: number; note?: string }) =>
      apiPost<{ shift: Shift }>("/api/shifts", body),
    onSuccess: () => {
      toast.success("เปิดกะสำเร็จ");
      setOpenForm(false);
      setOpeningCash("");
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
    },
    onError: (e: Error) => toast.error("เปิดกะไม่สำเร็จ", { description: e.message }),
  });

  const closeMutation = useMutation({
    mutationFn: ({ id, countedCash, note }: { id: string; countedCash: number; note?: string }) =>
      apiPost<{ shift: Shift }>(`/api/shifts/${id}/close`, { countedCash, note }),
    onSuccess: (data) => {
      const diff = data.shift.cashDifference ?? 0;
      toast.success(
        `ปิดกะสำเร็จ · ผลต่าง ${diff >= 0 ? "+" : ""}${money(diff)}`,
        { description: diff === 0 ? "ตรงยอดพอดี" : diff > 0 ? "เกินจากที่คาด" : "ขาดจากที่คาด" },
      );
      setCloseForm(null);
      setCountedCash("");
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
    },
    onError: (e: Error) => toast.error("ปิดกะไม่สำเร็จ", { description: e.message }),
  });

  const handleOpen = () => {
    const cash = Number(openingCash) || 0;
    if (cash < 0) {
      toast.error("เงินตั้งต้นต้องไม่ติดลบ");
      return;
    }
    openMutation.mutate({ openingCash: cash });
  };

  const handleClose = () => {
    if (!closeForm) return;
    const cash = Number(countedCash) || 0;
    if (cash < 0) {
      toast.error("เงินที่นับต้องไม่ติดลบ");
      return;
    }
    closeMutation.mutate({ id: closeForm.id, countedCash: cash });
  };

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">กำลังโหลด...</div>;
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="กะขาย"
        title="จัดการกะพนักงาน"
        description="เปิดกะ · ปิดกะ · นับเงิน · รายงานผลต่าง"
      />

      {openShift ? (
        // Active shift — show live totals + close button
        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Clock className="size-5 text-emerald-600" />
                กะที่เปิดอยู่
              </span>
              <Badge className="bg-emerald-600 text-white">เปิดอยู่</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="พนักงาน" value={openShift.cashierName} />
              <Stat label="เปิดเมื่อ" value={formatThaiDateTime(openShift.openedAt)} />
              <Stat label="เงินตั้งต้น" value={money(openShift.openingCash)} tone="emerald" />
              <Stat label="บิล" value={String(openShift.billsCount)} />
            </div>

            <div className="border-t pt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Stat label="ยอดขายรวม" value={money(openShift.salesTotal)} tone="emerald" />
              <Stat label="เงินสดที่คาด" value={money(openShift.expectedCash)} />
              <Stat label="QR / สแกน" value={money(openShift.expectedQr)} />
            </div>

            <Button
              variant="default"
              className="w-full bg-emerald-600 hover:bg-emerald-700"
              onClick={() => {
                setCloseForm(openShift);
                setCountedCash(String(openShift.expectedCash));
              }}
            >
              <Scissors className="size-4" />
              ปิดกะ + นับเงิน
            </Button>
          </CardContent>
        </Card>
      ) : openForm ? (
        // Open new shift form
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="size-5 text-emerald-600" />
              เปิดกะใหม่
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="openingCash">เงินตั้งต้นในลิ้นชัก (บาท)</Label>
              <Input
                id="openingCash"
                type="number"
                step="0.01"
                min="0"
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
                placeholder="0.00"
                className="text-lg tabular-nums"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                ใส่จำนวนเงินสดที่นับได้ตอนเริ่มกะ · ใช้เป็นยอดคาดการณ์เงินสดในตอนปิดกะ
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="default"
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={handleOpen}
                disabled={openMutation.isPending}
              >
                {openMutation.isPending ? "กำลังเปิด..." : "เปิดกะ"}
              </Button>
              <Button variant="outline" onClick={() => setOpenForm(false)}>
                ยกเลิก
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        // No active shift — show open button
        <Card className="border-dashed">
          <CardContent className="p-8 text-center">
            <Clock className="size-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground mb-4">
              ยังไม่มีกะที่เปิดอยู่ · เปิดกะใหม่เพื่อเริ่มบันทึกการขาย
            </p>
            <Button
              variant="default"
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => setOpenForm(true)}
            >
              <Plus className="size-4" />
              เปิดกะใหม่
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Close shift modal */}
      {closeForm && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Coins className="size-5 text-amber-600" />
              ปิดกะ — นับเงินสด
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded border bg-card p-3">
                <div className="text-xs text-muted-foreground">เงินตั้งต้น</div>
                <div className="text-lg font-semibold tabular-nums">{money(closeForm.openingCash)}</div>
              </div>
              <div className="rounded border bg-card p-3">
                <div className="text-xs text-muted-foreground">บิลขาย</div>
                <div className="text-lg font-semibold tabular-nums">{closeForm.billsCount}</div>
              </div>
              <div className="rounded border bg-card p-3">
                <div className="text-xs text-muted-foreground">ยอดขายรวม</div>
                <div className="text-lg font-semibold tabular-nums text-emerald-600">{money(closeForm.salesTotal)}</div>
              </div>
              <div className="rounded border bg-card p-3">
                <div className="text-xs text-muted-foreground">เงินสดที่คาด</div>
                <div className="text-lg font-semibold tabular-nums">{money(closeForm.expectedCash)}</div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="countedCash">เงินสดที่นับได้จริง (บาท)</Label>
              <Input
                id="countedCash"
                type="number"
                step="0.01"
                min="0"
                value={countedCash}
                onChange={(e) => setCountedCash(e.target.value)}
                className="text-lg tabular-nums"
                autoFocus
              />
              {countedCash !== "" && (
                <div className="text-sm">
                  {(() => {
                    const diff = Number(countedCash) - closeForm.expectedCash;
                    if (Math.abs(diff) < 0.01) {
                      return <span className="text-emerald-600">✓ ตรงยอดพอดี</span>;
                    }
                    if (diff > 0) {
                      return <span className="text-emerald-600">เกินจากที่คาด +{money(diff)}</span>;
                    }
                    return <span className="text-red-600">ขาดจากที่คาด {money(diff)}</span>;
                  })()}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                variant="default"
                className="bg-amber-600 hover:bg-amber-700"
                onClick={handleClose}
                disabled={closeMutation.isPending}
              >
                {closeMutation.isPending ? "กำลังปิด..." : "ยืนยันปิดกะ"}
              </Button>
              <Button variant="outline" onClick={() => { setCloseForm(null); setCountedCash(""); }}>
                ยกเลิก
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">ประวัติกะ ({closedShifts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {closedShifts.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-4">ยังไม่มีประวัติ</div>
          ) : (
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card border-b">
                  <tr className="text-left">
                    <th className="py-2 px-2">เปิดกะ</th>
                    <th className="py-2 px-2">ปิดกะ</th>
                    <th className="py-2 px-2">พนักงาน</th>
                    <th className="py-2 px-2 text-right">บิล</th>
                    <th className="py-2 px-2 text-right">ยอดขาย</th>
                    <th className="py-2 px-2 text-right">เงินสด</th>
                    <th className="py-2 px-2 text-right">นับได้</th>
                    <th className="py-2 px-2 text-right">ผลต่าง</th>
                  </tr>
                </thead>
                <tbody>
                  {closedShifts.map(s => (
                    <tr key={s.id} className="border-b hover:bg-muted/50">
                      <td className="py-1.5 px-2 text-xs">{formatThaiDateTime(s.openedAt)}</td>
                      <td className="py-1.5 px-2 text-xs">{s.closedAt ? formatThaiDateTime(s.closedAt) : "—"}</td>
                      <td className="py-1.5 px-2 font-medium">{s.cashierName}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{s.billsCount}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{money(s.salesTotal)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">{money(s.expectedCash)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{s.countedCash !== null ? money(s.countedCash) : "—"}</td>
                      <td className={`py-1.5 px-2 text-right tabular-nums font-medium ${(s.cashDifference ?? 0) === 0 ? "text-emerald-600" : (s.cashDifference ?? 0) > 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {(s.cashDifference ?? 0) >= 0 ? "+" : ""}{money(s.cashDifference ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "emerald" }) {
  const toneClass = { default: "text-foreground", emerald: "text-emerald-600" }[tone];
  return (
    <div className="rounded border bg-card p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

export default ShiftPage;
