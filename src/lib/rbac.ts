/**
 * RBAC — Role-Based Access Control with granular permissions.
 *
 * Per Technical Review Section 8:
 *   - Roles: cashier, stock_officer, supervisor, manager, auditor, administrator (+ dev service mode)
 *   - Permissions grouped: POS, STOCK, REPORT, MEMBER, SYSTEM
 *
 * Roles + permissions are seeded to DB on first run. System roles (isSystem=true)
 * cannot be deleted but their permission set can be edited.
 */

export type PermissionKey =
  // POS
  | 'POS.SELL'
  | 'POS.VOID'
  | 'POS.REFUND'
  | 'POS.DISCOUNT'
  | 'POS.SPECIAL'
  // STOCK
  | 'STOCK.VIEW'
  | 'STOCK.RECEIVE'
  | 'STOCK.ADJUST'
  | 'STOCK.COUNT'
  | 'STOCK.TRANSFER'
  // REPORT
  | 'REPORT.SALES'
  | 'REPORT.PROFIT'
  | 'REPORT.INVENTORY'
  | 'REPORT.AUDIT'
  | 'REPORT.ADVANCED'
  // MEMBER
  | 'MEMBER.VIEW'
  | 'MEMBER.EDIT'
  | 'MEMBER.WALLET'
  | 'MEMBER.DELETE'
  | 'MEMBER.LIMIT_APPROVE'
  // SYSTEM
  | 'SYSTEM.USER_MANAGE'
  | 'SYSTEM.ROLE_MANAGE'
  | 'SYSTEM.BACKUP'
  | 'SYSTEM.RESTORE'
  | 'SYSTEM.SETTING'
  | 'SYSTEM.LICENSE'
  | 'SYSTEM.UPDATE'
  | 'SYSTEM.SESSION_REVOKE'

export type PermissionGroup = 'POS' | 'STOCK' | 'REPORT' | 'MEMBER' | 'SYSTEM'

export interface PermissionDef {
  key: PermissionKey
  group: PermissionGroup
  description: string
}

export const PERMISSION_CATALOG: PermissionDef[] = [
  // POS
  { key: 'POS.SELL', group: 'POS', description: 'ขายสินค้าและรับชำระ' },
  { key: 'POS.VOID', group: 'POS', description: 'ยกเลิกบิล' },
  { key: 'POS.REFUND', group: 'POS', description: 'คืนเงิน / คืนบัตรเงินสด' },
  { key: 'POS.DISCOUNT', group: 'POS', description: 'ให้ส่วนลดบิล' },
  { key: 'POS.SPECIAL', group: 'POS', description: 'เปิดรายการพิเศษ (นอกแค็ตตาล็อก)' },
  // STOCK
  { key: 'STOCK.VIEW', group: 'STOCK', description: 'ดูสต็อก' },
  { key: 'STOCK.RECEIVE', group: 'STOCK', description: 'รับสินค้าเข้า' },
  { key: 'STOCK.ADJUST', group: 'STOCK', description: 'ปรับยอดสต็อก' },
  { key: 'STOCK.COUNT', group: 'STOCK', description: 'นับสต็อก' },
  { key: 'STOCK.TRANSFER', group: 'STOCK', description: 'โอนสินค้าระหว่างคลัง' },
  // REPORT
  { key: 'REPORT.SALES', group: 'REPORT', description: 'ดูรายงานยอดขาย' },
  { key: 'REPORT.PROFIT', group: 'REPORT', description: 'ดูรายงานกำไร/ต้นทุน' },
  { key: 'REPORT.INVENTORY', group: 'REPORT', description: 'ดูรายงานสินค้าคงคลัง' },
  { key: 'REPORT.AUDIT', group: 'REPORT', description: 'ดู audit log' },
  { key: 'REPORT.ADVANCED', group: 'REPORT', description: 'รายงานขั้นสูง (BI, ABC, Slow/Fast)' },
  // MEMBER
  { key: 'MEMBER.VIEW', group: 'MEMBER', description: 'ดูข้อมูลสมาชิก' },
  { key: 'MEMBER.EDIT', group: 'MEMBER', description: 'แก้ข้อมูลสมาชิก' },
  { key: 'MEMBER.WALLET', group: 'MEMBER', description: 'เติม/ถอนเงินสมาชิก' },
  { key: 'MEMBER.DELETE', group: 'MEMBER', description: 'ลบสมาชิก' },
  { key: 'MEMBER.LIMIT_APPROVE', group: 'MEMBER', description: 'พิจารณาคำขอลดวงเงินสมาชิก' },
  // SYSTEM
  { key: 'SYSTEM.USER_MANAGE', group: 'SYSTEM', description: 'จัดการบัญชีผู้ใช้' },
  { key: 'SYSTEM.ROLE_MANAGE', group: 'SYSTEM', description: 'จัดการ Role/Permission' },
  { key: 'SYSTEM.BACKUP', group: 'SYSTEM', description: 'สำรองข้อมูล' },
  { key: 'SYSTEM.RESTORE', group: 'SYSTEM', description: 'กู้คืนข้อมูล' },
  { key: 'SYSTEM.SETTING', group: 'SYSTEM', description: 'ตั้งค่าระบบ' },
  { key: 'SYSTEM.LICENSE', group: 'SYSTEM', description: 'จัดการลิขสิทธิ์' },
  { key: 'SYSTEM.UPDATE', group: 'SYSTEM', description: 'อัปเดตระบบ' },
  { key: 'SYSTEM.SESSION_REVOKE', group: 'SYSTEM', description: 'ยกเลิก session' },
]

