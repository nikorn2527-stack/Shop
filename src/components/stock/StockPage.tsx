"use client";

/**
 * StockPage — main inventory page.
 *
 * Layout:
 *   - Top tabs: inventory | orders (procurement helper list)
 *   - Toolbar: status filter (ทั้งหมด/ปกติ/สต็อกต่ำ/ใกล้หมดอายุ/ปิดการขาย)
 *              + search input + camera scan button
 *   - 4 stat cards: สินค้าทั้งหมด / สต็อกต่ำ / ใกล้หมดอายุ / มูลค่าคงคลัง (Σ stock × cost)
 *   - Product list: expandable cards
 *   - Expanded view: lot list + action buttons
 *
 * Actions per product:
 *   แก้ไข    → ProductEditModal
 *   รับเข้า   → ReceiveForm
 *   นับสต็อก → CountForm (total | lots)
 *   เปิด/ปิด  → PATCH /api/products/[id] { active }
 *   ลบ       → ConfirmDialog → DELETE /api/products/[id]
 *
 * Mobile-first responsive (1 col mobile, 2 cols md, 3 cols xl).
 */

import * as React from "react";
import {
  Boxes,
  Camera,
  ChevronRight,
  ClipboardList,
  Coins,
  Eye,
  EyeOff,
  Package,
  PackagePlus,
  Pencil,
  Plus,
  Printer,
  Search,
  SlidersHorizontal,
  Trash2,
  TrendingDown,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { money, formatThaiDate } from "@/lib/format";
import { apiGet, apiPatch, apiDelete } from "@/lib/api-client";
import { StatusPill } from "@/components/shared/StatusPill";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ProductEditModal, type CategoryOption, type ProductEditProduct } from "./ProductEditModal";
import { ReceiveForm, type ReceiveFormProduct } from "./ReceiveForm";
import { CountForm, type CountFormProduct } from "./CountForm";
import { BulkPriceModal } from "./BulkPriceModal";
import { StockCountSheet } from "./StockCountSheet";

// ----- Types -----

interface Lot {
  id: string;
  lot: string;
  qty: number;
  cost: number;
  expiryDate?: string | null;
  receivedAt: string;
}

interface Product {
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
  lots?: Lot[];
}

interface ProductsResponse {
  products: Product[];
}

interface CategoriesResponse {
  categories: CategoryOption[];
}

type StatusFilter =
  | "ทั้งหมด"
  | "ปกติ"
  | "สต็อกต่ำ"
  | "ใกล้หมดอายุ"
  | "ปิดการขาย";

const STATUS_FILTERS: StatusFilter[] = [
  "ทั้งหมด",
  "ปกติ",
  "สต็อกต่ำ",
  "ใกล้หมดอายุ",
  "ปิดการขาย",
];

const EXPIRY_ALERT_DAYS = 30;

/** Compute the status of a product (used for filter + pill). */
function productStatus(p: Product): StatusFilter {
  if (!p.active) return "ปิดการขาย";
  const lots = p.lots ?? [];
  const now = Date.now();
  const nearExpiry = lots.some((lot) => {
    if (!lot.expiryDate) return false;
    const diff = new Date(lot.expiryDate).getTime() - now;
    return diff <= EXPIRY_ALERT_DAYS * 24 * 60 * 60 * 1000;
  });
  if (nearExpiry) return "ใกล้หมดอายุ";
  if (p.stock <= p.reorderPoint) return "สต็อกต่ำ";
  return "ปกติ";
}

function statusTone(status: StatusFilter) {
  if (status === "ปิดการขาย") return "purple" as const;
  if (status === "ใกล้หมดอายุ") return "amber" as const;
  if (status === "สต็อกต่ำ") return "red" as const;
  return "green" as const;
}

