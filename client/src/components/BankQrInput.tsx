import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { validateBankPaymentQr } from "@shared/paymentQr";
import { ImagePlus, Trash2 } from "@/lib/icons";

export function BankQrInput({ value, onChange, disabled }: { value: string; onChange: (payload: string) => void; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ payload: string; url: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!value) return;
    let cancelled = false;
    QRCode.toDataURL(value, { margin: 4, width: 220 }).then(url => { if (!cancelled) setPreview({ payload: value, url }); }).catch(() => {});
    return () => { cancelled = true; };
  }, [value]);
  const pick = async (file?: File) => {
    if (!file || busy || disabled) return;
    setError("");
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 2_000_000) {
      setError("เลือกรูป QR รับเงิน PNG JPG WEBP ขนาดไม่เกิน 2MB"); return;
    }
    setBusy(true);
    const url = URL.createObjectURL(file);
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const result = await new BrowserQRCodeReader().decodeFromImageUrl(url);
      const payload = validateBankPaymentQr(result.getText());
      if (alive.current) onChange(payload);
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error && cause.message ? cause.message : "อ่าน QR ไม่ได้ กรุณาใช้รูป QR รับเงินต้นฉบับจากแอปธนาคาร");
    } finally { URL.revokeObjectURL(url); if (alive.current) setBusy(false); }
  };
  return <div className="bank-qr-input" data-field-feedback="off">
    <b>QR รับเงินของบัญชีนี้</b>
    <p>เลือก QR รับเงินแบบไม่ระบุยอดจากแอปธนาคาร ตรวจว่าตรงกับบัญชีด้านบนก่อนบันทึก</p>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label="รูป QR รับเงินธนาคาร" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void pick(file); }} disabled={disabled || busy} />
    <div className="bank-qr-input-actions">
      <button type="button" className="outline-button" disabled={disabled || busy} onClick={() => input.current?.click()}><ImagePlus size={16} />{busy ? "กำลังอ่าน QR…" : value ? "เปลี่ยน QR รับเงิน" : "เลือกรูป QR รับเงิน"}</button>
      {value && <button type="button" className="danger-outline-button" disabled={disabled || busy} onClick={() => onChange("")}><Trash2 size={16} />นำ QR ออก</button>}
    </div>
    {value && preview?.payload === value && <img src={preview.url} alt="ตัวอย่าง QR รับเงินของบัญชี" />}
    <small>{value ? "มี QR รับเงินแล้ว · กดบันทึกการตั้งค่าเพื่อใช้งาน" : "ยังไม่มี QR — รับโอนด้วยเลขบัญชีได้ แต่ยังแสดง QR ของบัญชีนี้ไม่ได้"}</small>
    {error && <p role="alert" className="notice-bar error">{error}</p>}
  </div>;
}
