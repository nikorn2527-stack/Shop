"use client";

/**
 * ReceiveForm — receive stock into a lot.
 *
 * Fields:
 *   product        — auto-suggest from search (pre-filled when opened from a card)
 *   lot            — optional, auto-generated as "LOT-YYYYMMDD" if blank
 *   expiryDate     — ThaiDatePicker (Buddhist era)
 *   purchaseQty    — qty paid for (positive integer)
 *   freeQty        — qty given free (positive integer, 0 default)
 *   paidAmount     — total baht actually paid
 *
 * Live preview:
 *   totalQty       = purchaseQty + freeQty
 *   unitCost       = paidAmount / totalQty (0 if totalQty=0)
 *   blendedCost    = weighted avg after receive = (oldStock·oldCost + paidAmount) / (oldStock + totalQty)
 *
 * On submit: POST /api/stock/receive with { productId, lot, expiryDate, qty, cost }
 *   Server computes weighted average cost and returns the new cost.
 *   Success toast shows the new blended cost.
 */

import * as React from "react";
import { PackagePlus, Search, X } from "lucide-react";
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
import { ThaiDatePicker } from "@/components/shared/ThaiDatePicker";
import { money } from "@/lib/format";
import { apiPost } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export interface ReceiveFormProduct {
  id: string;
  name: string;
  sku: string;
  unit: string;
  stock: number;
  cost: number;
}

export interface ReceiveFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: ReceiveFormProduct[];
  /** Pre-selected product (e.g. when opened from a product card). */
  initialProductId?: string;
  onSaved?: () => void;
}

interface ReceiveResponse {
  lotId: string;
  lotName: string;
  totalQty: number;
  newCost: number;
}

