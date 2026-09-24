"use client";

/**
 * StatusPill — colored status badge.
 *
 * Tailwind color classes per tone — NO indigo/blue (per project palette).
 *
 * Two ways to render content:
 *   1. <StatusPill tone="active" />              — uses default Thai label
 *   2. <StatusPill tone="active" label="เปิด" /> — explicit label
 *   3. <StatusPill tone="green">ปกติ</StatusPill> — children (used by Stock page)
 *
 * Tone values:
 *   - "active"   — green   (ปกติ / ใช้งาน)
 *   - "suspended"— red     (ระงับ / ปิดการขาย)
 *   - "locked"   — amber   (ล็อกชั่วคราว)
 *   - "pending"  — amber   (รอดำเนินการ / ใกล้หมดอายุ)
 *   - "inactive" — purple  (ปิดการขาย — alternative)
 *   - "green"    — green   (Stock: ปกติ)
 *   - "red"      — red     (Stock: สต็อกต่ำ)
 *   - "amber"    — amber   (Stock: ใกล้หมดอายุ)
 *   - "purple"   — purple  (Stock: ปิดการขาย)
 *   - "neutral"  — gray    (default)
 */

import * as React from "react";
import { cn } from "@/lib/utils";

export type Tone =
  // Member / user statuses (existing API)
  | "active"
  | "suspended"
  | "locked"
  | "pending"
  // Stock page tones (new API)
  | "green"
  | "red"
  | "amber"
  | "purple"
  | "blue"
  | "neutral";

/** Alias kept for backward compat with Stock page imports. */
export type StatusTone = Tone;

const TONES: Record<Tone, string> = {
  active: "bg-emerald-100 text-emerald-700 border-emerald-200",
  suspended: "bg-rose-100 text-rose-700 border-rose-200",
  locked: "bg-amber-100 text-amber-700 border-amber-200",
  pending: "bg-amber-100 text-amber-700 border-amber-200",
  green: "bg-emerald-100 text-emerald-800 border-emerald-200",
  red: "bg-rose-100 text-rose-800 border-rose-200",
  amber: "bg-amber-100 text-amber-800 border-amber-200",
  purple: "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200",
  blue: "bg-cyan-100 text-cyan-800 border-cyan-200",
  neutral: "bg-neutral-100 text-neutral-700 border-neutral-200",
};

const LABELS: Partial<Record<Tone, string>> = {
  active: "ใช้งาน",
  suspended: "ระงับ",
  locked: "ล็อกชั่วคราว",
  pending: "รอดำเนินการ",
};

export interface StatusPillProps {
  tone?: Tone;
  /** Optional label (overrides default Thai label). */
  label?: React.ReactNode;
  className?: string;
  /** Alternative way to pass content (takes precedence over `label`). */
  children?: React.ReactNode;
}

export function StatusPill({
  tone = "neutral",
  label,
  className,
  children,
}: StatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          tone === "active" && "bg-emerald-500",
          tone === "green" && "bg-emerald-500",
          tone === "suspended" && "bg-rose-500",
          tone === "red" && "bg-rose-500",
          tone === "locked" && "bg-amber-500",
          tone === "pending" && "bg-amber-500",
          tone === "amber" && "bg-amber-500",
          tone === "purple" && "bg-fuchsia-500",
          tone === "blue" && "bg-cyan-500",
          tone === "neutral" && "bg-neutral-400",
        )}
        aria-hidden="true"
      />
      {children ?? label ?? LABELS[tone] ?? "—"}
    </span>
  );
}

/** Map a member.status string → StatusPill tone. */
export function memberStatusTone(status: string): Tone {
  if (status === "active") return "active";
  if (status === "suspended") return "suspended";
  return "neutral";
}

/** Map a user.active / failedAttempts / lockedUntil combo → StatusPill tone + label. */
export function userStatusTone(user: {
  active: boolean;
  failedAttempts?: number;
  lockedUntil?: string | Date | null;
  mustChangePassword?: boolean;
}): { tone: Tone; label: string } {
  if (!user.active) return { tone: "suspended", label: "ระงับการใช้งาน" };
  const locked =
    user.lockedUntil &&
    new Date(user.lockedUntil).getTime() > Date.now();
  if (locked) return { tone: "locked", label: "ล็อกชั่วคราว" };
  if ((user.failedAttempts ?? 0) > 0)
    return { tone: "pending", label: `พยายามผิดพลาด ${user.failedAttempts}` };
  if (user.mustChangePassword)
    return { tone: "pending", label: "รอเปลี่ยนรหัสผ่าน" };
  return { tone: "active", label: "ใช้งาน" };
}

export default StatusPill;
