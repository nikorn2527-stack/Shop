"use client";

/**
 * ForceChangeView — full-screen "must change password" card.
 *
 * Rendered by the Server-Component auth gate when `session.user.mustChangePassword`
 * is true. The user cannot reach the AppShell until they set a fresh password
 * (covers both first-run setup and admin-issued temporary passwords).
 *
 * On success: `router.refresh()` so the server re-evaluates the gate and
 * proceeds to AppShell.
 *
 * A small "ออกจากระบบ" button at the bottom posts `/api/auth/logout` and
 * refreshes — the only escape hatch besides completing the change.
 */

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, KeyRound, LogOut, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiPost } from "@/lib/api-client";
import PasswordMeter, {
  passwordIssues,
  passwordPolicyForRole,
} from "@/components/PasswordMeter";
import { roleLabel } from "@/lib/rbac";

export interface ForceChangeUser {
  id: string;
  username: string;
  displayName: string;
  role: string;
  mustChangePassword: boolean;
}

interface ForceChangeViewProps {
  user: ForceChangeUser;
}

export default function ForceChangeView({ user }: ForceChangeViewProps) {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [pendingLogout, setPendingLogout] = useState(false);

  const policy = passwordPolicyForRole(user.role);

  const schema = z
    .object({
      currentPassword: z.string().min(1, "กรุณากรอกรหัสผ่านปัจจุบัน"),
      newPassword: z.string().min(1, "กรุณากรอกรหัสผ่านใหม่"),
      confirmPassword: z.string().min(1, "กรุณายืนยันรหัสผ่านใหม่"),
    })
    .refine((data) => data.newPassword !== data.currentPassword, {
      message: "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านปัจจุบัน",
      path: ["newPassword"],
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
      message: "รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน",
      path: ["confirmPassword"],
    })
    .refine(
      (data) => passwordIssues(data.newPassword, policy).length === 0,
      {
        message: passwordIssues("", policy)[0],
        path: ["newPassword"],
      },
    );

  type FormValues = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  const newPassword = watch("newPassword");

  const onSubmit = async (values: FormValues) => {
    const issues = passwordIssues(values.newPassword, policy);
    if (issues.length > 0) {
      toast.error("รหัสผ่านใหม่ไม่ผ่านเงื่อนไข", {
        description: issues.join(" · "),
      });
      return;
    }
    setPending(true);
    try {
      await apiPost<{ success: boolean }>("/api/auth/change-password", {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      toast.success("เปลี่ยนรหัสผ่านสำเร็จ · อุปกรณ์อื่นถูกออกจากระบบ");
      router.refresh();
    } catch (err) {
      toast.error("เปลี่ยนรหัสผ่านไม่สำเร็จ", {
        description:
          err instanceof Error ? err.message : "เกิดข้อผิดพลาดบางอย่าง",
      });
    } finally {
      setPending(false);
    }
  };

  const handleLogout = async () => {
    if (pendingLogout) return;
    setPendingLogout(true);
    try {
      await apiPost<{ success: boolean }>("/api/auth/logout", {});
      toast.success("ออกจากระบบแล้ว");
      router.refresh();
    } catch (err) {
      toast.error("ออกจากระบบไม่สำเร็จ", {
        description:
          err instanceof Error ? err.message : "เกิดข้อผิดพลาดบางอย่าง",
      });
    } finally {
      setPendingLogout(false);
    }
  };

  const initial = (user.displayName || user.username || "ผ").slice(0, 1);
  const roleText = roleLabel(user.role);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-[#fcfbf7] p-4">
      <Card className="w-full max-w-md shadow-lg rounded-xl py-0 border-neutral-200/80">
        <CardContent className="p-8 space-y-6">
          <header className="flex flex-col items-center text-center space-y-3">
            <div className="size-14 rounded-2xl bg-amber-500 text-white grid place-items-center shadow-sm">
              <ShieldAlert className="size-7" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h1 className="text-xl font-semibold tracking-tight">
                กรุณาเปลี่ยนรหัสผ่านก่อนเริ่มใช้งาน
              </h1>
              <p className="text-sm text-muted-foreground">
                บัญชีนี้ใช้รหัสผ่านชั่วคราว — ตั้งรหัสผ่านใหม่เพื่อความปลอดภัย
              </p>
            </div>
          </header>

          <div className="flex items-center gap-3 rounded-lg bg-muted/60 p-3">
            <span className="size-10 rounded-full bg-emerald-600 text-white grid place-items-center font-semibold shrink-0">
              {initial}
            </span>
            <div className="min-w-0">
              <p className="font-medium truncate">{user.displayName}</p>
              <p className="text-xs text-muted-foreground truncate">
                @{user.username} · {roleText}
              </p>
            </div>
          </div>

          <form
            onSubmit={handleSubmit(onSubmit)}
            className="space-y-4"
            noValidate
          >
            <div className="space-y-2">
              <Label htmlFor="currentPassword">
                รหัสผ่านปัจจุบัน <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                <Input
                  id="currentPassword"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  autoFocus
                  placeholder="รหัสผ่านที่ได้รับ / ใช้อยู่ในตอนนี้"
                  className="pr-10"
                  aria-invalid={!!errors.currentPassword}
                  {...register("currentPassword")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 size-7 grid place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff size={15} aria-hidden="true" />
                  ) : (
                    <Eye size={15} aria-hidden="true" />
                  )}
                </button>
              </div>
              {errors.currentPassword && (
                <p className="text-xs text-red-600" role="alert">
                  {errors.currentPassword.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="newPassword">
                รหัสผ่านใหม่ <span className="text-red-500">*</span>
              </Label>
              <Input
                id="newPassword"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder={`อย่างน้อย ${policy.min} ตัวอักษร${
                  policy.needSymbol ? " · มีสัญลักษณ์" : ""
                }`}
                aria-invalid={!!errors.newPassword}
                {...register("newPassword")}
              />
              {errors.newPassword && (
                <p className="text-xs text-red-600" role="alert">
                  {errors.newPassword.message}
                </p>
              )}
              <PasswordMeter password={newPassword} role={user.role} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">
                ยืนยันรหัสผ่านใหม่ <span className="text-red-500">*</span>
              </Label>
              <Input
                id="confirmPassword"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="พิมพ์รหัสผ่านใหม่ซ้ำอีกครั้ง"
                aria-invalid={!!errors.confirmPassword}
                {...register("confirmPassword")}
              />
              {errors.confirmPassword && (
                <p className="text-xs text-red-600" role="alert">
                  {errors.confirmPassword.message}
                </p>
              )}
            </div>

            <Button
              type="submit"
              disabled={pending}
              className="w-full bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              <KeyRound size={16} aria-hidden="true" />
              {pending ? "กำลังบันทึก…" : "บันทึกรหัสผ่านใหม่"}
            </Button>
          </form>

          <p className="text-xs text-muted-foreground text-center leading-relaxed">
            เปลี่ยนรหัสผ่านสำเร็จแล้ว ระบบจะออกจากระบบของอุปกรณ์อื่นทุกเครื่องของบัญชีนี้
            ให้เหลือเฉพาะเครื่องที่คุณใช้อยู่
          </p>

          <div className="border-t pt-4">
            <button
              type="button"
              onClick={handleLogout}
              disabled={pendingLogout}
              className="mx-auto flex items-center gap-1.5 text-xs text-muted-foreground hover:text-red-600 disabled:opacity-50 transition-colors"
            >
              <LogOut size={13} aria-hidden="true" />
              ออกจากระบบ
            </button>
          </div>
        </CardContent>
      </Card>

      <footer className="mt-6 text-center text-xs text-muted-foreground/80">
        PNG Shop · ระบบร้านค้าสวัสดิการ
      </footer>
    </main>
  );
}
