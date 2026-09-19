import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * Round 37 — toast notifications ใช้ธีมของแอปโดยตรง
 * (แอปนี้เป็น light theme แบบกำหนดเอง ไม่ได้ใช้ next-themes — สี/ฟอนต์
 * ทั้งหมดจัดการที่ index.css ผ่าน [data-sonner-toast] แทน CSS vars)
 */
const Toaster = ({ ...props }: ToasterProps) => (
  <Sonner
    theme="light"
    className="toaster group"
    {...props}
  />
);

export { Toaster };
