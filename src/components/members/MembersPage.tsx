"use client";

/**
 * MembersPage — list members, search/filter, open detail modal, register new.
 *
 * Data: GET /api/members (returns `{ members: MemberRow[] }`).
 * Mutation: POST /api/members (register), POST /api/members/[number]/status
 * (suspend/restore), PATCH is currently handled via the register endpoint re-POST
 * in this MVP — a future task can add a dedicated PATCH route.
 */

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus, UsersRound, Wallet } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { StatusPill, memberStatusTone } from "@/components/shared/StatusPill";
import { EmptyState } from "@/components/shared/EmptyState";
import { MemberDetailModal } from "@/components/members/MemberDetailModal";
import { RegisterMemberModal } from "@/components/members/RegisterMemberModal";
import { apiGet, apiPost } from "@/lib/api-client";
import { money, formatLastActivity, formatThaiMonthYear } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface MemberRow {
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
  lastTransactionAt: string | null;
  lastActivityLabel: string;
}

interface MembersListResponse {
  members: MemberRow[];
}

interface MembersPageProps {
  role: string;
  userName: string;
  focusMemberNumber?: string | null;
  onFocusMemberConsumed?: () => void;
}

type FilterId = "all" | "active" | "suspended";

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "all", label: "ทั้งหมด" },
  { id: "active", label: "ใช้งาน" },
  { id: "suspended", label: "ระงับ" },
];

function fullName(m: { prename?: string | null; firstName?: string | null; lastName?: string | null }): string {
  return [m.prename?.trim() || "", m.firstName?.trim() || "", m.lastName?.trim() || ""].filter(Boolean).join(" ");
}

