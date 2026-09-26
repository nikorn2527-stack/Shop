// Types ported from original Shop server/sqliteStore.ts

export interface InstallOverview {
  userCount: number;
  memberCount: number;
  productCount: number;
  todaySaleCount: number;
  dbSizeBytes: number;
  edition?: { edition: string; source: string; trialDaysLeft?: number };
}

export interface MemberTransactionRow {
  id: string;
  memberNumber: string;
  type: "purchase" | "deposit" | "withdrawal" | "activation" | "refund" | "limit_request";
  detail: string;
  amount: number;
  balanceAfter: number | null;
  paymentMethod: string | null;
  actor: string | null;
  slipUrl: string | null;
  createdAt: string;
  saleId?: string | null;
}

export interface SaleHistoryEntry {
  id: string;
  orderNumber: string;
  paymentMethod: string;
  memberNumber: string | null;
  subtotal: number;
  discount: number;
  total: number;
  cashierName: string | null;
  voided: boolean;
  createdAt: string;
  items: { id: string; name: string; qty: number; price: number; cost: number; unit: string | null; variant: string | null }[];
  memberBalanceAfter?: number | null;
}

export interface BusinessPeriodStatus {
  mode: "auto" | "manual";
  periodStart: string;
  nextCutOffAt: string | null;
  lastClosure: DayClosureRow | null;
  totals: {
    bills: number;
    pieces: number;
    revenue: number;
    cash: number;
    qr: number;
    wallet: number;
    deposits: number;
    withdrawals: number;
  };
}

export interface DayClosureRow {
  id: string;
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
  closedBy: string | null;
  note: string | null;
}

export interface StockRow {
  id: string;
  productId: string;
  name: string;
  sku: string;
  barcode: string | null;
  unit: string;
  stock: number;
  reorderPoint: number;
  active: boolean;
  status: "ปกติ" | "สต็อกต่ำ" | "ใกล้หมดอายุ" | "ปิดการขาย";
  tone: "green" | "red" | "amber" | "purple";
  lots: StockLotRow[];
}

export interface StockLotRow {
  id: string;
  lot: string;
  expiry: string | null;
  qty: number;
  cost: number;
  receivedAt: string;
  receivedQty: number;
  daysLeft: number | null;
  status: string;
  tone: string;
}

export interface MemberLite {
  memberNumber: string;
  prename?: string | null;
  firstName: string;
  lastName: string;
  type: string;
  balance: number;
  status: "active" | "suspended";
  lastTransactionAt: string | null;
  cardNumber?: string | null;
  patientCode?: string | null;
  createdAt?: string | null;
  photoUrl?: string | null;
  gender?: string | null;
  creditLimit?: number | null;
}

export interface Product {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  category: string;
  emoji: string;
  color: string;
  unit: string;
  price: number;
  cost: number;
  stock: number;
  reorderPoint: number;
  active: boolean;
  size?: string | null;
  imageUrl?: string | null;
  quickPick?: boolean;
  sellMode?: string;
  priceTiers?: string | null;
}

export interface CheckoutReceipt {
  saleId: string;
  orderNumber: string;
  subtotal: number;
  discount: number;
  total: number;
  memberBalanceAfter?: number;
  cashierName?: string | null;
  paymentMethod: string;
  createdAt?: string;
  items?: { name: string; qty: number; price: number; unit?: string | null }[];
}

export interface DashboardStats {
  totalSales: number;
  totalOrders: number;
  totalPieces: number;
  avgDailySales: number;
  bestSellerCount: number;
  itemsSold: number;
  revenueByDay: { date: string; total: number }[];
  bestSellers: { name: string; qty: number; revenue: number }[];
  lowStock: { id: string; name: string; stock: number; unit: string; reorderPoint: number }[];
  expirySoon: { lotId: string; productName: string; unit: string; lot: string; expiryLabel: string; qty: number }[];
  recentActivities: { id: string; action: string; actor: string | null; actorRole: string | null; detail: string; tone: string; createdAt: string }[];
  memberWalletTotal: number;
  memberCount: number;
}

// SqliteProduct alias used by BulkPriceModal
export type SqliteProduct = Product
