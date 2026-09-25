/**
 * View routing — single source of truth for the AppShell sidebar navigation,
 * client-side role gating, and Thai labels.
 *
 * Mirrors `/tmp/Shop/client/src/pages/pageData.ts` but adapted to the new RBAC
 * model in `src/lib/rbac.ts` (cashier/stock_officer/supervisor/manager/auditor/
 * administrator/dev_service) instead of the legacy staff/admin/dev trio.
 */

import {
  Activity,
  Clock,
  LayoutDashboard,
  PackageSearch,
  Settings2,
  ShoppingCart,
  UserCog,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { SYSTEM_ROLES } from "@/lib/rbac";

export type View =
  | "dashboard"
  | "pos"
  | "stock"
  | "shift"
  | "members"
  | "reports"
  | "settings"
  | "logs"
  | "users";

export interface NavItem {
  id: View;
  label: string;
  caption: string;
  icon: LucideIcon;
  /** Section grouping in the sidebar (main / admin). */
  section: "main" | "admin";
}

export const NAV_ITEMS: NavItem[] = [
  {
    id: "dashboard",
    label: "ภาพรวม",
    caption: "สรุปการดำเนินงาน",
    icon: LayoutDashboard,
    section: "main",
  },
  {
    id: "pos",
    label: "หน้าร้าน / POS",
    caption: "ขายสินค้าและรับชำระ",
    icon: ShoppingCart,
    section: "main",
  },
  {
    id: "stock",
    label: "สต็อกสินค้า",
    caption: "รับเข้าและนับสต็อก",
    icon: PackageSearch,
    section: "main",
  },
  {
    id: "shift",
    label: "กะขาย",
    caption: "เปิดกะ · ปิดกะ · นับเงิน",
    icon: Clock,
    section: "main",
  },
  {
    id: "members",
    label: "สมาชิกและบัญชี",
    caption: "สมาชิกและเจ้าหน้าที่",
    icon: UsersRound,
    section: "main",
  },
  {
    id: "reports",
    label: "รายงาน",
    caption: "วิเคราะห์และส่งออก",
    icon: Activity,
    section: "main",
  },
  {
    id: "settings",
    label: "ตั้งค่า",
    caption: "ตั้งค่าร้านค้าและระบบ",
    icon: Settings2,
    section: "admin",
  },
  {
    id: "users",
    label: "ผู้ใช้ระบบ",
    caption: "บัญชีผู้ใช้และสิทธิ์",
    icon: UserCog,
    section: "admin",
  },
  {
    id: "logs",
    label: "ระบบ Log",
    caption: "บันทึกการทำธุรกรรม",
    icon: Activity,
    section: "admin",
  },
];

export const ADMIN_VIEWS: ReadonlySet<View> = new Set<View>([
  "settings",
  "users",
  "logs",
]);

/** Roles considered "admin-level" — they can access admin views. */
export const ADMIN_ROLES = new Set<string>(["administrator", "manager", "dev_service"]);

export function isAdminRole(role: string): boolean {
  return ADMIN_ROLES.has(role);
}

/** Map a view + role pair to whether the user may open that view. */
export function canAccessView(role: string, view: View): boolean {
  if (!ADMIN_VIEWS.has(view)) return true;
  return isAdminRole(role);
}

/** Friendly Thai label for the breadcrumb when a view is active. */
export function viewLabel(view: View): string {
  return NAV_ITEMS.find((item) => item.id === view)?.label ?? "ภาพรวม";
}

/**
 * Resolve the safe view to render. If the user lacks permission for the requested
 * view, fall back to the dashboard.
 */
export function resolveView(role: string, requested: View): View {
  return canAccessView(role, requested) ? requested : "dashboard";
}

/** Selectable roles for the create-user modal — excludes dev_service. */
export function selectableRoles(): { name: string; label: string }[] {
  return SYSTEM_ROLES.map((r) => ({ name: r.name, label: r.label }));
}
