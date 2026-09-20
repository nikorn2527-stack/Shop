import { useEffect, useMemo, useState } from "react";
import { TRPCClientError } from "@trpc/client";
import { Check, CircleAlert, Coins, Percent, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";
import type { SqliteProduct } from "../../../server/sqliteStore";
import { money } from "@/pages/pageData";
import { trpc } from "@/lib/trpc";

/**
 * ROUND 64 (user) — ปรับราคาขาย/ต้นทุนหลายรายการพร้อมกัน
 * use case จริง: ร้านใหม่มีสินค้า 100+ รายการที่ยังไม่มีราคา (฿0)
 * แก้ทีละตัวผ่านโมดัลแก้ไขช้ามาก — โมดัลนี้ให้กรอกทั้งตารางแล้วบันทึกครั้งเดียว
 * (server ใช้ transaction เดียว + audit log สรุปก้อนเดียว)
 */

type DraftValue = { price: string; cost: string };
type FilterMode = "all" | "noPrice" | "noCost";

const FILTER_LABELS: Record<FilterMode, string> = { all: "ทั้งหมด", noPrice: "ยังไม่มีราคา (฿0)", noCost: "ยังไม่มีต้นทุน (฿0)" };

function parseMoneyInput(raw: string | undefined): number | null | "invalid" {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return null; // ช่องว่าง = ไม่แก้ฟิลด์นี้
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return "invalid";
  return value;
}

/** ช่วยสร้าง draft ให้ครบทั้ง price/cost เสมอ (กัน undefined หลุดเข้า parseMoneyInput) */
function withDraft(previous: Record<number, DraftValue>, productId: number, patch: Partial<DraftValue>): DraftValue {
  const base = previous[productId] ?? { price: "", cost: "" };
  return { ...base, ...patch };
}

export type BulkPriceModalProps = {
  open: boolean;
  products: SqliteProduct[];
  actor: string;
  actorRole: string;
  onClose: () => void;
  /** เรียกหลังบันทึกสำเร็จ (message สรุปไทยพร้อมใช้ setNotice) */
  onDone: (message: string) => void;
};

export function BulkPriceModal({ open, products, actor, actorRole, onClose, onDone }: BulkPriceModalProps) {
  const [drafts, setDrafts] = useState<Record<number, DraftValue>>({});
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<FilterMode>("all");
  const [term, setTerm] = useState("");
  const [markup, setMarkup] = useState("25");
  const [error, setError] = useState("");
  const utils = trpc.useUtils();
  const bulkMutation = trpc.product.bulkUpdatePrices.useMutation({
    onSuccess: (result) => {
      setDrafts({});
      setChecked(new Set());
      setError("");
      const sample = result.sampleNames.length > 0 ? ` · เช่น ${result.sampleNames.slice(0, 2).join(", ")}` : "";
      onDone(`ปรับราคา/ต้นทุนแล้ว ${result.updated} รายการ · แก้ราคาขาย ${result.priceChanges} · แก้ต้นทุน ${result.costChanges}${result.skipped > 0 ? ` · ค่าเท่าเดิม ${result.skipped} รายการ` : ""}${sample}`);
      void utils.product.list.invalidate();
      void utils.stock.rows.invalidate();
      void utils.dashboard.stats.invalidate();
    },
    onError: (mutationError) => {
      setError(mutationError instanceof TRPCClientError ? mutationError.message : "เกิดข้อผิดพลาดในการเชื่อมต่อระบบ กรุณาลองอีกครั้ง");
    },
  });

  // รีเซ็ต state ทุกครั้งที่เปิดใหม่ (กันค้างค่าจากรอบก่อน)
  useEffect(() => {
    if (open) {
      setDrafts({});
      setChecked(new Set());
      setFilter(products.some((product) => product.price === 0) ? "noPrice" : "all");
      setTerm("");
      setError("");
      bulkMutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Esc ปิดหน้าต่าง
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !bulkMutation.isPending) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, bulkMutation.isPending]);

  const visible = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return products.filter((product) => {
      if (filter === "noPrice" && product.price !== 0) return false;
      if (filter === "noCost" && product.cost !== 0) return false;
      if (needle !== "" && !product.name.toLowerCase().includes(needle) && !product.sku.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [products, filter, term]);

  const invalidIds = useMemo(() => {
    const ids: number[] = [];
    for (const [id, draft] of Object.entries(drafts)) {
      if (parseMoneyInput(draft.price) === "invalid" || parseMoneyInput(draft.cost) === "invalid") ids.push(Number(id));
    }
    return ids;
  }, [drafts]);

  const payload = useMemo(() => {
    const items: Array<{ productId: number; price?: number; cost?: number }> = [];
    for (const product of products) {
      const draft = drafts[product.id];
      if (!draft) continue;
      const price = parseMoneyInput(draft.price);
      const cost = parseMoneyInput(draft.cost);
      if (price === "invalid" || cost === "invalid") continue;
      if (price === null && cost === null) continue;
      if (price === null && cost !== null && cost === product.cost) continue;
      if (cost === null && price !== null && price === product.price) continue;
      if (price !== null && price === product.price && cost !== null && cost === product.cost) continue;
      const item: { productId: number; price?: number; cost?: number } = { productId: product.id };
      if (price !== null && price !== product.price) item.price = price;
      if (cost !== null && cost !== product.cost) item.cost = cost;
      if (item.price !== undefined || item.cost !== undefined) items.push(item);
    }
    return items;
  }, [products, drafts]);

  const dirtyCount = payload.length;

  const setDraft = (productId: number, field: keyof DraftValue, value: string) => {
    setDrafts((previous) => ({ ...previous, [productId]: withDraft(previous, productId, { [field]: value }) }));
  };

  const toggleChecked = (productId: number) => {
    setChecked((previous) => {
      const next = new Set(previous);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const targetIds = (): number[] => (checked.size > 0 ? Array.from(checked) : visible.map((product) => product.id));

  /** ตั้งราคาขาย = ต้นทุน (ค่าใหม่ถ้ากรอก ไม่งั้นค่าเดิม) × (1 + markup%) สำหรับรายการที่ติดเลือก (ไม่เลือก = ทุกที่แสดง) */
  const applyMarkup = () => {
    const percent = Number(markup);
    if (!Number.isFinite(percent) || percent < 0) { setError("ส่วนต่างต้องเป็นตัวเลข 0 ขึ้นไป เช่น 25 = บวก 25% จากต้นทุน"); return; }
    setError("");
    const next: Record<number, DraftValue> = { ...drafts };
    let applied = 0;
    for (const id of targetIds()) {
      const product = products.find((item) => item.id === id);
      if (!product) continue;
      const baseCost = parseMoneyInput(next[id]?.cost);
      const cost = baseCost !== null && baseCost !== "invalid" ? baseCost : product.cost;
      if (!(cost > 0)) continue;
      next[id] = withDraft(next, id, { price: (Math.round(cost * (1 + percent / 100) * 100) / 100).toFixed(2) });
      applied += 1;
    }
    setDrafts(next);
    if (applied === 0) setError("รายการที่เลือกยังไม่มีต้นทุน — กรอกต้นทุนก่อน แล้วจึงใช้สูตรตั้งราคาได้");
  };

  /** คัดลอกต้นทุน (ค่าใหม่ถ้ากรอก) ไปเป็นราคาขาย — สำหรับรายการที่ติดเลือก */
  const copyCostToPrice = () => {
    const next: Record<number, DraftValue> = { ...drafts };
    let applied = 0;
    for (const id of targetIds()) {
      const product = products.find((item) => item.id === id);
      if (!product) continue;
      const baseCost = parseMoneyInput(next[id]?.cost);
      const cost = baseCost !== null && baseCost !== "invalid" ? baseCost : product.cost;
      if (!(cost > 0)) continue;
      next[id] = withDraft(next, id, { price: cost.toFixed(2) });
      applied += 1;
    }
    setDrafts(next);
    if (applied === 0) setError("รายการที่เลือกยังไม่มีต้นทุน — กรอกต้นทุนก่อน");
  };

  /** ปัดราคาที่กรอกไว้ให้จบด้วย .00 / .50 — ทำให้ราคาหน้าร้านดูเรียบร้อย */
  const roundPrices = () => {
    const next: Record<number, DraftValue> = { ...drafts };
    for (const [id, draft] of Object.entries(drafts)) {
      const price = parseMoneyInput(draft.price);
      if (price === null || price === "invalid" || price === 0) continue;
      // ปัดให้จบด้วย .00 หรือ .50 (frac < .25 → ลง .00 · .25–.75 → .50 · ≥ .75 → ขึ้น .00 ถัดไป)
      const floor = Math.floor(price);
      const frac = price - floor;
      const rounded = frac < 0.25 ? floor : frac < 0.75 ? floor + 0.5 : floor + 1;
      next[Number(id)] = withDraft(next, Number(id), { price: rounded.toFixed(2) });
    }
    setDrafts(next);
  };

  const clearAll = () => {
    setDrafts({});
    setChecked(new Set());
    setError("");
  };

  const save = () => {
    if (invalidIds.length > 0) { setError("มีบางช่องที่กรอกไม่ถูกต้อง (ต้องเป็นตัวเลข 0 ขึ้นไป) — แก้ตัวที่แดงก่อนบันทึก"); return; }
    if (payload.length === 0) { setError("ยังไม่มีรายการที่แก้ — กรอกราคาใหม่หรือต้นทุนใหม่อย่างน้อย 1 ช่อง"); return; }
    setError("");
    bulkMutation.mutate({ items: payload, actor, actorRole });
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={() => { if (!bulkMutation.isPending) onClose(); }}>
      <div className="form-modal bulk-price-modal" role="dialog" aria-modal="true" aria-label="ปรับราคาหลายรายการพร้อมกัน" onClick={(event) => event.stopPropagation()}>
        <div className="modal-heading">
          <div>
            <span className="eyebrow">BULK PRICING · ปรับราคาหลายรายการ</span>
            <h2>ตั้งราคา / ต้นทุนหลายรายการพร้อมกัน</h2>
            <p>กรอกเฉพาะช่องที่ต้องการแก้ แล้วกดบันทึกครั้งเดียว — ระบบบันทึกทั้งชุดในคราวเดียวและลง Log สรุปรายการเดียว</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="ปิดหน้าต่าง" disabled={bulkMutation.isPending}><X size={16} /></button>
        </div>

        <div className="bulk-toolbar">
          <div className="bulk-filter-group" role="group" aria-label="กรองรายการ">
            {(Object.keys(FILTER_LABELS) as FilterMode[]).map((mode) => {
              const count = mode === "all" ? products.length : mode === "noPrice" ? products.filter((product) => product.price === 0).length : products.filter((product) => product.cost === 0).length;
              return (
                <button key={mode} className={`filter-chip ${filter === mode ? "active" : ""}`} onClick={() => setFilter(mode)} disabled={count === 0 && filter !== mode}>
                  {FILTER_LABELS[mode]} <b>{count}</b>
                </button>
              );
            })}
          </div>
          <label className="bulk-search">
            <Search size={14} />
            <input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="ค้นหาชื่อสินค้า / รหัส SKU" aria-label="ค้นหาสินค้า" />
          </label>
        </div>

        <div className="bulk-mass-tools">
          <span className="bulk-tools-label"><SlidersHorizontal size={13} /> เครื่องมือช่วย (ใช้กับ {checked.size > 0 ? `รายการที่ติดเลือก ${checked.size} รายการ` : `ทุกรายการที่แสดง ${visible.length} รายการ`}):</span>
          <div className="bulk-tools-row">
            <label className="bulk-markup-input" title="ตั้งราคาขาย = ต้นทุน × (1 + ส่วนต่าง%)">
              <Percent size={13} />
              <input value={markup} onChange={(event) => setMarkup(event.target.value)} inputMode="decimal" aria-label="ส่วนต่างจากต้นทุนเป็นเปอร์เซ็นต์" />
            </label>
            <button className="outline-button" onClick={applyMarkup} type="button">ตั้งราคาจากต้นทุน +%</button>
            <button className="outline-button" onClick={copyCostToPrice} type="button"><Coins size={14} /> ต้นทุน = ราคา</button>
            <button className="outline-button" onClick={roundPrices} type="button">ปัดเป็น .00 / .50</button>
            <button className="outline-button bulk-reset" onClick={clearAll} type="button"><RotateCcw size={14} /> ล้างค่าที่กรอก</button>
          </div>
        </div>

        {error && (
          <p className="bulk-error" role="alert"><CircleAlert size={14} /> {error}</p>
        )}

        <div className="bulk-table-wrap">
          <table className="bulk-table">
            <thead>
              <tr>
                <th className="col-check">
                  <input
                    type="checkbox"
                    aria-label="เลือกทุกรายการที่แสดง"
                    checked={visible.length > 0 && visible.every((product) => checked.has(product.id))}
                    ref={(node) => { if (node) node.indeterminate = visible.some((product) => checked.has(product.id)) && !visible.every((product) => checked.has(product.id)); }}
                    onChange={() => {
                      const allChecked = visible.every((product) => checked.has(product.id));
                      setChecked(allChecked ? new Set() : new Set(visible.map((product) => product.id)));
                    }}
                    disabled={visible.length === 0}
                  />
                </th>
                <th className="col-name">สินค้า</th>
                <th className="col-money">ราคาขายปัจจุบัน</th>
                <th className="col-money">ราคาใหม่</th>
                <th className="col-money">ต้นทุนปัจจุบัน</th>
                <th className="col-money">ต้นทุนใหม่</th>
                <th className="col-margin">กำไร/ชิ้น</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((product) => {
                const draft = drafts[product.id] ?? { price: "", cost: "" };
                const draftPrice = parseMoneyInput(draft.price);
                const draftCost = parseMoneyInput(draft.cost);
                const badPrice = draftPrice === "invalid";
                const badCost = draftCost === "invalid";
                const effectivePrice = draftPrice !== null && draftPrice !== "invalid" ? draftPrice : product.price;
                const effectiveCost = draftCost !== null && draftCost !== "invalid" ? draftCost : product.cost;
                const marginBaht = effectivePrice - effectiveCost;
                const marginPct = effectivePrice > 0 ? (marginBaht / effectivePrice) * 100 : null;
                const dirty = payload.some((item) => item.productId === product.id);
                return (
                  <tr key={product.id} className={dirty ? "dirty" : ""}>
                    <td className="col-check">
                      <input type="checkbox" aria-label={`เลือก ${product.name}`} checked={checked.has(product.id)} onChange={() => toggleChecked(product.id)} />
                    </td>
                    <td className="col-name">
                      <b>{product.name}</b>
                      <small>{product.sku}{product.size ? ` · ${product.size}` : ""}</small>
                      {product.price === 0 && <em className="bulk-flag-no-price">ยังไม่มีราคา</em>}
                    </td>
                    <td className="col-money"><span className="bulk-current">{product.price === 0 ? "—" : money(product.price)}</span></td>
                    <td className="col-money">
                      <input
                        className={`bulk-cell-input ${badPrice ? "bad" : ""} ${dirty && !badPrice && draftPrice !== null ? "ok" : ""}`}
                        value={draft.price}
                        onChange={(event) => setDraft(product.id, "price", event.target.value)}
                        inputMode="decimal"
                        placeholder={product.price === 0 ? "ยังไม่มีราคา" : money(product.price)}
                        aria-label={`ราคาขายใหม่ของ ${product.name}`}
                        disabled={bulkMutation.isPending}
                      />
                    </td>
                    <td className="col-money"><span className="bulk-current">{product.cost === 0 ? "—" : money(product.cost)}</span></td>
                    <td className="col-money">
                      <input
                        className={`bulk-cell-input ${badCost ? "bad" : ""} ${dirty && !badCost && draftCost !== null ? "ok" : ""}`}
                        value={draft.cost}
                        onChange={(event) => setDraft(product.id, "cost", event.target.value)}
                        inputMode="decimal"
                        placeholder={product.cost === 0 ? "ยังไม่มีต้นทุน" : money(product.cost)}
                        aria-label={`ต้นทุนใหม่ของ ${product.name}`}
                        disabled={bulkMutation.isPending}
                      />
                    </td>
                    <td className="col-margin">
                      {badPrice || badCost ? <span className="bulk-margin bad">กรอกผิด</span> : marginPct === null ? <span className="bulk-margin none">ตั้งราคาก่อน</span> : (
                        <span className={`bulk-margin ${marginBaht < 0 ? "bad" : marginPct < 10 ? "low" : "good"}`}>
                          {money(marginBaht)} · {marginPct.toFixed(1)}%
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={7} className="bulk-empty">ไม่พบรายการตามเงื่อนไขที่เลือก — ลองเปลี่ยนตัวกรองหรือคำค้น</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="modal-actions bulk-actions">
          <div className="bulk-summary">
            {dirtyCount > 0 ? <><Check size={14} /> พร้อมบันทึก <b>{dirtyCount}</b> รายการ{invalidIds.length > 0 && <span className="bulk-invalid-hint"> · กรอกผิด {invalidIds.length} ช่อง</span>}</> : <span>กรอกราคาใหม่/ต้นทุนใหม่ในตารางเพื่อเริ่ม</span>}
          </div>
          <button className="outline-button" onClick={onClose} disabled={bulkMutation.isPending} type="button">ปิด</button>
          <button className="primary-button" onClick={save} disabled={bulkMutation.isPending || dirtyCount === 0 || invalidIds.length > 0} type="button">
            {bulkMutation.isPending ? "กำลังบันทึก…" : `บันทึก ${dirtyCount > 0 ? `${dirtyCount} รายการ` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
