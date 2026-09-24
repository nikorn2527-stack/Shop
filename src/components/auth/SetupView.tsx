"use client";

/**
 * SetupView — first-run setup screen shown when no users exist in the DB yet
 * (db.user.count() === 0 on the server at src/app/page.tsx).
 *
 * Creates the primary administrator account via POST /api/auth/setup, then the
 * server returns a session + mustChangePassword=true. We call router.refresh()
 * so the server re-evaluates and renders ForceChangeView next.
 *
 * Footer note ("หลังตั้งค่า ระบบจะให้คุณเปลี่ยนรหัสผ่านอีกครั้งก่อนเริ่มใช้งาน")
 * makes that flow obvious to the user.
 */

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, LogIn, ShoppingBag, Store } from "lucide-react";
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

// Administrator policy: min 12, needs symbol — mirrors server-side validatePassword.
const ADMIN_POLICY = passwordPolicyForRole("administrator");

const schema = z
  .object({
    storeName: z.string().max(120).optional(),
    username: z
      .string()
      .min(3, "ชื่อผู้ใช้ต้องยาวอย่างน้อย 3 ตัวอักษร")
      .max(30, "ชื่อผู้ใช้ยาวเกินไป")
      .regex(
        /^[a-z0-9_.]+$/,
        "ภาษาอังกฤษตัวพิมพ์เล็ก ตัวเลข จุด ขีดล่าง เท่านั้น",
      ),
    displayName: z
      .string()
      .min(1, "กรุณาระบุชื่อ-นามสกุล")
      .max(80, "ชื่อยาวเกินไป"),
    password: z.string().min(1, "กรุณาระบุรหัสผ่าน"),
    confirmPassword: z.string().min(1, "กรุณายืนยันรหัสผ่าน"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "รหัสผ่านทั้งสองช่องไม่ตรงกัน",
    path: ["confirmPassword"],
  })
  .refine((data) => passwordIssues(data.password, ADMIN_POLICY).length === 0, {
    message: passwordIssues("", ADMIN_POLICY)[0],
    path: ["password"],
  });

type FormValues = z.infer<typeof schema>;

interface SetupResponse {
  user: {
    id: string;
    username: string;
    displayName: string;
    role: string;
    mustChangePassword: boolean;
  };
}

export default function SetupView() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      storeName: "",
      username: "",
      displayName: "",
      password: "",
      confirmPassword: "",
    },
  });

  const password = watch("password");

  const onSubmit = async (values: FormValues) => {
    // Final client-side strength gate (mirrors server's validatePassword).
    const issues = passwordIssues(values.password, ADMIN_POLICY);
    if (issues.length > 0) {
      toast.error("รหัสผ่านไม่ผ่านเงื่อนไข", { description: issues.join(" · ") });
      return;
    }
    if (values.password !== values.confirmPassword) {
      toast.error("รหัสผ่านทั้งสองช่องไม่ตรงกัน");
      return;
    }
    setPending(true);
    try {
      const result = await apiPost<SetupResponse>("/api/auth/setup", {
        username: values.username.trim().toLowerCase(),
        displayName: values.displayName.trim(),
        password: values.password,
        storeName: values.storeName?.trim() || undefined,
      });
      toast.success(`สร้างบัญชีผู้ดูแล "${result.user.displayName}" แล้ว`);
      router.refresh();
    } catch (err) {
      toast.error("ตั้งค่าระบบไม่สำเร็จ", {
        description:
          err instanceof Error ? err.message : "เกิดข้อผิดพลาดบางอย่าง",
      });
    } finally {
      setPending(false);
    }
  }

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
                ตั้งค่าระบบครั้งแรก
              </h1>
              <p className="text-sm text-muted-foreground">
                สร้างบัญชีผู้ดูแลระบบหลัก
              </p>
            </div>
          </header>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="storeName">ชื่อร้าน (ไม่บังคับ)</Label>
              <div className="relative">
                <Store
                  size={15}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id="storeName"
                  className="pl-9"
                  maxLength={80}
                  placeholder="เช่น ร้านค้าสวัสดิการ บจก."
                  {...register("storeName")}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="username">
                ชื่อผู้ใช้ <span className="text-red-500">*</span>
              </Label>
              <Input
                id="username"
                autoComplete="username"
                autoFocus
                autoCapitalize="none"
                spellCheck={false}
                maxLength={30}
                placeholder="เช่น owner"
                aria-invalid={!!errors.username}
                {...register("username")}
              />
              {errors.username ? (
                <p className="text-xs text-red-600" role="alert">
                  {errors.username.message}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  ภาษาอังกฤษหรือตัวเลข · ใช้เข้าสู่ระบบทุกครั้ง
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="displayName">
                ชื่อ-นามสกุลที่แสดง <span className="text-red-500">*</span>
              </Label>
              <Input
                id="displayName"
                placeholder="เช่น วรพจน์ ใจดี"
                aria-invalid={!!errors.displayName}
                {...register("displayName")}
              />
              {errors.displayName && (
                <p className="text-xs text-red-600" role="alert">
                  {errors.displayName.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">
                รหัสผ่าน <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder={`อย่างน้อย ${ADMIN_POLICY.min} ตัวอักษร · มีตัวอักษร ตัวเลข และสัญลักษณ์`}
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
              <PasswordMeter password={password} role="administrator" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">
                ยืนยันรหัสผ่าน <span className="text-red-500">*</span>
              </Label>
              <Input
                id="confirmPassword"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="พิมพ์รหัสผ่านซ้ำอีกครั้ง"
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
              <LogIn size={16} aria-hidden="true" />
              {pending ? "กำลังสร้างบัญชี…" : "ลงทะเบียนและเริ่มใช้งาน"}
            </Button>
          </form>

          <p className="text-xs text-muted-foreground text-center leading-relaxed">
            หลังตั้งค่า ระบบจะให้คุณเปลี่ยนรหัสผ่านอีกครั้งก่อนเริ่มใช้งาน
          </p>
        </CardContent>
      </Card>

      <footer className="mt-6 text-center text-xs text-muted-foreground/80">
        PNG Shop · ระบบร้านค้าสวัสดิการ
      </footer>
    </main>
  );
}
