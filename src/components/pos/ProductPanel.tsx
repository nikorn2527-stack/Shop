'use client'

/**
 * ProductPanel — right side of the POS layout.
 *
 * Contains:
 *   - Category filter chips (ทั้งหมด + categories from API)
 *   - Quick-pick rail (quickPick=true)
 *   - Product grid: card per product with emoji/image + name + size + price +
 *     stock badge; click = addScannedItem; money-mode shows tier buttons
 *     (฿1 / ฿5 / ฿10) — each calls addTierItem; quickPick products also get a
 *     stepper on the card itself.
 */

import { Minus, Plus, Sparkles, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { money } from '@/lib/format'
import type { Product, PriceTier, CartItem } from './types'
import { addScannedItem, addTierItem, parsePriceTiers, formatBillQty } from './types'

export interface ProductPanelProps {
  products: Product[]
  categories: string[]
  category: string
  onCategory: (cat: string) => void
  cart: CartItem[]
  onAddProduct: (product: Product) => void
  onAddTier: (product: Product, tier: PriceTier) => void
  onBumpQty: (productId: number, delta: number) => void
}

export function ProductPanel({
  products,
  categories,
  category,
  onCategory,
  cart,
  onAddProduct,
  onAddTier,
  onBumpQty,
}: ProductPanelProps) {
  const quickPicks = products.filter((p) => Boolean(p.quickPick))
  const inCategory = category === 'ทั้งหมด' ? products : products.filter((p) => p.category === category)
  const quickInCategory =
    category === 'ทั้งหมด' ? quickPicks : quickPicks.filter((p) => p.category === category)

  const qtyInBill = (id: number) =>
    cart.reduce((sum, item) => (item.id === id ? sum + item.qty : sum), 0)

  return (
    <section className="flex flex-col h-full bg-card rounded-xl border overflow-hidden">
      {/* Category chips */}
      <div className="border-b p-3">
        <div className="flex gap-1.5 flex-wrap">
          <CategoryChip
            label="ทั้งหมด"
            active={category === 'ทั้งหมด'}
            onClick={() => onCategory('ทั้งหมด')}
          />
          {categories.map((cat) => (
            <CategoryChip
              key={cat}
              label={cat}
              active={category === cat}
              onClick={() => onCategory(cat)}
            />
          ))}
        </div>
      </div>

      {/* Quick-pick rail */}
      {quickInCategory.length > 0 && (
        <div className="border-b bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1.5">
            <Star size={11} className="text-amber-500 fill-amber-500" />
            <span className="font-medium">แผงลัดหน้าร้าน</span>
            <span className="text-muted-foreground/70">· หยิบบ่อย</span>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {quickInCategory.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => onAddProduct(product)}
                className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200 text-xs font-medium transition-colors"
              >
                <span aria-hidden="true">{product.emoji || '🛍️'}</span>
                <span className="max-w-[8rem] truncate">{product.name}</span>
                <span className="font-mono">{money(product.price)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Product grid */}
      <div className="flex-1 overflow-y-auto p-3">
        {inCategory.length === 0 ? (
          <div className="h-full grid place-items-center text-center py-12 text-sm text-muted-foreground">
            <div className="space-y-2">
              <Sparkles size={28} className="mx-auto opacity-40" />
              <p>ยังไม่มีสินค้าในหมวด "{category}"</p>
              <p className="text-xs">กด F10 เพื่อเพิ่มสินค้าใหม่</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
            {inCategory.map((product) => {
              const tiers = parsePriceTiers(product.priceTiers)
              const isMoney = product.sellMode === 'money' && tiers.length > 0
              const qty = qtyInBill(product.id)
              const lowStock = product.stock <= 5
              const outOfStock = product.stock <= 0
              return (
                <div
                  key={product.id}
                  className="group relative flex flex-col rounded-xl border bg-card hover:border-emerald-300 hover:shadow-sm transition-all overflow-hidden"
                >
                  {/* Card top — emoji / image (clickable to add) */}
                  <button
                    type="button"
                    onClick={() => !isMoney && onAddProduct(product)}
                    disabled={isMoney || outOfStock}
                    className="relative aspect-square bg-gradient-to-br from-muted/40 to-muted/10 grid place-items-center overflow-hidden disabled:cursor-default"
                    aria-label={`เพิ่ม ${product.name} เข้าบิล`}
                  >
                    {product.imageUrl ? (
                      <img
                        src={product.imageUrl}
                        alt={product.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-4xl" aria-hidden="true">
                        {product.emoji || '🛍️'}
                      </span>
                    )}
                    {/* Stock badge */}
                    <div className="absolute top-1.5 right-1.5">
                      {outOfStock ? (
                        <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
                          หมด
                        </Badge>
                      ) : lowStock ? (
                        <Badge className="px-1.5 py-0 text-[10px] bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200">
                          เหลือ {formatBillQty(product.stock, product.unit)}
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                          {formatBillQty(product.stock, product.unit)}
                        </Badge>
                      )}
                    </div>
                    {/* qty in bill */}
                    {qty > 0 && (
                      <div className="absolute top-1.5 left-1.5 size-6 rounded-full bg-emerald-600 text-white text-[11px] font-bold grid place-items-center">
                        {qty}
                      </div>
                    )}
                  </button>

                  {/* Card body */}
                  <div className="p-2 flex flex-col gap-1.5 flex-1">
                    <div className="text-xs font-medium leading-tight line-clamp-2 min-h-[2rem]">
                      {product.name}
                    </div>
                    {product.size && (
                      <div className="text-[10px] text-muted-foreground -mt-1">{product.size}</div>
                    )}
                    <div className="flex items-baseline justify-between gap-1">
                      <b className="text-sm font-mono text-emerald-700">{money(product.price)}</b>
                      <span className="text-[10px] text-muted-foreground">/{product.unit}</span>
                    </div>

                    {/* Money-mode tier buttons */}
                    {isMoney && (
                      <div className="flex gap-1 mt-auto">
                        {tiers.map((tier) => (
                          <Button
                            key={tier.label}
                            type="button"
                            size="sm"
                            disabled={outOfStock}
                            onClick={() => onAddTier(product, tier)}
                            className="h-7 px-2 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white"
                          >
                            ฿{tier.price}
                          </Button>
                        ))}
                      </div>
                    )}

                    {/* QuickPick on-card stepper */}
                    {!isMoney && Boolean(product.quickPick) && !outOfStock && (
                      <div className="flex items-center gap-1 mt-auto">
                        <button
                          type="button"
                          onClick={() => onBumpQty(product.id, -1)}
                          disabled={qty === 0}
                          className="size-7 rounded-md border bg-background hover:bg-muted grid place-items-center disabled:opacity-40"
                          aria-label={`ลดจำนวน ${product.name}`}
                        >
                          <Minus size={13} />
                        </button>
                        <div className="flex-1 text-center text-xs font-mono">
                          {qty > 0 ? formatBillQty(qty, product.unit) : '—'}
                        </div>
                        <button
                          type="button"
                          onClick={() => onBumpQty(product.id, +1)}
                          className="size-7 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white grid place-items-center"
                          aria-label={`เพิ่มจำนวน ${product.name}`}
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                    )}

                    {!isMoney && !product.quickPick && !outOfStock && (
                      <Button
                        type="button"
                        size="sm"
                        className="mt-auto h-7 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200"
                        onClick={() => onAddProduct(product)}
                      >
                        <Plus size={13} /> เพิ่ม
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 px-3 rounded-full text-xs font-medium border transition-colors ${
        active
          ? 'bg-emerald-600 text-white border-emerald-600'
          : 'bg-background text-muted-foreground border-border hover:bg-accent hover:text-foreground'
      }`}
    >
      {label}
    </button>
  )
}

// Helpers re-exported for tests / storybook (kept in types.ts)
export { addScannedItem, addTierItem }