export function MembersPage({ role, userName, focusMemberNumber, onFocusMemberConsumed }: MembersPageProps) {
  const qc = useQueryClient();
  const [filter, setFilter] = React.useState<FilterId>("all");
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [selectedNumber, setSelectedNumber] = React.useState<string | null>(null);
  const [registerOpen, setRegisterOpen] = React.useState(false);

  // Debounce search by 350ms.
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search), 350);
    return () => window.clearTimeout(t);
  }, [search]);

  const query = useQuery({
    queryKey: ["members", filter, debouncedSearch],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("status", filter);
      if (debouncedSearch) params.set("search", debouncedSearch);
      const qs = params.toString();
      return apiGet<MembersListResponse>(`/api/members${qs ? `?${qs}` : ""}`);
    },
  });

  // Open detail when an external focus prop is set (e.g. bell click in AppShell).
  React.useEffect(() => {
    if (focusMemberNumber) {
      setSelectedNumber(focusMemberNumber);
      onFocusMemberConsumed?.();
    }
  }, [focusMemberNumber, onFocusMemberConsumed]);

  const members = query.data?.members ?? [];

  const totalWallet = React.useMemo(
    () => members.reduce((sum, m) => sum + m.balance, 0),
    [members],
  );
  const totalActive = React.useMemo(
    () => members.filter((m) => m.status === "active").length,
    [members],
  );
  const newThisMonth = React.useMemo(() => {
    const now = new Date();
    const m = now.getMonth();
    const y = now.getFullYear();
    return members.filter((mem) => {
      const d = new Date(mem.createdAt);
      return d.getMonth() === m && d.getFullYear() === y;
    }).length;
  }, [members]);

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="สมาชิกและบัญชี"
        title="สมาชิกสวัสดิการ"
        description="จัดการบัญชีสมาชิก เติม/ถอนเงิน และพิมพ์บัตร"
        actions={
          <Button
            type="button"
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={() => setRegisterOpen(true)}
          >
            <UserPlus className="size-4" aria-hidden="true" />
            ลงทะเบียนสมาชิก
          </Button>
        }
      />

      {/* Stat cards */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <Card className="py-0">
          <CardContent className="p-4 flex items-center gap-3">
            <span className="size-10 rounded-lg bg-emerald-100 text-emerald-700 grid place-items-center">
              <Wallet className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">ยอดเงินในบัญชีรวม</p>
              <p className="text-lg font-semibold tabular-nums">{money(totalWallet)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="py-0">
          <CardContent className="p-4 flex items-center gap-3">
            <span className="size-10 rounded-lg bg-neutral-100 text-neutral-700 grid place-items-center">
              <UsersRound className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">สมาชิกทั้งหมด</p>
              <p className="text-lg font-semibold tabular-nums">{members.length} ราย</p>
            </div>
          </CardContent>
        </Card>
        <Card className="py-0">
          <CardContent className="p-4 flex items-center gap-3">
            <span className="size-10 rounded-lg bg-amber-100 text-amber-700 grid place-items-center">
              <UserPlus className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">ลงทะเบียนเดือนนี้</p>
              <p className="text-lg font-semibold tabular-nums">{newThisMonth} ราย</p>
              <p className="text-[10px] text-muted-foreground">{formatThaiMonthYear(new Date())}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter pills + search */}
      <Card className="py-0">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-1 rounded-lg border p-0.5">
              {FILTERS.map((f) => (
                <Button
                  key={f.id}
                  type="button"
                  variant={filter === f.id ? "default" : "ghost"}
                  size="sm"
                  className={cn(
                    "h-8 px-3 text-xs",
                    filter === f.id && "bg-emerald-600 text-white hover:bg-emerald-700",
                  )}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                </Button>
              ))}
            </div>
            <Input
              type="text"
              placeholder="ค้นหาด้วย เลขสมาชิก / ชื่อ-สกุล / บัตร / HN"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="sm:max-w-sm"
              aria-label="ค้นหาสมาชิก"
            />
          </div>

          {/* Table */}
          {query.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : members.length === 0 ? (
            <EmptyState
              icon={UsersRound}
              title="ยังไม่มีสมาชิก"
              description="ลงทะเบียนสมาชิกใหม่เพื่อเริ่มต้นใช้งานระบบกระเป๋าเงิน"
              action={
                <Button
                  type="button"
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                  onClick={() => setRegisterOpen(true)}
                >
                  <UserPlus className="size-4" aria-hidden="true" />
                  ลงทะเบียนสมาชิก
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="py-2 px-2">เลขสมาชิก</th>
                    <th className="py-2 px-2">ชื่อ-สกุล</th>
                    <th className="py-2 px-2">สถานะ</th>
                    <th className="py-2 px-2 text-right">ยอดคงเหลือ</th>
                    <th className="py-2 px-2">รายการล่าสุด</th>
                    <th className="py-2 px-2 text-right">การจัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr
                      key={m.id}
                      className="border-b last:border-b-0 hover:bg-accent/40 cursor-pointer"
                      onClick={() => setSelectedNumber(m.memberNumber)}
                    >
                      <td className="py-2.5 px-2 font-mono text-xs">{m.memberNumber}</td>
                      <td className="py-2.5 px-2">
                        <p className="font-medium">{fullName(m)}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {m.type}
                          {m.patientCode ? ` · HN ${m.patientCode}` : ""}
                          {m.cardNumber ? ` · บัตร ${m.cardNumber}` : ""}
                        </p>
                      </td>
                      <td className="py-2.5 px-2">
                        <StatusPill tone={memberStatusTone(m.status)} />
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums font-medium">
                        {money(m.balance)}
                      </td>
                      <td className="py-2.5 px-2 text-xs text-muted-foreground">
                        {m.lastActivityLabel ?? "—"}
                      </td>
                      <td className="py-2.5 px-2 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedNumber(m.memberNumber);
                          }}
                        >
                          เปิด
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedNumber ? (
        <MemberDetailModal
          memberNumber={selectedNumber}
          role={role}
          onClose={() => setSelectedNumber(null)}
        />
      ) : null}

      {registerOpen ? (
        <RegisterMemberModal
          onClose={() => setRegisterOpen(false)}
          onCreated={async (memberNumber) => {
            await qc.invalidateQueries({ queryKey: ["members"] });
            setRegisterOpen(false);
            setSelectedNumber(memberNumber);
          }}
        />
      ) : null}

      {/* keep import alive for future role-aware actions */}
      <span className="sr-only">{userName}</span>
    </div>
  );
}

export default MembersPage;
