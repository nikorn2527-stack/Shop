export type TierRow = { label: string; price: string; qty: string };

export function serializeTierRows(rows: TierRow[]): { error?: string; json: string | null; minPrice: number } {
  const tiers = rows
    .filter(row => [row.label, row.price, row.qty].some(value => value.trim() !== ""))
    .map(row => ({ label: row.label.trim(), price: Number(row.price), qty: Number(row.qty) }));
  if (tiers.length === 0) return { json: null, minPrice: 0 };
  const labels = new Set<string>();
  for (const tier of tiers) {
    if (!tier.label) return { error: "ช่องราคาต้องมีชื่อขนาด เช่น “200 กรัม”", json: null, minPrice: 0 };
    if (!Number.isFinite(tier.price) || tier.price <= 0) return { error: `ช่องราคา “${tier.label}” ต้องมีราคามากกว่า 0`, json: null, minPrice: 0 };
    if (!Number.isFinite(tier.qty) || tier.qty <= 0) return { error: `ช่องราคา “${tier.label}” ต้องมีปริมาณมากกว่า 0`, json: null, minPrice: 0 };
    if (labels.has(tier.label)) return { error: `ชื่อช่องราคา “${tier.label}” ซ้ำกัน กรุณาใช้ชื่อไม่ซ้ำ`, json: null, minPrice: 0 };
    labels.add(tier.label);
  }
  return { json: JSON.stringify(tiers), minPrice: Math.min(...tiers.map(tier => tier.price)) };
}