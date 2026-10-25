import type {
  Product,
  StockMovementInput,
} from "../../shared/storeTypes/inventory";
import type { Member } from "../../shared/storeTypes/members";
import type {
  CheckoutReceipt,
  PosTerminal,
} from "../../shared/storeTypes/sales";
import type { MemberLedgerRepository } from "./memberLedgerRepository";

export type CheckoutLine = CheckoutReceipt["items"][number] & { cost: number };
export type SaleInsert = Omit<
  CheckoutReceipt,
  "items" | "memberName" | "balanceAfter" | "printPreviewBefore"
> & {
  slipImage: string | null;
  clientRequestId: string | null;
};

export interface CheckoutRepository extends MemberLedgerRepository {
  findCheckoutByRequestId(requestId: string): CheckoutReceipt | undefined;
  findTerminal(deviceId: string): PosTerminal | null;
  findProduct(productId: number): Product | undefined;
  requireUsableMember(memberNumber: string): Member;
  nextOrderNumber(date: Date): string;
  insertSale(input: SaleInsert): number;
  insertSaleItem(saleId: number, item: CheckoutLine): number;
  decreaseStock(productId: number, quantity: number): void;
  recordMovement(input: StockMovementInput): void;
  deductLots(
    productId: number,
    quantity: number,
    saleItemId: number,
  ): { shortfall: number; costSatang: number };
  hasValuedLots(productId: number): boolean;
  setSaleItemCost(saleItemId: number, costSatang: number): void;
}
