'use client'

/**
 * BarcodeCameraModal — opens the device camera and decodes barcodes / QR codes
 * via @zxing/browser (lazy-imported so it doesn't bloat the main bundle).
 *
 * Mirror of /tmp/Shop/client/src/components/BarcodeCameraModal.tsx.
 *
 * On successful decode: plays a 1230Hz square-wave beep, vibrates (if supported),
 * and emits the code via `onDetect(code)`. A 1.8s cooldown suppresses duplicate
 * reads of the same code so a single scan doesn't fire repeatedly.
 *
 * Browsers only allow camera access on HTTPS or localhost — when accessed via
 * LAN IP (http://192.168.x.x) the modal shows an actionable hint instead of
 * silently failing.
 */

import { useEffect, useRef, useState } from 'react'
import { Camera, CircleAlert, ScanLine, X, Zap, ZapOff } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface BarcodeCameraModalProps {
  open: boolean
  title: string
  hint?: string
  onClose: () => void
  /** Called once with the decoded code; modal closes itself right after. */
  onDetect: (code: string) => void
}

type Phase = 'starting' | 'live' | 'error'

export function BarcodeCameraModal({
  open,
  title,
  hint,
  onClose,
  onDetect,
}: BarcodeCameraModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [phase, setPhase] = useState<Phase>('starting')
  const [errorMsg, setErrorMsg] = useState('')
  const [torchOn, setTorchOn] = useState(false)
  const [lastCode, setLastCode] = useState<string | null>(null)
  const lastHitRef = useRef<{ code: string; at: number } | null>(null)
  const detectedRef = useRef(false)

  const feedback = () => {
    try {
      navigator.vibrate?.(70)
    } catch {
      /* some browsers/desktops have no vibration API */
    }
    try {
      const AudioCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioCtor) return
      const ctx = new AudioCtor()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = 1230
      gain.gain.value = 0.05
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.11)
      window.setTimeout(() => void ctx.close().catch(() => {}), 400)
    } catch {
      /* no audio — non-fatal */
    }
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    let controls: { stop: () => void } | null = null
    setPhase('starting')
    setErrorMsg('')
    setLastCode(null)
    setTorchOn(false)
    lastHitRef.current = null
    detectedRef.current = false

    void (async () => {
      if (typeof window !== 'undefined' && !window.isSecureContext) {
        setPhase('error')
        setErrorMsg(
          'เบราว์เซอร์อนุญาตให้เปิดกล้องเฉพาะ HTTPS หรือ localhost เท่านั้น — ลองเข้าผ่าน Preview Panel หรือเปิด https ที่เซิร์ฟเวอร์',
        )
        return
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setPhase('error')
        setErrorMsg('อุปกรณ์หรือเบราว์เซอร์นี้ไม่รองรับการเปิดกล้อง')
        return
      }
      try {
        const zxing = await import('@zxing/browser')
        const { BarcodeFormat, DecodeHintType } = await import('@zxing/library')
        if (cancelled || !videoRef.current) return
        const hints = new Map<number, unknown>()
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.ITF,
          BarcodeFormat.QR_CODE,
        ])
        hints.set(DecodeHintType.TRY_HARDER, true)
        const reader = new zxing.BrowserMultiFormatReader(hints as never, {
          delayBetweenScanAttempts: 120,
        })
        controls = await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          videoRef.current,
          (result) => {
            if (!result || detectedRef.current) return
            const code = result.getText()
            if (!code) return
            const now = Date.now()
            if (
              lastHitRef.current &&
              lastHitRef.current.code === code &&
              now - lastHitRef.current.at < 1800
            ) {
              return
            }
            lastHitRef.current = { code, at: now }
            setLastCode(code)
            feedback()
            detectedRef.current = true
            onDetect(code)
          },
        )
        if (!cancelled) setPhase('live')
      } catch (err) {
        if (cancelled) return
        setPhase('error')
        const message = String((err as Error)?.message ?? err ?? '')
        if (/NotAllowed|Permission|denied/i.test(message)) {
          setErrorMsg('ไม่ได้รับอนุญาตให้ใช้กล้อง — กดอนุญาตกล้องในเบราว์เซอร์ (ไอคอน 🔒 ในแถบที่อยู่) แล้วลองใหม่')
        } else if (/NotFound|no camera|Requested device/i.test(message)) {
          setErrorMsg('ไม่พบกล้องบนอุปกรณ์นี้ — ตรวจกล้อง/เว็บแคม หรือปิดแอปอื่นที่ใช้กล้องอยู่')
        } else if (/NotReadable|Track start/i.test(message)) {
          setErrorMsg('กล้องถูกแอปอื่นใช้อยู่ — ปิดโปรแกรมที่เปิดค้างกล้อง แล้วลองใหม่')
        } else {
          setErrorMsg(`เปิดกล้องไม่สำเร็จ: ${message.slice(0, 160)}`)
        }
      }
    })()

    return () => {
      cancelled = true
      try {
        controls?.stop()
      } catch {
        /* camera already closed */
      }
    }
  }, [open])

  const toggleTorch = async () => {
    const stream = videoRef.current?.srcObject as MediaStream | null
    const track = stream?.getVideoTracks?.()[0]
    if (!track) return
    try {
      await track.applyConstraints({
        advanced: [{ torch: !torchOn }] as unknown as MediaTrackConstraintSet[],
      })
      setTorchOn((on) => !on)
    } catch {
      setErrorMsg('เครื่องนี้ไม่รองรับไฟฉายกล้อง')
      setPhase('error')
      window.setTimeout(() => {
        if (!detectedRef.current) {
          setPhase('live')
          setErrorMsg('')
        }
      }, 1600)
    }
  }

  // Esc closes (capture phase so it wins over parent modal Esc handlers).
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[1100] grid place-items-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-card shadow-2xl overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-5 border-b">
          <div className="min-w-0">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
              Camera Scanner
            </span>
            <h2 className="text-base font-semibold mt-0.5 truncate">{title}</h2>
            {hint ? <p className="text-xs text-muted-foreground mt-1">{hint}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่าง"
            className="shrink-0 size-8 rounded-lg text-muted-foreground hover:bg-muted grid place-items-center"
          >
            <X size={16} />
          </button>
        </div>

        <div className="relative bg-black aspect-video">
          <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
          {phase === 'live' && (
            <div className="absolute inset-0 grid place-items-center pointer-events-none" aria-hidden="true">
              <div className="relative w-3/5 aspect-video">
                <span className="absolute -top-1 -left-1 size-6 border-t-4 border-l-4 border-emerald-400 rounded-tl-lg" />
                <span className="absolute -top-1 -right-1 size-6 border-t-4 border-r-4 border-emerald-400 rounded-tr-lg" />
                <span className="absolute -bottom-1 -left-1 size-6 border-b-4 border-l-4 border-emerald-400 rounded-bl-lg" />
                <span className="absolute -bottom-1 -right-1 size-6 border-b-4 border-r-4 border-emerald-400 rounded-br-lg" />
                <span className="absolute left-0 right-0 top-1/2 h-0.5 bg-emerald-400/80 shadow-[0_0_8px_rgba(16,185,129,0.7)] animate-pulse" />
              </div>
            </div>
          )}
          {phase === 'starting' && (
            <div className="absolute inset-0 grid place-items-center text-white text-center p-6">
              <div className="space-y-2">
                <Camera size={32} className="mx-auto opacity-80" />
                <b className="block">กำลังเปิดกล้อง…</b>
                <small className="block text-white/70">
                  ถ้าเบราว์เซอร์ถามสิทธิ์กล้อง ให้กดอนุญาต
                </small>
              </div>
            </div>
          )}
          {phase === 'error' && (
            <div className="absolute inset-0 grid place-items-center text-white text-center p-6">
              <div className="space-y-3 max-w-sm">
                <CircleAlert size={32} className="mx-auto text-amber-400" />
                <b className="block">เปิดกล้องไม่ได้</b>
                <small className="block text-white/80 whitespace-pre-line">{errorMsg}</small>
                <Button variant="outline" size="sm" onClick={onClose} className="bg-card">
                  ปิดหน้าต่างนี้
                </Button>
              </div>
            </div>
          )}
        </div>

        {phase === 'live' && (
          <div className="flex items-center justify-between gap-3 p-3 bg-muted/50">
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <ScanLine size={13} />
              เล็งบาร์โค้ดให้อยู่ในกรอบ — อ่านได้จะมีเสียงบี๊ปและปิดอัตโนมัติ
            </span>
            <button
              type="button"
              onClick={() => void toggleTorch()}
              aria-pressed={torchOn}
              aria-label={torchOn ? 'ปิดไฟฉายกล้อง' : 'เปิดไฟฉายกล้อง'}
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium border ${
                torchOn
                  ? 'bg-amber-500 text-white border-amber-500'
                  : 'bg-card text-foreground border-border hover:bg-accent'
              }`}
            >
              {torchOn ? <ZapOff size={13} /> : <Zap size={13} />}
              {torchOn ? 'ปิดไฟ' : 'ไฟฉาย'}
            </button>
          </div>
        )}

        {lastCode && (
          <div
            className="px-4 py-2 text-xs text-emerald-700 bg-emerald-50 border-t flex items-center gap-2"
            role="status"
            aria-live="polite"
          >
            <ScanLine size={13} />
            อ่านล่าสุด: <b className="font-mono">{lastCode}</b>
          </div>
        )}
      </div>
    </div>
  )
}
