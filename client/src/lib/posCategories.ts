import { productCategoryOptions } from "@shared/productCategories";
/** Categories come from the catalog, not a fixed subset that hides newer groups. */
export function posCategories(products: readonly { category: string }[]): string[] {
  return ["ทั้งหมด", ...productCategoryOptions(products.map(product => product.category)).filter(category => category !== "ทั้งหมด")];
}