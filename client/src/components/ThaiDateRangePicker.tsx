import React from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "@/lib/icons";
import { bangkokParts } from "@shared/storeTime";

const THAI_MONTHS_FULL = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const THAI_MONTHS_SHORT = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const THAI_WEEKDAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

function toIso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function fromIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatThai(value: string) {
  const date = fromIso(value);
  return date ? `${date.getDate()} ${THAI_MONTHS_SHORT[date.getMonth()]} ${date.getFullYear() + 543}` : "";
}

export function resolveRangePick(anchor: string, picked: string): [string, string] {
  return picked < anchor ? [picked, anchor] : [anchor, picked];
}

export function ThaiDateRangePicker({
  from,
  to,
  onChange,
  ariaLabel = "เลือกช่วงวันที่",
  placeholder = "เลือกช่วงวันที่",
  className = "",
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const current = bangkokParts(new Date());
  const today = new Date(current.year, current.month - 1, current.day);
  const initial = fromIso(from || to) ?? today;
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const selected = fromIso(from || to) ?? today;
    setViewYear(selected.getFullYear());
    setViewMonth(selected.getMonth());
    setAnchor("");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = wrapRef.current?.getBoundingClientRect();
      const popup = popRef.current;
      if (!rect || !popup) return;
      const gap = 6;
      const margin = 8;
      const { width, height } = popup.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - gap - margin;
      const above = rect.top - gap - margin;
      const top = below >= height || below >= above ? rect.bottom + gap : rect.top - height - gap;
      setPosition({
        top: Math.max(margin, Math.min(top, window.innerHeight - height - margin)),
        left: Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin)),
      });
    };
    updatePosition();
    const closeOutside = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node) && !popRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, [open, viewMonth, viewYear]);

  const grid = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells: (Date | null)[] = Array.from({ length: first.getDay() }, () => null);
    for (let day = 1; day <= daysInMonth; day += 1) cells.push(new Date(viewYear, viewMonth, day));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [viewMonth, viewYear]);

  const stepMonth = (delta: number) => {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  };
  const pick = (date: Date) => {
    const iso = toIso(date);
    if (!anchor) {
      setAnchor(iso);
      onChange(iso, iso);
      return;
    }
    const [nextFrom, nextTo] = resolveRangePick(anchor, iso);
    onChange(nextFrom, nextTo);
    setAnchor("");
    setOpen(false);
  };
  const display = from && to
    ? from === to ? formatThai(from) : `${formatThai(from)} – ${formatThai(to)}`
    : from || to ? formatThai(from || to) : placeholder;
  const effectiveFrom = anchor || from;
  const effectiveTo = anchor || to;

  return <div className={`thai-date-range-picker${className ? ` ${className}` : ""}`} ref={wrapRef}>
    <button type="button" className="thai-date-range-field" onClick={() => setOpen(value => !value)} aria-haspopup="dialog" aria-expanded={open} aria-label={ariaLabel}>
      <CalendarDays size={16} />
      <span>{display}</span>
      <ChevronRight size={13} className="thai-date-caret" />
    </button>
    {(from || to) && <button type="button" className="thai-date-range-clear" aria-label="ล้างช่วงวันที่" title="ล้างช่วงวันที่" onClick={() => { onChange("", ""); setAnchor(""); setOpen(false); }}><X size={14} /></button>}
    {open && createPortal(<div
      ref={popRef}
      className="thai-date-pop thai-date-range-pop"
      style={{ position: "fixed", top: position.top, left: position.left, right: "auto", bottom: "auto", zIndex: 10000, maxWidth: "calc(100vw - 16px)", maxHeight: "calc(100dvh - 16px)", overflowY: "auto" }}
      role="dialog"
      aria-label={`ปฏิทินเลือกช่วงวันที่ ${THAI_MONTHS_FULL[viewMonth]} ${viewYear + 543}`}
    >
      <div className="thai-date-nav">
        <button type="button" onClick={() => stepMonth(-1)} aria-label="เดือนก่อนหน้า"><ChevronLeft size={15} /></button>
        <b>{THAI_MONTHS_FULL[viewMonth]} {viewYear + 543}</b>
        <button type="button" onClick={() => stepMonth(1)} aria-label="เดือนถัดไป"><ChevronRight size={15} /></button>
      </div>
      <p className="thai-date-range-hint">{anchor ? "เลือกวันสิ้นสุด" : "เลือกวันเริ่มต้น"}</p>
      <div className="thai-date-grid thai-date-week">{THAI_WEEKDAYS.map(day => <span key={day}>{day}</span>)}</div>
      <div className="thai-date-grid">
        {grid.map((date, index) => {
          if (!date) return <span key={`empty-${index}`} />;
          const iso = toIso(date);
          const inRange = Boolean(effectiveFrom && effectiveTo && iso >= effectiveFrom && iso <= effectiveTo);
          const edge = iso === effectiveFrom || iso === effectiveTo;
          return <button type="button" key={iso} className={`${edge ? "picked " : ""}${inRange ? "in-range " : ""}${iso === toIso(today) ? "today" : ""}`.trim()} onClick={() => pick(date)} aria-label={`${date.getDate()} ${THAI_MONTHS_FULL[date.getMonth()]} ${date.getFullYear() + 543}`}>{date.getDate()}</button>;
        })}
      </div>
      <div className="thai-date-foot">
        <button type="button" className="mini-button" onClick={() => { const iso = toIso(today); onChange(iso, iso); setAnchor(""); setOpen(false); }}>วันนี้ · {today.getDate()} {THAI_MONTHS_SHORT[today.getMonth()]} {today.getFullYear() + 543}</button>
        <button type="button" className="mini-button" onClick={() => { onChange("", ""); setAnchor(""); setOpen(false); }}>ล้างช่วงวันที่</button>
      </div>
    </div>, document.body)}
  </div>;
}