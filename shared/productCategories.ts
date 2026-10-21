/** Legacy supplies groups remain readable without changing existing SKU prefixes. */
export function normalizeProductCategory(category: string): string {
  return category === "ของใช้ส่วนตัว" || category === "ของใช้ในครัวเรือน" ? "ของใช้" : category;
}

export const PRODUCT_CATEGORIES = ["ของใช้", "เครื่องดื่ม", "ขนม", "อาหาร", "เครื่องเขียน"];

/**
 * ROUND 81 (user) — อีโมจิตัวแทนประจำหมวดสินค้า
 * ใช้เป็นภาพต้นแบบของสินค้าที่ยังไม่มีรูปภาพ (เช่น สินค้าที่ยิงบาร์โค้ดเข้ามาโดยไม่มีรูป)
 * หนึ่งที่เดียวทั้งฝั่งเซิร์ฟเวอร์และฝั่งหน้าเว็บ เพื่อให้ผลลัพธ์ตรงกันเสมอ
 */
export const CATEGORY_EMOJI_MAP: Record<string, string> = {
  "ของใช้": "🛍️",
  "เครื่องดื่ม": "🥤",
  "ขนม": "🍬",
  "อาหาร": "🍱",
  "เครื่องเขียน": "📝",
  // หมวดเก่าที่ยังมีข้อมูลอยู่ในฐานข้อมูล — แสดงอีโมจิเดิมของแต่ละกลุ่ม
  "ของใช้ส่วนตัว": "🧴",
  "ของใช้ในครัวเรือน": "🧺",
};

/** อีโมจิประจำหมวด — ถ้าหมวดไม่รู้จัก ใช้อีโมจิกลาง */
export function categoryEmoji(category: string | null | undefined): string {
  if (!category) return "🛍️";
  return CATEGORY_EMOJI_MAP[category] ?? CATEGORY_EMOJI_MAP[normalizeProductCategory(category)] ?? "🛍️";
}

export function productCategoryOptions(categories: readonly string[]): string[] {
  return Array.from(new Set(categories.map(normalizeProductCategory).filter(Boolean)));
}