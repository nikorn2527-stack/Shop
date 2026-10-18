import { useEffect } from "react";
import { LoginView } from "@/components/LoginView";
import { SetupView } from "@/components/SetupView";
import { ForceChangeView } from "@/components/ForceChangeView";
import { trpc } from "@/lib/trpc";
// V2-B — AppShell extracted to layouts/AppShell.tsx (sidebar + topbar + view switch).
import { AppShell } from "../layouts/AppShell";
import { applyBrand, applyCachedBrand } from "../theme";
// V2-C3 — Reports view (sales summary + bills + member tx + stock balance +
// member balances) extracted to its own file next to TimelineDrilldown.
import { Reports } from "./reports/Reports";
// Members and Logs are passed to AppShell via the viewComponents prop below.
import { Members } from "./members/Members";
import { Logs } from "./settings/Logs";
// V2-C4 — Settings view (brand/receipt/member-number/payment/pos-menu/cutoff/
// roles/edition/backup/import/install/dev-tools/go-live) extracted to its own
// file next to Logs.
import { Settings } from "./settings/Settings";

export {
  addScannedItem,
  calculateCartSubtotal,
  canAccessView,
  formatMemberNumber,
  isStockAlert,
} from "./pageData";

/** Auth gate: session check (auth.me) → splash → first-time setup → login view → forced password change → app shell. */
export default function Home() {
  const authQuery = trpc.auth.me.useQuery();
  // ROUND 25 — แบรนด์ (ชื่อ/โลโก้/สี) โหลดจาก settings สาธารณะ ใช้ทั้งก่อน/หลัง login
  const brandQuery = trpc.settings.brand.useQuery();
  // ROUND 36 (ข้อ 31) — สถานะลงทะเบียนครั้งแรก (ฐานข้อมูลยังไม่มีบัญชีผู้ใช้เลย)
  // ถามเฉพาะตอนยังไม่มีเซสชัน เพื่อไม่ให้ทุก request ไปนับตาราง app_users
  const setupStatusQuery = trpc.auth.setupStatus.useQuery(undefined, {
    enabled: !authQuery.data,
  });
  useEffect(() => {
    applyCachedBrand(); // ธีมที่จำไว้ ใช้ทันทีตอนบูต กันกระพริบ
  }, []);
  useEffect(() => {
    applyBrand(brandQuery.data);
  }, [brandQuery.data]);
  if (authQuery.isLoading) {
    return (
      <div className="auth-splash">
        <div className="brand-mark">
          <span>ส</span>
        </div>
        <p>กำลังตรวจสอบสิทธิ์การใช้งาน…</p>
      </div>
    );
  }
  const user = authQuery.data;
  if (!user) {
    // ระบบใหม่ที่ยังไม่มีบัญชีผู้ใช้ → หน้าลงทะเบียนผู้บริหารหลักก่อนเข้าสู่ระบบ
    if (setupStatusQuery.data?.needsSetup) {
      return (
        <SetupView
          brand={brandQuery.data}
          onAuthed={() => {
            void authQuery.refetch();
            void setupStatusQuery.refetch();
          }}
        />
      );
    }
    return (
      <LoginView
        brand={brandQuery.data}
        onAuthed={() => void authQuery.refetch()}
      />
    );
  }
  // ROUND 36 — บัญชีที่ยังต้องเปลี่ยนรหัสผ่าน (ลงทะเบียนครั้งแรก/ผู้บริหารตั้งรหัสให้)
  // ต้องเปลี่ยนก่อนจึงจะไปหน้าหลักได้ — ไม่มีทางข้าม
  if (user.mustChangePassword) {
    return (
      <ForceChangeView
        user={user}
        brand={brandQuery.data}
        onDone={() => void authQuery.refetch()}
        onLogout={() => void authQuery.refetch()}
      />
    );
  }
  return (
    <AppShell
      user={user}
      brand={brandQuery.data}
      onLogout={() => void authQuery.refetch()}
      viewComponents={{ Members, Reports, Settings, Logs }}
    />
  );
}
