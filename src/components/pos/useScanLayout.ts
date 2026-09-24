'use client'

/**
 * useScanLayout — captures physical keystrokes from a barcode gun even when
 * the Windows IME is in Thai Kedmanee mode, and reconstructs the intended
 * English/digit string.
 *
 * Mirror of /tmp/Shop/client/src/scanLayout.ts.
 *
 * Two layers of recovery:
 *   1. "Pure digit row" — every char is in the Thai number row (ๅ / _ ภ ถ ุ ึ
 *      ค ต จ ข ช ๑-๙ ฿ …) and length ≥ 4 = someone typing digits while Thai
 *      is on (real Thai text always has letters from other rows).
 *   2. "Fast burst" — hook stores event.code (physical key, language-agnostic)
 *      + timing. Barcode gun fires 10-40ms/char; humans cannot match that.
 *      If the recent burst is gun-fast AND the committed text contains Thai,
 *      rebuild the string from the captured physical codes.
 */

import { useCallback, useRef } from 'react'

const THAI_DIGIT_ROW: Record<string, string> = {
  // No Shift (key 1 → ๅ U+0E45, key 2 → /, key 3 → _, …)
  '\u0E45': '1', // ๅ
  '/': '2',
  '_': '3',
  '\u0E20': '4', // ภ
  '\u0E16': '5', // ถ
  '\u0E38': '6', // ุ
  '\u0E36': '7', // ึ
  '\u0E04': '8', // ค
  '\u0E15': '9', // ต
  '\u0E08': '0', // จ
  '\u0E02': '-', // ข
  '\u0E0A': '=', // ช
  // Shift (Thai digits + symbols of the same row)
  '+': '1',
  '\u0E51': '2', // ๑
  '\u0E52': '3', // ๒
  '\u0E53': '4', // ๓
  '\u0E54': '5', // ๔
  '\u0E39': '6', // ู
  '\u0E3F': '7', // ฿
  '\u0E55': '8', // ๕
  '\u0E56': '9', // ๖
  '\u0E57': '0', // ๗
  '\u0E58': '-', // ๘
  '\u0E59': '=', // ๙
}

const NEUTRAL_CHARS: Record<string, boolean> = { ' ': true, '-': true, '.': true }

/** True if `text` contains any Thai char (U+0E01–U+0E5B). */
export function hasThai(text: string): boolean {
  return /[\u0E01-\u0E5B]/.test(text)
}

/** Layer 1 — every char is in the Thai digit-row map (+ neutral) and length ≥ 4. */
export function convertThaiDigitRow(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed.length < 4) return null
  let mappedCount = 0
  let out = ''
  for (const ch of trimmed) {
    if (NEUTRAL_CHARS[ch]) {
      out += ch
      continue
    }
    const mapped = THAI_DIGIT_ROW[ch]
    if (mapped === undefined) return null
    out += mapped
    mappedCount += 1
  }
  return mappedCount >= 4 ? out : null
}

/** event.code (physical key) → English char that key would produce. */
function codeToChar(code: string, shift: boolean): string | null {
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) {
    const key = code.slice(6)
    return /^[0-9]$/.test(key) ? key : null
  }
  if (code.startsWith('Key')) {
    const letter = code.slice(3).toLowerCase()
    return shift ? letter.toUpperCase() : letter
  }
  const symbols: Record<string, string> = {
    Minus: '-',
    Equal: '=',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Semicolon: ';',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Backquote: '`',
  }
  return symbols[code] ?? null
}

type BurstState = { chars: string[]; times: number[]; enterAt: number }

/** Inter-key gap below which we still consider the burst "one gun shot". */
const BURST_GAP_MS = 90
/** Burst faster than this end-to-end = barcode gun (humans peak ~80-100ms/char). */
const BURST_TOTAL_MS = 900

export type ScanLayoutFix = { value: string; convertedFrom?: string }

/** Standard toast shown whenever a conversion happened — caller decides whether to surface. */
export const SCAN_LAYOUT_TOAST = {
  message: 'แปลงคีย์บอร์ดไทย → อังกฤษให้อัตโนมัติ',
  description: (from: string, to: string) =>
    `"${from}" → "${to}" — ยิงบาร์โค้ดได้เลยไม่ต้องสลับภาษา`,
}

/**
 * Attach `onKeyDownCapture` to the scan input's container, then call
 * `normalize(text)` on commit (Enter) to recover the intended string.
 */
export function useScanLayout() {
  const burstRef = useRef<BurstState>({ chars: [], times: [], enterAt: 0 })

  const onKeyDownCapture = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    const state = burstRef.current
    const now = event.timeStamp || performance.now()
    if (event.key === 'Enter') {
      state.enterAt = now
      return
    }
    if (event.key === 'Backspace') {
      state.chars = []
      state.times = []
      return
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const ch = codeToChar(event.code, event.shiftKey)
    if (ch === null) return
    const last = state.times[state.times.length - 1]
    if (last === undefined || now - last > BURST_GAP_MS) {
      state.chars = []
      state.times = []
    }
    state.chars.push(ch)
    state.times.push(now)
  }, [])

  const normalize = useCallback((text: string): ScanLayoutFix => {
    const value = text.trim()
    if (value === '' || !hasThai(value)) return { value }

    // Layer 2 — gun burst (fast + Enter closely after): rebuild from physical codes.
    const { chars, times, enterAt } = burstRef.current
    if (enterAt > 0 && times.length >= 3) {
      const totalSpan = times[times.length - 1] - times[0]
      let maxGap = 0
      for (let index = 1; index < times.length; index += 1) {
        maxGap = Math.max(maxGap, times[index] - times[index - 1])
      }
      const enterGap = enterAt - times[times.length - 1]
      if (totalSpan <= BURST_TOTAL_MS && maxGap <= BURST_GAP_MS && enterGap <= 160) {
        const rebuilt = chars.join('').trim()
        if (rebuilt !== '' && rebuilt !== value) return { value: rebuilt, convertedFrom: value }
      }
    }

    // Layer 1 — digits typed while Thai IME is on (regardless of speed).
    const converted = convertThaiDigitRow(value)
    if (converted !== null && converted !== value) return { value: converted, convertedFrom: value }

    return { value }
  }, [])

  return { onKeyDownCapture, normalize }
}
