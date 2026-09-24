"use client";

/**
 * CountForm — stock count.
 *
 * 2 modes:
 *   total — single countedQty input + note → POST /api/stock/count
 *           { productId, countedQty, note }
 *   lots  — list of lots with their own countedQty + note → POST /api/stock/count-lots
 *           { counts: [{ lotId, countedQty }], note }
 *
 * Shows diff (counted - system) per line.
 */

import * as React from "react";
import { ClipboardList, PackageSearch } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { apiPost } from "@/lib/api-client";
import { formatThaiDate } from "@/lib/format";

export interface CountFormLot {
  id: string;
  lot: string;
  qty: number;
  cost: number;
  expiryDate?: Date | string | null;
  receivedAt: Date | string;
}

export interface CountFormProduct {
  id: string;
  name: string;
  sku: string;
  unit: string;
  stock: number;
  lots?: CountFormLot[];
}

type Mode = "total" | "lots";

export interface CountFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: CountFormProduct[];
  initialProductId?: string;
  onSaved?: () => void;
}

interface CountTotalResponse {
  stockCountId: string;
  systemQty: number;
  countedQty: number;
  diff: number;
}

interface CountLotsResponse {
  stockCountId: string;
  summaries: {
    lotId: string;
    productId: string;
    productName: string;
    systemQty: number;
    countedQty: number;
    diff: number;
  }[];
}

