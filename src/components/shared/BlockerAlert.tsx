'use client'

/**
 * BlockerAlert — singleton center-screen alert for "stop-the-line" errors.
 *
 * Mirror of /tmp/Shop/client/src/components/BlockerAlert.tsx — adapted to
 * shadcn/ui Dialog with Tailwind classes (no bespoke CSS file).
 *
 * Why: errors like "สต็อกไม่พอ", "เงินไม่พอ", "ชำระเงินไม่สำเร็จ" used to
 * appear as a tiny toast bottom-right and got missed by the cashier mid-sale.
 * The blocker is a true modal: must press "รับทราบ" (or Enter / Esc) to dismiss.
 *
 * Usage from anywhere:
 *   import { blocker } from '@/components/shared/BlockerAlert'
 *   blocker.error('สต็อกไม่พอ — เพิ่มเข้าบิลไม่ได้', `${name} เหลือ ${stock} ${unit} ในคลัง`)
 *   blocker.warning('ยังไม่ได้เลือกสมาชิก', 'ยิงบัตรสมาชิกก่อนชำระแบบหักบัญชี')
 *
 * Mount <BlockerAlert /> once near the root (already in AppShell).
 */

import { useEffect, useRef, useState } from 'react'
import { Check, Info, TriangleAlert, X, CircleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type BlockerLevel = 'error' | 'warning' | 'info'

export interface BlockerOptions {
  title: string
  description?: string
  level?: BlockerLevel
  /** ข้อความบนปุ่ม (default: รับทราบ) */
  confirmLabel?: string
  /** คำใบ้สั้น ๆ ใต้คำอธิบาย */
  hint?: string
  onAcknowledge?: () => void
}

type BlockerListener = (options: BlockerOptions) => void

let listeners: BlockerListener[] = []

function emit(options: BlockerOptions): void {
  for (const listener of listeners) listener(options)
}

/** Static singleton — call from anywhere, no hook required. */
export const blocker = {
  error: (
    title: string,
    description?: string,
    extra?: Omit<BlockerOptions, 'title' | 'description' | 'level'>,
  ) => emit({ ...extra, level: 'error', title, description }),
  warning: (
    title: string,
    description?: string,
    extra?: Omit<BlockerOptions, 'title' | 'description' | 'level'>,
  ) => emit({ ...extra, level: 'warning', title, description }),
  info: (
    title: string,
    description?: string,
    extra?: Omit<BlockerOptions, 'title' | 'description' | 'level'>,
  ) => emit({ ...extra, level: 'info', title, description }),
}

const LEVEL_META: Record<
  BlockerLevel,
  { Icon: typeof CircleAlert; label: string; iconWrap: string; ring: string; button: string }
> = {
  error: {
    Icon: CircleAlert,
    label: 'ผิดพลาด',
    iconWrap: 'bg-red-100 text-red-600',
    ring: 'ring-red-200',
    button: 'bg-red-600 hover:bg-red-700 text-white',
  },
  warning: {
    Icon: TriangleAlert,
    label: 'แจ้งเตือน',
    iconWrap: 'bg-amber-100 text-amber-600',
    ring: 'ring-amber-200',
    button: 'bg-amber-600 hover:bg-amber-700 text-white',
  },
  info: {
    Icon: Info,
    label: 'แจ้งให้ทราบ',
    iconWrap: 'bg-emerald-100 text-emerald-700',
    ring: 'ring-emerald-200',
    button: 'bg-emerald-600 hover:bg-emerald-700 text-white',
  },
}

/**
 * Mount once near the app root. Listens to `blocker.*` calls and renders a
 * z-index-[1300] modal in the center of the viewport.
 */
export function BlockerAlert() {
  const [current, setCurrent] = useState<BlockerOptions | null>(null)
  const acknowledgeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const listener: BlockerListener = (options) => {
      setCurrent(options)
      window.requestAnimationFrame(() => acknowledgeRef.current?.focus())
    }
    listeners.push(listener)
    return () => {
      listeners = listeners.filter((entry) => entry !== listener)
    }
  }, [])

  const close = () => {
    if (!current) return
    const ack = current.onAcknowledge
    setCurrent(null)
    ack?.()
  }

  // Esc anywhere closes (capture phase so it wins over child modals).
  useEffect(() => {
    if (!current) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [current])

  if (!current) return null

  const level = current.level ?? 'error'
  const meta = LEVEL_META[level]
  const Icon = meta.Icon

  return (
    <div
      className="fixed inset-0 z-[1300] grid place-items-center bg-black/50 backdrop-blur-sm p-4"
      role="presentation"
      onClick={close}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={`${meta.label}: ${current.title}`}
        onClick={(event) => event.stopPropagation()}
        className={`w-full max-w-md rounded-2xl bg-card shadow-2xl ring-1 ${meta.ring} p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150`}
      >
        <div className="flex items-start gap-4">
          <span
            className={`shrink-0 size-12 rounded-xl grid place-items-center ${meta.iconWrap}`}
            aria-hidden="true"
          >
            <Icon size={26} strokeWidth={2.2} />
          </span>
          <div className="flex-1 min-w-0 space-y-1.5">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {meta.label}
            </span>
            <h3 className="text-lg font-semibold leading-snug text-foreground">
              {current.title}
            </h3>
            {current.description && (
              <p className="text-sm text-muted-foreground whitespace-pre-line">
                {current.description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="ปิดหน้าต่าง"
            className="shrink-0 size-8 rounded-lg text-muted-foreground hover:bg-muted grid place-items-center"
          >
            <X size={16} />
          </button>
        </div>
        {current.hint && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {current.hint}
          </p>
        )}
        <div className="flex flex-col gap-2 pt-1">
          <Button
            ref={acknowledgeRef}
            type="button"
            onClick={close}
            className={`w-full h-11 text-sm font-medium ${meta.button}`}
          >
            <Check size={16} />
            {current.confirmLabel ?? 'รับทราบ'}
          </Button>
          <span className="text-center text-[11px] text-muted-foreground">
            กด <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-[10px]">Enter</kbd>{' '}
            หรือ <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-[10px]">Esc</kbd>{' '}
            เพื่อปิดหน้าต่างนี้
          </span>
        </div>
      </div>
    </div>
  )
}
