"use client";

/**
 * AppShell — temporary placeholder for the authenticated dashboard.
 *
 * This is the next-to-render component after the auth gate succeeds. It will
 * be replaced in a later task with the real POS layout (sidebar + topbar +
 * module routes). For now we just show a friendly placeholder + logout button
 * so the auth flow can be exercised end-to-end.
 *
 * Logout: POST /api/auth/logout → router.refresh() so the server re-evaluates
 * the auth gate and renders LoginView again.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, ShoppingBag } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { apiPost } from "@/lib/api-client";
import { roleLabel } from "@/lib/rbac";

export interface AppShellUser {
  id: string;
  username: string;
  displayName: string;
  role: string;
  mustChangePassword: boolean;
}

interface AppShellProps {
  user: AppShellUser;
}

export default function AppShell({ user }: AppShellProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const handleLogout = async () => {
    if (pending) return;
    setPending(true);
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
      setPending(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-lg bg-emerald-600 text-white grid place-items-center">
              <ShoppingBag className="size-4" aria-hidden="true" />
            </div>
            <span className="font-semibold tracking-tight">PNG Shop</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex flex-col items-end text-right">
              <span className="text-sm font-medium leading-none">
                {user.displayName}
              </span>
              <span className="text-xs text-muted-foreground leading-none mt-0.5">
                {roleLabel(user.role)}
              </span>
            </div>
            <span className="size-8 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center text-sm font-medium">
              {user.displayName.slice(0, 1)}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              disabled={pending}
            >
              <LogOut size={14} aria-hidden="true" />
              <span className="hidden sm:inline">ออกจากระบบ</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="text-center space-y-3 max-w-md">
          <div className="size-12 mx-auto rounded-xl bg-emerald-50 text-emerald-700 grid place-items-center">
            <ShoppingBag className="size-6" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            POS dashboard placeholder
          </h1>
          <p className="text-sm text-muted-foreground">
            สวัสดี <b className="text-foreground">{user.displayName}</b> —
            ยินดีต้อนรับสู่ PNG Shop
            <br />
            แดชบอร์ดหลักจะถูกพัฒนาต่อในขั้นถัดไป
          </p>
        </div>
      </main>

      <footer className="mt-auto border-t bg-card px-4 sm:px-6 py-3">
        <div className="mx-auto max-w-5xl flex items-center justify-between text-xs text-muted-foreground">
          <span>PNG Shop · ระบบร้านค้าสวัสดิการ</span>
          <span>พัฒนาโดย PNG TEAM</span>
        </div>
      </footer>
    </div>
  );
}
