/**
 * cardRenderer — Task C v2: Canvas Renderer กลางสำหรับบัตรสมาชิก
 *
 * วาดบัตรลง Canvas โดยตรง (ไม่ใช้ html2canvas) ที่ความละเอียด 300 DPI
 * 90mm × 55mm @ 300 DPI = 1063 × 650 px
 *
 * ทุกช่องทางใช้ Canvas อันเดียวกัน:
 * - Preview: แสดง Canvas บนหน้าจอ (scale ลง)
 * - PNG: canvas.toDataURL("image/png")
 * - PDF: jsPDF 90×55mm + addImage จาก canvas
 * - Print: ส่ง canvas เป็น image ไป Helper
 *
 * Barcode และ QR สร้างที่ความละเอียดสูง (ไม่ screenshot จากหน้าจอ)
 */
import QRCode from "qrcode";
import { code128DataUrl } from "../barcode";
import { money } from "../pages/pageData";
import type { MemberCardData } from "../components/MemberCardModal";

// 90mm × 55mm @ 300 DPI
export const CARD_W_PX = 1063;
export const CARD_H_PX = 650;
export const CARD_W_MM = 90;
export const CARD_H_MM = 55;

/** สีหลักของบัตร */
const COLORS = {
  bg: "#f9fbfa",
  border: "#d3e5dd",
  text: "#2e463e",
  textMuted: "#7b7f70",
  teal: "#3d8c71",
  tealLight: "#eaf5f1",
  white: "#ffffff",
  photoBg: "#f5f5f3",
  photoBorder: "#c0c0bc",
};

type CardRenderInput = {
  member: MemberCardData;
  brandName: string;
  brandLogo: string; // data URL หรือ empty
  qrDataUrl: string;
  photoUrl?: string | null; // data URL หรือ null
};

/**
 * วาดบัตรลง Canvas — คืน HTMLCanvasElement
 * ทุกช่องทาง (Preview/PNG/PDF/Print) เรียกฟังก์ชันนี้อันเดียว
 */
