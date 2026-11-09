import type { SlipVariant } from "@shared/storeTypes/documents";
export function SlipCopyMark({ variant }: { variant: SlipVariant }) {
  return variant === "copy" ? (
    <div className="slip-copy-mark">สำเนา</div>
  ) : null;
}
export function SlipDocumentOptions({
  variant,
  onChange,
  disabled = false,
}: {
  variant: SlipVariant;
  onChange: (variant: SlipVariant) => void;
  disabled?: boolean;
}) {
  return (
    <label className="slip-document-options">
      ดาวน์โหลดเป็น{" "}
      <select
        aria-label="รูปแบบเอกสารดาวน์โหลด"
        value={variant}
        disabled={disabled}
        onChange={e => onChange(e.target.value as SlipVariant)}
      >
        <option value="original">ต้นฉบับ</option>
        <option value="copy">สำเนา</option>
      </select>
      <small>การพิมพ์ซ้ำจะระบุ “สำเนา” อัตโนมัติ</small>
    </label>
  );
}
