/** Database-independent business contracts. No database clients or server runtime imports. */

/** Login account role for the welfare store app itself (local session auth). */
export type AppUserRole = "staff" | "admin" | "dev";

export type PermissionKey =
  | "POS.SELL"
  | "POS.VOID"
  | "POS.REFUND"
  | "POS.DISCOUNT"
  | "POS.SPECIAL"
  | "STOCK.VIEW"
  | "STOCK.RECEIVE"
  | "STOCK.ADJUST"
  | "STOCK.COUNT"
  | "STOCK.TRANSFER"
  | "REPORT.SALES"
  | "REPORT.PROFIT"
  | "REPORT.INVENTORY"
  | "REPORT.AUDIT"
  | "REPORT.ADVANCED"
  | "MEMBER.VIEW"
  | "MEMBER.EDIT"
  | "MEMBER.WALLET"
  | "MEMBER.DELETE"
  | "SYSTEM.USER_MANAGE"
  | "SYSTEM.ROLE_MANAGE"
  | "SYSTEM.BACKUP"
  | "SYSTEM.RESTORE"
  | "SYSTEM.SETTING"
  | "SYSTEM.LICENSE"
  | "SYSTEM.UPDATE"
  | "SYSTEM.SESSION_REVOKE";

/** Login account for the welfare store app itself (local session auth). */
export type AppUser = {
  id: number;
  username: string;
  passwordHash: string;
  displayName: string;
  role: AppUserRole;
  active: number;
  createdAt: string;
  failedAttempts: number;
  lockedUntil: string | null;
  /** ROUND 36 (ข้อ 31) — 1 = ต้องเปลี่ยนรหัสผ่านก่อนเริ่มใช้งาน (บัญชีใหม่/รหัสที่ผู้บริหารตั้งให้) */
  mustChangePassword: number;
};

export type LoginFailureOutcome = {
  attempts: number;
  lockedUntil: string | null;
  justLocked: boolean;
};

/** Active session without internal ids — safe to return to clients. */
export type AppSessionSummary = {
  sessionId: string;
  username: string;
  displayName: string;
  role: AppUserRole;
  active: number;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
};

/** AppUser without the password hash — safe to return to clients. */
export type AppUserSummary = {
  id: number;
  username: string;
  displayName: string;
  role: AppUserRole;
  active: number;
  createdAt: string;
  failedAttempts: number;
  lockedUntil: string | null;
  /** ROUND 36 (ข้อ 31) — 1 = บัญชีนี้ยังต้องเปลี่ยนรหัสผ่านก่อนเริ่มใช้งาน */
  mustChangePassword: number;
};

export type CreateAppUserInput = {
  username: string;
  password: string;
  displayName: string;
  role: AppUserRole;
  actor?: string;
  actorRole?: string | null;
};

export type SetupInitialAdminInput = {
  username: string;
  displayName: string;
  password: string;
  storeName?: string;
};

export type ChangeOwnPasswordInput = {
  userId: number;
  currentPassword: string;
  newPassword: string;
  /** เซสชันที่ผู้ใช้กำลังใช้อยู่ (จากคุกกี้) — จะไม่ถูกยกเลิกไปด้วย */
  keepSessionId?: string;
  actor?: string;
  actorRole?: string | null;
};

export type UpdateAppUserInput = {
  userId: number;
  displayName?: string;
  role?: AppUserRole;
  active?: boolean;
  password?: string;
  actor?: string;
  actorRole?: string | null;
};
