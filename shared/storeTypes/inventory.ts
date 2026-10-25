/** Database-independent business contracts. No database clients or server runtime imports. */

export type Product = {
  id: number;
  sku: string;
  barcode: string | null;
  name: string;
  category: string;
  emoji: string | null;
  color: string | null;
  unit: string;
  price: number;
  size: string | null;
  imageUrl: string | null;
  /** สินค้าลัดหน้าร้าน — 1 = โชว์เป็นปุ่มลัดที่ POS (round 31-12) */
  quickPick: number;
  /** "unit" = ขายตามหน่วย · "money" = ขายเป็นเงิน เช่น น้ำแข็ง (ใช้ priceTiers) */
  sellMode: string | null;
  /** ตัวเลือกราคาสั้นๆ สำหรับ sellMode "money": JSON [{ label, price, qty }] */
  priceTiers: string | null;
  cost: number;
  stock: number;
  reorderPoint: number;
  active: number;
  createdAt: string;
};

export type StockRow = {
  id: number;
  productId: number;
  sku: string;
  name: string;
  unit: string;
  lot: string;
  expiry: string | null;
  qty: number;
  cost: number;
  price: number;
  stock: number;
  reorderPoint: number;
  receivedAt: string | null;
  active: number;
  status: "ปกติ" | "สต็อกต่ำ" | "ใกล้หมดอายุ" | "ปิดการขาย";
  tone: "green" | "red" | "amber" | "purple";
};

export type CreateProductInput = {
  name: string;
  sku?: string;
  barcode?: string;
  size?: string;
  imageUrl?: string | null;
  /** 1 = สินค้าลัดหน้าร้าน (boolean ก็รับแล้วแปลงเป็น 0/1) */
  quickPick?: number | boolean | null;
  /** "unit" (default) | "money" — ขายเป็นเงินใช้ priceTiers */
  sellMode?: "unit" | "money" | null;
  /** JSON [{ label, price, qty }] สำหรับ sellMode "money" */
  priceTiers?: string | null;
  unit?: string;
  price: number;
  cost?: number;
  stock?: number;
  reorderPoint?: number;
  category?: string;
  emoji?: string;
  color?: string;
  actor?: string;
  actorRole?: string;
};

/**
 * ROUND 77 (user) — รับเข้าสินค้า "ต้นทุนต่างกันแต่ละรอบ" ได้:
 * สินค้าชนิดเดียวกัน รอบละราคาไม่เท่ากัน (เช่น รอบนี้ 10 ห่อ @฿200 แถมอีก 2 ห่อ)
 * ต้นทุนที่ fix คงที่ใช้ไม่ได้ → ระบบเก็บเป็น "ต้นทุนถัวเฉลี่ย" (weighted average):
 * ผสมมูลค่าของเดิมในคลังกับทุกบรรทัดที่รับเข้ารอบนี้ บรรทัดแถม (ต้นทุน ฿0) จะดึง
 * ค่าเฉลี่ยลงให้เอง — รายงานกำไรจึงถูกต้องตามของจริงเสมอ
 */
export type ReceiveStockLine = { qty: number; cost?: number };

export type ReceiveStockLotRow = {
  id: number;
  productId: number;
  lot: string;
  expiry: string | null;
  qty: number;
  cost: number;
  receivedAt: string;
};

export type ReceiveStockResult = {
  /** ทุกบรรทัดที่รับเข้ารอบนี้ (แต่ละบรรทัด = 1 stock_lot ใช้ Lot เดียวกัน) */
  lots: ReceiveStockLotRow[];
  /** บรรทัดแรก — ผู้เรียกแบบเดิม (บรรทัดเดียว) ยังอ่านได้ตามรูปเก่า */
  lot: ReceiveStockLotRow;
  product: Product;
  /** ต้นทุนถัวเฉลี่ยใหม่ที่เก็บในสินค้า (ของเดิมในคลัง + ทุกบรรทัดรอบนี้) */
  averageCost: number;
  /** ต้นทุนเฉลี่ยก่อนรับเข้ารอบนี้ */
  previousCost: number;
};