export function ReceiveForm({
  open,
  onOpenChange,
  products,
  initialProductId,
  onSaved,
}: ReceiveFormProps) {
  const [productId, setProductId] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [lot, setLot] = React.useState("");
  const [expiry, setExpiry] = React.useState("");
  const [purchaseQty, setPurchaseQty] = React.useState("");
  const [freeQty, setFreeQty] = React.useState("0");
  const [paidAmount, setPaidAmount] = React.useState("");
  const [error, setError] = React.useState("");
  const [pending, setPending] = React.useState(false);

  // Sync from props.
  React.useEffect(() => {
    if (open) {
      setProductId(initialProductId ?? "");
      const product = products.find((p) => p.id === initialProductId);
      setSearch(product ? `${product.name} · ${product.sku}` : "");
      setLot("");
      setExpiry("");
      setPurchaseQty("");
      setFreeQty("0");
      setPaidAmount("");
      setError("");
    }
  }, [open, initialProductId]);

  const selectedProduct = React.useMemo(
    () => products.find((p) => p.id === productId),
    [products, productId],
  );

  // Auto-suggest: filter products by typed search.
  const suggestions = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === "") return products.slice(0, 8);
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(needle) ||
          p.sku.toLowerCase().includes(needle),
      )
      .slice(0, 8);
  }, [products, search]);

  const pickSuggestion = (p: ReceiveFormProduct) => {
    setProductId(p.id);
    setSearch(`${p.name} · ${p.sku}`);
  };

  const preview = React.useMemo(() => {
    const pq = Math.floor(Number(purchaseQty)) || 0;
    const fq = Math.floor(Number(freeQty)) || 0;
    const paid = Number(paidAmount);
    const totalQty = pq + fq;
    const validPaid = Number.isFinite(paid) && paid >= 0 ? paid : 0;
    const unitCost =
      totalQty > 0 && paidAmount.trim() !== ""
        ? Math.round((validPaid / totalQty) * 100) / 100
        : 0;
    const oldQty = Math.max(0, selectedProduct?.stock ?? 0);
    const oldCost = selectedProduct?.cost ?? 0;
    const blended =
      totalQty > 0 && paidAmount.trim() !== ""
        ? Math.round(
            ((oldQty * oldCost + validPaid) / (oldQty + totalQty)) * 100,
          ) / 100
        : null;
    return { pq, fq, paid: validPaid, totalQty, unitCost, blended };
  }, [purchaseQty, freeQty, paidAmount, selectedProduct]);

  const validate = (): string | null => {
    if (!productId) return "กรุณาเลือกสินค้าที่ต้องการรับเข้า (พิมพ์ชื่อหรือรหัสแล้วเลือกจากรายการ)";
    if (!Number.isInteger(preview.pq) || preview.pq <= 0)
      return "จำนวนที่ซื้อต้องเป็นจำนวนเต็มมากกว่า 0";
    if (!Number.isInteger(preview.fq) || preview.fq < 0)
      return "จำนวนแถมต้องเป็นจำนวนเต็ม 0 ขึ้นไป";
    if (!Number.isFinite(preview.paid) || preview.paid < 0)
      return "เงินที่จ่ายจริงต้องเป็นตัวเลข 0 ขึ้นไป";
    return null;
  };

  const handleSubmit = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    setPending(true);
    try {
      const body: Record<string, unknown> = {
        productId,
        qty: preview.totalQty,
      };
      if (lot.trim()) body.lot = lot.trim();
      if (expiry) body.expiryDate = `${expiry}T00:00:00.000Z`;
      if (preview.totalQty > 0 && preview.paid > 0) {
        body.cost = preview.unitCost;
      }
      const result = await apiPost<ReceiveResponse>("/api/stock/receive", body);
      toast.success(
        `รับเข้า ${selectedProduct?.name ?? ""} ${preview.totalQty} ${selectedProduct?.unit ?? "ชิ้น"} สำเร็จ`,
        {
          description: `Lot ${result.lotName} · ต้นทุนเฉลี่ยใหม่ ${money(result.newCost)}`,
        },
      );
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการรับเข้าสต็อก",
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
            <PackagePlus className="size-5 text-emerald-600" />
            รับสินค้าเข้าสต็อก
          </DialogTitle>
          <DialogDescription>
            ระบุสินค้าและจำนวนที่รับเข้า — ระบบจะบันทึก Lot และคำนวณต้นทุนเฉลี่ยใหม่อัตโนมัติ
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
          {/* Product search */}
          <div className="space-y-1.5">
            <Label htmlFor="receive-product-search">สินค้า</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="receive-product-search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  // Clear selection when user types again
                  if (
                    productId &&
                    !e.target.value.includes(
                      products.find((p) => p.id === productId)?.sku ?? "",
                    )
                  ) {
                    setProductId("");
                  }
                }}
                placeholder="พิมพ์ชื่อหรือรหัส SKU แล้วเลือกจากรายการ"
                className="pl-8"
                autoComplete="off"
              />
              {selectedProduct && (
                <button
                  type="button"
                  onClick={() => {
                    setProductId("");
                    setSearch("");
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="ล้างสินค้าที่เลือก"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            {/* Suggestions */}
            {!selectedProduct && suggestions.length > 0 && (
              <div className="max-h-40 overflow-auto rounded-md border bg-popover">
                {suggestions.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pickSuggestion(p)}
                    className="flex w-full items-center justify-between gap-2 border-b px-3 py-1.5 text-left text-sm last:border-b-0 hover:bg-accent"
                  >
                    <span className="font-medium">{p.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {p.sku} · คงเหลือ {p.stock} {p.unit}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {selectedProduct && (
              <p className="text-xs text-muted-foreground">
                คงเหลือปัจจุบัน {selectedProduct.stock}{" "}
                {selectedProduct.unit} · ต้นทุนเดิม {money(selectedProduct.cost)}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="receive-lot">Lot (ไม่ระบุ = อัตโนมัติ)</Label>
              <Input
                id="receive-lot"
                value={lot}
                onChange={(e) => setLot(e.target.value)}
                placeholder="LOT-20260918"
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label>วันหมดอายุ</Label>
              <ThaiDatePicker
                value={expiry}
                onChange={setExpiry}
                disabled={pending}
                placeholder="ไม่ระบุ"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="receive-purchase-qty">จำนวนที่ซื้อ</Label>
              <Input
                id="receive-purchase-qty"
                value={purchaseQty}
                onChange={(e) => setPurchaseQty(e.target.value)}
                inputMode="numeric"
                placeholder="0"
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="receive-free-qty">จำนวนแถม</Label>
              <Input
                id="receive-free-qty"
                value={freeQty}
                onChange={(e) => setFreeQty(e.target.value)}
                inputMode="numeric"
                placeholder="0"
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="receive-paid-amount">เงินที่จ่าย (฿)</Label>
              <Input
                id="receive-paid-amount"
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                disabled={pending}
              />
            </div>
          </div>

          {/* Preview */}
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-xs text-muted-foreground">รับเข้ารวม</div>
                <div className="font-medium tabular-nums">
                  {preview.totalQty} {selectedProduct?.unit ?? "ชิ้น"}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">ต้นทุน/หน่วยใหม่</div>
                <div className="font-medium tabular-nums">
                  {preview.totalQty > 0 && preview.paid > 0
                    ? money(preview.unitCost)
                    : "—"}
                </div>
              </div>
              <div className="col-span-2 border-t pt-2">
                <div className="text-xs text-muted-foreground">
                  ต้นทุนเฉลี่ยถัวไปหลังรับเข้า
                </div>
                <div
                  className={cn(
                    "font-semibold tabular-nums",
                    preview.blended !== null &&
                      selectedProduct &&
                      preview.blended < selectedProduct.cost &&
                      "text-amber-600",
                    preview.blended !== null &&
                      selectedProduct &&
                      preview.blended > selectedProduct.cost &&
                      "text-emerald-700",
                  )}
                >
                  {preview.blended !== null ? money(preview.blended) : "—"}
                </div>
              </div>
            </div>
          </div>
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
            disabled={pending}
          >
            {pending ? "กำลังบันทึก…" : "บันทึกรับเข้า"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
