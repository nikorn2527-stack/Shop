/**
 * Scan / search code normalization.
 *
 * Original Shop logic — supports barcode gun, hand-typed text, QR payloads
 * (JSON / URL / "MEMBER:xxx" / digits-only).
 *
 * Every lookup box funnels through these helpers so the same input works for:
 * - barcode scanner gun (high-speed keystrokes)
 * - QR payload with URL or JSON
 * - manual typing
 */

/** Strips control chars and collapses whitespace. */
function cleanScanRaw(raw: string): string {
  return raw.replace(/[\u0000-\u001f]+/g, ' ').trim()
}

const SCAN_PAYLOAD_KEYS = [
  'memberNumber', 'member', 'memberNo', 'm', 'sku', 'productCode', 'code',
  'barcode', 'id', 'bill', 'orderNumber', 'order',
] as const

function firstPayloadValue(payload: Record<string, unknown>): string | null {
  for (const key of SCAN_PAYLOAD_KEYS) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return null
}

/**
 * Normalizes a scanned or typed code to comparable candidates.
 * Example: "https://x/m/M-000001?foo" -> ["https://x/m/m-000001?foo", "m-000001", "000001"]
 */
export function scanCandidates(raw: string): string[] {
  const cleaned = cleanScanRaw(raw)
  if (cleaned === '') return []
  const lowered = cleaned.toLowerCase()
  const out = new Set<string>([lowered])

  // JSON payload: {"memberNumber":"M-000001"}
  if (lowered.startsWith('{')) {
    try {
      const parsed = JSON.parse(cleaned) as Record<string, unknown>
      const value = firstPayloadValue(parsed)
      if (value) out.add(value.toLowerCase())
    } catch {
      /* not JSON — treat as plain text */
    }
  }

  // URL payload: https://host/path/M-000001?member=M-000001
  if (lowered.includes('://') || lowered.includes('www.')) {
    try {
      const url = new URL(cleaned)
      url.searchParams.forEach((value) => {
        if (value) out.add(value.toLowerCase())
      })
      const lastSegment = url.pathname.split('/').filter(Boolean).pop()
      if (lastSegment) out.add(decodeURIComponent(lastSegment).toLowerCase())
    } catch {
      /* not a URL — fall through */
    }
  }

  // "MEMBER:M-000001" / "SKU;DRK-001" / "M-000001," — take the last token
  const tokens = lowered.split(/[:;|,>]/).map(t => t.trim()).filter(Boolean)
  if (tokens.length > 1) out.add(tokens[tokens.length - 1])

  // digits-only variant (strip letter prefixes, dashes, zeros)
  const digits = lowered.replace(/[^0-9]/g, '')
  if (digits.length >= 4) out.add(digits)

  return Array.from(out)
}

/** True when any normalized form of `input` equals the normalized `value`. */
export function scanMatches(value: string | null | undefined, input: string): boolean {
  if (!value) return false
  const needle = value.trim().toLowerCase()
  return needle !== '' && scanCandidates(input).includes(needle)
}

/**
 * Smart match score 0-100.
 *   exact            = 100
 *   prefix >=3       = 82
 *   prefix <3        = 60
 *   contains >=3     = 62
 *   contains <3      = 40
 *   endsWith >=2     = 52
 */
export function smartMatchScore(value: string | null | undefined, input: string): number {
  if (!value) return 0
  const needle = value.trim().toLowerCase()
  const raw = input.trim().toLowerCase()
  if (!needle || !raw) return 0
  let best = 0
  const seen: Record<string, boolean> = {}
  for (const candidate of [raw, ...scanCandidates(input)]) {
    if (candidate === '' || seen[candidate]) continue
    seen[candidate] = true
    if (candidate === needle) best = Math.max(best, 100)
    else if (needle.startsWith(candidate)) best = Math.max(best, candidate.length >= 3 ? 82 : 60)
    else if (needle.includes(candidate)) best = Math.max(best, candidate.length >= 3 ? 62 : 40)
    else if (needle.endsWith(candidate) && candidate.length >= 2) best = Math.max(best, 52)
  }
  return best
}

/** Compress a picked photo to a compact JPEG data URL for DB storage. */
export async function compressImageToDataUrl(
  file: File | Blob,
  maxEdge = 480,
  quality = 0.72,
): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', quality)
}

/** Validate a data URL is an image and within size limit. */
export function validateImageDataUrl(dataUrl: string | null | undefined, maxChars = 600_000): string | null {
  if (!dataUrl) return null
  if (!dataUrl.startsWith('data:image/')) return null
  if (dataUrl.length > maxChars) return null
  return dataUrl
}

/** Common prenames used as datalist suggestions in member forms. */
export const PRENAME_OPTIONS = [
  'นาย', 'นาง', 'นางสาว', 'ด.ช.', 'ด.ญ.', 'แพทย์หญิง', 'พ.อ.', 'พ.ญ.', 'พ.ต.', 'พ.ต.ญ.', 'ร.ท.', 'ร.ท.ญ.',
]

/** Build a full Thai name with optional prename. */
export function memberFullName(member: {
  prename?: string | null
  firstName?: string | null
  lastName?: string | null
}): string {
  return [
    member.prename?.trim() || '',
    member.firstName?.trim() || '',
    member.lastName?.trim() || '',
  ].filter(Boolean).join(' ')
}