export type StockIntakeEntry = {
  sellingPrice?: number;
  expectedSellingPrice?: number;
  productId?: number;
  newProduct?: CreateProductInput;
  purchaseQty: number;
  freeQty?: number;
  paidAmount: number;
  lot?: string;
  expiryDate?: string | null;
};

export type StockCountInput = {
  productId: number;
  countedQty: number;
  note?: string;
  actor?: string;
  actorRole?: string;
};

export type LotCountEntry = { lotId: number; countedQty: number };

export type StockCountLotsInput = {
  counts: LotCountEntry[];
  note?: string;
  actor?: string;
  actorRole?: string;
};

export type StockCountLotResult = {
  lotId: number;
  lot: string;
  expiry: string | null;
  systemQty: number;
  countedQty: number;
  diff: number;
};

export type StockCountLotsResult = {
  productId: number;
  sku: string;
  name: string;
  unit: string;
  systemQty: number;
  countedQty: number;
  diff: number;
  lots: StockCountLotResult[];
};

export type OrderItem = {
  id: number;
  productId: number;
  sku: string;
  name: string;
  unit: string;
  category: string;
  cost: number;
  sellingPrice: number;
  stock: number;
  reorderPoint: number;
  qty: number;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type OrderAddInput = {
  productId: number;
  qty?: number;
  note?: string;
  actor?: string;
  actorRole?: string;
};

export type OrderUpdateInput = {
  id: number;
  qty?: number;
  note?: string | null;
  actor?: string;
  actorRole?: string;
};

export type UpdateProductInput = {
  productId: number;
  name?: string;
  barcode?: string | null;
  size?: string | null;
  imageUrl?: string | null;
  /** 1 = สินค้าลัดหน้าร้าน (boolean ก็รับแล้วแปลงเป็น 0/1) */
  quickPick?: number | boolean | null;
  /** "unit" (default) | "money" — ขายเป็นเงินใช้ priceTiers */
  sellMode?: "unit" | "money" | null;
  /** JSON [{ label, price, qty }] สำหรับ sellMode "money" */
  priceTiers?: string | null;
  unit?: string;
  price?: number;
  cost?: number;
  reorderPoint?: number;
  category?: string;
  emoji?: string;
  actor?: string;
  actorRole?: string;
};

export type BulkPriceItemInput = {
  productId: number;
  price?: number;
  cost?: number;
};

export type BulkUpdatePricesInput = {
  items: BulkPriceItemInput[];
  actor?: string;
  actorRole?: string;
};

export type BulkUpdatePricesResult = {
  updated: number;
  priceChanges: number;
  costChanges: number;
  skipped: number;
  /** ตัวอย่างชื่อสินค้าที่แก้ (ใช้ทำ toast สรุป) */
  sampleNames: string[];
};

export type DeleteProductInput = {
  productId: number;
  actor?: string;
  actorRole?: string;
};

export type SetProductActiveInput = {
  productId: number;
  active: boolean;
  actor?: string;
  actorRole?: string;
};

export type StockMovementType =
  "RECEIVE" | "SALE" | "ADJUST" | "TRANSFER" | "RETURN" | "VOID" | "COUNT";

export interface StockMovementInput {
  type: StockMovementType;
  productId: number;
  qtyDelta: number; // signed: +in / -out
  unitCost?: number;
  refType?: string;
  refId?: number;
  reason?: string;
  actor?: string;
  actorRole?: string;
}

/** Shared input contract for both receiving API entry points and adapters. */
export type ReceiveStockLinesInput = {
  productId: number;
  lot?: string;
  expiryDate?: string | null;
  lines: (ReceiveStockLine | null | undefined)[] | null | undefined;
  paidAmount?: number;
  actor?: string;
  actorRole?: string;
};
