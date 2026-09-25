"use client";

/**
 * MemberDetailModal — full member profile + 6 action buttons + 2-step wallet
 * flow + suspend/restore + 6-tab transaction history.
 *
 * Data: GET /api/members/[number]  → { member, transactions, limitRequests, stats }
 * Mutations:
 *   POST /api/members/[number]/wallet { type, amount, note }
 *   POST /api/members/[number]/status { suspended }
 *   POST /api/members/[number]  (edit profile — same route as register)
 */

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Ban,
  CheckCircle2,
  CreditCard,
  Edit3,
  Printer,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill, memberStatusTone } from "@/components/shared/StatusPill";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { apiGet, apiPost } from "@/lib/api-client";
import { money, formatThaiDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface MemberDetail {
  id: string;
  memberNumber: string;
  prename: string | null;
  firstName: string;
  lastName: string;
  idCard: string | null;
  phone: string | null;
  type: string;
  balance: number;
  status: string;
  photoUrl: string | null;
  gender: string | null;
  creditLimit: number | null;
  cardNumber: string | null;
  patientCode: string | null;
  createdAt: string;
}

interface MemberTransaction {
  id: string;
  memberNumber: string;
  type: string;
  detail: string;
  amount: number;
  balanceAfter: number | null;
  paymentMethod: string | null;
  actor: string | null;
  slipUrl: string | null;
  createdAt: string;
}

interface MemberStats {
  totalSpent: number;
  billCount: number;
  topProducts: [string, number][];
}

interface MemberDetailResponse {
  member: MemberDetail;
  transactions: MemberTransaction[];
  limitRequests: unknown[];
  stats: MemberStats;
}

interface MemberDetailModalProps {
  memberNumber: string;
  role: string;
  onClose: () => void;
}

type WalletStep = "form" | "confirm" | "success";
type WalletAction = "deposit" | "withdrawal" | "refund";

const WALLET_LABEL: Record<WalletAction, string> = {
  deposit: "เติมเงิน",
  withdrawal: "ถอนเงิน",
  refund: "คืนบัตรเงินสด",
};

function fullName(m: { prename?: string | null; firstName?: string | null; lastName?: string | null }): string {
  return [m.prename?.trim() || "", m.firstName?.trim() || "", m.lastName?.trim() || ""].filter(Boolean).join(" ");
}

const TAB_FILTERS: { id: string; label: string; types: string[] | null }[] = [
  { id: "all", label: "ทั้งหมด", types: null },
  { id: "purchase", label: "ซื้อสินค้า", types: ["purchase"] },
  { id: "deposit", label: "เติมเงิน", types: ["deposit", "activation"] },
  { id: "withdrawal", label: "ถอนเงิน", types: ["withdrawal"] },
  { id: "activation", label: "เปิดใช้บัตร", types: ["activation"] },
  { id: "refund", label: "คืนบัตรเงินสด", types: ["refund"] },
];

function txTone(amount: number): string {
  if (amount > 0) return "text-emerald-700";
  if (amount < 0) return "text-red-600";
  return "text-muted-foreground";
}

function WalletForm({
  action,
  currentBalance,
  onSubmit,
  pending,
}: {
  action: WalletAction;
  currentBalance: number;
  onSubmit: (amount: number, note: string) => void;
  pending: boolean;
}) {
  const [amount, setAmount] = React.useState("");
  const [note, setNote] = React.useState("");

  const parsedAmount = React.useMemo(() => {
    const v = Number(amount);
    return Number.isFinite(v) && v > 0 ? v : 0;
  }, [amount]);

  const newBalance = React.useMemo(() => {
    if (action === "deposit") return currentBalance + parsedAmount;
    return currentBalance - parsedAmount;
  }, [action, currentBalance, parsedAmount]);

  const insufficient = action !== "deposit" && parsedAmount > currentBalance;

  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">ยอดเงินคงเหลือปัจจุบัน</span>
          <b className="tabular-nums">{money(currentBalance)}</b>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="wallet-amount">จำนวนเงิน</Label>
        <Input
          id="wallet-amount"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          autoFocus
        />
        {insufficient ? (
          <p className="text-xs text-red-600" role="alert">
            ยอดเงินคงเหลือไม่พอ — คงเหลือ {money(currentBalance)}
          </p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="wallet-note">หมายเหตุ (ถ้ามี)</Label>
        <Input
          id="wallet-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="เช่น เติมเงินสด จ่ายด้วยแบงก์ 1000"
        />
      </div>
      <div className="rounded-lg bg-neutral-50 border border-neutral-200 p-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">ยอดคงเหลือหลังทำรายการ</span>
          <b className={cn("tabular-nums", newBalance < 0 && "text-red-600")}>{money(newBalance)}</b>
        </div>
      </div>
      <Button
        type="button"
        className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
        disabled={parsedAmount <= 0 || insufficient || pending}
        onClick={() => onSubmit(parsedAmount, note)}
      >
        ดำเนินการต่อ
      </Button>
    </div>
  );
}

function WalletConfirm({
  action,
  amount,
  note,
  currentBalance,
  onConfirm,
  onCancel,
  pending,
}: {
  action: WalletAction;
  amount: number;
  note: string;
  currentBalance: number;
  onConfirm: () => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const newBalance = action === "deposit" ? currentBalance + amount : currentBalance - amount;
  return (
    <div className="space-y-3">
      <div className="rounded-lg border p-3 text-sm space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">รายการ</span>
          <b>{WALLET_LABEL[action]}</b>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">จำนวนเงิน</span>
          <b className="tabular-nums">{money(amount)}</b>
        </div>
        {note ? (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">หมายเหตุ</span>
            <span className="text-right max-w-[60%] truncate">{note}</span>
          </div>
        ) : null}
        <div className="flex items-center justify-between pt-1.5 border-t">
          <span className="text-muted-foreground">ยอดคงเหลือหลังทำรายการ</span>
          <b className={cn("tabular-nums", newBalance < 0 && "text-red-600")}>{money(newBalance)}</b>
        </div>
      </div>
      <p className="text-xs text-muted-foreground text-center">
        กดยืนยันเพื่อบันทึกธุรกรรมลงระบบ · ระบบจะบันทึก Log อัตโนมัติ
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={onCancel} disabled={pending}>
          ย้อนกลับ
        </Button>
        <Button
          type="button"
          className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
          onClick={onConfirm}
          disabled={pending}
        >
          {pending ? "กำลังบันทึก…" : "ยืนยัน"}
        </Button>
      </div>
    </div>
  );
}

function WalletSuccess({
  action,
  amount,
  newBalance,
  onDone,
}: {
  action: WalletAction;
  amount: number;
  newBalance: number;
  onDone: () => void;
}) {
  return (
    <div className="space-y-3 text-center">
      <div className="mx-auto size-12 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center">
        <CheckCircle2 className="size-6" aria-hidden="true" />
      </div>
      <div>
        <p className="font-medium">{WALLET_LABEL[action]}สำเร็จ</p>
        <p className="text-sm text-muted-foreground">
          จำนวน {money(amount)} · คงเหลือ <b className="tabular-nums text-foreground">{money(newBalance)}</b>
        </p>
      </div>
      <Button type="button" className="w-full bg-emerald-600 text-white hover:bg-emerald-700" onClick={onDone}>
        เสร็จสิ้น
      </Button>
    </div>
  );
}

const editSchema = z.object({
  prename: z.string().max(20).optional(),
  firstName: z.string().min(1, "กรุณาระบุชื่อ").max(100),
  lastName: z.string().min(1, "กรุณาระบุนามสกุล").max(100),
  type: z.string().max(40).optional(),
  phone: z.string().max(20).optional(),
  idCard: z.string().max(20).optional(),
  gender: z.string().max(20).optional(),
  photoUrl: z.string().max(600_000).optional(),
  creditLimit: z.number().min(0).max(1_000_000).nullable().optional(),
  cardNumber: z.string().max(20).optional(),
  patientCode: z.string().max(20).optional(),
});

type EditValues = z.infer<typeof editSchema>;

export function MemberDetailModal({ memberNumber, role, onClose }: MemberDetailModalProps) {
  const qc = useQueryClient();
  const [walletOpen, setWalletOpen] = React.useState<WalletAction | null>(null);
  const [walletStep, setWalletStep] = React.useState<WalletStep>("form");
  const [walletAmount, setWalletAmount] = React.useState(0);
  const [walletNote, setWalletNote] = React.useState("");
  const [walletResult, setWalletResult] = React.useState<{ amount: number; balanceAfter: number } | null>(null);
  const [editOpen, setEditOpen] = React.useState(false);
  const [suspendOpen, setSuspendOpen] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState("all");

  const query = useQuery({
    queryKey: ["member-detail", memberNumber],
    queryFn: () => apiGet<MemberDetailResponse>(`/api/members/${encodeURIComponent(memberNumber)}`),
    enabled: !!memberNumber,
  });

  const member = query.data?.member;
  const transactions = query.data?.transactions ?? [];
  const stats = query.data?.stats;

  const walletMutation = useMutation({
    mutationFn: async (input: { action: WalletAction; amount: number; note: string }) => {
      const res = await apiPost<{ balanceAfter: number }>(
        `/api/members/${encodeURIComponent(memberNumber)}/wallet`,
        { type: input.action, amount: input.amount, note: input.note || undefined },
      );
      return { balanceAfter: res.balanceAfter };
    },
    onSuccess: (data) => {
      setWalletResult({ amount: walletAmount, balanceAfter: data.balanceAfter });
      setWalletStep("success");
      void qc.invalidateQueries({ queryKey: ["member-detail", memberNumber] });
      void qc.invalidateQueries({ queryKey: ["members"] });
      void qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success(`${WALLET_LABEL[walletOpen ?? "deposit"]}สำเร็จ`);
    },
    onError: (err: unknown) => {
      toast.error("ทำรายการไม่สำเร็จ", {
        description: err instanceof Error ? err.message : "เกิดข้อผิดพลาดบางอย่าง",
      });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async (suspended: boolean) => {
      await apiPost(`/api/members/${encodeURIComponent(memberNumber)}/status`, { suspended });
      return suspended;
    },
    onSuccess: (suspended) => {
      toast.success(suspended ? "ระงับสมาชิกแล้ว" : "ปลดระงับสมาชิกแล้ว");
      setSuspendOpen(false);
      void qc.invalidateQueries({ queryKey: ["member-detail", memberNumber] });
      void qc.invalidateQueries({ queryKey: ["members"] });
    },
    onError: (err: unknown) => {
      toast.error("เปลี่ยนสถานะไม่สำเร็จ", {
        description: err instanceof Error ? err.message : "เกิดข้อผิดพลาดบางอย่าง",
      });
    },
  });

  const handleWalletStart = (action: WalletAction) => {
    setWalletOpen(action);
    setWalletStep("form");
    setWalletAmount(0);
    setWalletNote("");
    setWalletResult(null);
  };

  const handleWalletSubmit = (amount: number, note: string) => {
    if (!walletOpen) return;
    setWalletAmount(amount);
    setWalletNote(note);
    setWalletStep("confirm");
  };

  const handleWalletConfirm = () => {
    if (!walletOpen) return;
    walletMutation.mutate({ action: walletOpen, amount: walletAmount, note: walletNote });
  };

  const filteredTx = React.useMemo(() => {
    const filter = TAB_FILTERS.find((t) => t.id === activeTab);
    if (!filter?.types) return transactions;
    return transactions.filter((t) => filter.types!.includes(t.type));
  }, [transactions, activeTab]);

  const isSuspended = member?.status === "suspended";

  return (
    <Dialog open onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-base">{memberNumber}</span>
            {member ? <StatusPill tone={memberStatusTone(member.status)} /> : null}
          </DialogTitle>
          <DialogDescription>
            {member ? fullName(member) : "กำลังโหลดข้อมูล…"}
          </DialogDescription>
        </DialogHeader>

        {query.isLoading || !member ? (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Balance + actions */}
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-lg border bg-emerald-50/50 p-3">
                <p className="text-xs text-muted-foreground">ยอดเงินคงเหลือ</p>
                <p className="text-2xl font-semibold tabular-nums">{money(member.balance)}</p>
                {member.creditLimit ? (
                  <p className="text-xs text-muted-foreground mt-1">วงเงิน {money(member.creditLimit)}</p>
                ) : null}
              </div>
              <div className="rounded-lg border p-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ประเภท</span>
                  <b>{member.type}</b>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">เบอร์โทร</span>
                  <b className="tabular-nums">{member.phone ?? "—"}</b>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">เลขบัตรประชาชน</span>
                  <b className="tabular-nums">{member.idCard ?? "—"}</b>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">บัตรเงินสด</span>
                  <b className="tabular-nums">{member.cardNumber ?? "—"}</b>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">HN</span>
                  <b className="tabular-nums">{member.patientCode ?? "—"}</b>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="flex flex-col items-center gap-1 h-auto py-2"
                onClick={() => handleWalletStart("deposit")}
                disabled={isSuspended}
              >
                <ArrowDownToLine className="size-4 text-emerald-600" aria-hidden="true" />
                <span className="text-[10px]">เติมเงิน</span>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="flex flex-col items-center gap-1 h-auto py-2"
                onClick={() => handleWalletStart("withdrawal")}
                disabled={isSuspended}
              >
                <ArrowUpFromLine className="size-4 text-amber-600" aria-hidden="true" />
                <span className="text-[10px]">ถอนเงิน</span>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="flex flex-col items-center gap-1 h-auto py-2"
                onClick={() => handleWalletStart("refund")}
                disabled={isSuspended}
              >
                <CreditCard className="size-4 text-purple-600" aria-hidden="true" />
                <span className="text-[10px]">คืนบัตร</span>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="flex flex-col items-center gap-1 h-auto py-2"
                onClick={() => setEditOpen(true)}
              >
                <Edit3 className="size-4 text-neutral-600" aria-hidden="true" />
                <span className="text-[10px]">แก้ไข</span>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="flex flex-col items-center gap-1 h-auto py-2"
                onClick={() => toast.info("พิมพ์บัตร", { description: "ฟีเจอร์นี้จะเปิดในเร็ว ๆ นี้" })}
              >
                <Printer className="size-4 text-neutral-600" aria-hidden="true" />
                <span className="text-[10px]">พิมพ์บัตร</span>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="flex flex-col items-center gap-1 h-auto py-2"
                onClick={() => toast.info("รายงานยอดเงินคงเหลือ", { description: "ฟีเจอร์นี้จะเปิดในเร็ว ๆ นี้" })}
              >
                <Wallet className="size-4 text-neutral-600" aria-hidden="true" />
                <span className="text-[10px]">รายงานยอด</span>
              </Button>
            </div>

            {/* Stats row */}
            {stats ? (
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="rounded-lg border p-2">
                  <p className="text-[10px] text-muted-foreground">ยอดซื้อสะสม</p>
                  <p className="font-semibold tabular-nums">{money(stats.totalSpent)}</p>
                </div>
                <div className="rounded-lg border p-2">
                  <p className="text-[10px] text-muted-foreground">จำนวนบิล</p>
                  <p className="font-semibold tabular-nums">{stats.billCount}</p>
                </div>
                <div className="rounded-lg border p-2">
                  <p className="text-[10px] text-muted-foreground">สินค้าที่ซื้อบ่อย</p>
                  <p className="font-medium text-xs truncate">{stats.topProducts[0]?.[0] ?? "—"}</p>
                </div>
              </div>
            ) : null}

            {/* Suspend/restore */}
            <div className="flex items-center justify-between rounded-lg border border-dashed p-3">
              <div className="text-sm">
                <p className="font-medium">{isSuspended ? "สมาชิกถูกระงับ" : "สมาชิกใช้งานปกติ"}</p>
                <p className="text-xs text-muted-foreground">
                  {isSuspended
                    ? "ระงับการเติมเงิน/ซื้อสินค้าชั่วคราว — กดปลดระงับเพื่อคืนสถานะ"
                    : "กดระงับเพื่อหยุดการเติมเงินและซื้อสินค้าชั่วคราว"}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant={isSuspended ? "default" : "outline"}
                className={cn(
                  !isSuspended && "text-red-600 hover:text-red-700 hover:bg-red-50 hover:border-red-200",
                  isSuspended && "bg-emerald-600 text-white hover:bg-emerald-700",
                )}
                onClick={() => setSuspendOpen(true)}
              >
                <Ban className="size-4" aria-hidden="true" />
                {isSuspended ? "ปลดระงับ" : "ระงับสมาชิก"}
              </Button>
            </div>

            {/* Transactions */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="w-full justify-start overflow-x-auto">
                {TAB_FILTERS.map((t) => (
                  <TabsTrigger key={t.id} value={t.id} className="text-xs">
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value={activeTab} className="mt-3">
                {filteredTx.length === 0 ? (
                  <EmptyState
                    icon={Wallet}
                    title="ยังไม่มีรายการ"
                    description="ธุรกรรมของสมาชิกจะแสดงที่นี่"
                  />
                ) : (
                  <div className="max-h-72 overflow-y-auto rounded-lg border">
                    <table className="w-full text-[11px]">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr className="text-left text-xs text-muted-foreground">
                          <th className="py-[12px] px-[9px]">วันที่-เวลา</th>
                          <th className="py-[12px] px-[9px]">รายการ</th>
                          <th className="py-2 px-2 text-right">จำนวน</th>
                          <th className="py-2 px-2 text-right">คงเหลือ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredTx.map((t) => (
                          <tr key={t.id} className="border-t">
                            <td className="py-2 px-2 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                              {formatThaiDateTime(t.createdAt)}
                            </td>
                            <td className="py-[12px] px-[9px]">
                              <p className="text-sm">{t.detail}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {t.paymentMethod ?? ""}
                                {t.actor ? ` · โดย ${t.actor}` : ""}
                              </p>
                            </td>
                            <td className={cn("py-2 px-2 text-right tabular-nums font-medium", txTone(t.amount))}>
                              {t.amount > 0 ? "+" : ""}
                              {money(t.amount)}
                            </td>
                            <td className="py-2 px-2 text-right tabular-nums">
                              {t.balanceAfter !== null ? money(t.balanceAfter) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </TabsContent>
            </Tabs>

            <p className="text-xs text-muted-foreground text-center">
              สมาชิกตั้งแต่ {formatThaiDateTime(member.createdAt)}
              <span className="sr-only"> · บทบาทผู้ดูเบิก {role}</span>
            </p>
          </div>
        )}
      </DialogContent>

      {/* Wallet modal */}
      {walletOpen && member ? (
        <Dialog open onOpenChange={(next) => (next ? null : setWalletOpen(null))}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {WALLET_LABEL[walletOpen]} · {member.memberNumber}
              </DialogTitle>
              <DialogDescription>
                {walletStep === "form"
                  ? "กรอกจำนวนเงินและหมายเหตุ (ถ้ามี)"
                  : walletStep === "confirm"
                    ? "ยืนยันรายการก่อนบันทึก"
                    : "รายการเสร็จสมบูรณ์"}
              </DialogDescription>
            </DialogHeader>
            {walletStep === "form" ? (
              <WalletForm
                action={walletOpen}
                currentBalance={member.balance}
                onSubmit={handleWalletSubmit}
                pending={walletMutation.isPending}
              />
            ) : null}
            {walletStep === "confirm" ? (
              <WalletConfirm
                action={walletOpen}
                amount={walletAmount}
                note={walletNote}
                currentBalance={member.balance}
                onConfirm={handleWalletConfirm}
                onCancel={() => setWalletStep("form")}
                pending={walletMutation.isPending}
              />
            ) : null}
            {walletStep === "success" && walletResult ? (
              <WalletSuccess
                action={walletOpen}
                amount={walletResult.amount}
                newBalance={walletResult.balanceAfter}
                onDone={() => {
                  setWalletOpen(null);
                  setWalletStep("form");
                  setWalletResult(null);
                }}
              />
            ) : null}
          </DialogContent>
        </Dialog>
      ) : null}

      {/* Edit modal */}
        {editOpen && member ? (
          <MemberEditDialog
            member={member}
            onClose={() => setEditOpen(false)}
            onSaved={() => {
              void qc.invalidateQueries({ queryKey: ["member-detail", memberNumber] });
              void qc.invalidateQueries({ queryKey: ["members"] });
              setEditOpen(false);
            }}
          />
        ) : null}

      {/* Suspend/restore confirm */}
      <ConfirmDialog
        open={suspendOpen}
        title={isSuspended ? "ปลดระงับสมาชิก?" : "ยืนยันระงับสมาชิก?"}
        description={
          isSuspended
            ? `สมาชิก ${member?.memberNumber} จะกลับมาใช้งานได้ปกติ · เติมเงิน/ซื้อสินค้าได้ทันที`
            : `สมาชิก ${member?.memberNumber} จะไม่สามารถเติมเงินหรือซื้อสินค้าได้ชั่วคราว · ปลดระงับได้ภายหลัง`
        }
        confirmLabel={isSuspended ? "ปลดระงับ" : "ระงับ"}
        tone={!isSuspended ? "danger" : "default"}
        pending={statusMutation.isPending}
        onConfirm={() => statusMutation.mutate(!isSuspended)}
        onCancel={() => setSuspendOpen(false)}
      />
    </Dialog>
  );
}

interface MemberEditDialogProps {
  member: MemberDetail;
  onClose: () => void;
  onSaved: () => void;
}

function MemberEditDialog({ member, onClose, onSaved }: MemberEditDialogProps) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      prename: member.prename ?? "",
      firstName: member.firstName,
      lastName: member.lastName,
      type: member.type,
      phone: member.phone ?? "",
      idCard: member.idCard ?? "",
      gender: member.gender ?? "",
      creditLimit: member.creditLimit ?? null,
      cardNumber: member.cardNumber ?? "",
      patientCode: member.patientCode ?? "",
    },
  });

  const onSubmit = async (values: EditValues) => {
    try {
      await apiPost(`/api/members/${encodeURIComponent(member.memberNumber)}`, {
        ...values,
        // memberNumber omitted → server keeps existing number
      });
      toast.success("บันทึกข้อมูลสมาชิกแล้ว");
      onSaved();
    } catch (err) {
      toast.error("บันทึกไม่สำเร็จ", {
        description: err instanceof Error ? err.message : "เกิดข้อผิดพลาดบางอย่าง",
      });
    }
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>แก้ไขข้อมูลสมาชิก</DialogTitle>
          <DialogDescription>{member.memberNumber}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="prename">คำนำหน้า</Label>
              <Input id="prename" {...register("prename")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="type">ประเภท</Label>
              <Select
                defaultValue={watch("type") || "สมาชิก"}
                onValueChange={(v) => setValue("type", v)}
              >
                <SelectTrigger id="type">
                  <SelectValue placeholder="เลือกประเภท" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="สมาชิก">สมาชิก</SelectItem>
                  <SelectItem value="เจ้าหน้าที่">เจ้าหน้าที่</SelectItem>
                  <SelectItem value="ผู้ป่วย">ผู้ป่วย</SelectItem>
                  <SelectItem value="บุคลากร">บุคลากร</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="firstName">ชื่อ</Label>
              <Input id="firstName" {...register("firstName")} aria-invalid={!!errors.firstName} />
              {errors.firstName ? (
                <p className="text-xs text-red-600">{errors.firstName.message}</p>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor="lastName">นามสกุล</Label>
              <Input id="lastName" {...register("lastName")} aria-invalid={!!errors.lastName} />
              {errors.lastName ? (
                <p className="text-xs text-red-600">{errors.lastName.message}</p>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor="phone">เบอร์โทร</Label>
              <Input id="phone" {...register("phone")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="idCard">เลขบัตรประชาชน</Label>
              <Input id="idCard" {...register("idCard")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="gender">เพศ</Label>
              <Select
                defaultValue={watch("gender") || ""}
                onValueChange={(v) => setValue("gender", v)}
              >
                <SelectTrigger id="gender">
                  <SelectValue placeholder="ไม่ระบุ" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ชาย">ชาย</SelectItem>
                  <SelectItem value="หญิง">หญิง</SelectItem>
                  <SelectItem value="ไม่ระบุ">ไม่ระบุ</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="creditLimit">วงเงินเครดิต</Label>
              <Input
                id="creditLimit"
                type="number"
                step="0.01"
                min="0"
                {...register("creditLimit", {
                  setValueAs: (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
                })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cardNumber">เลขบัตรเงินสด</Label>
              <Input id="cardNumber" {...register("cardNumber")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="patientCode">HN</Label>
              <Input id="patientCode" {...register("patientCode")} />
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={isSubmitting}>
              ยกเลิก
            </Button>
            <Button
              type="submit"
              className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={isSubmitting}
            >
              {isSubmitting ? "กำลังบันทึก…" : "บันทึก"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default MemberDetailModal;
