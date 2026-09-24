"use client";

/**
 * ProductEditModal — create/edit product.
 *
 * Fields:
 *   name (required)
 *   sku (auto-suggest from category — server finalizes)
 *   barcode
 *   category (select)
 *   emoji (text)
 *   color (text)
 *   unit (text)
 *   price, cost
 *   reorderPoint
 *   size (number + unit dropdown)
 *   imageUrl (file → compressImageToDataUrl 480px)
 *   sellMode (unit | money)
 *   priceTiers (when money — array of {label, price, qty})
 *   quickPick (toggle)
 *
 * On submit:
 *   - create mode: POST /api/products
 *   - edit mode:   PATCH /api/products/[id]
 */

import * as React from "react";
import { ImagePlus, PackagePlus, Trash2, X } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { compressImageToDataUrl } from "@/lib/scan";
import { apiPost, apiPatch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { money } from "@/lib/format";

export interface CategoryOption {
  id: string;
  name: string;
  skuPrefix?: string | null;
}

export interface ProductEditLot {
  id: string;
  lot: string;
  qty: number;
  cost: number;
  expiryDate?: Date | string | null;
  receivedAt: Date | string;
}

export interface ProductEditProduct {
  id: string;
  sku: string;
  barcode?: string | null;
  name: string;
  categoryId?: string | null;
  category?: { id: string; name: string } | null;
  emoji?: string;
  color?: string;
  unit: string;
  price: number;
  cost: number;
  stock: number;
  reorderPoint: number;
  active: boolean;
  size?: string | null;
  imageUrl?: string | null;
  quickPick: boolean;
  sellMode: string;
  priceTiers?: string | null;
}

export interface ProductEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing product when editing; null/undefined when creating. */
  product?: ProductEditProduct | null;
  categories: CategoryOption[];
  /** All products (for SKU auto-suggest preview). */
  products: ProductEditProduct[];
  onSaved?: () => void;
}

interface TierRow {
  label: string;
  price: string;
  qty: string;
}

const SIZE_UNIT_OPTIONS = [
  "มล.",
  "ลิตร",
  "กรัม",
  "กก.",
  "ชิ้น",
  "แพ็ก",
  "ถุง",
  "ขวด",
  "กล่อง",
] as const;

const CATEGORY_PREFIX_FALLBACK: Record<string, string> = {
  "เครื่องดื่ม": "DRK",
  อาหาร: "FD",
  "ของใช้ส่วนตัว": "HYG",
  ของใช้: "HYG",
  "ของใช้ในครัวเรือน": "HH",
  ขนม: "SNK",
  เครื่องเขียน: "ST",
};

const EMOJI_PRESETS = ["📦", "🛍️", "🥤", "🍪", "🍜", "🧴", "🪥", "✏️", "🍫", "🍵"];
const COLOR_PRESETS = [
  "#10b981",
  "#6d6157",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#0ea5e9",
  "#f43f5e",
  "#84cc16",
];

function parseSizeInput(size: string | null | undefined): {
  num: string;
  unit: string;
} {
  const trimmed = (size ?? "").trim();
  if (!trimmed) return { num: "", unit: "มล." };
  const match = /^(\d+(?:\.\d+)?)\s*(.+)$/.exec(trimmed);
  if (!match) return { num: "", unit: "มล." };
  return {
    num: match[1]!,
    unit: SIZE_UNIT_OPTIONS.includes(match[2] as never)
      ? match[2]!
      : match[2]!,
  };
}

function composeSize(num: string, unit: string): string {
  return num.trim() === "" ? "" : `${num.trim()} ${unit.trim()}`;
}

function parseTierRows(json?: string | null): TierRow[] {
  if (!json) return [{ label: "", price: "", qty: "" }];
  try {
    const parsed = JSON.parse(json) as Array<{
      label?: unknown;
      price?: unknown;
      qty?: unknown;
    }>;
    if (!Array.isArray(parsed) || parsed.length === 0)
      return [{ label: "", price: "", qty: "" }];
    return parsed.map((tier) => ({
      label: String(tier.label ?? ""),
      price: String(tier.price ?? ""),
      qty: String(tier.qty ?? ""),
    }));
  } catch {
    return [{ label: "", price: "", qty: "" }];
  }
}

