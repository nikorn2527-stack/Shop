"use client";

/**
 * BulkPriceModal — bulk price/cost editor for active products.
 *
 * Use case: a fresh store has 100+ products without prices; editing one-by-one
 * via the product modal is too slow. This modal lets you fill the entire table
 * then save in one click (parallel PATCH per row, since there's no bulk endpoint).
 *
 * Tools:
 *   ตั้งราคา = ต้นทุน × (1+%)      — markup tool
 *   คัดลอกต้นทุน→ราคา            — copy cost to price
 *   ปัดเป็น .00/.50              — round price to .00 / .50
 *   ล้างค่าที่กรอก                  — clear drafts
 *
 * Submit: PATCH /api/products/[id] per row (Promise.allSettled).
 */

import * as React from "react";
import {
  Check,
  Coins,
  Percent,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { apiPatch } from "@/lib/api-client";
import { money } from "@/lib/format";

export interface BulkPriceProduct {
  id: string;
  name: string;
  sku: string;
  unit: string;
  size?: string | null;
  price: number;
  cost: number;
  active: boolean;
}

interface DraftValue {
  price: string;
  cost: string;
}

type FilterMode = "all" | "noPrice" | "noCost";

const FILTER_LABELS: Record<FilterMode, string> = {
  all: "ทั้งหมด",
  noPrice: "ยังไม่มีราคา (฿0)",
  noCost: "ยังไม่มีต้นทุน (฿0)",
};

function parseMoneyInput(raw: string | undefined): number | null | "invalid" {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return "invalid";
  return value;
}

function withDraft(
  previous: Record<string, DraftValue>,
  productId: string,
  patch: Partial<DraftValue>,
): DraftValue {
  const base = previous[productId] ?? { price: "", cost: "" };
  return { ...base, ...patch };
}

export interface BulkPriceModalProps {
  open: boolean;
  products: BulkPriceProduct[];
  onClose: () => void;
  onSaved?: () => void;
}

export function BulkPriceModal({
  open,
  products,
  onClose,
  onSaved,
}: BulkPriceModalProps) {
  const [drafts, setDrafts] = React.useState<Record<string, DraftValue>>({});
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const [filter, setFilter] = React.useState<FilterMode>("all");
  const [term, setTerm] = React.useState("");
  const [markup, setMarkup] = React.useState("25");
  const [error, setError] = React.useState("");
  const [pending, setPending] = React.useState(false);

  // Reset state every time the modal opens.
  React.useEffect(() => {
    if (open) {
      setDrafts({});
      setChecked(new Set());
      setFilter(products.some((p) => p.price === 0) ? "noPrice" : "all");
      setTerm("");
      setError("");
    }
  }, [open]);

  // Esc to close (when not saving).
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, pending]);

  const activeProducts = React.useMemo(
    () => products.filter((p) => p.active),
    [products],
  );

  const visible = React.useMemo(() => {
    const needle = term.trim().toLowerCase();
    return activeProducts.filter((p) => {
      if (filter === "noPrice" && p.price !== 0) return false;
      if (filter === "noCost" && p.cost !== 0) return false;
      if (
        needle !== "" &&
        !p.name.toLowerCase().includes(needle) &&
        !p.sku.toLowerCase().includes(needle)
      )
        return false;
      return true;
    });
  }, [activeProducts, filter, term]);

  const invalidIds = React.useMemo(() => {
    const ids: string[] = [];
    for (const [id, draft] of Object.entries(drafts)) {
      if (
        parseMoneyInput(draft.price) === "invalid" ||
        parseMoneyInput(draft.cost) === "invalid"
      )
        ids.push(id);
    }
    return ids;
  }, [drafts]);

  const payload = React.useMemo(() => {
    const items: {
      productId: string;
      price?: number;
      cost?: number;
    }[] = [];
    for (const product of activeProducts) {
      const draft = drafts[product.id];
      if (!draft) continue;
      const price = parseMoneyInput(draft.price);
      const cost = parseMoneyInput(draft.cost);
      if (price === "invalid" || cost === "invalid") continue;
      if (price === null && cost === null) continue;
      if (price === null && cost !== null && cost === product.cost) continue;
      if (cost === null && price !== null && price === product.price) continue;
      if (
        price !== null &&
        price === product.price &&
        cost !== null &&
        cost === product.cost
      )
        continue;
      const item: { productId: string; price?: number; cost?: number } = {
        productId: product.id,
      };
      if (price !== null && price !== product.price) item.price = price;
      if (cost !== null && cost !== product.cost) item.cost = cost;
      if (item.price !== undefined || item.cost !== undefined) items.push(item);
    }
    return items;
  }, [activeProducts, drafts]);

  const dirtyCount = payload.length;

  const setDraft = (
    productId: string,
    field: keyof DraftValue,
    value: string,
  ) => {
    setDrafts((prev) => ({
      ...prev,
      [productId]: withDraft(prev, productId, { [field]: value }),
    }));
  };

  const toggleChecked = (productId: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const targetIds = (): string[] =>
    checked.size > 0
      ? Array.from(checked)
      : visible.map((p) => p.id);

  const applyMarkup = () => {
    const percent = Number(markup);
    if (!Number.isFinite(percent) || percent < 0) {
      setError("ส่วนต่างต้องเป็นตัวเลข 0 ขึ้นไป เช่น 25 = บวก 25% จากต้นทุน");
      return;
    }
    setError("");
    const next: Record<string, DraftValue> = { ...drafts };
    let applied = 0;
    for (const id of targetIds()) {
      const product = activeProducts.find((p) => p.id === id);
      if (!product) continue;
      const baseCost = parseMoneyInput(next[id]?.cost);
      const cost =
        baseCost !== null && baseCost !== "invalid" ? baseCost : product.cost;
      if (!(cost > 0)) continue;
      next[id] = withDraft(next, id, {
        price: (Math.round(cost * (1 + percent / 100) * 100) / 100).toFixed(2),
      });
      applied += 1;
    }
    setDrafts(next);
    if (applied === 0)
      setError(
        "รายการที่เลือกยังไม่มีต้นทุน — กรอกต้นทุนก่อน แล้วจึงใช้สูตรตั้งราคาได้",
      );
  };

  const copyCostToPrice = () => {
    const next: Record<string, DraftValue> = { ...drafts };
    let applied = 0;
    for (const id of targetIds()) {
      const product = activeProducts.find((p) => p.id === id);
      if (!product) continue;
      const baseCost = parseMoneyInput(next[id]?.cost);
      const cost =
        baseCost !== null && baseCost !== "invalid" ? baseCost : product.cost;
      if (!(cost > 0)) continue;
      next[id] = withDraft(next, id, { price: cost.toFixed(2) });
      applied += 1;
    }
    setDrafts(next);
    if (applied === 0)
      setError("รายการที่เลือกยังไม่มีต้นทุน — กรอกต้นทุนก่อน");
  };

  const roundPrices = () => {
    const next: Record<string, DraftValue> = { ...drafts };
    for (const [id, draft] of Object.entries(drafts)) {
      const price = parseMoneyInput(draft.price);
      if (price === null || price === "invalid" || price === 0) continue;
      const floor = Math.floor(price);
      const frac = price - floor;
      const rounded = frac < 0.25 ? floor : frac < 0.75 ? floor + 0.5 : floor + 1;
      next[id] = withDraft(next, id, { price: rounded.toFixed(2) });
    }
    setDrafts(next);
  };

  const clearAll = () => {
    setDrafts({});
    setChecked(new Set());
    setError("");
  };

  const save = async () => {
    if (invalidIds.length > 0) {
      setError(
        "มีบางช่องที่กรอกไม่ถูกต้อง (ต้องเป็นตัวเลข 0 ขึ้นไป) — แก้ตัวที่แดงก่อนบันทึก",
      );
      return;
    }
    if (payload.length === 0) {
      setError(
        "ยังไม่มีรายการที่แก้ — กรอกราคาใหม่หรือต้นทุนใหม่อย่างน้อย 1 ช่อง",
      );
      return;
    }
    setError("");
    setPending(true);
    const results = await Promise.allSettled(
      payload.map((item) =>
        apiPatch<{ product: BulkPriceProduct }>(
          `/api/products/${item.productId}`,
          {
            ...(item.price !== undefined ? { price: item.price } : {}),
            ...(item.cost !== undefined ? { cost: item.cost } : {}),
          },
        ),
      ),
    );
    const succeeded = results.filter(
      (r) => r.status === "fulfilled",
    ).length;
    const failed = results.length - succeeded;
    setPending(false);
    if (failed === 0) {
      toast.success(
        `ปรับราคา/ต้นทุนแล้ว ${succeeded} รายการ`,
      );
      setDrafts({});
      setChecked(new Set());
      onSaved?.();
      onClose();
    } else if (succeeded === 0) {
      toast.error("บันทึกไม่สำเร็จทุกรายการ", {
        description: "กรุณาตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง",
      });
    } else {
      toast.warning(
        `บันทึกสำเร็จ ${succeeded} รายการ · ล้มเหลว ${failed} รายการ`,
        {
          description: "รายการที่ล้มเหลวยังอยู่ในตาราง — ลองบันทึกใหม่",
        },
      );
      onSaved?.();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="size-5 text-emerald-600" />
            ตั้งราคา / ต้นทุนหลายรายการพร้อมกัน
          </DialogTitle>
          <DialogDescription>
            กรอกเฉพาะช่องที่ต้องการแก้ แล้วกดบันทึกครั้งเดียว — ระบบบันทึกทีละรายการแบบขนาน (PATCH /api/products/[id])
          </DialogDescription>
        </DialogHeader>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1" role="group" aria-label="กรองรายการ">
            {(Object.keys(FILTER_LABELS) as FilterMode[]).map((mode) => {
              const count =
                mode === "all"
                  ? activeProducts.length
                  : mode === "noPrice"
                    ? activeProducts.filter((p) => p.price === 0).length
                    : activeProducts.filter((p) => p.cost === 0).length;
              const disabled = count === 0 && filter !== mode;
              return (
                <Button
                  key={mode}
                  type="button"
                  size="sm"
                  variant={filter === mode ? "default" : "outline"}
                  className={cn(
                    "h-8 text-xs",
                    filter === mode &&
                      "bg-emerald-600 text-white hover:bg-emerald-700",
                  )}
                  onClick={() => setFilter(mode)}
                  disabled={disabled}
                >
                  {FILTER_LABELS[mode]} <b className="ml-1">{count}</b>
                </Button>
              );
            })}
          </div>
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="ค้นหาชื่อสินค้า / รหัส SKU"
              aria-label="ค้นหาสินค้า"
              className="h-8 pl-8 text-sm"
            />
          </div>
        </div>

        {/* Mass tools */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2">
          <span className="text-xs text-muted-foreground">
            เครื่องมือช่วย (ใช้กับ{" "}
            {checked.size > 0
              ? `รายการที่ติดเลือก ${checked.size} รายการ`
              : `ทุกรายการที่แสดง ${visible.length} รายการ`}
            ):
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            <label
              className="flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs"
              title="ตั้งราคาขาย = ต้นทุน × (1 + ส่วนต่าง%)"
            >
              <Percent className="size-3.5 text-muted-foreground" />
              <input
                value={markup}
                onChange={(e) => setMarkup(e.target.value)}
                inputMode="decimal"
                aria-label="ส่วนต่างจากต้นทุนเป็นเปอร์เซ็นต์"
                className="w-12 bg-transparent outline-none"
              />
              <span className="text-muted-foreground">%</span>
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={applyMarkup}
            >
              ตั้งราคาจากต้นทุน +%
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={copyCostToPrice}
            >
              <Coins className="size-3.5" />
              ต้นทุน = ราคา
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={roundPrices}
            >
              ปัดเป็น .00 / .50
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
              onClick={clearAll}
            >
              <RotateCcw className="size-3.5" />
              ล้างค่าที่กรอก
            </Button>
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
          >
            {error}
          </p>
        )}

        {/* Table */}
        <div className="max-h-[55vh] overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted">
              <tr className="text-left">
                <th className="w-10 px-2 py-2 text-center">
                  <input
                    type="checkbox"
                    aria-label="เลือกทุกรายการที่แสดง"
                    checked={
                      visible.length > 0 &&
                      visible.every((p) => checked.has(p.id))
                    }
                    ref={(node) => {
                      if (node)
                        node.indeterminate =
                          visible.some((p) => checked.has(p.id)) &&
                          !visible.every((p) => checked.has(p.id));
                    }}
                    onChange={() => {
                      const allChecked = visible.every((p) =>
                        checked.has(p.id),
                      );
                      setChecked(
                        allChecked
                          ? new Set()
                          : new Set(visible.map((p) => p.id)),
                      );
                    }}
                    disabled={visible.length === 0}
                  />
                </th>
                <th className="px-2 py-2">สินค้า</th>
                <th className="px-2 py-2 text-right">ราคาปัจจุบัน</th>
                <th className="px-2 py-2 text-right">ราคาใหม่</th>
                <th className="px-2 py-2 text-right">ต้นทุนปัจจุบัน</th>
                <th className="px-2 py-2 text-right">ต้นทุนใหม่</th>
                <th className="px-2 py-2 text-right">กำไร/ชิ้น</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((product) => {
                const draft = drafts[product.id] ?? { price: "", cost: "" };
                const draftPrice = parseMoneyInput(draft.price);
                const draftCost = parseMoneyInput(draft.cost);
                const badPrice = draftPrice === "invalid";
                const badCost = draftCost === "invalid";
                const effectivePrice =
                  draftPrice !== null && draftPrice !== "invalid"
                    ? draftPrice
                    : product.price;
                const effectiveCost =
                  draftCost !== null && draftCost !== "invalid"
                    ? draftCost
                    : product.cost;
                const marginBaht = effectivePrice - effectiveCost;
                const marginPct =
                  effectivePrice > 0
                    ? (marginBaht / effectivePrice) * 100
                    : null;
                const dirty = payload.some(
                  (item) => item.productId === product.id,
                );
                return (
                  <tr
                    key={product.id}
                    className={cn(
                      "border-t",
                      dirty && "bg-emerald-50/40",
                    )}
                  >
                    <td className="px-2 py-1.5 text-center">
                      <input
                        type="checkbox"
                        aria-label={`เลือก ${product.name}`}
                        checked={checked.has(product.id)}
                        onChange={() => toggleChecked(product.id)}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="font-medium">{product.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {product.sku}
                        {product.size ? ` · ${product.size}` : ""}
                      </div>
                      {product.price === 0 && (
                        <span className="mt-0.5 inline-block rounded bg-rose-100 px-1.5 py-0.5 text-[10px] text-rose-700">
                          ยังไม่มีราคา
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                      {product.price === 0 ? "—" : money(product.price)}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <input
                        className={cn(
                          "h-8 w-24 rounded-md border bg-background px-2 text-right text-sm tabular-nums outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200",
                          badPrice && "border-rose-400 bg-rose-50",
                        )}
                        value={draft.price}
                        onChange={(e) =>
                          setDraft(product.id, "price", e.target.value)
                        }
                        inputMode="decimal"
                        placeholder={
                          product.price === 0 ? "ยังไม่มีราคา" : money(product.price)
                        }
                        aria-label={`ราคาขายใหม่ของ ${product.name}`}
                        disabled={pending}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                      {product.cost === 0 ? "—" : money(product.cost)}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <input
                        className={cn(
                          "h-8 w-24 rounded-md border bg-background px-2 text-right text-sm tabular-nums outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200",
                          badCost && "border-rose-400 bg-rose-50",
                        )}
                        value={draft.cost}
                        onChange={(e) =>
                          setDraft(product.id, "cost", e.target.value)
                        }
                        inputMode="decimal"
                        placeholder={
                          product.cost === 0 ? "ยังไม่มีต้นทุน" : money(product.cost)
                        }
                        aria-label={`ต้นทุนใหม่ของ ${product.name}`}
                        disabled={pending}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {badPrice || badCost ? (
                        <span className="text-xs text-rose-600">กรอกผิด</span>
                      ) : marginPct === null ? (
                        <span className="text-xs text-muted-foreground">
                          ตั้งราคาก่อน
                        </span>
                      ) : (
                        <span
                          className={cn(
                            "text-xs",
                            marginBaht < 0
                              ? "text-rose-600"
                              : marginPct < 10
                                ? "text-amber-600"
                                : "text-emerald-700",
                          )}
                        >
                          {money(marginBaht)} · {marginPct.toFixed(1)}%
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-6 text-center text-sm text-muted-foreground"
                  >
                    ไม่พบรายการตามเงื่อนไขที่เลือก — ลองเปลี่ยนตัวกรองหรือคำค้น
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <div className="text-sm text-muted-foreground">
            {dirtyCount > 0 ? (
              <span className="inline-flex items-center gap-1">
                <Check className="size-4 text-emerald-600" />
                พร้อมบันทึก <b>{dirtyCount}</b> รายการ
                {invalidIds.length > 0 && (
                  <span className="text-rose-600">
                    {" "}
                    · กรอกผิด {invalidIds.length} ช่อง
                  </span>
                )}
              </span>
            ) : (
              <span>กรอกราคาใหม่/ต้นทุนใหม่ในตารางเพื่อเริ่ม</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={pending}
            >
              <X className="size-4" />
              ปิด
            </Button>
            <Button
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={save}
              disabled={pending || dirtyCount === 0 || invalidIds.length > 0}
            >
              {pending
                ? "กำลังบันทึก…"
                : `บันทึก ${dirtyCount > 0 ? `${dirtyCount} รายการ` : ""}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
