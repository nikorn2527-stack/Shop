import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Round 31-8 — เลือกวันที่เป็นภาษาไทยล้วน (เดือนไทย · ปี พ.ศ. · สัปดาห์ อา–ส)
 * แทนช่อง input[type=date] ของเบราว์เซอร์ที่ฟอร์แมตตามภาษาเครื่อง
 * value/onChange ใช้รูปแบบ ISO "YYYY-MM-DD" เหมือนเดิม — สลับกับ backend ได้ทันที
 */
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
  if (!date) return "";
  return `${date.getDate()} ${THAI_MONTHS_SHORT[date.getMonth()]} ${date.getFullYear() + 543}`;
}

export function ThaiDatePicker({ value, onChange, min, max, ariaLabel = "เลือกวันที่", placeholder = "เลือกวันที่" }: {
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  ariaLabel?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const selected = fromIso(value);
  const today = new Date();
  const [viewYear, setViewYear] = useState(selected?.getFullYear() ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(selected?.getMonth() ?? today.getMonth());
  useEffect(() => {
    if (open && selected) { setViewYear(selected.getFullYear()); setViewMonth(selected.getMonth()); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDocClick); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const minDate = useMemo(() => fromIso(min ?? "") ?? null, [min]);
  const maxDate = useMemo(() => fromIso(max ?? "") ?? null, [max]);
  const grid = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const lead = first.getDay();
    const cells: (Date | null)[] = Array.from({ length: lead }, () => null);
    for (let day = 1; day <= daysInMonth; day += 1) cells.push(new Date(viewYear, viewMonth, day));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [viewMonth, viewYear]);
  const stepMonth = (delta: number) => {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  };
  const outOfRange = (date: Date) => (minDate && date < new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate())) || (maxDate && date > new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate()));
  const pick = (date: Date) => { onChange(toIso(date)); setOpen(false); };
  return (
    <div className="thai-date-picker" ref={wrapRef}>
      <button type="button" className="thai-date-field" onClick={() => setOpen((current) => !current)} aria-haspopup="dialog" aria-expanded={open} aria-label={ariaLabel}>
        <CalendarDays size={15} />
        <span>{value ? formatThai(value) : placeholder}</span>
        <ChevronRight size={13} className="thai-date-caret" />
      </button>
      {open && (
        <div className="thai-date-pop" role="dialog" aria-label={`ปฏิทิน ${THAI_MONTHS_FULL[viewMonth]} ${viewYear + 543}`}>
          <div className="thai-date-nav">
            <button type="button" onClick={() => stepMonth(-1)} aria-label="เดือนก่อนหน้า"><ChevronLeft size={15} /></button>
            <b>{THAI_MONTHS_FULL[viewMonth]} {viewYear + 543}</b>
            <button type="button" onClick={() => stepMonth(1)} aria-label="เดือนถัดไป"><ChevronRight size={15} /></button>
          </div>
          <div className="thai-date-grid thai-date-week">
            {THAI_WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="thai-date-grid">
            {grid.map((date, index) => date === null
              ? <span key={`empty-${index}`} />
              : <button type="button" key={toIso(date)} className={value === toIso(date) ? "picked" : toIso(date) === toIso(today) ? "today" : ""} disabled={Boolean(outOfRange(date))} onClick={() => pick(date)} aria-label={`${date.getDate()} ${THAI_MONTHS_FULL[date.getMonth()]} ${date.getFullYear() + 543}`}>{date.getDate()}</button>)}
          </div>
          <div className="thai-date-foot">
            <button type="button" className="mini-button" onClick={() => pick(today)}>วันนี้ · {today.getDate()} {THAI_MONTHS_SHORT[today.getMonth()]} {today.getFullYear() + 543}</button>
            {value && <button type="button" className="mini-button" onClick={() => { onChange(""); setOpen(false); }}>ล้างวันที่</button>}
          </div>
        </div>
      )}
    </div>
  );
}
