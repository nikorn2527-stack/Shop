import { useRef, type ChangeEvent } from "react";
import { ImagePlus } from "@/lib/icons";

/** A visible upload affordance replaces the browser's small native file control. */
export function BackgroundImageUpload({ target, hasImage, disabled, onChange }: {
  target: "workspace" | "login";
  hasImage: boolean;
  disabled: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const label = target === "login" ? "หน้าเข้าสู่ระบบ" : "พื้นที่ทำงาน";
  return <div className="background-image-upload">
    <ImagePlus size={30} aria-hidden="true" />
    <div><b>{hasImage ? "เปลี่ยนภาพพื้นหลัง" : "เพิ่มภาพพื้นหลัง"}{label}</b><p>เลือกภาพจากเครื่อง เช่น ภาพโรงพยาบาลหรืออาคาร</p><small>PNG, JPG หรือ WEBP · ขนาดไม่เกิน 2MB</small></div>
    <button type="button" className="outline-button background-upload-button" disabled={disabled} onClick={() => input.current?.click()}><ImagePlus size={17} />{hasImage ? "เปลี่ยนรูป" : "เลือกรูปภาพ"}</button>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" aria-label={`เลือกภาพพื้นหลัง${label}`} hidden disabled={disabled} onChange={onChange} />
  </div>;
}