function serializeTierRows(rows: TierRow[]): {
  error?: string;
  json: string | null;
  minPrice: number;
} {
  const tiers = rows
    .map((row) => ({
      label: row.label.trim(),
      price: Number(row.price),
      qty: Number(row.qty),
    }))
    .filter(
      (tier) =>
        tier.label !== "" ||
        (Number.isFinite(tier.price) && tier.price !== 0) ||
        (Number.isFinite(tier.qty) && tier.qty !== 0),
    );
  if (tiers.length === 0) return { json: null, minPrice: 0 };
  for (const tier of tiers) {
    if (!tier.label)
      return {
        error: "ช่องราคาต้องมีชื่อขนาด เช่น “200 กรัม”",
        json: null,
        minPrice: 0,
      };
    if (!(tier.price > 0))
      return {
        error: `ช่องราคา “${tier.label}” ต้องมีราคามากกว่า 0`,
        json: null,
        minPrice: 0,
      };
    if (!(tier.qty > 0))
      return {
        error: `ช่องราคา “${tier.label}” ต้องมีปริมาณมากกว่า 0`,
        json: null,
        minPrice: 0,
      };
  }
  return {
    json: JSON.stringify(tiers),
    minPrice: Math.min(...tiers.map((t) => t.price)),
  };
}