export function CountForm({
  open,
  onOpenChange,
  products,
  initialProductId,
  onSaved,
}: CountFormProps) {
  const [productId, setProductId] = React.useState("");
  const [mode, setMode] = React.useState<Mode>("total");
  const [countedQty, setCountedQty] = React.useState("");
  const [lotCounts, setLotCounts] = React.useState<Record<string, string>>({});
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState("");
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setProductId(initialProductId ?? "");
      setMode(initialProductId ? "total" : "total");
      setCountedQty("");
      setLotCounts({});
      setNote("");
      setError("");
    }
  }, [open, initialProductId]);

  const selectedProduct = React.useMemo(
    () => products.find((p) => p.id === productId),
    [products, productId],
  );

  const lots = selectedProduct?.lots ?? [];

  const lotEntries = React.useMemo(() => {
    return lots.map((lot) => {
      const raw = lotCounts[lot.id] ?? String(lot.qty);
      const parsed = raw.trim() === "" ? Number.NaN : Number(raw);
      const valid = Number.isInteger(parsed) && parsed >= 0;
      return {
        lot,
        raw,
        parsed,
        valid,
        diff: valid ? parsed - lot.qty : null,
      };
    });
  }, [lots, lotCounts]);

  const lotCountsValid =
    lotEntries.length > 0 && lotEntries.every((entry) => entry.valid);
  const lotTotal = lotEntries.reduce(
    (sum, entry) => sum + (entry.valid ? entry.parsed : 0),
    0,
  );
  const lotTotalDiff =
    selectedProduct && lotCountsValid ? lotTotal - selectedProduct.stock : null;

  const countedInput = countedQty.trim() === "" ? null : Number(countedQty);
  const totalDiff =
    selectedProduct && countedInput !== null && Number.isFinite(countedInput)
      ? countedInput - selectedProduct.stock
      : null;

  const handleSubmit = async () => {
    if (!selectedProduct) {
      setError("กรุณาเลือกสินค้าที่ต้องการนับสต็อก");
      return;
    }
    if (mode === "total") {
      if (
        countedInput === null ||
        !Number.isInteger(countedInput) ||
        countedInput < 0
      ) {
        setError("จำนวนที่นับได้ต้องเป็นจำนวนเต็ม 0 ขึ้นไป");
        return;
      }
      setError("");
      setPending(true);
      try {
        const result = await apiPost<CountTotalResponse>("/api/stock/count", {
          productId: selectedProduct.id,
          countedQty: countedInput,
          note: note.trim() || undefined,
        });
        toast.success(
          `นับสต็อก ${selectedProduct.name} บันทึกแล้ว`,
          {
            description: `ระบบ ${result.systemQty} → นับ ${result.countedQty} ${
              selectedProduct.unit
            } (${result.diff >= 0 ? "+" : ""}${result.diff})`,
          },
        );
        onSaved?.();
        onOpenChange(false);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการนับสต็อก",
        );
      } finally {
        setPending(false);
      }
      return;
    }

    // Lots mode
    if (!lotCountsValid) {
      setError("จำนวนที่นับได้ทุก Lot ต้องเป็นจำนวนเต็ม 0 ขึ้นไป");
      return;
    }
    setError("");
    setPending(true);
    try {
      const result = await apiPost<CountLotsResponse>("/api/stock/count-lots", {
        counts: lotEntries.map((entry) => ({
          lotId: entry.lot.id,
          countedQty: entry.parsed,
        })),
        note: note.trim() || undefined,
      });
      const totalDiff = result.summaries.reduce((s, x) => s + x.diff, 0);
      toast.success(
        `นับสต็อก (แยก Lot) ${selectedProduct.name} บันทึกแล้ว`,
        {
          description: `${result.summaries.length} lot · ผลต่างรวม ${
            totalDiff >= 0 ? "+" : ""
          }${totalDiff}`,
        },
      );
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการนับสต็อก",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(n) => !n && !pending && onOpenChange(n)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="size-5 text-emerald-600" />
            นับสต็อกสินค้า
          </DialogTitle>
          <DialogDescription>
            เลือกสินค้าและโหมดการนับ — “รวม” กรอกยอดรวม · “แยก Lot” กรอกแยกตามล็อต
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
          >
            {error}
          </p>
        )}

        <div className="space-y-3">
          {/* Product select */}
          <div className="space-y-1.5">
            <Label htmlFor="count-product">สินค้า</Label>
            <div className="relative">
              <PackageSearch className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <select
                id="count-product"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                disabled={pending}
                className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200"
              >
                <option value="">เลือกสินค้า…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.sku} · คงเหลือ {p.stock} {p.unit}
                  </option>
                ))}
              </select>
            </div>
            {selectedProduct && (
              <p className="text-xs text-muted-foreground">
                คงเหลือในระบบ {selectedProduct.stock}{" "}
                {selectedProduct.unit}
                {lots.length > 0 && ` · ${lots.length} ล็อต`}
              </p>
            )}
          </div>

          {/* Mode toggle */}
          {selectedProduct && (
            <div className="flex gap-1 rounded-md border bg-muted/40 p-1">
              <Button
                type="button"
                size="sm"
                variant={mode === "total" ? "default" : "ghost"}
                className={cn(
                  "h-8 flex-1 text-xs",
                  mode === "total" &&
                    "bg-emerald-600 text-white hover:bg-emerald-700",
                )}
                onClick={() => setMode("total")}
              >
                นับรวม
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "lots" ? "default" : "ghost"}
                className={cn(
                  "h-8 flex-1 text-xs",
                  mode === "lots" &&
                    "bg-emerald-600 text-white hover:bg-emerald-700",
                )}
                onClick={() => setMode("lots")}
                disabled={lots.length === 0}
              >
                นับแยก Lot {lots.length > 0 ? `(${lots.length})` : ""}
              </Button>
            </div>
          )}

          {/* Total mode */}
          {selectedProduct && mode === "total" && (
            <div className="space-y-1.5">
              <Label htmlFor="count-qty">จำนวนที่นับได้ (รวมทุก Lot)</Label>
              <Input
                id="count-qty"
                value={countedQty}
                onChange={(e) => setCountedQty(e.target.value)}
                inputMode="numeric"
                placeholder="0"
                disabled={pending}
                className="text-lg tabular-nums"
              />
              {totalDiff !== null && (
                <p
                  className={cn(
                    "text-sm font-medium tabular-nums",
                    totalDiff === 0
                      ? "text-emerald-700"
                      : totalDiff > 0
                        ? "text-amber-600"
                        : "text-rose-600",
                  )}
                >
                  ผลต่าง {totalDiff >= 0 ? "+" : ""}
                  {totalDiff} {selectedProduct.unit}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {totalDiff === 0
                      ? "ตรงกับระบบ"
                      : totalDiff > 0
                        ? "เกินจากระบบ"
                        : "ขาดจากระบบ"}
                  </span>
                </p>
              )}
            </div>
          )}

          {/* Lots mode */}
          {selectedProduct && mode === "lots" && (
            <div className="space-y-2">
              {lots.length === 0 ? (
                <p className="rounded-md border bg-muted/30 px-3 py-4 text-center text-sm text-muted-foreground">
                  สินค้านี้ยังไม่มี Lot — รับเข้าก่อนเพื่อสร้าง Lot แรก
                </p>
              ) : (
                <div className="space-y-2 max-h-60 overflow-auto rounded-md border p-2">
                  {lotEntries.map((entry) => (
                    <div
                      key={entry.lot.id}
                      className="grid grid-cols-[1fr_auto] items-center gap-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {entry.lot.lot}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          ระบบ {entry.lot.qty} ·{" "}
                          {entry.lot.expiryDate
                            ? `หมดอายุ ${formatThaiDate(entry.lot.expiryDate)}`
                            : "ไม่ระบุวันหมดอายุ"}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          value={entry.raw}
                          onChange={(e) =>
                            setLotCounts((prev) => ({
                              ...prev,
                              [entry.lot.id]: e.target.value,
                            }))
                          }
                          inputMode="numeric"
                          aria-label={`จำนวนที่นับได้สำหรับ Lot ${entry.lot.lot}`}
                          disabled={pending}
                          className={cn(
                            "h-8 w-20 text-right tabular-nums",
                            !entry.valid && entry.raw !== "" &&
                              "border-rose-400 bg-rose-50",
                          )}
                        />
                        <span
                          className={cn(
                            "w-12 text-right text-xs font-medium tabular-nums",
                            entry.diff === null
                              ? "text-muted-foreground"
                              : entry.diff === 0
                                ? "text-emerald-700"
                                : entry.diff > 0
                                  ? "text-amber-600"
                                  : "text-rose-600",
                          )}
                        >
                          {entry.diff === null
                            ? "—"
                            : `${entry.diff > 0 ? "+" : ""}${entry.diff}`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {lotCountsValid && lotTotalDiff !== null && (
                <p
                  className={cn(
                    "text-sm font-medium tabular-nums",
                    lotTotalDiff === 0
                      ? "text-emerald-700"
                      : lotTotalDiff > 0
                        ? "text-amber-600"
                        : "text-rose-600",
                  )}
                >
                  ผลต่างรวม {lotTotalDiff >= 0 ? "+" : ""}
                  {lotTotalDiff} {selectedProduct.unit}
                </p>
              )}
            </div>
          )}

          {/* Note */}
          {selectedProduct && (
            <div className="space-y-1.5">
              <Label htmlFor="count-note">หมายเหตุ (ถ้ามี)</Label>
              <Textarea
                id="count-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="เช่น ตัดจำหน่ายผิด / สินค้าเสีย / ของหาย"
                disabled={pending}
                rows={2}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            ยกเลิก
          </Button>
          <Button
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={handleSubmit}
            disabled={pending || !selectedProduct}
          >
            {pending ? "กำลังบันทึก…" : "บันทึกการนับ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
