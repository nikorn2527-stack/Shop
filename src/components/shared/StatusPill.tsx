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
  // Match original Shop .status-pill colors exactly
  active:   "text-[#4b987b] bg-[#edf8f3] border-transparent",
  suspended:"text-[#c16b6e] bg-[#fff0f0] border-transparent",
  locked:   "text-[#b8863d] bg-[#fff5e6] border-transparent",
  pending:  "text-[#b8863d] bg-[#fff5e6] border-transparent",
  green:    "text-[#4b987b] bg-[#edf8f3] border-transparent",
  red:      "text-[#c16b6e] bg-[#fff0f0] border-transparent",
  amber:    "text-[#b8863d] bg-[#fff5e6] border-transparent",
  purple:   "text-[#8870af] bg-[#f3edfb] border-transparent",
  blue:     "text-[#5d91b5] bg-[#edf6fb] border-transparent",
  neutral:  "text-neutral-600 bg-neutral-100 border-transparent",
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
        "inline-flex items-center gap-[5px] rounded-[20px] px-[7px] py-[4px] text-[10px] font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      <span
        className={cn(
          "size-[5px] rounded-full",
          (tone === "active" || tone === "green") && "bg-[#4b987b]",
          (tone === "suspended" || tone === "red") && "bg-[#c16b6e]",
          (tone === "locked" || tone === "pending" || tone === "amber") && "bg-[#b8863d]",
          tone === "purple" && "bg-[#8870af]",
          tone === "blue" && "bg-[#5d91b5]",
          tone === "neutral" && "bg-neutral-400",
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
