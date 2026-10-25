import type {
  CreateProductInput,
  Product,
  ReceiveStockLotRow,
  StockMovementInput,
} from "../../shared/storeTypes/inventory";

export type StockIntakeAudit = {
  action: string;
  actor: string;
  actorRole: string | null;
  detail: string;
  tone: string;
  createdAt: string;
};

export type InsertReceiptLot = Omit<ReceiveStockLotRow, "id"> & {
  receivedValueSatang: number;
  receiptGroup: string;
};

/** Synchronous port for the current SQLite runtime. Never return promises here.
 * An asynchronous provider needs an asynchronous service and connection-scoped
 * transaction implementation; it cannot be plugged into this interface.
 */
export interface StockIntakeRepository {
  findProduct(productId: number): Product | undefined;
  hasBarcodeOrSku(code: string): boolean;
  createProduct(input: CreateProductInput): Product;
  nextLotNumber(): string;
  insertLot(input: InsertReceiptLot): ReceiveStockLotRow;
  increaseStock(productId: number, quantity: number, averageCost: number): void;
  setSellingPrice(productId: number, price: number): void;
  recordMovement(input: StockMovementInput): void;
  appendAudit(input: StockIntakeAudit): void;
}

/** All callbacks in a receipt use the same transaction-bound repository. */
export interface StockIntakeUnitOfWork {
  transaction<T>(work: (repository: StockIntakeRepository) => T): T;
}

export type StockIntakeRuntime = {
  now(): string;
  newReceiptGroup(): string;
};
