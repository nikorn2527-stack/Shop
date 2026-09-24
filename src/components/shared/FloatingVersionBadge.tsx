'use client'

/**
 * FloatingVersionBadge — bottom-right corner pill that makes it visually obvious
 * which version of the system is running.
 *
 * Per user feedback: "หน้าตามันเหมือนเดิมจนผมไม่เห็นความต่างเลยยังไม่แน่ใจว่ามันใช้ได้แน่นอนเฉย 5555"
 *
 * This badge is the visual differentiator between:
 *   - เวอร์ชันเดิม (Vite + tRPC + node:sqlite) — ไม่มี badge นี้
 *   - เวอร์ชันใหม่ (Next.js + Prisma) — มี badge นี้
 *
 * Click to open /api/system/version in new tab for full info.
 */

import * as React from 'react'
import { Zap } from 'lucide-react'

interface VersionInfo {
  ok: boolean
  version: string
  buildDate: string | null
  commitSha: string | null
  nodeEnv: string
  db: {
    userCount: number
    memberCount: number
    productCount: number
    saleCount: number
  }
}

export function FloatingVersionBadge() {
  const [info, setInfo] = React.useState<VersionInfo | null>(null)
  const [expanded, setExpanded] = React.useState(false)

  React.useEffect(() => {
    fetch('/api/system/version')
      .then(r => r.json())
      .then(setInfo)
      .catch(() => {})
  }, [])

  const version = info?.version ?? '1.0.0-dev'
  const env = info?.nodeEnv ?? 'development'
  const isDev = env !== 'production'

  return (
    <div
      className="fixed bottom-3 right-3 z-40 select-none"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <a
        href="/api/system/version"
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1.5 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg ring-2 ring-emerald-600/30 transition-all hover:bg-emerald-700 hover:ring-emerald-700/40"
        title="คลิกเพื่อดูข้อมูลเวอร์ชันเต็ม"
      >
        <Zap className="size-3" aria-hidden="true" />
        <span>Next.js + Prisma</span>
        <span className="opacity-70">·</span>
        <span>v{version}</span>
        {isDev && (
          <span className="ml-1 rounded-sm bg-amber-400 px-1 text-[9px] font-bold text-amber-900 uppercase tracking-wider">
            DEV
          </span>
        )}
      </a>
      {expanded && info && (
        <div className="absolute bottom-full right-0 mb-1 w-56 rounded-lg border bg-card p-3 text-xs shadow-xl">
          <div className="mb-2 font-semibold text-foreground">ข้อมูลเวอร์ชัน</div>
          <dl className="space-y-1">
            <Row label="เวอร์ชัน" value={`v${info.version}`} />
            <Row label="Stack" value="Next.js 16 + Prisma" />
            <Row label="Environment" value={info.nodeEnv} />
            {info.commitSha && <Row label="Commit" value={info.commitSha.slice(0, 8)} />}
            <div className="my-2 border-t pt-2">
              <div className="text-muted-foreground">ข้อมูลในระบบ</div>
              <div className="mt-1 grid grid-cols-2 gap-1">
                <Stat label="ผู้ใช้" value={info.db.userCount} />
                <Stat label="สมาชิก" value={info.db.memberCount} />
                <Stat label="สินค้า" value={info.db.productCount} />
                <Stat label="บิลขาย" value={info.db.saleCount} />
              </div>
            </div>
          </dl>
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded bg-muted/50 px-1.5 py-1">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  )
}