/** Compute the next expiry ISO date for a product (or null). */
function nextExpiry(p: Product): string | null {
  const lots = p.lots ?? [];
  return lots.reduce<string | null>((best, lot) => {
    if (!lot.expiryDate) return best;
    if (!best || lot.expiryDate < best) return lot.expiryDate;
    return best;
  }, null);
}

// ----- Component -----

export function StockPage() {
  const [tab, setTab] = React.useState<"inventory" | "orders">("inventory");
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("ทั้งหมด");
  const [search, setSearch] = React.useState("");
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [showInactive, setShowInactive] = React.useState(true);

  const [products, setProducts] = React.useState<Product[]>([]);
  const [categories, setCategories] = React.useState<CategoryOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshKey, setRefreshKey] = React.useState(0);

  // Modal state
  const [editOpen, setEditOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<Product | null>(null);
  const [receiveOpen, setReceiveOpen] = React.useState(false);
  const [receiveProductId, setReceiveProductId] = React.useState<string | undefined>();
  const [countOpen, setCountOpen] = React.useState(false);
  const [countProductId, setCountProductId] = React.useState<string | undefined>();
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<Product | null>(null);
  const [deletePending, setDeletePending] = React.useState(false);
  const [togglePending, setTogglePending] = React.useState<Set<string>>(new Set());

  const searchRef = React.useRef<HTMLInputElement | null>(null);

  // ----- Load products + categories -----
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      apiGet<ProductsResponse>(
        `/api/products?includeInactive=${showInactive ? "true" : "false"}&includeLots=true`,
      ),
      apiGet<CategoriesResponse>("/api/categories").catch(() => ({
        categories: [] as CategoryOption[],
      })),
    ])
      .then(([prodRes, catRes]) => {
        if (cancelled) return;
        setProducts(prodRes.products);
        setCategories(catRes.categories);
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error("โหลดรายการสินค้าไม่สำเร็จ", {
          description:
            err instanceof Error ? err.message : "เกิดข้อผิดพลาดบางอย่าง",
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showInactive, refreshKey]);

  const refresh = () => setRefreshKey((k) => k + 1);

  // ----- Derived data -----
  const stats = React.useMemo(() => {
    const total = products.length;
    const lowStock = products.filter(
      (p) => p.active && p.stock <= p.reorderPoint,
    ).length;
    const nearExpiry = products.filter((p) => {
      if (!p.active) return false;
      const lots = p.lots ?? [];
      const now = Date.now();
      return lots.some((lot) => {
        if (!lot.expiryDate) return false;
        const diff = new Date(lot.expiryDate).getTime() - now;
        return diff <= EXPIRY_ALERT_DAYS * 24 * 60 * 60 * 1000;
      });
    }).length;
    const inventoryValue = products.reduce(
      (sum, p) => sum + p.stock * p.cost,
      0,
    );
    return { total, lowStock, nearExpiry, inventoryValue };
  }, [products]);

  const statusCounts = React.useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      ทั้งหมด: products.length,
      ปกติ: 0,
      สต็อกต่ำ: 0,
      ใกล้หมดอายุ: 0,
      ปิดการขาย: 0,
    };
    for (const p of products) counts[productStatus(p)] += 1;
    return counts;
  }, [products]);

  const filteredProducts = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return products.filter((p) => {
      if (statusFilter !== "ทั้งหมด" && productStatus(p) !== statusFilter)
        return false;
      if (needle === "") return true;
      if (p.name.toLowerCase().includes(needle)) return true;
      if (p.sku.toLowerCase().includes(needle)) return true;
      if (p.barcode && p.barcode.toLowerCase().includes(needle)) return true;
      return false;
    });
  }, [products, statusFilter, search]);

  // ----- Orders tab: low-stock procurement helper (client-side) -----
  const lowStockProducts = React.useMemo(
    () =>
      products
        .filter((p) => p.active && p.stock <= p.reorderPoint)
        .sort((a, b) => a.stock / a.reorderPoint - b.stock / b.reorderPoint),
    [products],
  );
  const orderSuggestedQty = (p: Product) =>
    Math.max(p.reorderPoint * 2 - p.stock, 1);
  const orderTotalValue = lowStockProducts.reduce(
    (sum, p) => sum + orderSuggestedQty(p) * p.cost,
    0,
  );

  // ----- Actions -----
  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openEdit = (p?: Product) => {
    setEditTarget(p ?? null);
    setEditOpen(true);
  };
  const openReceive = (p?: Product) => {
    setReceiveProductId(p?.id);
    setReceiveOpen(true);
  };
  const openCount = (p: Product) => {
    setCountProductId(p.id);
    setCountOpen(true);
  };

  const toggleActive = async (p: Product) => {
    setTogglePending((prev) => new Set(prev).add(p.id));
    try {
      await apiPatch(`/api/products/${p.id}`, { active: !p.active });
      toast.success(p.active ? `ปิดการขาย ${p.name}` : `เปิดขาย ${p.name} อีกครั้ง`);
      refresh();
    } catch (err) {
      toast.error("เปลี่ยนสถานะไม่สำเร็จ", {
        description: err instanceof Error ? err.message : "โปรดลองอีกครั้ง",
      });
    } finally {
      setTogglePending((prev) => {
        const next = new Set(prev);
        next.delete(p.id);
        return next;
      });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeletePending(true);
    try {
      await apiDelete(`/api/products/${deleteTarget.id}`);
      toast.success(`ลบสินค้า ${deleteTarget.name} เรียบร้อย`);
      setDeleteTarget(null);
      refresh();
    } catch (err) {
      toast.error("ลบสินค้าไม่สำเร็จ", {
        description: err instanceof Error ? err.message : "โปรดลองอีกครั้ง",
      });
    } finally {
      setDeletePending(false);
    }
  };

  const focusSearchForScan = () => {
    searchRef.current?.focus();
    searchRef.current?.select();
    toast.info("พร้อมสแกน — ยิงบาร์โค้ดที่เครื่องอ่าน", {
      description: "เคอร์เซอร์อยู่ที่ช่องค้นหาแล้ว",
    });
  };

  // ----- Render -----
  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Toolbar */}
      <div className="border-b bg-card sticky top-14 z-30">
        <div className="mx-auto max-w-7xl px-3 sm:px-6 py-3 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <Boxes className="size-5 text-emerald-600" />
              สต็อกสินค้า
            </h1>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBulkOpen(true)}
                disabled={products.length === 0}
              >
                <SlidersHorizontal className="size-4" />
                <span className="hidden sm:inline">ปรับราคาหลายรายการ</span>
                <span className="sm:hidden">ราคา</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSheetOpen(true)}
                disabled={products.length === 0}
              >
                <Printer className="size-4" />
                <span className="hidden sm:inline">ใบนับสต็อก</span>
                <span className="sm:hidden">พิมพ์</span>
              </Button>
              <Button
                size="sm"
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={() => openEdit()}
              >
                <Plus className="size-4" />
                <span className="hidden sm:inline">เพิ่มสินค้า</span>
                <span className="sm:hidden">เพิ่ม</span>
              </Button>
            </div>
          </div>

          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as "inventory" | "orders")}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="inventory">
                <Package className="size-4" />
                คลังสินค้า
              </TabsTrigger>
              <TabsTrigger value="orders">
                <ClipboardList className="size-4" />
                รายการสั่งซื้อ
                {lowStockProducts.length > 0 && (
                  <span className="ml-1 rounded-full bg-rose-100 px-1.5 text-xs text-rose-700">
                    {lowStockProducts.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>

            {/* Inventory tab */}
            <TabsContent value="inventory" className="mt-3 space-y-3">
              {/* Stat cards */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                <StatCard
                  icon={<Package className="size-4" />}
                  label="สินค้าทั้งหมด"
                  value={stats.total.toLocaleString("th-TH")}
                  tone="emerald"
                />
                <StatCard
                  icon={<TrendingDown className="size-4" />}
                  label="สต็อกต่ำ"
                  value={stats.lowStock.toLocaleString("th-TH")}
                  tone="rose"
                />
                <StatCard
                  icon={<AlertTriangle className="size-4" />}
                  label="ใกล้หมดอายุ"
                  value={stats.nearExpiry.toLocaleString("th-TH")}
                  tone="amber"
                />
                <StatCard
                  icon={<Coins className="size-4" />}
                  label="มูลค่าคงคลัง"
                  value={money(stats.inventoryValue)}
                  tone="emerald"
                />
              </div>

              {/* Filter row */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap items-center gap-1">
                  {STATUS_FILTERS.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setStatusFilter(f)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs transition-colors",
                        statusFilter === f
                          ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                          : "border-border bg-background hover:bg-accent",
                      )}
                    >
                      {f}{" "}
                      <b className="ml-0.5 tabular-nums">{statusCounts[f]}</b>
                    </button>
                  ))}
                </div>
                <div className="relative ml-auto w-full sm:w-64">
                  <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={searchRef}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="ค้นหาชื่อ / SKU / บาร์โค้ด"
                    aria-label="ค้นหาสินค้า"
                    className="pl-8 pr-10"
                  />
                  <button
                    type="button"
                    onClick={focusSearchForScan}
                    className="absolute right-1 top-1/2 -translate-y-1/2 grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label="สแกนบาร์โค้ด"
                    title="สแกนบาร์โค้ด"
                  >
                    <Camera className="size-4" />
                  </button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowInactive((v) => !v)}
                  className="text-xs"
                >
                  {showInactive ? (
                    <EyeOff className="size-3.5" />
                  ) : (
                    <Eye className="size-3.5" />
                  )}
                  <span className="hidden sm:inline">
                    {showInactive ? "ซ่อนปิดการขาย" : "แสดงทุกสินค้า"}
                  </span>
                </Button>
              </div>

              {/* Product list */}
              {loading ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-32 rounded-lg" />
                  ))}
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="rounded-lg border bg-muted/30 px-4 py-12 text-center text-sm text-muted-foreground">
                  ไม่พบสินค้าตามตัวกรองที่เลือก
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredProducts.map((p) => (
                    <ProductCard
                      key={p.id}
                      product={p}
                      expanded={expanded.has(p.id)}
                      onToggle={() => toggleExpand(p.id)}
                      onEdit={() => openEdit(p)}
                      onReceive={() => openReceive(p)}
                      onCount={() => openCount(p)}
                      onToggleActive={() => toggleActive(p)}
                      onDelete={() => setDeleteTarget(p)}
                      togglePending={togglePending.has(p.id)}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Orders tab */}
            <TabsContent value="orders" className="mt-3 space-y-3">
              <div className="rounded-lg border bg-card p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="font-semibold">รายการสั่งซื้อ (เตือนสต็อกต่ำ)</h2>
                    <p className="text-xs text-muted-foreground">
                      สินค้าที่เหลือ ≤ จุดสั่งซื้อขั้นต่ำ · เสนอให้สั่ง 2 เท่าของจุดสั่งซื้อ − สต็อกปัจจุบัน
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">มูลค่ารวมโดยประมาณ</div>
                    <div className="font-semibold tabular-nums text-emerald-700">
                      {money(orderTotalValue)}
                    </div>
                  </div>
                </div>
              </div>
              {lowStockProducts.length === 0 ? (
                <div className="rounded-lg border bg-muted/30 px-4 py-12 text-center text-sm text-muted-foreground">
                  ไม่มีสินค้าที่ต่ำกว่าจุดสั่งซื้อในตอนนี้ — สต็อกปกติทุกรายการ
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr className="text-left">
                        <th className="px-3 py-2">สินค้า</th>
                        <th className="px-3 py-2 text-center">คงเหลือ</th>
                        <th className="px-3 py-2 text-center">จุดสั่งซื้อ</th>
                        <th className="px-3 py-2 text-center">แนะนำสั่ง</th>
                        <th className="px-3 py-2 text-right">ต้นทุน/หน่วย</th>
                        <th className="px-3 py-2 text-right">มูลค่า</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lowStockProducts.map((p) => {
                        const qty = orderSuggestedQty(p);
                        return (
                          <tr
                            key={p.id}
                            className="border-t hover:bg-accent/50"
                          >
                            <td className="px-3 py-2">
                              <div className="font-medium">{p.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {p.sku} · {p.unit}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-center tabular-nums text-rose-600">
                              {p.stock}
                            </td>
                            <td className="px-3 py-2 text-center tabular-nums">
                              {p.reorderPoint}
                            </td>
                            <td className="px-3 py-2 text-center tabular-nums font-medium">
                              {qty}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {money(p.cost)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {money(qty * p.cost)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() => openReceive(p)}
                              >
                                <PackagePlus className="size-3.5" />
                                รับเข้า
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-auto border-t bg-card px-4 sm:px-6 py-3">
        <div className="mx-auto max-w-7xl flex items-center justify-between text-xs text-muted-foreground">
          <span>PNG Shop · ระบบร้านค้าสวัสดิการ</span>
          <span>โหลด {products.length.toLocaleString("th-TH")} รายการ</span>
        </div>
      </footer>

      {/* Modals */}
      <ProductEditModal
        open={editOpen}
        onOpenChange={setEditOpen}
        product={editTarget}
        categories={categories}
        products={products}
        onSaved={refresh}
      />
      <ReceiveForm
        open={receiveOpen}
        onOpenChange={setReceiveOpen}
        products={products}
        initialProductId={receiveProductId}
        onSaved={refresh}
      />
      <CountForm
        open={countOpen}
        onOpenChange={setCountOpen}
        products={products}
        initialProductId={countProductId}
        onSaved={refresh}
      />
      <BulkPriceModal
        open={bulkOpen}
        products={products}
        onClose={() => setBulkOpen(false)}
        onSaved={refresh}
      />
      <StockCountSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        products={products}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="ลบสินค้า"
        description={
          deleteTarget
            ? `ยืนยันการลบ “${deleteTarget.name}” (${deleteTarget.sku}) — การลบไม่สามารถย้อนกลับได้ · ประวัติบิลเดิมยังคงอยู่ครบ`
            : ""
        }
        confirmLabel="ลบ"
        tone="danger"
        pending={deletePending}
        onConfirm={confirmDelete}
        onCancel={() => !deletePending && setDeleteTarget(null)}
      />
    </div>
  );
}

// ----- Sub-components -----

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "emerald" | "rose" | "amber";
}

function StatCard({ icon, label, value, tone }: StatCardProps) {
  const toneClass =
    tone === "rose"
      ? "text-rose-600 bg-rose-50"
      : tone === "amber"
        ? "text-amber-600 bg-amber-50"
        : "text-emerald-600 bg-emerald-50";
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span
          className={cn(
            "grid size-6 place-items-center rounded-md",
            toneClass,
          )}
        >
          {icon}
        </span>
        {label}
      </div>
      <div className="mt-1.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

interface ProductCardProps {
  product: Product;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onReceive: () => void;
  onCount: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  togglePending: boolean;
}

function ProductCard({
  product: p,
  expanded,
  onToggle,
  onEdit,
  onReceive,
  onCount,
  onToggleActive,
  onDelete,
  togglePending,
}: ProductCardProps) {
  const status = productStatus(p);
  const exp = nextExpiry(p);
  const lots = p.lots ?? [];
  const inventoryValue = p.stock * p.cost;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card transition-shadow hover:shadow-sm",
        !p.active && "opacity-75",
      )}
    >
      {/* Header — click to expand */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 p-3 text-left"
        aria-expanded={expanded}
      >
        {/* Image / emoji */}
        <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md bg-muted text-2xl">
          {p.imageUrl ? (
            <img
              src={p.imageUrl}
              alt={p.name}
              className="size-full object-cover"
            />
          ) : (
            <span>{p.emoji || "📦"}</span>
          )}
        </div>
        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium">{p.name}</span>
            {p.quickPick && (
              <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-700">
                ⭐
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span>{p.sku}</span>
            {p.barcode && <span>· {p.barcode}</span>}
            {p.category?.name && <span>· {p.category.name}</span>}
            {p.size && <span>· {p.size}</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <StatusPill tone={statusTone(status)}>{status}</StatusPill>
            <span className="text-xs text-muted-foreground tabular-nums">
              คงเหลือ{" "}
              <b
                className={cn(
                  p.stock <= p.reorderPoint
                    ? "text-rose-600"
                    : "text-foreground",
                )}
              >
                {p.stock}
              </b>{" "}
              {p.unit}
            </span>
          </div>
        </div>
        {/* Right: price + stock value */}
        <div className="text-right">
          <div className="font-semibold tabular-nums text-emerald-700">
            {money(p.price)}
          </div>
          <div className="text-[11px] text-muted-foreground tabular-nums">
            ต้นทุน {money(p.cost)}
          </div>
        </div>
        <ChevronRight
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
        />
      </button>

      {/* Expanded */}
      {expanded && (
        <div className="border-t bg-muted/30 p-3 space-y-3">
          {/* Lot list */}
          <div>
            <div className="mb-1 flex items-center justify-between text-xs font-medium">
              <span>
                ล็อตสินค้า ({lots.length})
              </span>
              <span className="text-muted-foreground tabular-nums">
                มูลค่าคงคลัง {money(inventoryValue)}
              </span>
            </div>
            {lots.length === 0 ? (
              <p className="rounded-md border bg-background px-2 py-2 text-xs text-muted-foreground">
                ยังไม่มี Lot — กด “รับเข้า” เพื่อสร้าง Lot แรก
              </p>
            ) : (
              <div className="max-h-44 overflow-auto rounded-md border bg-background">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr className="text-left">
                      <th className="px-2 py-1">Lot</th>
                      <th className="px-2 py-1 text-right">จำนวน</th>
                      <th className="px-2 py-1 text-right">ต้นทุน</th>
                      <th className="px-2 py-1">หมดอายุ</th>
                      <th className="px-2 py-1">รับเข้า</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lots.map((lot) => (
                      <tr key={lot.id} className="border-t">
                        <td className="px-2 py-1 font-medium">{lot.lot}</td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {lot.qty}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {money(lot.cost)}
                        </td>
                        <td className="px-2 py-1">
                          {lot.expiryDate
                            ? formatThaiDate(lot.expiryDate)
                            : "—"}
                        </td>
                        <td className="px-2 py-1 text-muted-foreground">
                          {formatThaiDate(lot.receivedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {exp && (
              <p className="mt-1 text-xs text-amber-700">
                หมดอายุเร็วสุด: {formatThaiDate(exp)}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" onClick={onEdit} className="h-8 text-xs">
              <Pencil className="size-3.5" />
              แก้ไข
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onReceive}
              className="h-8 text-xs text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
            >
              <PackagePlus className="size-3.5" />
              รับเข้า
            </Button>
            <Button size="sm" variant="outline" onClick={onCount} className="h-8 text-xs">
              <ClipboardList className="size-3.5" />
              นับสต็อก
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onToggleActive}
              disabled={togglePending}
              className="h-8 text-xs"
            >
              {p.active ? (
                <>
                  <EyeOff className="size-3.5" />
                  ปิดการขาย
                </>
              ) : (
                <>
                  <Eye className="size-3.5" />
                  เปิดการขาย
                </>
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onDelete}
              className="h-8 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            >
              <Trash2 className="size-3.5" />
              ลบ
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