export interface RoleDef {
  name: string
  label: string
  description: string
  isSystem: boolean
  permissions: PermissionKey[]
}

/**
 * System roles seeded on first run.
 * Customer admins can create custom roles afterwards (with isSystem=false).
 */
export const SYSTEM_ROLES: RoleDef[] = [
  {
    name: 'cashier',
    label: 'พนักงานขายหน้าร้าน',
    description: 'เจ้าหน้าที่หน้า POS — ขาย พักบิล รับเงิน',
    isSystem: true,
    permissions: [
      'POS.SELL', 'POS.DISCOUNT', 'POS.SPECIAL',
      'STOCK.VIEW',
      'REPORT.SALES',
      'MEMBER.VIEW', 'MEMBER.WALLET',
    ],
  },
  {
    name: 'stock_officer',
    label: 'เจ้าหน้าที่คลังสินค้า',
    description: 'ดูแลรับเข้า ปรับยอด นับสต็อก',
    isSystem: true,
    permissions: [
      'STOCK.VIEW', 'STOCK.RECEIVE', 'STOCK.ADJUST', 'STOCK.COUNT',
      'REPORT.INVENTORY',
      'MEMBER.VIEW',
    ],
  },
  {
    name: 'supervisor',
    label: 'หัวหน้างาน',
    description: 'ดูแลหน้าร้าน + อนุมัติการเงินสำคัญ',
    isSystem: true,
    permissions: [
      'POS.SELL', 'POS.VOID', 'POS.REFUND', 'POS.DISCOUNT', 'POS.SPECIAL',
      'STOCK.VIEW', 'STOCK.RECEIVE', 'STOCK.ADJUST', 'STOCK.COUNT',
      'REPORT.SALES', 'REPORT.INVENTORY',
      'MEMBER.VIEW', 'MEMBER.EDIT', 'MEMBER.WALLET', 'MEMBER.LIMIT_APPROVE',
    ],
  },
  {
    name: 'manager',
    label: 'ผู้จัดการ',
    description: 'ดูรายงานครบ + อนุมัติคำขอลดวงเงิน + จัดการผู้ใช้บางส่วน',
    isSystem: true,
    permissions: [
      'POS.SELL', 'POS.VOID', 'POS.REFUND', 'POS.DISCOUNT', 'POS.SPECIAL',
      'STOCK.VIEW', 'STOCK.RECEIVE', 'STOCK.ADJUST', 'STOCK.COUNT', 'STOCK.TRANSFER',
      'REPORT.SALES', 'REPORT.PROFIT', 'REPORT.INVENTORY', 'REPORT.AUDIT',
      'MEMBER.VIEW', 'MEMBER.EDIT', 'MEMBER.WALLET', 'MEMBER.DELETE', 'MEMBER.LIMIT_APPROVE',
      'SYSTEM.USER_MANAGE', 'SYSTEM.BACKUP',
    ],
  },
  {
    name: 'auditor',
    label: 'ผู้ตรวจสอบ',
    description: 'ดู audit log + รายงาน + ประวัติ แต่ไม่แก้ไข',
    isSystem: true,
    permissions: [
      'STOCK.VIEW',
      'REPORT.SALES', 'REPORT.PROFIT', 'REPORT.INVENTORY', 'REPORT.AUDIT',
      'MEMBER.VIEW',
    ],
  },
  {
    name: 'administrator',
    label: 'ผู้ดูแลระบบ',
    description: 'สิทธิ์เต็ม — ตั้งค่า ลิขสิทธิ์ สำรองข้อมูล อัปเดตระบบ',
    isSystem: true,
    permissions: PERMISSION_CATALOG.map(p => p.key),
  },
]

/** Dev service mode — temporary admin-level access with expiry. */
export const DEV_ROLE_NAME = 'dev_service'
export const DEV_ROLE_LABEL = 'โหมดบริการชั่วคราว (ผู้พัฒนา)'

export function roleLabel(name: string): string {
  const found = SYSTEM_ROLES.find(r => r.name === name)
  if (found) return found.label
  if (name === DEV_ROLE_NAME) return DEV_ROLE_LABEL
  return name
}

/** Check if a user with given role has a permission. Looks up DB-cached role+permission at runtime. */
export function hasPermission(cached: Set<string>, key: PermissionKey): boolean {
  return cached.has(key)
}

/** Helper: user must have ANY of the listed permissions. */
export function hasAnyPermission(cached: Set<string>, keys: PermissionKey[]): boolean {
  return keys.some(k => cached.has(k))
}
