import { normalizeExpiryDate } from "@shared/expiryDate";
export function ExpiryDateInput({ value, onChange, label, disabled, onNext, id }: {
  value: string; onChange: (value: string) => void; label: string; disabled?: boolean;
  onNext?: () => void; id?: string;
}) {
  const valid = normalizeExpiryDate(value) !== null;
  return <div><input id={id} type="text" inputMode="numeric" aria-label={label} disabled={disabled} value={value} placeholder="วว/ดด/ปปปป" title="วัน/เดือน/ปี พ.ศ. หรือ ค.ศ. เช่น 31/12/2570" aria-invalid={!valid} onChange={e => onChange(e.target.value)} onKeyDown={e => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing && !e.shiftKey && (!valid || onNext)) { e.preventDefault(); if (valid) onNext?.(); }
  }} />{!valid && <small role="alert">ระบุวันที่จริง เช่น 31/12/2570</small>}</div>;
}
