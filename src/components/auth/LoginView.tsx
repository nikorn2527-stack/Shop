"use client";

/**
 * LoginView — staff/manager login card shown by the Server-Component auth gate
 * at src/app/page.tsx when there are users in the DB but no active session.
 *
 * Form: react-hook-form + zod. Submits to POST /api/auth/login. On success we
 * call `router.refresh()` so the server re-evaluates the auth gate and routes
 * to either ForceChangeView (mustChangePassword) or the AppShell.
 *
 * Errors from the API (Thai business-rule messages like "ชื่อผู้ใช้หรือรหัสผ่าน
 * ไม่ถูกต้อง") are surfaced via sonner toasts at bottom-right.
 *
 * Members (สมาชิกสวัสดิการ) never log in — they use their member number at the
 * counter, hence the helper text under the form.
 */

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, LogIn, ShoppingBag } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiPost } from "@/lib/api-client";

const schema = z.object({
  username: z.string().min(1, "กรุณาระบุชื่อผู้ใช้"),
  password: z.string().min(1, "กรุณาระบุรหัสผ่าน"),
});

type FormValues = z.infer<typeof schema>;

interface LoginResponse {
  user: {
    id: string;
    username: string;
    displayName: string;
    role: string;
    mustChangePassword: boolean;
  };
}

export default function LoginView() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: "", password: "" },
  });

  const onSubmit = async (values: FormValues) => {
    setPending(true);
    try {
      const result = await apiPost<LoginResponse>("/api/auth/login", {
        username: values.username.trim().toLowerCase(),
        password: values.password,
      });
      toast.success(`ยินดีต้อนรับ คุณ${result.user.displayName}`);
      // Tell the server to re-evaluate the auth gate — it will render
      // ForceChangeView or AppShell depending on mustChangePassword.
      router.refresh();
    } catch (err) {
      toast.error("เข้าสู่ระบบไม่สำเร็จ", {
        description:
          err instanceof Error ? err.message : "เกิดข้อผิดพลาดบางอย่าง",
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-[#fcfbf7] p-4">
      <Card className="w-full max-w-md shadow-lg rounded-xl py-0 border-neutral-200/80">
        <CardContent className="p-8 space-y-6">
          <header className="flex flex-col items-center text-center space-y-3">
            <div className="size-14 rounded-2xl bg-emerald-600 text-white grid place-items-center shadow-sm">
              <ShoppingBag className="size-7" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h1 className="text-xl font-semibold tracking-tight">
                PNG Shop
              </h1>
              <p className="text-sm text-muted-foreground">
                ระบบร้านค้าสวัสดิการ
              </p>
            </div>
          </header>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="username">ชื่อผู้ใช้</Label>
              <Input
                id="username"
                autoComplete="username"
                autoFocus
                autoCapitalize="none"
                spellCheck={false}
                placeholder="กรอกชื่อผู้ใช้ของบัญชีเจ้าหน้าที่/ผู้บริหาร"
                aria-invalid={!!errors.username}
                {...register("username")}
              />
              {errors.username ? (
                <p className="text-xs text-red-600" role="alert">
                  {errors.username.message}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  ภาษาอังกฤษตัวพิมพ์เล็ก
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">รหัสผ่าน</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="กรอกรหัสผ่าน"
                  className="pr-10"
                  aria-invalid={!!errors.password}
                  {...register("password")}
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
              {errors.password && (
                <p className="text-xs text-red-600" role="alert">
                  {errors.password.message}
                </p>
              )}
            </div>

            <Button
              type="submit"
              disabled={pending}
              className="w-full bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              <LogIn size={16} aria-hidden="true" />
              {pending ? "กำลังตรวจสอบ…" : "เข้าสู่ระบบ"}
            </Button>
          </form>

          <p className="text-xs text-muted-foreground text-center leading-relaxed">
            สมาชิกสวัสดิการไม่ต้องเข้าระบบ — ใช้สิทธิ์ที่เคาน์เตอร์
          </p>
        </CardContent>
      </Card>

      <footer className="mt-6 text-center text-xs text-muted-foreground/80">
        PNG Shop · ระบบร้านค้าสวัสดิการ
      </footer>
    </main>
  );
}
