import type { Product } from "../../shared/storeTypes/inventory";
import { StoreError } from "./storeError";
import { round2 } from "./money";

type CatalogLine = { qty: number; price?: number; label?: string; unit?: string };
const price4 = (price: number) => Math.round(price * 10000) / 10000;

/** Resolve all catalog amounts from server data, including sell-by-money portions. */
export function catalogLinePricing(product: Product, line: CatalogLine) {
  if (line.price !== undefined && (!Number.isFinite(line.price) || line.price < 0)) {
    throw new StoreError("ราคาสินค้าไม่ถูกต้อง กรุณาเลือกสินค้าใหม่");
  }
  if (product.sellMode === "money") {
    let tiers: unknown;
    try { tiers = JSON.parse(product.priceTiers ?? ""); } catch { tiers = null; }
    const tier = Array.isArray(tiers) ? tiers.find((entry: unknown) => {
      if (!entry || typeof entry !== "object") return false;
      const value = entry as Record<string, unknown>;
      return typeof value.label === "string" && value.label.trim() === line.label
        && typeof value.price === "number" && Number.isFinite(value.price) && value.price > 0
        && typeof value.qty === "number" && Number.isFinite(value.qty) && value.qty > 0;
    }) as { label: string; price: number; qty: number } | undefined : undefined;
    if (!tier || line.price === undefined || price4(line.price) !== price4(tier.price / tier.qty)
      || !Number.isInteger(line.qty / tier.qty)) {
      throw new StoreError(`ช่วงราคาหรือจำนวนของ ${product.name} เปลี่ยนไป กรุณาเลือกช่วงราคาใหม่`);
    }
    return { name: `${product.name} · ${tier.label.trim()}`, unit: product.unit, price: price4(tier.price / tier.qty), amount: round2(tier.price * (line.qty / tier.qty)) };
  }
  if (!Number.isFinite(product.price) || product.price <= 0) {
    throw new StoreError(`สินค้ายังไม่ได้ตั้งราคาขาย · ${product.name}`);
  }
  if ((line.price !== undefined && line.price !== product.price) || line.label) {
    throw new StoreError(`ราคาของ ${product.name} เปลี่ยนไป กรุณาเลือกสินค้าใหม่`);
  }
  return { name: product.name, unit: product.unit, price: product.price, amount: round2(product.price * line.qty) };
}
