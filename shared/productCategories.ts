/** Legacy supplies groups remain readable without changing existing SKU prefixes. */
export function normalizeProductCategory(category: string): string {
  return category === "ของใช้ส่วนตัว" || category === "ของใช้ในครัวเรือน" ? "ของใช้" : category;
}

export const PRODUCT_CATEGORIES = ["ของใช้", "เครื่องดื่ม", "ขนม", "อาหาร", "เครื่องเขียน"];

export function productCategoryOptions(categories: readonly string[]): string[] {
  return Array.from(new Set(categories.map(normalizeProductCategory).filter(Boolean)));
}