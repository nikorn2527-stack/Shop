"use client";

/**
 * ThaiDatePicker — Buddhist-era calendar popover.
 *
 * Value is ISO "YYYY-MM-DD" (gregorian). Display is Buddhist (year + 543).
 * Week starts on Sunday. Built on shadcn Popover + a custom month grid
 * (no react-day-picker dependency, no custom CSS file).
 *
 * Props:
 *   value?: string   — "YYYY-MM-DD" or "" / undefined
 *   onChange(next)   — called with the new ISO string (or "" when cleared)
 *   min?: string     — "YYYY-MM-DD" lower bound (inclusive)
 *   max?: string     — "YYYY-MM-DD" upper bound (inclusive)
 *   placeholder?: string
 *   disabled?: boolean
 *   ariaLabel?: string
 */

import * as React from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const THAI_MONTHS_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
] as const;

const THAI_MONTHS_FULL = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
] as const;

const THAI_WEEKDAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"] as const;

const BUDDHIST_OFFSET = 543;

interface ParsedDate {
  y: number; // gregorian year
  m: number; // 0-11
  d: number; // 1-31
}

function parseIso(iso: string | undefined | null): ParsedDate | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [, yStr, mStr, dStr] = match;
  const y = Number(yStr);
  const m = Number(mStr) - 1;
  const d = Number(dStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 0 || m > 11 || d < 1 || d > 31) return null;
  return { y, m, d };
}

function toIso(p: ParsedDate): string {
  const m = String(p.m + 1).padStart(2, "0");
  const d = String(p.d).padStart(2, "0");
  return `${p.y}-${m}-${d}`;
}

/** Days in a gregorian month. */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Day of week for the 1st of (year, month). Sunday = 0. */
function firstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

/** Today as ParsedDate in local timezone. */
function todayParsed(): ParsedDate {
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
}

/** Format ISO as Thai display: "16 ก.ย. 2569". */
function formatThai(iso: string | undefined | null): string {
  const p = parseIso(iso);
  if (!p) return "";
  return `${p.d} ${THAI_MONTHS_SHORT[p.m]} ${p.y + BUDDHIST_OFFSET}`;
}

export interface ThaiDatePickerProps {
  value?: string;
  onChange: (next: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  /** Optionally render the trigger as a custom child. Default = read-only Input. */
  children?: React.ReactNode;
}

export function ThaiDatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = "เลือกวันที่",
  disabled = false,
  ariaLabel = "เลือกวันที่",
  className,
  children,
}: ThaiDatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const selected = parseIso(value);
  const minP = parseIso(min);
  const maxP = parseIso(max);
  const today = todayParsed();

  // Initial view = selected month, else today.
  const [view, setView] = React.useState<{ y: number; m: number }>(() => ({
    y: selected?.y ?? today.y,
    m: selected?.m ?? today.m,
  }));

  // When opening, sync the calendar to the latest selected value.
  React.useEffect(() => {
    if (!open) return;
    if (selected) setView({ y: selected.y, m: selected.m });
    else setView({ y: today.y, m: today.m });
  }, [open]);

  // Esc to close (shadcn Popover also handles Esc natively, but we keep
  // this for parity with the original Shop behavior).
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const totalDays = daysInMonth(view.y, view.m);
  const leading = firstDayOfMonth(view.y, view.m);

  const cells: (ParsedDate | null)[] = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) {
    cells.push({ y: view.y, m: view.m, d });
  }

  const isSameDay = (a: ParsedDate | null, b: ParsedDate | null): boolean => {
    if (!a || !b) return false;
    return a.y === b.y && a.m === b.m && a.d === b.d;
  };

  const isOutOfRange = (p: ParsedDate): boolean => {
    if (minP && toIso(p) < toIso(minP)) return true;
    if (maxP && toIso(p) > toIso(maxP)) return true;
    return false;
  };

  const pick = (p: ParsedDate) => {
    if (isOutOfRange(p)) return;
    onChange(toIso(p));
    setOpen(false);
  };

  const gotoPrevMonth = () => {
    setView((prev) => {
      const m = prev.m - 1;
      if (m < 0) return { y: prev.y - 1, m: 11 };
      return { y: prev.y, m };
    });
  };
  const gotoNextMonth = () => {
    setView((prev) => {
      const m = prev.m + 1;
      if (m > 11) return { y: prev.y + 1, m: 0 };
      return { y: prev.y, m };
    });
  };
  const gotoPrevYear = () => setView((prev) => ({ ...prev, y: prev.y - 1 }));
  const gotoNextYear = () => setView((prev) => ({ ...prev, y: prev.y + 1 }));

  const clear = () => {
    onChange("");
    setOpen(false);
  };
  const pickToday = () => {
    pick(today);
  };

  const trigger = children ?? (
    <Input
      readOnly
      value={selected ? formatThai(value) : ""}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn("cursor-pointer", className)}
      onClick={() => !disabled && setOpen(true)}
    />
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          className="block w-full text-left disabled:cursor-not-allowed disabled:opacity-50"
        >
          {trigger}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[20rem] p-3 sm:w-[22rem]"
      >
        {/* Header: month + year (Buddhist) with prev/next */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={gotoPrevYear}
              aria-label="ปีก่อนหน้า"
            >
              «
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={gotoPrevMonth}
              aria-label="เดือนก่อนหน้า"
            >
              <ChevronLeft className="size-4" />
            </Button>
          </div>
          <div className="text-center">
            <div className="text-sm font-semibold leading-none">
              {THAI_MONTHS_FULL[view.m]}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {view.y + BUDDHIST_OFFSET}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={gotoNextMonth}
              aria-label="เดือนถัดไป"
            >
              <ChevronRight className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={gotoNextYear}
              aria-label="ปีถัดไป"
            >
              »
            </Button>
          </div>
        </div>

        {/* Weekday row */}
        <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
          {THAI_WEEKDAYS.map((w) => (
            <div key={w} className="py-1 font-medium">
              {w}
            </div>
          ))}
        </div>

        {/* Day grid */}
        <div className="mt-1 grid grid-cols-7 gap-1 text-center">
          {cells.map((cell, idx) => {
            if (!cell) return <div key={`empty-${idx}`} />;
            const selectedCls = isSameDay(cell, selected);
            const todayCls = isSameDay(cell, today);
            const out = isOutOfRange(cell);
            return (
              <button
                key={toIso(cell)}
                type="button"
                disabled={out}
                onClick={() => pick(cell)}
                className={cn(
                  "size-8 rounded-md text-sm transition-colors disabled:opacity-30 disabled:cursor-not-allowed",
                  "hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300",
                  todayCls && !selectedCls && "ring-1 ring-emerald-300",
                  selectedCls &&
                    "bg-emerald-600 text-white hover:bg-emerald-700",
                )}
              >
                {cell.d}
              </button>
            );
          })}
        </div>

        {/* Quick actions */}
        <div className="mt-3 flex items-center justify-between gap-2 border-t pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={pickToday}
            className="h-8 text-xs"
          >
            วันนี้ · {formatThai(toIso(today))}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clear}
            className="h-8 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
          >
            <X className="size-3.5" />
            ล้างวันที่
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