export async function renderCardToCanvas(input: CardRenderInput): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W_PX;
  canvas.height = CARD_H_PX;
  const ctx = canvas.getContext("2d")!;

  // อัตราส่วน px → mm (สำหรับคำนวณ padding)
  const scale = CARD_W_PX / CARD_W_MM; // ≈ 11.81 px/mm

  // --- พื้นหลัง ---
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, CARD_W_PX, CARD_H_PX);

  // --- ขอบ ---
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1 * scale;
  ctx.strokeRect(0.5 * scale, 0.5 * scale, CARD_W_PX - 1 * scale, CARD_H_PX - 1 * scale);

  const padX = 5 * scale;
  const padY = 4 * scale;
  let y = padY;

  // --- หัวบัตร: brand + type ---
  const brandName = input.brandName || "ร้านค้าสวัสดิการ";
  // Logo
  const logoSize = 14 * scale;
  if (input.brandLogo) {
    try {
      const logoImg = await loadImage(input.brandLogo);
      ctx.drawImage(logoImg, padX, y, logoSize, logoSize);
    } catch { /* skip */ }
  } else {
    // Brand initial
    ctx.fillStyle = COLORS.teal;
    ctx.beginPath();
    ctx.roundRect(padX, y, logoSize, logoSize, 3 * scale);
    ctx.fill();
    ctx.fillStyle = COLORS.white;
    ctx.font = `bold ${8 * scale}px "Sarabun", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(brandName.charAt(0) || "ร", padX + logoSize / 2, y + logoSize / 2);
  }

  // Brand name text
  ctx.fillStyle = COLORS.text;
  ctx.font = `bold ${6 * scale}px "Sarabun", sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(brandName, padX + logoSize + 3 * scale, y);
  ctx.fillStyle = COLORS.textMuted;
  ctx.font = `${4 * scale}px "Sarabun", sans-serif`;
  ctx.fillText("Welfare Store", padX + logoSize + 3 * scale, y + 7 * scale);

  // Member type (top-right)
  const typeText = input.member.type || "สมาชิก";
  ctx.font = `${4 * scale}px "Sarabun", sans-serif`;
  ctx.fillStyle = COLORS.teal;
  const typeW = ctx.measureText(typeText).width;
  ctx.fillStyle = COLORS.white;
  ctx.beginPath();
  ctx.roundRect(CARD_W_PX - padX - typeW - 6 * scale, y, typeW + 6 * scale, 7 * scale, 3.5 * scale);
  ctx.fill();
  ctx.strokeStyle = "#cfe4db";
  ctx.lineWidth = 0.5 * scale;
  ctx.stroke();
  ctx.fillStyle = COLORS.teal;
  ctx.textAlign = "center";
  ctx.fillText(typeText, CARD_W_PX - padX - typeW / 2 - 3 * scale, y + 1.5 * scale);

  y += logoSize + 4 * scale;

  // --- เนื้อหา: รูป + ชื่อ + เลข ---
  const photoW = 30 * scale;
  const photoH = 40 * scale;
  const photoX = padX;
  const photoY = y;

  // Photo frame
  ctx.fillStyle = COLORS.white;
  ctx.fillRect(photoX - 1, photoY - 1, photoW + 2, photoH + 2);
  ctx.strokeStyle = COLORS.photoBorder;
  ctx.lineWidth = 0.5 * scale;
  ctx.setLineDash([2 * scale, 2 * scale]);
  ctx.strokeRect(photoX, photoY, photoW, photoH);
  ctx.setLineDash([]);

  // Photo or placeholder
  if (input.photoUrl) {
    try {
      const photoImg = await loadImage(input.photoUrl);
      ctx.save();
      ctx.beginPath();
      ctx.rect(photoX, photoY, photoW, photoH);
      ctx.clip();
      ctx.drawImage(photoImg, photoX, photoY, photoW, photoH);
      ctx.restore();
    } catch { /* skip */ }
  } else {
    // Placeholder "สมาชิก"
    ctx.fillStyle = COLORS.photoBg;
    ctx.fillRect(photoX, photoY, photoW, photoH);
    ctx.fillStyle = COLORS.photoBorder;
    ctx.font = `bold ${5 * scale}px "Sarabun", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("สมาชิก", photoX + photoW / 2, photoY + photoH / 2);
  }

  // Identity (right of photo)
  const idX = photoX + photoW + 5 * scale;
  const idW = CARD_W_PX - idX - padX;
  const displayName = [input.member.prename?.trim() || "", input.member.firstName, input.member.lastName].filter(Boolean).join(" ");

  // Name — auto-fit font size
  let nameFontSize = 8 * scale;
  ctx.font = `bold ${nameFontSize}px "Sarabun", sans-serif`;
  while (ctx.measureText(displayName).width > idW && nameFontSize > 5 * scale) {
    nameFontSize -= 0.3 * scale;
    ctx.font = `bold ${nameFontSize}px "Sarabun", sans-serif`;
  }
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(displayName, idX, photoY);

  // Member number
  ctx.font = `bold ${11 * scale}px "IBM Plex Mono", monospace`;
  ctx.fillStyle = COLORS.teal;
  ctx.fillText(input.member.memberNumber, idX, photoY + nameFontSize + 2 * scale);

  // Card number / HN
  let infoY = photoY + nameFontSize + 16 * scale;
  if (input.member.cardNumber) {
    const cardText = `บัตร ${input.member.cardNumber}${input.member.patientCode ? ` · HN ${input.member.patientCode}` : ""}`;
    ctx.font = `${4 * scale}px "Sarabun", sans-serif`;
    ctx.fillStyle = COLORS.textMuted;
    ctx.fillText(cardText, idX, infoY);
    infoY += 6 * scale;
  }

  // Meta: date + status
  const dateText = input.member.createdAt
    ? `สมัครเมื่อ ${formatCardDate(input.member.createdAt)}`
    : "พร้อมใช้จ่ายที่เคาน์เตอร์";
  ctx.font = `${4 * scale}px "Sarabun", sans-serif`;
  ctx.fillStyle = COLORS.textMuted;
  ctx.fillText(dateText, idX, infoY);

  const statusText = input.member.status === "active" ? "ใช้จ่ายได้ปกติ" : "ระงับการใช้จ่าย";
  ctx.fillStyle = input.member.status === "active" ? "#4b9d7f" : "#c26568";
  const statusW = ctx.measureText(statusText).width;
  ctx.fillText(statusText, idX + idW - statusW, infoY);

  y = photoY + photoH + 4 * scale;

  // --- Barcode + QR ---
  const codesH = 30 * scale;
  const barcodeW = idW + photoW + 5 * scale; // ใช้ความกว้างเต็ม
  const qrW = 22 * scale;
  const gap = 3 * scale;
  const barcodeActualW = CARD_W_PX - padX * 2 - qrW - gap;

  // Barcode
  const barcodeDataUrl = code128DataUrl(input.member.memberNumber, { height: 200, moduleWidth: 2, padding: 4 });
  if (barcodeDataUrl) {
    try {
      const barcodeImg = await loadImage(barcodeDataUrl);
      ctx.fillStyle = COLORS.white;
      ctx.fillRect(padX, y, barcodeActualW, codesH);
      ctx.strokeStyle = "#d8e6df";
      ctx.lineWidth = 0.5 * scale;
      ctx.strokeRect(padX, y, barcodeActualW, codesH);
      // Draw barcode centered
      const bw = barcodeImg.width;
      const bh = barcodeImg.height;
      const maxH = codesH - 8 * scale;
      const maxW = barcodeActualW - 6 * scale;
      let dw = maxW;
      let dh = (bh / bw) * dw;
      if (dh > maxH) { dh = maxH; dw = (bw / bh) * dh; }
      ctx.drawImage(barcodeImg, padX + (barcodeActualW - dw) / 2, y + 2 * scale, dw, dh);
      // Label
      ctx.font = `${3 * scale}px "Sarabun", sans-serif`;
      ctx.fillStyle = COLORS.textMuted;
      ctx.textAlign = "center";
      ctx.fillText("บาร์โค้ด", padX + barcodeActualW / 2, y + codesH - 4 * scale);
    } catch { /* skip */ }
  }

  // QR
  const qrX = padX + barcodeActualW + gap;
  ctx.fillStyle = COLORS.white;
  ctx.fillRect(qrX, y, qrW, codesH);
  ctx.strokeStyle = "#d8e6df";
  ctx.lineWidth = 0.5 * scale;
  ctx.strokeRect(qrX, y, qrW, codesH);
  if (input.qrDataUrl) {
    try {
      const qrImg = await loadImage(input.qrDataUrl);
      const qrDrawSize = qrW - 4 * scale;
      ctx.drawImage(qrImg, qrX + 2 * scale, y + 2 * scale, qrDrawSize, qrDrawSize);
      ctx.font = `${3 * scale}px "Sarabun", sans-serif`;
      ctx.fillStyle = COLORS.textMuted;
      ctx.textAlign = "center";
      ctx.fillText("คิวอาร์โค้ด", qrX + qrW / 2, y + codesH - 4 * scale);
    } catch { /* skip */ }
  }

  y += codesH + 3 * scale;

  // --- ท้ายบัตร ---
  ctx.strokeStyle = "#cfe4db";
  ctx.lineWidth = 0.5 * scale;
  ctx.setLineDash([2 * scale, 2 * scale]);
  ctx.beginPath();
  ctx.moveTo(padX, y);
  ctx.lineTo(CARD_W_PX - padX, y);
  ctx.stroke();
  ctx.setLineDash([]);
  y += 2 * scale;

  ctx.font = `${3.5 * scale}px "Sarabun", sans-serif`;
  ctx.fillStyle = COLORS.textMuted;
  ctx.textAlign = "left";
  ctx.fillText("ยื่นบัตรนี้ให้สแกน หรือแจ้งหมายเลขสมาชิกที่เคาน์เตอร์", padX, y);

  const balanceText = `ยอดคงเหลือ ${money(input.member.balance)}`;
  ctx.textAlign = "right";
  ctx.fillStyle = COLORS.teal;
  ctx.font = `bold ${4 * scale}px "Sarabun", sans-serif`;
  ctx.fillText(balanceText, CARD_W_PX - padX, y);

  return canvas;
}

/** Helper: load image from URL */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Format date for card */
function formatCardDate(value: string): string {
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
}
