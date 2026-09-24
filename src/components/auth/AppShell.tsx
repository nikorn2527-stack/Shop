'use client'

/**
 * AppShell — authenticated dashboard shell.
 *
 * Header (logo + user + logout) + main content area + sticky footer.
 *
 * For now the shell renders the POS view by default (lazy-loaded PosPage).
 * Other nav items (Stock/Members/Reports/Settings) are placeholders that
 * show a "ยังไม่เปิดใช้งาน" toast — to be replaced in later tasks.
 */

import { lazy, Suspense, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  BarChart3,
  LayoutDashboard,
  LogOut,
  PackageSearch,
  ShoppingBag,
  ShoppingCart,
  UsersRound,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { apiPost } from '@/lib/api-client'
import { roleLabel } from '@/lib/rbac'
import { BlockerAlert } from '@/components/shared/BlockerAlert'

const PosPage = lazy(() =>
  import('@/components/pos/PosPage').then((m) => ({ default: m.PosPage })),
)

export interface AppShellUser {
  id: string
  username: string
  displayName: string
  role: string
  mustChangePassword: boolean
}

interface AppShellProps {
  user: AppShellUser
}

type View = 'dashboard' | 'pos' | 'stock' | 'members' | 'reports' | 'settings'

const NAV_ITEMS: { id: View; label: string; caption: string; icon: typeof BarChart3 }[] = [
  { id: 'dashboard', label: 'ภาพรวม', caption: 'สรุปการดำเนินงาน', icon: LayoutDashboard },
  { id: 'pos', label: 'หน้าร้าน / POS', caption: 'ขายสินค้าและรับชำระ', icon: ShoppingCart },
  { id: 'stock', label: 'สต็อกสินค้า', caption: 'รับเข้าและนับสต็อก', icon: PackageSearch },
  { id: 'members', label: 'สมาชิกและบัญชี', caption: 'สมาชิกและเจ้าหน้าที่', icon: UsersRound },
  { id: 'reports', label: 'รายงาน', caption: 'วิเคราะห์และส่งออก', icon: BarChart3 },
]

export default function AppShell({ user }: AppShellProps) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [view, setView] = useState<View>('pos')
  const [navOpen, setNavOpen] = useState(false)

  const handleLogout = async () => {
    if (pending) return
    setPending(true)
    try {
      await apiPost<{ success: boolean }>('/api/auth/logout', {})
      toast.success('ออกจากระบบแล้ว')
      router.refresh()
    } catch (err) {
      toast.error('ออกจากระบบไม่สำเร็จ', {
        description: err instanceof Error ? err.message : 'เกิดข้อผิดพลาดบางอย่าง',
      })
    } finally {
      setPending(false)
    }
  }

  const onNav = (next: View) => {
    if (next === view) {
      setNavOpen(false)
      return
    }
    if (next !== 'pos' && next !== 'dashboard') {
      toast.info('ยังไม่เปิดใช้งาน', {
        description: `${NAV_ITEMS.find((n) => n.id === next)?.label ?? ''} — จะถูกพัฒนาต่อใน Task ถัดไป`,
      })
      return
    }
    setView(next)
    setNavOpen(false)
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <BlockerAlert />

      <header className="border-b bg-card sticky top-0 z-30">
        <div className="px-3 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="size-8 rounded-lg bg-emerald-600 text-white grid place-items-center shrink-0">
              <ShoppingBag className="size-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <span className="font-semibold tracking-tight block text-sm leading-none">
                PNG Shop
              </span>
              <span className="text-[10px] text-muted-foreground block mt-0.5">
                ระบบร้านค้าสวัสดิการ
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden sm:flex flex-col items-end text-right">
              <span className="text-sm font-medium leading-none">{user.displayName}</span>
              <span className="text-xs text-muted-foreground leading-none mt-0.5">
                {roleLabel(user.role)}
              </span>
            </div>
            <span className="size-8 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center text-sm font-medium shrink-0">
              {user.displayName.slice(0, 1)}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              disabled={pending}
              aria-label="ออกจากระบบ"
            >
              <LogOut size={14} aria-hidden="true" />
              <span className="hidden sm:inline">ออกจากระบบ</span>
            </Button>
          </div>
        </div>

        {/* Nav rail */}
        <nav className="border-t bg-card overflow-x-auto">
          <div className="px-3 sm:px-6 h-11 flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const active = view === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNav(item.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium transition-colors ${
                    active
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                  title={item.caption}
                >
                  <Icon size={14} aria-hidden="true" />
                  <span className="hidden sm:inline">{item.label}</span>
                </button>
              )
            })}
          </div>
        </nav>
      </header>

      <main className="flex-1 min-h-0">
        {view === 'pos' ? (
          <Suspense
            fallback={
              <div className="h-[60vh] grid place-items-center text-sm text-muted-foreground">
                <div className="text-center space-y-2">
                  <div className="size-8 mx-auto rounded-full border-2 border-emerald-200 border-t-emerald-600 animate-spin" />
                  <p>กำลังโหลด POS…</p>
                </div>
              </div>
            }
          >
            <PosPage userName={user.displayName} />
          </Suspense>
        ) : (
          <div className="h-[60vh] grid place-items-center text-center p-6">
            <div className="space-y-2 max-w-sm">
              <div className="size-12 mx-auto rounded-xl bg-emerald-50 text-emerald-700 grid place-items-center">
                <LayoutDashboard className="size-6" />
              </div>
              <h1 className="text-xl font-semibold tracking-tight">
                แดชบอร์ด {NAV_ITEMS.find((n) => n.id === view)?.label ?? ''}
              </h1>
              <p className="text-sm text-muted-foreground">
                สวัสดี <b className="text-foreground">{user.displayName}</b> — หน้านี้จะถูกพัฒนาต่อใน Task ถัดไป
              </p>
              <Button className="mt-2" onClick={() => setView('pos')}>
                <ShoppingCart size={14} /> เปิด POS
              </Button>
            </div>
          </div>
        )}
      </main>

      <footer className="mt-auto border-t bg-card px-4 sm:px-6 py-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>PNG Shop · ระบบร้านค้าสวัสดิการ</span>
          <span>พัฒนาโดย PNG TEAM</span>
        </div>
      </footer>
    </div>
  )
}
