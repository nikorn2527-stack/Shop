import { useEffect, useLayoutEffect, useState } from "react";
import QRCode from "qrcode";
import type { BankAccount } from '@shared/storeTypes/settings';
import { validateBankPaymentQr } from "@shared/paymentQr";
import { buildPromptPayPayload, isValidPromptPayId } from "@/promptpay";
import { Bank, Copy, QrCode } from "@/lib/icons";
import { money } from "@/pages/pageData";

type Props = { settings?: { promptpayId: string; promptpayActive: boolean; paymentQrSource: string; bankAccounts: BankAccount[] }; amount: number; onQrReady: (url: string) => void; onSourceChange: () => void };

export function PaymentQrPanel({ settings, amount, onQrReady, onSourceChange }: Props) {
  const banks = (settings?.bankAccounts ?? []).filter(account => account.active);
  const promptpayEnabled = settings?.promptpayActive !== false;
  const preferred = settings?.paymentQrSource ?? "promptpay";
  const available = (id: string) => id === "promptpay" ? promptpayEnabled : banks.some(bank => bank.id === id);
  const fallback = available(preferred) ? preferred : promptpayEnabled ? "promptpay" : banks[0]?.id ?? "";
  const [chosen, setChosen] = useState<string | null>(null);
  const source = chosen !== null && available(chosen) ? chosen : fallback;
  const bank = banks.find(account => account.id === source);
  const [image, setImage] = useState<{ key: string; url: string } | null>(null);
  const [renderError, setRenderError] = useState<{ key: string; message: string } | null>(null);
  let payload = "";
  let error = "";
  try {
    if (source === "promptpay") {
      if (!isValidPromptPayId(settings?.promptpayId ?? "")) throw new Error("ยังไม่ได้ตั้งเลขพร้อมเพย์ — ไปที่ตั้งค่า › การชำระเงิน");
      payload = buildPromptPayPayload({ promptpayId: settings!.promptpayId, amount });
    } else if (bank) {
      if (!bank.qrPayload) throw new Error(`ยังไม่ได้ตั้ง QR รับเงินของ${bank.bankName} — ไปที่ตั้งค่า › การชำระเงิน › แก้ไขบัญชี`);
      payload = validateBankPaymentQr(bank.qrPayload);
    } else error = "ยังไม่มีช่องทางรับเงินที่เปิดใช้งาน — ไปที่ตั้งค่า › การชำระเงิน";
  } catch (cause) { error = cause instanceof Error ? cause.message : "สร้าง QR ไม่สำเร็จ"; }
  // Key the rendered image to its exact source and payload: never display the previous account while a new QR renders.
  const key = `${source}:${amount}:${payload}`;
  useEffect(() => {
    if (!payload) return;
    let cancelled = false;
    QRCode.toDataURL(payload, { margin: 4, width: 280, errorCorrectionLevel: "M" })
      .then(url => { if (!cancelled) { setImage({ key, url }); setRenderError(null); } })
      .catch(() => { if (!cancelled) setRenderError({ key, message: "สร้างภาพ QR ไม่สำเร็จ กรุณาปิดแล้วเปิดหน้าชำระเงินใหม่" }); });
    return () => { cancelled = true; };
  }, [key, payload]);

  useLayoutEffect(() => { onSourceChange(); }, [key, onSourceChange]);
  useLayoutEffect(() => {
    onQrReady(!error && renderError?.key !== key && image?.key === key ? image.url : "");
    return () => onQrReady("");
  }, [key, image, error, renderError, onQrReady]);

  return <section className="payment-qr-panel" data-field-feedback="off">
    <label className="payment-qr-source">ช่องทางรับเงิน
      <select value={source} onChange={event => setChosen(event.target.value)} aria-label="ช่องทางรับเงิน QR">
        {!source && <option value="">ยังไม่มีช่องทางรับเงิน</option>}
        {promptpayEnabled && <option value="promptpay">พร้อมเพย์</option>}
        {banks.map(account => <option key={account.id} value={account.id}>{account.bankName} · {account.accountNumber}</option>)}
      </select>
    </label>
    {error || renderError?.key === key ? <p className="notice-bar warning" role="status">{error || renderError?.message}</p> : image?.key === key ? <div className="pay-qr-figure">
      <img src={image.url} alt={bank ? `QR รับเงิน ${bank.bankName} ${bank.accountNumber}` : `QR พร้อมเพย์ ยอด ${money(amount)}`} />
      <div className="pay-qr-caption"><b><QrCode size={16} />{bank ? bank.bankName : "พร้อมเพย์"}</b>
        <small>{bank ? `${bank.accountName} · ${bank.accountNumber}` : settings?.promptpayId}</small>
        <strong>ยอดชำระ {money(amount)}</strong>
        <small>{bank ? "กรอกยอดในแอปธนาคาร แล้วตรวจชื่อผู้รับก่อนโอน" : "QR ระบุยอดตามบิลนี้"}</small>
      </div>
    </div> : <p role="status">กำลังสร้าง QR…</p>}
    {bank && <div className="payment-bank-details"><Bank size={16} /><span>{bank.accountName} · {bank.accountNumber}</span>
      <button type="button" className="outline-button" onClick={() => navigator.clipboard?.writeText(bank.accountNumber).catch(() => {})} aria-label="คัดลอกเลขบัญชี"><Copy size={14} />คัดลอก</button>
    </div>}
  </section>;
}
