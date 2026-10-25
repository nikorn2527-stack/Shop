/** Database-independent business contracts. No database clients or server runtime imports. */

export type AuditLog = {
  id: number;
  action: string;
  actor: string;
  actorRole: string | null;
  detail: string;
  tone: string;
  createdAt: string;
};

export type DailySalesRow = {
  date: string;
  orders: number;
  items: number;
  revenue: number;
  cogs: number;
  profit: number;
  marginPct: number;
};

export type DashboardStats = {
  rangeDays: number;
  totalSales: number;
  totalOrders: number;
  itemsSold: number;
  bestSellerCount: number;
  avgDailySales: number;
  revenueByDay: { date: string; total: number }[];
  bestSellers: { name: string; qty: number; revenue: number }[];
  lowStock: {
    id: number;
    sku: string;
    name: string;
    unit: string;
    stock: number;
    reorderPoint: number;
  }[];
  expirySoon: {
    id: number;
    productId: number;
    sku: string;
    name: string;
    unit: string;
    lot: string;
    expiry: string;
    qty: number;
  }[];
  recentActivities: AuditLog[];
  memberWalletTotal: number;
  memberCount: { total: number; active: number; suspended: number };
};

export type DailyRangeInput = {
  days?: number;
  from?: string;
  to?: string;
  cashier?: string;
  cashiers?: string[];
  categories?: string[];
};

export type SalesByCategoryRow = {
  category: string;
  orders: number;
  qty: number;
  revenue: number;
  cogs: number;
  profit: number;
  marginPct: number;
};

export type SalesByProductRow = {
  productId: number | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  category: string | null;
  bills: number;
  qty: number;
  revenue: number;
  cogs: number;
  profit: number;
  marginPct: number;
};

/**
 * ROUND 48 (user) — รายงาน "แยกตามรายการในบิล": ทุกบรรทัดสินค้าจากทุกบิลในช่วงเวลา
 * ผู้ใช้อยากรู้ว่าแต่ละช่วง "มีรายการอะไร" บ้าง ไม่ใช่แค่จำนวนบิล — รายงานนี้คือ
 * สมุดขายรายบรรทัด: บิลไหน วันไหน เวลาไหน ขายอะไร กี่ชิ้น ราคาเท่าไหร่ ใครขาย
 * จำกัดที่ 1000 บรรทัดล่าสุดกันช่วงยาว ๆ ลากเบราว์เซอร์ (พอสำหรับรายงานหน้าร้าน)
 */
export type SalesLineItemRow = {
  orderNumber: string;
  createdAt: string;
  /** SKU is the hospital-report product identifier; barcode is a legacy fallback. */
  productCode: string | null;
  productName: string;
  unit: string;
  qty: number;
  price: number;
  amount: number;
  paymentMethod: string;
  cashier: string;
  memberNumber: string | null;
  memberName: string | null;
};

export type SalesByCashierRow = {
  cashier: string;
  orders: number;
  items: number;
  memberBills: number;
  discount: number;
  total: number;
  cogs: number;
  profit: number;
};

/** ROUND 51 (user) — รายชื่อพนักงานขายจากบิลจริงทั้งหมด (สำหรับตัวกรองเจาะจงในรายงาน) */
export type CashierOptionRow = {
  cashier: string;
  bills: number;
  lastSale: string;
};

export type MemberTransactionRow = {
  id: number;
  memberNumber: string;
  memberName: string | null;
  /** เลขบัตร ณ รอบที่ทำรายการ (จาก card_usage_sessions) */
  cardNumber: string | null;
  patientCode: string | null;
  type: "purchase" | "deposit" | "withdrawal" | "activation" | "refund";
  kind: "tx";
  detail: string;
  amount: number;
  paymentMethod: string | null;
  balanceAfter: number | null;
  actor: string | null;
  createdAt: string;
};

export type MemberTransactionsInput = {
  memberNumber?: string;
  type?: "purchase" | "deposit" | "withdrawal" | "activation" | "refund";
  /** ROUND 77 (user) — เลือกหลายประเภทพร้อมกัน (รวมกับ type เดี่ยว ถ้าส่งทั้งคู่) */
  types?: ("purchase" | "deposit" | "withdrawal" | "activation" | "refund")[];
  from?: string;
  to?: string;
  limit?: number;
};

export type MemberBalanceRow = {
  id: number;
  memberNumber: string;
  cardNumber: string | null;
  patientCode: string | null;
  prename: string | null;
  firstName: string;
  lastName: string;
  type: string;
  status: "active" | "suspended";
  /** วันที่เปิดใช้บัตร = วันที่ลงทะเบียนสมาชิกในระบบ */
  createdAt: string;
  /** ยอดทั้งหมด (บาท) — เงินเข้ารวมทุกช่องทาง: เปิดใช้บัตร + เติมเงิน */
  totalIn: number;
  /** ยอดจ่าย (บาท) — ใช้ซื้อสินค้า + ถอน + คืนบัตรเงินสด (ค่าบวก) */
  totalOut: number;
  /** คงเหลือ (บาท) = ยอดคงเหลือในบัญชีสมาชิกขณะนี้ */
  balance: number;
};

export type MemberBalancesInput = { search?: string };

export type StockBalanceRow = {
  productId: number;
  /** รหัสสินค้า — บาร์โค้ดถ้ามี ไม่มีก็ใช้ SKU */
  code: string;
  sku: string;
  barcode: string | null;
  name: string;
  unit: string;
  category: string;
  active: number;
  /** จำนวนยกมาต้นช่วง */
  opening: number;
  /** จำนวนที่ขายออกในช่วง */
  sold: number;
  /** จำนวนที่รับเข้าในช่วง */
  received: number;
  /** จำนวนคงเหลือปัจจุบัน */
  remaining: number;
  sellingPrice: number;
  sellingValue: number;
};

export type StockBalanceInput = {
  from?: string;
  to?: string;
  search?: string;
  categories?: string[];
};

export type DayClosureRow = {
  id: number;
  periodStart: string;
  closedAt: string;
  bills: number;
  pieces: number;
  revenue: number;
  cashTotal: number;
  qrTotal: number;
  walletTotal: number;
  deposits: number;
  withdrawals: number;
  depositCount: number;
  depositAmount: number;
  activationCount: number;
  activationAmount: number;
  withdrawalCount: number;
  withdrawalAmount: number;
  refundCount: number;
  refundAmount: number;
  closedBy: string | null;
  note: string | null;
};

export type BusinessPeriodStatus = {
  mode: "auto" | "manual";
  cutOffTime: string;
  /** เริ่มรอบปัจจุบัน — auto: เวลาตัดยอของวันนี้/เมื่อวาน · manual: ตั้งแต่ตัดยอดครั้งล่าสุด */
  periodStart: string;
  /** รอบถัดไปจะเริ่มเมื่อ (auto เท่านั้น) */
  nextCutOffAt: string | null;
  totals: {
    bills: number;
    pieces: number;
    revenue: number;
    cashTotal: number;
    qrTotal: number;
    walletTotal: number;
    deposits: number;
    withdrawals: number;
    depositCount: number;
    depositAmount: number;
    activationCount: number;
    activationAmount: number;
    withdrawalCount: number;
    withdrawalAmount: number;
    refundCount: number;
    refundAmount: number;
  };
  lastClosure: DayClosureRow | null;
};

export type CloseDayInput = {
  actor?: string;
  actorRole?: string;
  note?: string;
};
