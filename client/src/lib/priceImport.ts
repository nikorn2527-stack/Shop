/** Price-only files never supply stock, cost, or product creation fields. */
export function preparePriceImport(
  rows: string[][],
  products: { id: number; barcode?: string | null; price: number }[]
) {
  const headers = (rows[0] ?? []).map(value =>
    value.trim().replace(/^\uFEFF/, "")
  );
  if (
    headers.length !== 2 ||
    headers[0] !== "บาร์โค้ด" ||
    headers[1] !== "ราคาขาย"
  )
    throw new Error(
      "ไฟล์ต้องมี 2 คอลัมน์ตามลำดับ: บาร์โค้ด, ราคาขาย (ไม่รับคอลัมน์ต้นทุนหรือสต็อก)"
    );
  const items: { productId: number; price: number }[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  let unchanged = 0;
  rows.slice(1).forEach((row, index) => {
    if (row.every(value => !value.trim())) return;
    const barcode = (row[0] ?? "").trim();
    const priceText = (row[1] ?? "").trim();
    const label = `แถว ${index + 2} (${barcode || "ไม่มีบาร์โค้ด"})`;
    if (!barcode || ["—", "-", "#N/A"].includes(barcode)) {
      errors.push(`${label}: ต้องมีบาร์โค้ด`);
      return;
    }
    if (row.slice(2).some(value => value.trim())) {
      errors.push(`${label}: มีคอลัมน์เกินรูปแบบ`);
      return;
    }
    if (seen.has(barcode)) {
      errors.push(`${label}: บาร์โค้ดซ้ำในไฟล์`);
      return;
    }
    seen.add(barcode);
    const price = priceText
      ? Number(priceText.replace(/[฿,\s]/g, "").replace(/บาท/g, ""))
      : NaN;
    if (
      !Number.isFinite(price) ||
      price < 0 ||
      !Number.isSafeInteger(Math.round(price * 100))
    ) {
      errors.push(`${label}: ราคาขายไม่ถูกต้อง`);
      return;
    }
    const matches = products.filter(product => product.barcode === barcode);
    if (matches.length !== 1) {
      errors.push(
        `${label}: ${matches.length ? "พบสินค้าหลายรายการ" : "ไม่พบสินค้าในระบบ"}`
      );
      return;
    }
    const rounded = Math.round((price + Number.EPSILON) * 100) / 100;
    if (matches[0].price === rounded) unchanged++;
    items.push({ productId: matches[0].id, price: rounded });
  });
  if (!items.length && !errors.length) errors.push("ไฟล์ไม่มีรายการราคาขาย");
  return { items, errors, unchanged };
}
