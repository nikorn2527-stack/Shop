import { useMemo, useState } from "react";
import { X } from "@/lib/icons";
import { WorkflowDialog } from "./WorkflowDialog";
import {
  categoryEmoji,
  normalizeProductCategory,
} from "@shared/productCategories";
import { PRODUCT_ICONS, resolveProductArtwork } from "@shared/productIcons";

export function ProductImagePicker({
  currentEmoji,
  currentImageUrl,
  category,
  productName,
  onChange,
  onClose,
}: {
  currentEmoji?: string | null;
  currentImageUrl?: string | null;
  category?: string | null;
  productName?: string;
  onChange: (emoji: string | null, imageUrl: string | null) => void;
  onClose: () => void;
}) {
  const [selection, setSelection] = useState(() =>
    resolveProductArtwork({
      emoji: currentEmoji,
      imageUrl: currentImageUrl,
      category,
      name: productName,
    })
  );
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("ทั้งหมด");
  const groups = useMemo(
    () => [
      "ทั้งหมด",
      ...Array.from(new Set(PRODUCT_ICONS.map(icon => icon.category))),
    ],
    []
  );
  const choices = useMemo(() => {
    const term = query.trim().toLowerCase();
    return PRODUCT_ICONS.filter(
      icon =>
        (group === "ทั้งหมด" || icon.category === group) &&
        (!term ||
          `${icon.label} ${icon.aliases.join(" ")} ${icon.category}`
            .toLowerCase()
            .includes(term))
    );
  }, [group, query]);
  const defaultEmoji = categoryEmoji(category);
  return (
    <WorkflowDialog
      title="เลือกไอคอนสินค้า"
      description="ใช้แทนรูปถ่ายได้ทั้งสินค้าบนแผงและสินค้าในคลัง เลือกแล้วกดยืนยัน"
      onClose={onClose}
      className="form-modal product-image-picker"
    >
      <div className="modal-heading">
        <div>
          <h2>เลือกไอคอนสินค้า</h2>
          <p>เลือกรูปแทนสินค้า โดยไม่ต้องถ่ายภาพจริง</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="ปิดตัวเลือกไอคอน"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <div className="product-icon-preview" aria-live="polite">
        {selection.imageUrl ? (
          <img src={selection.imageUrl} alt="ตัวอย่างภาพสินค้า" />
        ) : (
          <span className="product-icon-emoji" aria-hidden="true">
            {selection.emoji}
          </span>
        )}
        <div>
          <b>{productName || "ตัวอย่างสินค้า"}</b>
          <small>จะบันทึกเมื่อกดบันทึกสินค้า</small>
        </div>
      </div>
      <button
        type="button"
        className="outline-button product-icon-default"
        aria-pressed={!selection.imageUrl && selection.emoji === defaultEmoji}
        onClick={() => setSelection({ imageUrl: null, emoji: defaultEmoji })}
      >
        <span aria-hidden="true">{defaultEmoji}</span> ใช้ค่าเริ่มต้นตามหมวด ·{" "}
        {normalizeProductCategory(category || "ของใช้")}
      </button>
      <label className="product-icon-search">
        ค้นหาไอคอน
        <input
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="เช่น แสตมป์ ผ้าเช็ดตัว น้ำแข็ง"
        />
      </label>
      <label className="product-icon-filter">
        หมวดไอคอน
        <select value={group} onChange={event => setGroup(event.target.value)}>
          {groups.map(value => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      <div className="product-icon-grid" aria-label="ชุดไอคอนสินค้า">
        {choices.map(icon => (
          <button
            key={icon.id}
            type="button"
            className="product-icon-choice"
            aria-label={`เลือกไอคอน ${icon.label}`}
            aria-pressed={selection.imageUrl === icon.imageUrl}
            onClick={() =>
              setSelection({ imageUrl: icon.imageUrl, emoji: icon.emoji })
            }
          >
            <img src={icon.imageUrl} alt="" loading="lazy" />
            <span>{icon.label}</span>
          </button>
        ))}
      </div>
      {choices.length === 0 && (
        <p role="status">ไม่พบไอคอน ลองค้นด้วยชื่ออื่นหรือเลือกหมวดทั้งหมด</p>
      )}
      <div className="modal-actions">
        <button type="button" className="outline-button" onClick={onClose}>
          ยกเลิก
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={() => {
            onChange(selection.emoji, selection.imageUrl);
            onClose();
          }}
        >
          ยืนยันไอคอน
        </button>
      </div>
    </WorkflowDialog>
  );
}