export function ProductEditModal({
  open,
  onOpenChange,
  product,
  categories,
  products,
  onSaved,
}: ProductEditModalProps) {
  const isEdit = Boolean(product);
  const [name, setName] = React.useState("");
  const [sku, setSku] = React.useState("");
  const [barcode, setBarcode] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("");
  const [emoji, setEmoji] = React.useState("📦");
  const [color, setColor] = React.useState("#6d6157");
  const [unit, setUnit] = React.useState("ชิ้น");
  const [price, setPrice] = React.useState("");
  const [cost, setCost] = React.useState("");
  const [reorderPoint, setReorderPoint] = React.useState("10");
  const [sizeNum, setSizeNum] = React.useState("");
  const [sizeUnit, setSizeUnit] = React.useState<string>("มล.");
  const [imageUrl, setImageUrl] = React.useState("");
  const [sellMode, setSellMode] = React.useState<"unit" | "money">("unit");
  const [quickPick, setQuickPick] = React.useState(false);
  const [tiers, setTiers] = React.useState<TierRow[]>([
    { label: "", price: "", qty: "" },
  ]);
  const [error, setError] = React.useState("");
  const [pending, setPending] = React.useState(false);

  // Reset form whenever modal opens or product changes.
  React.useEffect(() => {
    if (!open) return;
    if (product) {
      const parsedSize = parseSizeInput(product.size);
      setName(product.name);
      setSku(product.sku);
      setBarcode(product.barcode ?? "");
      setCategoryId(product.category?.id ?? product.categoryId ?? "");
      setEmoji(product.emoji ?? "📦");
      setColor(product.color ?? "#6d6157");
      setUnit(product.unit);
      setPrice(String(product.price));
      setCost(String(product.cost));
      setReorderPoint(String(product.reorderPoint));
      setSizeNum(parsedSize.num);
      setSizeUnit(parsedSize.unit);
      setImageUrl(product.imageUrl ?? "");
      setSellMode(product.sellMode === "money" ? "money" : "unit");
      setQuickPick(product.quickPick);
      setTiers(parseTierRows(product.priceTiers));
    } else {
      setName("");
      setSku("");
      setBarcode("");
      setCategoryId(categories[0]?.id ?? "");
      setEmoji("📦");
      setColor("#6d6157");
      setUnit("ชิ้น");
      setPrice("");
      setCost("");
      setReorderPoint("10");
      setSizeNum("");
      setSizeUnit("มล.");
      setImageUrl("");
      setSellMode("unit");
      setQuickPick(false);
      setTiers([{ label: "", price: "", qty: "" }]);
    }
    setError("");
  }, [open, product]);

  // Auto-suggest SKU preview based on category.
  const skuPreview = React.useMemo(() => {
    const category = categories.find((c) => c.id === categoryId);
    if (!category) return null;
    const prefix =
      category.skuPrefix ?? CATEGORY_PREFIX_FALLBACK[category.name] ?? "GEN";
    let maxSeq = 0;
    for (const p of products) {
      const match = /^([A-Z]+)-(\d{3,})$/.exec(p.sku);
      if (match && match[1] === prefix) maxSeq = Math.max(maxSeq, Number(match[2]));
    }
    return `${prefix}-${String(maxSeq + 1).padStart(3, "0")}`;
  }, [categories, categoryId, products]);

  const handleImageFile = async (file?: File) => {
    if (!file) return;
    try {
      const dataUrl = await compressImageToDataUrl(file);
      setImageUrl(dataUrl);
      setError("");
    } catch {
      setError("อ่านไฟล์รูปไม่สำเร็จ · ลองใช้ไฟล์ JPG หรือ PNG ไฟล์อื่น");
    }
  };

  const addTier = () =>
    setTiers((prev) => [...prev, { label: "", price: "", qty: "" }]);
  const removeTier = (idx: number) =>
    setTiers((prev) => prev.filter((_, i) => i !== idx));
  const updateTier = (idx: number, field: keyof TierRow, value: string) =>
    setTiers((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, [field]: value } : row)),
    );

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("กรุณาระบุชื่อสินค้า");
      return;
    }
    const isMoney = sellMode === "money";
    const tierResult = serializeTierRows(tiers);
    if (isMoney && tierResult.error) {
      setError(tierResult.error);
      return;
    }
    if (isMoney && !tierResult.json) {
      setError(
        "สินค้าขายเป็นราคา ต้องมีช่องราคาอย่างน้อย 1 ช่อง เช่น ฿1 = 200 กรัม",
      );
      return;
    }
    const finalPrice = isMoney
      ? tierResult.minPrice
      : price.trim() === ""
        ? 0
        : Number(price);
    if (!Number.isFinite(finalPrice) || finalPrice < 0) {
      setError("ราคาขายต้องเป็นตัวเลข 0 ขึ้นไป");
      return;
    }
    const finalCost = cost.trim() === "" ? 0 : Number(cost);
    if (!Number.isFinite(finalCost) || finalCost < 0) {
      setError("ต้นทุนต้องเป็นตัวเลข 0 ขึ้นไป");
      return;
    }
    const finalReorder = Number(reorderPoint);
    if (!Number.isInteger(finalReorder) || finalReorder < 0) {
      setError("จุดสั่งซื้อขั้นต่ำต้องเป็นจำนวนเต็ม 0 ขึ้นไป");
      return;
    }

    const body: Record<string, unknown> = {
      name: trimmedName,
      barcode: barcode.trim() || null,
      categoryId: categoryId || null,
      emoji: emoji.trim() || "📦",
      color: color.trim() || "#6d6157",
      unit: unit.trim() || "ชิ้น",
      price: finalPrice,
      cost: finalCost,
      reorderPoint: finalReorder,
      size: composeSize(sizeNum, sizeUnit) || null,
      imageUrl: imageUrl || null,
      sellMode: isMoney ? "money" : "unit",
      priceTiers: isMoney ? tierResult.json : null,
      quickPick,
    };
    if (!isEdit && sku.trim()) {
      body.sku = sku.trim();
    }

    setError("");
    setPending(true);
    try {
      if (isEdit && product) {
        await apiPatch(`/api/products/${product.id}`, body);
        toast.success(`บันทึกการแก้ไข ${trimmedName} เรียบร้อย`);
      } else {
        await apiPost("/api/products", body);
        toast.success(`เพิ่มสินค้า ${trimmedName} เข้ารายการแล้ว`);
      }
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการบันทึกสินค้า",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(n) => !n && !pending && onOpenChange(n)}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackagePlus className="size-5 text-emerald-600" />
            {isEdit ? "แก้ไขสินค้า" : "เพิ่มสินค้าใหม่"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? `แก้ไขข้อมูลสินค้า · รหัส ${product?.sku ?? ""}`
              : "กรอกข้อมูลสินค้าใหม่ · รหัส SKU จะถูกสร้างอัตโนมัติจากหมวดหมู่"}
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Name */}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="prod-name">ชื่อสินค้า *</Label>
            <Input
              id="prod-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น น้ำดื่มคริสตัล 600 มล."
              disabled={pending}
            />
          </div>

          {/* SKU */}
          <div className="space-y-1.5">
            <Label htmlFor="prod-sku">รหัส SKU (ไม่ระบุ = อัตโนมัติ)</Label>
            <Input
              id="prod-sku"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder={skuPreview ?? "DRK-001"}
              disabled={pending}
            />
            {!sku.trim() && skuPreview && (
              <p className="text-xs text-muted-foreground">
                แนะนำ: <b>{skuPreview}</b>
              </p>
            )}
          </div>

          {/* Barcode */}
          <div className="space-y-1.5">
            <Label htmlFor="prod-barcode">บาร์โค้ด</Label>
            <Input
              id="prod-barcode"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="8851234567890"
              disabled={pending}
            />
          </div>

          {/* Category */}
          <div className="space-y-1.5">
            <Label htmlFor="prod-category">หมวดหมู่</Label>
            <Select
              value={categoryId}
              onValueChange={setCategoryId}
              disabled={pending}
            >
              <SelectTrigger id="prod-category" className="w-full">
                <SelectValue placeholder="เลือกหมวดหมู่" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Unit */}
          <div className="space-y-1.5">
            <Label htmlFor="prod-unit">หน่วยขาย</Label>
            <Input
              id="prod-unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="ชิ้น"
              disabled={pending}
            />
          </div>

          {/* Price + Cost */}
          <div className="space-y-1.5">
            <Label htmlFor="prod-price">ราคาขาย (฿)</Label>
            <Input
              id="prod-price"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              disabled={pending || sellMode === "money"}
            />
            {sellMode === "money" && (
              <p className="text-xs text-muted-foreground">
                ตั้งราคาจากช่องราคาด้านล่าง — ต่ำสุด{" "}
                {tiers.length > 0 && tiers.some((t) => t.price !== "")
                  ? money(Math.min(...tiers.filter((t) => t.price !== "").map((t) => Number(t.price))))
                  : "—"}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prod-cost">ต้นทุน (฿)</Label>
            <Input
              id="prod-cost"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              disabled={pending}
            />
          </div>

          {/* Reorder point */}
          <div className="space-y-1.5">
            <Label htmlFor="prod-reorder">จุดสั่งซื้อขั้นต่ำ</Label>
            <Input
              id="prod-reorder"
              value={reorderPoint}
              onChange={(e) => setReorderPoint(e.target.value)}
              inputMode="numeric"
              placeholder="10"
              disabled={pending}
            />
          </div>

          {/* Size */}
          <div className="space-y-1.5">
            <Label htmlFor="prod-size-num">ขนาด</Label>
            <div className="flex gap-1">
              <Input
                id="prod-size-num"
                value={sizeNum}
                onChange={(e) => setSizeNum(e.target.value)}
                inputMode="decimal"
                placeholder="500"
                disabled={pending}
                className="flex-1"
              />
              <select
                value={sizeUnit}
                onChange={(e) => setSizeUnit(e.target.value)}
                disabled={pending}
                className="h-9 rounded-md border bg-background px-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200"
              >
                {SIZE_UNIT_OPTIONS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Emoji */}
          <div className="space-y-1.5">
            <Label htmlFor="prod-emoji">อิโมจิ</Label>
            <div className="flex gap-2">
              <Input
                id="prod-emoji"
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                placeholder="📦"
                disabled={pending}
                className="w-20 text-center text-xl"
              />
              <div className="flex flex-wrap gap-1">
                {EMOJI_PRESETS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setEmoji(e)}
                    className={cn(
                      "size-8 rounded-md border text-lg transition-colors hover:bg-accent",
                      emoji === e && "border-emerald-500 bg-emerald-50",
                    )}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Color */}
          <div className="space-y-1.5">
            <Label htmlFor="prod-color">สี</Label>
            <div className="flex items-center gap-2">
              <Input
                id="prod-color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#10b981"
                disabled={pending}
                className="w-28"
              />
              <div className="flex flex-wrap gap-1">
                {COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    aria-label={`เลือกสี ${c}`}
                    className={cn(
                      "size-6 rounded-full border-2 transition-transform hover:scale-110",
                      color === c ? "border-foreground" : "border-transparent",
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Sell mode */}
          <div className="space-y-1.5 sm:col-span-2">
            <Label>โหมดขาย</Label>
            <div className="flex gap-1 rounded-md border bg-muted/40 p-1">
              <Button
                type="button"
                size="sm"
                variant={sellMode === "unit" ? "default" : "ghost"}
                className={cn(
                  "h-8 flex-1 text-xs",
                  sellMode === "unit" &&
                    "bg-emerald-600 text-white hover:bg-emerald-700",
                )}
                onClick={() => setSellMode("unit")}
              >
                ขายเป็นชิ้น
              </Button>
              <Button
                type="button"
                size="sm"
                variant={sellMode === "money" ? "default" : "ghost"}
                className={cn(
                  "h-8 flex-1 text-xs",
                  sellMode === "money" &&
                    "bg-emerald-600 text-white hover:bg-emerald-700",
                )}
                onClick={() => setSellMode("money")}
              >
                ขายเป็นราคา (เช่น น้ำแข็ง/ของชั่ง)
              </Button>
            </div>
          </div>

          {/* Price tiers */}
          {sellMode === "money" && (
            <div className="space-y-2 sm:col-span-2">
              <Label>ช่องราคา (tier)</Label>
              <p className="text-xs text-muted-foreground">
                เช่น 200 กรัม = ฿20 · 500 กรัม = ฿45 — ระบบจะเลือก tier ตามจำนวนเงินที่รับ
              </p>
              <div className="space-y-2">
                {tiers.map((tier, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-[1fr_100px_100px_auto] items-center gap-2"
                  >
                    <Input
                      value={tier.label}
                      onChange={(e) => updateTier(idx, "label", e.target.value)}
                      placeholder="ชื่อขนาด เช่น 200 กรัม"
                      disabled={pending}
                    />
                    <Input
                      value={tier.price}
                      onChange={(e) => updateTier(idx, "price", e.target.value)}
                      inputMode="decimal"
                      placeholder="ราคา ฿"
                      disabled={pending}
                    />
                    <Input
                      value={tier.qty}
                      onChange={(e) => updateTier(idx, "qty", e.target.value)}
                      inputMode="numeric"
                      placeholder="ปริมาณ"
                      disabled={pending}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                      onClick={() => removeTier(idx)}
                      disabled={pending || tiers.length === 1}
                      aria-label="ลบ tier"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addTier}
                disabled={pending}
              >
                + เพิ่มช่องราคา
              </Button>
            </div>
          )}

          {/* Image */}
          <div className="space-y-1.5 sm:col-span-2">
            <Label>รูปสินค้า</Label>
            <div className="flex items-center gap-3">
              <div
                className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted"
                aria-label="พรีวิวรูปสินค้า"
              >
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt="พรีวิวรูปสินค้า"
                    className="size-full object-cover"
                  />
                ) : (
                  <ImagePlus className="size-6 text-muted-foreground" />
                )}
              </div>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleImageFile(e.target.files?.[0])}
                disabled={pending}
                className="hidden"
                id="prod-image-file"
              />
              <div className="flex flex-col gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    document.getElementById("prod-image-file")?.click()
                  }
                  disabled={pending}
                >
                  <ImagePlus className="size-4" />
                  เลือกไฟล์รูป
                </Button>
                {imageUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setImageUrl("")}
                    disabled={pending}
                    className="text-xs text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                  >
                    <X className="size-3.5" />
                    ลบรูป
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Quick pick */}
          <div className="sm:col-span-2 flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="prod-quickpick" className="cursor-pointer">
                ตั้งเป็นเมนูลัด (Quick Pick)
              </Label>
              <p className="text-xs text-muted-foreground">
                แสดงบนรางเลือกด่วนที่ POS
              </p>
            </div>
            <Switch
              id="prod-quickpick"
              checked={quickPick}
              onCheckedChange={setQuickPick}
              disabled={pending}
            />
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
            {pending ? "กำลังบันทึก…" : isEdit ? "บันทึกการแก้ไข" : "เพิ่มสินค้า"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
