import { useCallback, useMemo, useRef, useState } from "react";
import { X } from "@/lib/icons";
import { WorkflowDialog } from "./WorkflowDialog";
import { compressImageToDataUrl } from "../pageData";

/** อีโมจิตัวแทนของแต่ละหมวดสินค้า ใช้สำหรับสินค้าที่ยังไม่มีรูปภาพและไม่มีบาร์โค้ด */
export const CATEGORY_EMOJI_MAP: Record<string, string> = {
  "เครื่องดื่ม": "🥤",
  "อาหาร": "🍱",
  "ของใช้": "🛍️",
  "ของใช้ส่วนตัว": "🧴",
  "ของใช้ในครัวเรือน": "🧺",
  "ขนม": "🍬",
  "เครื่องเขียน": "📝",
};

/** รายการอีโมจิที่ใช้บ่อยสำหรับสินค้าทั่วไป */
const COMMON_EMOJIS = [
  "🥤", "🍱", "🍱", "🛍️", "🧴", "🧺", "🍬", "📝",
  "🥤", "☕", "🧃", "🥛", "🍉", "🍎", "🍌", "🍊",
  "🍞", "🍳", "🍔", "🍟", "🍕", "🍩", "🍪", "🍫",
  "📦", "🎒", "👕", "👖", "👟", "🧢", "🧴", "🧼",
  "📝", "✂️", "📎", "📄", "✏️", "🖊️", "📘", "📕",
];

export function ProductImagePicker({
  currentEmoji,
  currentImageUrl,
  category,
  onChange,
  onClose,
}: {
  currentEmoji?: string | null;
  currentImageUrl?: string | null;
  category?: string | null;
  onChange: (emoji: string | null, imageUrl: string | null) => void;
  onClose: () => void;
}) {
  const [selectedEmoji, setSelectedEmoji] = useState(currentEmoji ?? CATEGORY_EMOJI_MAP[category ?? ""] ?? "🛍️");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState(currentImageUrl ?? null);
  const fileInput = useRef<HTMLInputElement>(null);

  const handleImageChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;
    setImageFile(file);
    const dataUrl = await compressImageToDataUrl(file);
    setPreviewUrl(dataUrl);
    setSelectedEmoji(null); // เลือกรูปแล้วให้เลือกระหว่างรูปกับอีโมจิอย่างใดอย่างหนึ่ง
  };

  const pickEmoji = useCallback((emoji: string) => {
    setSelectedEmoji(emoji);
    setImageFile(null);
    setPreviewUrl(null);
  }, []);

  const confirm = useCallback(() => {
    onChange(selectedEmoji || null, previewUrl || null);
    onClose();
  }, [selectedEmoji, previewUrl, onChange, onClose]);

  const emojiGrid = useMemo(() => {
    const defaults = category ? [CATEGORY_EMOJI_MAP[category]].filter(Boolean) : [];
    const others = COMMON_EMOJIS.filter(e => !defaults.includes(e));
    return [...defaults, ...others];
  }, [category]);

  return (
    <WorkflowDialog
      title="เลือกรูปสินค้าหรืออีโมจิ"
      description="สินค้าที่ไม่มีบาร์โค้ดจะแสดงรูปหรืออีโมจิเป็นภาพต้นแบบบนแผงหน้าร้าน"
      onClose={onClose}
      className="form-modal product-image-picker"
    >
      <div className="image-picker-tabs">
        <button
          type="button"
          className={`tab-btn${selectedEmoji ? " active" : ""}`}
          onClick={() => { setSelectedEmoji(CATEGORY_EMOJI_MAP[category ?? ""] ?? "🛍️"); setImageFile(null); setPreviewUrl(null); }}
        >
          ใช้อีโมจิตามหมวด
        </button>
        <button
          type="button"
          className={`tab-btn${!selectedEmoji && previewUrl ? " active" : ""}`}
          onClick={() => fileInput.current?.click()}
        >
          อัปโหลดรูปภาพ
        </button>
      </div>

      {previewUrl ? (
        <div className="image-picker-preview">
          <img src={previewUrl} alt="ตัวอย่างรูปสินค้า" />
          <button type="button" className="image-picker-remove" onClick={() => { setImageFile(null); setPreviewUrl(null); setSelectedEmoji(CATEGORY_EMOJI_MAP[category ?? ""] ?? "🛍️"); }}>
            <X size={16} />
          </button>
        </div>
      ) : (
        <div className="emoji-grid">
          {emojiGrid.map((emoji, index) => (
            <button
              key={index}
              type="button"
              className={`emoji-btn${selectedEmoji === emoji ? " active" : ""}`}
              onClick={() => pickEmoji(emoji)}
              aria-label={`เลือกอีโมจิ ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {!previewUrl && (
        <div className="image-picker-upload">
          <label className="image-picker-upload-label">
            <span>📷</span>
            <b>เลือกไฟล์รูปภาพสินค้า</b>
            <small>PNG, JPG หรือ WEBP · ขนาดไม่เกิน 2MB</small>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={handleImageChange}
            />
          </label>
        </div>
      )}

      <div className="image-picker-actions">
        <button type="button" className="outline-button" onClick={onClose}>ยกเลิก</button>
        <button type="button" className="primary-button" onClick={confirm}>ยืนยัน</button>
      </div>
    </WorkflowDialog>
  );
}
