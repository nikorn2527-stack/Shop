"use client";

/**
 * UsersPage — RBAC user management UI.
 *
 * Two tabs:
 *   1. Accounts — list users, filter by role, create / edit / unlock.
 *   2. Sessions — list active sessions, revoke one or all-but-current.
 *
 * Data: GET /api/users  /  POST /api/users  /  PATCH /api/users/[id]  /
 *       POST /api/users/[id]/unlock  /  GET /api/sessions  /
 *       DELETE /api/sessions/[id]  /  POST /api/sessions/others
 */

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Ban,
  CheckCircle2,
  Crown,
  KeyRound,
  MonitorSmartphone,
  ShieldCheck,
  Terminal,
  User,
  UserCog,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { StatusPill, userStatusTone } from "@/components/shared/StatusPill";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import PasswordMeter from "@/components/PasswordMeter";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api-client";
import { roleLabel, SYSTEM_ROLES } from "@/lib/rbac";
import { formatThaiDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface UserRow {
  id: string;
  username: string;
  displayName: string;
  role: string;
  active: boolean;
  mustChangePassword: boolean;
  failedAttempts: number;
  lockedUntil: string | null;
  lastSignedIn: string | null;
  createdAt: string;
  createdAtLabel: string;
}

interface UsersResponse {
  users: UserRow[];
}

interface SessionRow {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  role: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  lastSeenLabel: string;
  expiresAt: string;
}

interface SessionsResponse {
  sessions: SessionRow[];
}

interface UsersPageProps {
  currentUserId: string;
  currentRole: string;
}

const ROLE_FILTERS: { id: string; label: string }[] = [
  { id: "all", label: "ทั้งหมด" },
  { id: "administrator", label: "ผู้ดูแล" },
  { id: "manager", label: "ผู้จัดการ" },
  { id: "auditor", label: "ผู้ตรวจสอบ" },
  { id: "cashier", label: "พนักงานขาย" },
  { id: "inactive", label: "ระงับ" },
];

function roleIcon(role: string) {
  if (role === "administrator") return <Crown className="size-3.5" aria-hidden="true" />;
  if (role === "auditor") return <ShieldCheck className="size-3.5" aria-hidden="true" />;
  if (role === "dev_service") return <Terminal className="size-3.5" aria-hidden="true" />;
  if (role === "manager") return <ShieldCheck className="size-3.5" aria-hidden="true" />;
  return <User className="size-3.5" aria-hidden="true" />;
}

const createSchema = z.object({
  username: z
    .string()
    .min(3, "ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัวอักษร")
    .max(30)
    .regex(/^[a-z0-9_.]+$/, "ภาษาอังกฤษ/ตัวเลข/._ เท่านั้น"),
  password: z.string().min(8, "รหัสผ่านอย่างน้อย 8 ตัวอักษร").max(128),
  displayName: z.string().min(1, "กรุณาระบุชื่อ-สกุล").max(120),
  role: z.string(),
});
type CreateValues = z.infer<typeof createSchema>;

const editSchema = z.object({
  displayName: z.string().min(1).max(120),
  role: z.string(),
  active: z.boolean(),
  newPassword: z.string().optional(),
});
type EditValues = z.infer<typeof editSchema>;

export function UsersPage({ currentUserId, currentRole }: UsersPageProps) {
  const qc = useQueryClient();
  const [tab, setTab] = React.useState<"accounts" | "sessions">("accounts");
  const [filter, setFilter] = React.useState("all");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editUser, setEditUser] = React.useState<UserRow | null>(null);
  const [unlockUser, setUnlockUser] = React.useState<UserRow | null>(null);
  const [revokeId, setRevokeId] = React.useState<string | null>(null);
  const [revokeAllOpen, setRevokeAllOpen] = React.useState(false);

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: () => apiGet<UsersResponse>("/api/users"),
  });
  const sessionsQuery = useQuery({
    queryKey: ["sessions"],
    queryFn: () => apiGet<SessionsResponse>("/api/sessions"),
    enabled: tab === "sessions",
  });

  const users = usersQuery.data?.users ?? [];
  const filtered = React.useMemo(() => {
    if (filter === "all") return users;
    if (filter === "inactive") return users.filter((u) => !u.active);
    return users.filter((u) => u.role === filter);
  }, [users, filter]);

  const stats = React.useMemo(() => {
    return {
      total: users.length,
      administrators: users.filter((u) => u.role === "administrator" && u.active).length,
      staff: users.filter((u) => u.role === "cashier" && u.active).length,
      devs: users.filter((u) => u.role === "dev_service" && u.active).length,
      inactive: users.filter((u) => !u.active).length,
    };
  }, [users]);

  const createMutation = useMutation({
    mutationFn: (input: CreateValues) => apiPost("/api/users", input),
    onSuccess: () => {
      toast.success("สร้างบัญชีผู้ใช้เรียบร้อย");
      setCreateOpen(false);
      void qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err: unknown) => {
      toast.error("สร้างบัญชีไม่สำเร็จ", {
        description: err instanceof Error ? err.message : "เกิดข้อผิดพลาดบางอย่าง",
      });
    },
  });

  const editMutation = useMutation({
    mutationFn: (input: { id: string; patch: Partial<EditValues> }) =>
      apiPatch(`/api/users/${input.id}`, input.patch),
    onSuccess: () => {
      toast.success("บันทึกข้อมูลผู้ใช้เรียบร้อย");
      setEditUser(null);
      void qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err: unknown) => {
      toast.error("บันทึกไม่สำเร็จ", {
        description: err instanceof Error ? err.message : "เกิดข้อผิดพลาดบางอย่าง",
      });
    },
  });

  const unlockMutation = useMutation({
    mutationFn: (id: string) => apiPost(`/api/users/${id}/unlock`, {}),
    onSuccess: () => {
      toast.success("ปลดล็อกบัญชีเรียบร้อย");
      setUnlockUser(null);
      void qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err: unknown) => {
      toast.error("ปลดล็อกไม่สำเร็จ", {
        description: err instanceof Error ? err.message : "เกิดข้อผิดพลาดบางอย่าง",
      });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/sessions/${id}`),
    onSuccess: () => {
      toast.success("ยกเลิกเซสชันเรียบร้อย");
      setRevokeId(null);
      void qc.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (err: unknown) => {
      toast.error("ยกเลิกเซสชันไม่สำเร็จ", {
        description: err instanceof Error ? err.message : "เกิดข้อผิดพลาดบางอย่าง",
      });
    },
  });

  const revokeAllMutation = useMutation({
    mutationFn: () => apiPost<{ revoked: number }>("/api/sessions/others", {}),
    onSuccess: (data) => {
      toast.success(`ยกเลิกเซสชันอื่น ${data.revoked} รายการ`);
      setRevokeAllOpen(false);
      void qc.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (err: unknown) => {
      toast.error("ยกเลิกไม่สำเร็จ", {
        description: err instanceof Error ? err.message : "เกิดข้อผิดพลาดบางอย่าง",
      });
    },
  });

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="ผู้ใช้ระบบ"
        title="บัญชีผู้ใช้และสิทธิ์"
        description="จัดการบัญชีผู้ใช้ · บทบาท · สถานะ · ปลดล็อกบัญชี · จัดการเซสชัน"
        actions={
          <Button
            type="button"
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={() => setCreateOpen(true)}
          >
            <UserPlus className="size-4" aria-hidden="true" />
            เพิ่มผู้ใช้
          </Button>
        }
      />

      {/* Stat cards */}
      <div className="grid gap-[13px] grid-cols-2 sm:grid-cols-5">
        <StatCard label="ผู้ใช้ทั้งหมด" value={stats.total} tone="emerald" icon={UserCog} />
        <StatCard label="ผู้ดูแล" value={stats.administrators} tone="amber" icon={Crown} />
        <StatCard label="พนักงานขาย" value={stats.staff} tone="neutral" icon={User} />
        <StatCard label="ผู้พัฒนา" value={stats.devs} tone="purple" icon={Terminal} />
        <StatCard label="ระงับการใช้งาน" value={stats.inactive} tone="red" icon={Ban} />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="accounts"><UserCog className="size-4 mr-1.5" aria-hidden="true" />บัญชีผู้ใช้</TabsTrigger>
          <TabsTrigger value="sessions"><MonitorSmartphone className="size-4 mr-1.5" aria-hidden="true" />เซสชัน</TabsTrigger>
        </TabsList>

        {/* Accounts */}
        <TabsContent value="accounts" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {ROLE_FILTERS.map((f) => (
              <Button
                key={f.id}
                type="button"
                variant={filter === f.id ? "default" : "outline"}
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

          <Card className="py-0">
            <CardContent className="p-0">
              {usersQuery.isLoading ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <EmptyState icon={UserCog} title="ยังไม่มีผู้ใช้" description="เพิ่มผู้ใช้ใหม่เพื่อเริ่มต้นใช้งาน" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[760px]">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground border-b bg-muted/40">
                        <th className="py-2 px-3">ผู้ใช้</th>
                        <th className="py-2 px-3">สิทธิ์</th>
                        <th className="py-2 px-3">สถานะ</th>
                        <th className="py-2 px-3">สร้างเมื่อ</th>
                        <th className="py-2 px-3 text-right">การจัดการ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((u) => {
                        const status = userStatusTone(u)
                        return (
                          <tr key={u.id} className="border-b last:border-b-0 hover:bg-accent/40">
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-2">
                                <span className="size-8 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center text-xs font-semibold">
                                  {u.displayName.slice(0, 1) || "?"}
                                </span>
                                <div className="min-w-0">
                                  <p className="font-medium truncate">{u.displayName}</p>
                                  <p className="text-xs text-muted-foreground">@{u.username}</p>
                                </div>
                              </div>
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                                {roleIcon(u.role)}
                                {roleLabel(u.role)}
                              </span>
                            </td>
                            <td className="py-2.5 px-3">
                              <StatusPill tone={status.tone} label={status.label} />
                            </td>
                            <td className="py-2.5 px-3 text-xs text-muted-foreground tabular-nums">
                              {u.createdAtLabel}
                              {u.lastSignedIn ? (
                                <>
                                  <br />
                                  <span className="text-[10px]">ล่าสุด {formatThaiDateTime(u.lastSignedIn)}</span>
                                </>
                              ) : null}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <div className="inline-flex items-center gap-1">
                                {u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now() ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setUnlockUser(u)}
                                  >
                                    <KeyRound className="size-3.5" aria-hidden="true" />
                                    ปลดล็อก
                                  </Button>
                                ) : null}
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setEditUser(u)}
                                >
                                  แก้ไข
                                </Button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Sessions */}
        <TabsContent value="sessions" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRevokeAllOpen(true)}
              disabled={(sessionsQuery.data?.sessions ?? []).length <= 1}
            >
              <Ban className="size-4" aria-hidden="true" />
              ยกเลิกเซสชันอื่นทั้งหมด
            </Button>
          </div>
          <Card className="py-0">
            <CardContent className="p-0">
              {sessionsQuery.isLoading ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : (sessionsQuery.data?.sessions ?? []).length === 0 ? (
                <EmptyState icon={MonitorSmartphone} title="ยังไม่มีเซสชันที่ใช้งานอยู่" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[720px]">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground border-b bg-muted/40">
                        <th className="py-2 px-3">ผู้ใช้</th>
                        <th className="py-2 px-3">IP</th>
                        <th className="py-2 px-3">เครื่อง</th>
                        <th className="py-2 px-3">ใช้งานล่าสุด</th>
                        <th className="py-2 px-3 text-right">การจัดการ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(sessionsQuery.data?.sessions ?? []).map((s) => (
                        <tr key={s.id} className="border-b last:border-b-0 hover:bg-accent/40">
                          <td className="py-2.5 px-3">
                            <p className="font-medium">{s.displayName}</p>
                            <p className="text-xs text-muted-foreground">@{s.username} · {roleLabel(s.role)}</p>
                          </td>
                          <td className="py-2.5 px-3 text-xs text-muted-foreground tabular-nums">
                            {s.ip ?? "—"}
                          </td>
                          <td className="py-2.5 px-3 text-xs text-muted-foreground max-w-xs truncate">
                            {s.userAgent ?? "—"}
                          </td>
                          <td className="py-2.5 px-3 text-xs text-muted-foreground tabular-nums">
                            {s.lastSeenLabel}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            {s.userId === currentUserId ? (
                              <span className="text-xs text-emerald-700 font-medium">เซสชันปัจจุบัน</span>
                            ) : (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setRevokeId(s.id)}
                              >
                                ยกเลิก
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create dialog */}
      {createOpen ? (
        <CreateUserDialog
          onClose={() => setCreateOpen(false)}
          onSubmit={(v) => createMutation.mutate(v)}
          pending={createMutation.isPending}
        />
      ) : null}

      {/* Edit dialog */}
      {editUser ? (
        <EditUserDialog
          user={editUser}
          onClose={() => setEditUser(null)}
          onSubmit={(patch) => editMutation.mutate({ id: editUser.id, patch })}
          pending={editMutation.isPending}
        />
      ) : null}

      {/* Unlock confirm */}
      <ConfirmDialog
        open={!!unlockUser}
        title="ปลดล็อกบัญชี?"
        description={`บัญชี ${unlockUser?.username} · ล้างจำนวนครั้งผิดพลาดและปลดล็อกให้ผู้ใช้ล็อกอินได้ทันที`}
        confirmLabel="ปลดล็อก"
        pending={unlockMutation.isPending}
        onConfirm={() => unlockUser && unlockMutation.mutate(unlockUser.id)}
        onCancel={() => setUnlockUser(null)}
      />

      {/* Revoke single session confirm */}
      <ConfirmDialog
        open={!!revokeId}
        title="ยกเลิกเซสชัน?"
        description="ผู้ใช้จะต้องเข้าสู่ระบบใหม่อีกครั้ง · ไม่สามารถย้อนกลับได้"
        confirmLabel="ยกเลิกเซสชัน"
        tone="danger"
        pending={revokeMutation.isPending}
        onConfirm={() => revokeId && revokeMutation.mutate(revokeId)}
        onCancel={() => setRevokeId(null)}
      />

      {/* Revoke all others confirm */}
      <ConfirmDialog
        open={revokeAllOpen}
        title="ยกเลิกเซสชันอื่นทั้งหมด?"
        description="เซสชันปัจจุบันของคุณจะไม่ถูกยกเลิก · ผู้ใช้อื่นทุกคนต้องเข้าสู่ระบบใหม่"
        confirmLabel="ยกเลิกเซสชันอื่น"
        tone="danger"
        pending={revokeAllMutation.isPending}
        onConfirm={() => revokeAllMutation.mutate()}
        onCancel={() => setRevokeAllOpen(false)}
      />

      <span className="sr-only">{currentRole}</span>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  tone: "emerald" | "amber" | "neutral" | "purple" | "red";
  icon: React.ComponentType<{ className?: string }>;
}) {
  const toneClass: Record<typeof tone, string> = {
    emerald: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    neutral: "bg-neutral-100 text-neutral-700",
    purple: "bg-purple-100 text-purple-700",
    red: "bg-red-100 text-red-700",
  };
  return (
    <Card className="py-0">
      <CardContent className="p-4 flex items-center gap-3">
        <span className={cn("size-9 rounded-lg grid place-items-center", toneClass[tone])}>
          <Icon className="size-4.5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function CreateUserDialog({
  onClose,
  onSubmit,
  pending,
}: {
  onClose: () => void;
  onSubmit: (v: CreateValues) => void;
  pending: boolean;
}) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { username: "", password: "", displayName: "", role: "cashier" },
  });

  const password = watch("password") || "";
  const role = watch("role") || "cashier";

  return (
    <Dialog open onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="size-5 text-emerald-600" aria-hidden="true" />
            เพิ่มผู้ใช้ใหม่
          </DialogTitle>
          <DialogDescription>
            บัญชีใหม่จะถูกตั้งให้ต้องเปลี่ยนรหัสผ่านในการเข้าสู่ระบบครั้งแรก
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
          <div className="space-y-1">
            <Label htmlFor="cu-username">ชื่อผู้ใช้</Label>
            <Input
              id="cu-username"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              {...register("username")}
              aria-invalid={!!errors.username}
            />
            {errors.username ? (
              <p className="text-xs text-red-600">{errors.username.message}</p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="cu-display">ชื่อ-สกุล</Label>
            <Input id="cu-display" {...register("displayName")} aria-invalid={!!errors.displayName} />
            {errors.displayName ? (
              <p className="text-xs text-red-600">{errors.displayName.message}</p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="cu-role">บทบาท</Label>
            <Select value={role} onValueChange={(v) => setValue("role", v)}>
              <SelectTrigger id="cu-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SYSTEM_ROLES.map((r) => (
                  <SelectItem key={r.name} value={r.name}>
                    {roleLabel(r.name)} — {r.description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cu-password">รหัสผ่านชั่วคราว</Label>
            <Input
              id="cu-password"
              type="password"
              autoComplete="new-password"
              {...register("password")}
              aria-invalid={!!errors.password}
            />
            {errors.password ? (
              <p className="text-xs text-red-600">{errors.password.message}</p>
            ) : null}
            <PasswordMeter role={role} password={password} />
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={pending}>
              ยกเลิก
            </Button>
            <Button
              type="submit"
              className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={pending}
            >
              {pending ? "กำลังสร้าง…" : "สร้างบัญชี"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({
  user,
  onClose,
  onSubmit,
  pending,
}: {
  user: UserRow;
  onClose: () => void;
  onSubmit: (patch: Partial<EditValues>) => void;
  pending: boolean;
}) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      displayName: user.displayName,
      role: user.role,
      active: user.active,
      newPassword: "",
    },
  });

  const role = watch("role") || user.role;
  const newPassword = watch("newPassword") || "";
  const active = watch("active");

  return (
    <Dialog open onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>แก้ไขบัญชีผู้ใช้</DialogTitle>
          <DialogDescription>@{user.username}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit((values) => {
            const patch: Partial<EditValues> = {
              displayName: values.displayName,
              role: values.role,
              active: values.active,
            };
            if (values.newPassword && values.newPassword.length > 0) {
              patch.newPassword = values.newPassword;
            }
            onSubmit(patch);
          })}
          className="space-y-3"
          noValidate
        >
          <div className="space-y-1">
            <Label htmlFor="eu-display">ชื่อ-สกุล</Label>
            <Input id="eu-display" {...register("displayName")} aria-invalid={!!errors.displayName} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="eu-role">บทบาท</Label>
            <Select value={role} onValueChange={(v) => setValue("role", v)}>
              <SelectTrigger id="eu-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SYSTEM_ROLES.map((r) => (
                  <SelectItem key={r.name} value={r.name}>
                    {roleLabel(r.name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="eu-active" className="font-medium">ใช้งานบัญชี</Label>
              <p className="text-xs text-muted-foreground">
                {active ? "บัญชีใช้งานได้ปกติ" : "บัญชีถูกระงับ — ไม่สามารถล็อกอินได้"}
              </p>
            </div>
            <input
              id="eu-active"
              type="checkbox"
              className="size-4 accent-emerald-600"
              checked={active}
              onChange={(e) => setValue("active", e.target.checked)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="eu-newpw">รีเซ็ตรหัสผ่าน (ว่าง = ไม่เปลี่ยน)</Label>
            <Input
              id="eu-newpw"
              type="password"
              autoComplete="new-password"
              {...register("newPassword")}
            />
            {newPassword ? <PasswordMeter role={role} password={newPassword} /> : null}
            {errors.newPassword ? (
              <p className="text-xs text-red-600">{errors.newPassword.message}</p>
            ) : null}
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={pending}>
              ยกเลิก
            </Button>
            <Button
              type="submit"
              className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={pending}
            >
              {pending ? "กำลังบันทึก…" : "บันทึก"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default UsersPage;

// Keep import alive.
void CheckCircle2;
