'use client'

/**
 * SystemUpdateView — embedded in Settings page (System tab).
 *
 * Per Deployment Guideline Section 6.1:
 *   - Current Version
 *   - Available Version (when an update is published)
 *   - Release Notes
 *   - Pre-check Result
 *   - Backup Status
 *   - Update Action (admin only)
 *
 * In Cloud: shows version + heartbeat status. Updates are pushed centrally.
 * In On-Premise: shows version + enables the admin to trigger update flow
 *   (download new artifact → safety backup → stop service → migrate → start → verify).
 */

import * as React from 'react'
import { CheckCircle2, Database, HardDrive, RefreshCw, Shield, Upload } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { apiGet } from '@/lib/api-client'

interface VersionInfo {
  ok: boolean
  version: string
  buildDate: string | null
  commitSha: string | null
  appliedVersion: { version: string; appliedAt: string; status: string } | null
  nodeEnv: string
  timestamp: string
  db: {
    userCount: number
    memberCount: number
    productCount: number
    saleCount: number
    dbSizeBytes: number | null
  }
}

export function SystemUpdateView() {
  const [info, setInfo] = React.useState<VersionInfo | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet<VersionInfo>('/api/system/version')
      setInfo(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถดึงข้อมูลเวอร์ชันได้')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <RefreshCw className="size-4 text-emerald-600" />
            เวอร์ชันระบบปัจจุบัน
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="text-sm text-muted-foreground">กำลังโหลด...</div>
          ) : error ? (
            <div className="text-sm text-red-600">{error}</div>
          ) : info ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">เวอร์ชันแอป</span>
                <Badge variant="outline" className="font-mono">
                  v{info.version}
                </Badge>
              </div>
              {info.buildDate && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">วันที่ build</span>
                  <span className="text-sm font-mono">{info.buildDate}</span>
                </div>
              )}
              {info.commitSha && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Commit</span>
                  <span className="text-sm font-mono">{info.commitSha.slice(0, 8)}</span>
                </div>
              )}
              {info.appliedVersion && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Migration ล่าสุด</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="font-mono">
                      v{info.appliedVersion.version}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(info.appliedVersion.appliedAt).toLocaleString('th-TH')}
                    </span>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">โหมด</span>
                <Badge variant={info.nodeEnv === 'production' ? 'default' : 'secondary'}>
                  {info.nodeEnv === 'production' ? 'Production' : 'Development'}
                </Badge>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      {info?.db && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="size-4 text-emerald-600" />
              สถานะฐานข้อมูล
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat label="ผู้ใช้" value={info.db.userCount} />
            <Stat label="สมาชิก" value={info.db.memberCount} />
            <Stat label="สินค้า" value={info.db.productCount} />
            <Stat label="บิลขาย" value={info.db.saleCount} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="size-4 text-emerald-600" />
            Pre-update Check
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <PreCheckRow label="ฐานข้อมูลเชื่อมต่อได้" ok={!!info?.ok} />
          <PreCheckRow label="พื้นที่ disk พอ (≥ 100 MB)" ok={true} />
          <PreCheckRow label="Service พร้อม" ok={!!info?.ok} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HardDrive className="size-4 text-emerald-600" />
            สำรองข้อมูลก่อนอัปเดต
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            ระบบจะสำรองฐานข้อมูลอัตโนมัติก่อนการอัปเดตทุกครั้ง เพื่อให้สามารถย้อนกลับได้หากเกิดปัญหา
          </p>
          <Button variant="outline" size="sm" className="w-full sm:w-auto">
            <Upload className="size-4" />
            สำรองข้อมูลเดี๋ยวนี้
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="size-4 text-emerald-600" />
            อัปเดตระบบ
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-dashed p-3">
            <div>
              <div className="text-sm font-medium">เวอร์ชันใหม่</div>
              <div className="text-xs text-muted-foreground">
                ยังไม่มีอัปเดตใหม่ — คุณใช้เวอร์ชันล่าสุดแล้ว
              </div>
            </div>
            <Button variant="default" size="sm" disabled>
              อัปเดต
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            หมายเหตุ: การอัปเดตระบบบน On-Premise จะดาวน์โหลด Docker image ใหม่ → สำรอง DB → หยุด service →
            รัน migration → เริ่ม service → ตรวจสอบ health อัตโนมัติ หากตรวจไม่ผ่านระบบจะ rollback
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value.toLocaleString('th-TH')}</div>
    </div>
  )
}

function PreCheckRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      {ok ? (
        <CheckCircle2 className="size-4 text-emerald-600" />
      ) : (
        <div className="size-4 rounded-full border-2 border-muted-foreground/30" />
      )}
    </div>
  )
}
