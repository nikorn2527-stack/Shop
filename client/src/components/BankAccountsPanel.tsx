import { QR_BANKS } from "@shared/paymentQr";
import { BankQrInput } from "./BankQrInput";
import { notify } from "@/lib/notifications";
/**
 * FIX-5 (user) — Bank accounts panel for Settings → Payment tab.
 *
 * Lets the admin maintain a list of shop's bank accounts (for accepting
 * money transfers). Stored in `StoreSettings.bankAccounts` as a JSON array.
 * The list is displayed at POS payment confirmation (next to PromptPay QR)
 * and at the bottom of receipts when payment method is "QR / สแกน".
 *
 * This component is purely presentational — it calls `onChange` with a new
 * array on every edit; the parent (Settings.tsx) is responsible for merging
 * into the form state and saving via `settings.set` mutation.
 */
import { useState } from "react";
import "./PaymentSettings.css";
import {
  Bank,
  Check,
  Copy,
  Pencil,
  Plus,
  Trash2,
  X,
  CircleAlert,
} from "@/lib/icons";
import { toast } from "sonner";
import type { BankAccount } from "../../../server/sqliteStore";

/** Preset list of Thai banks — quick pick, but admin can type custom too. */
const THAI_BANK_PRESETS: { code: string; name: string }[] = [
  ...QR_BANKS,
  { code: "BBL", name: "ธนาคารกรุงเทพ" },
  { code: "BAY", name: "ธนาคารกรุงศรีอยุธยา" },
  { code: "TTB", name: "ธนาคารทหารไทย" },
  { code: "TCD", name: "ธนาคารธนชาติ" },
  { code: "CIMBT", name: "ธนาคารซีไอเอ็มบีไทย" },
  { code: "TISCO", name: "ธนาคารทิสโก้" },
  { code: "KKTB", name: "ธนาคารเกียรตินาคาร" },
  { code: "ICB", name: "ธนาคารอาคารสงเคราะห์" },
  { code: "LHFB", name: "ธนาคารแลนด์ แอนด์ เฮ้าส์" },
  { code: "GHIB", name: "ธนาคารไอซีบีคแบงก์ (GBI)" },
  { code: "TCRB", name: "ธนาคารประชาชนพัทลุง" },
];

type DraftState = {
  id: string;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  branch: string;
  active: boolean;
  note: string;
  qrPayload: string;
};

const EMPTY_DRAFT = (): DraftState => ({
  id: "",
  bankCode: "",
  bankName: "",
  accountNumber: "",
  accountName: "",
  branch: "",
  active: true,
  note: "",
  qrPayload: "",
});

const isComplete = (draft: DraftState): boolean =>
  draft.bankName.trim().length > 0 &&
  draft.accountName.trim().length > 0 &&
  draft.accountNumber.replace(/[\-\s]/g, "").length >= 7;

const sanitizeAccount = (raw: string): string =>
  // Keep digits, dashes, and spaces only — server enforces same regex.
  raw.replace(/[^0-9\-\s]/g, "");

type BankAccountsPanelProps = {
  value: BankAccount[];
  onChange: (next: BankAccount[]) => void;
  disabled?: boolean;
  storeName?: string;
};

export function BankAccountsPanel({
  value,
  onChange,
  disabled = false,
  storeName,
}: BankAccountsPanelProps) {
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const startAdd = () => {
    setDraft(EMPTY_DRAFT());
    setEditingId(null);
  };
  const startEdit = (account: BankAccount) => {
    setDraft({
      id: account.id,
      bankCode: account.bankCode,
      bankName: account.bankName,
      accountNumber: account.accountNumber,
      accountName: account.accountName,
      branch: account.branch ?? "",
      active: account.active,
      note: account.note ?? "",
      qrPayload: account.qrPayload ?? "",
    });
    setEditingId(account.id);
  };
  const cancelDraft = () => {
    setDraft(null);
    setEditingId(null);
  };

  const pickPreset = (preset: { code: string; name: string }) => {
    if (!draft) return;
    setDraft({
      ...draft,
      bankCode: preset.code,
      bankName: preset.name,
      qrPayload: preset.code === draft.bankCode ? draft.qrPayload : "",
    });
  };

  const commitDraft = () => {
    if (!draft) return;
    if (!isComplete(draft)) {
      notify.error("ข้อมูลไม่ครบ", {
        description: "ต้องกรอกชื่อธนาคาร ชื่อบัญชี และเลขที่บัญชีอย่างน้อย 7 หลัก",
        duration: 4000,
      });
      return;
    }
    const cleaned: BankAccount = {
      id: draft.id || crypto.randomUUID(),
      bankCode: draft.bankCode.trim() || draft.bankName.trim().slice(0, 20),
      bankName: draft.bankName.trim(),
      accountNumber: draft.accountNumber.trim(),
      accountName: draft.accountName.trim(),
      branch: draft.branch.trim() || undefined,
      active: draft.active,
      note: draft.note.trim() || undefined,
      qrPayload: draft.qrPayload || undefined,
    };
    if (editingId) {
      onChange(value.map(a => (a.id === editingId ? cleaned : a)));
    } else {
      onChange([...value, cleaned]);
    }
    cancelDraft();
    toast.info(editingId ? "แก้ไขร่างข้อมูลบัญชีแล้ว" : "เพิ่มบัญชีในร่างแล้ว", {
      description: "กด “บันทึกการตั้งค่า” ด้านบน แล้วตรวจสอบและยืนยันเพื่อใช้งานจริง",
      duration: 3200,
    });
  };

  const removeAccount = (id: string) => {
    onChange(value.filter(a => a.id !== id));
    if (editingId === id) cancelDraft();
  };

  const toggleActive = (id: string) => {
    onChange(value.map(a => (a.id === id ? { ...a, active: !a.active } : a)));
  };

  const copyAccount = async (account: BankAccount) => {
    const text = `${account.bankName} เลขที่ ${account.accountNumber} ชื่อ ${account.accountName}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("คัดลอกข้อมูลบัญชีแล้ว", {
        description: "วางในแชทให้ลูกค้าได้เลย",
        duration: 2200,
      });
    } catch {
      notify.error("คัดลอกไม่สำเร็จ", { description: text, duration: 4000 });
    }
  };

  return (
    <section className="panel settings-card bank-accounts-compact">
      <div className="settings-heading">
        <div>
          <h2>บัญชีธนาคารรับโอน</h2>
          <p>QR รับเงินรองรับกรุงไทย กสิกรไทย ไทยพาณิชย์ และออมสิน</p>
        </div>
        {!draft && <button type="button" className="outline-button" onClick={startAdd} disabled={disabled}><Plus size={15} /> เพิ่มบัญชี</button>}
      </div>

      <div className="bank-list">
        {value.length === 0 && !draft && (
          <div className="bank-empty">
            <Bank size={22} />
            <div>
              <b>ยังไม่มีบัญชีธนาคาร</b>
            </div>
          </div>
        )}

        {value.map(account => (
          <div
            className={`bank-row${account.active ? "" : " inactive"}`}
            key={account.id}
          >
            <div className="bank-row-ico">
              <Bank size={18} />
            </div>
            <div className="bank-row-info">
              <b>
                {account.bankName}
                {account.bankCode && (
                  <em className="bank-code-pill">{account.bankCode}</em>
                )}
              </b>
              <small>
                เลขที่ <i>{account.accountNumber}</i> · ชื่อบัญชี{" "}
                <i>{account.accountName}</i>
                {account.qrPayload ? " · มี QR รับเงิน" : " · ยังไม่มี QR รับเงิน"}
                {account.branch ? ` · สาขา ${account.branch}` : ""}
                {account.note ? ` · ${account.note}` : ""}
              </small>
            </div>
            <div className="bank-row-actions">
              <button
                type="button"
                className="icon-button"
                onClick={() => void copyAccount(account)}
                title="คัดลอกข้อมูลบัญชี (ชื่อธนาคาร + เลขที่ + ชื่อบัญชี)"
                aria-label="คัดลอกข้อมูลบัญชี"
              >
                <Copy size={15} />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => startEdit(account)}
                title="แก้ไขบัญชีนี้"
                aria-label="แก้ไขบัญชีนี้"
                disabled={disabled}
              >
                <Pencil size={15} />
              </button>
              <button
                type="button"
                className="icon-button danger"
                onClick={() => removeAccount(account.id)}
                title="ลบบัญชีนี้ออกจากระบบ"
                aria-label="ลบบัญชีนี้"
                disabled={disabled}
              >
                <Trash2 size={15} />
              </button>
              <button
                type="button"
                className={`toggle ${account.active ? "on" : ""}`}
                onClick={() => toggleActive(account.id)}
                title={account.active ? "ปิดรับเงินเข้าบัญชีนี้ชั่วคราว" : "เปิดรับเงินเข้าบัญชีนี้"}
                aria-pressed={account.active}
                aria-label={account.active ? `ปิดรับเงินเข้าบัญชี ${account.bankName}` : `เปิดรับเงินเข้าบัญชี ${account.bankName}`}
                disabled={disabled}
              >
                <span />
              </button>
            </div>
          </div>
        ))}
      </div>

      {draft && (
        <div className="bank-draft-panel">
          <div className="bank-draft-head">
            <div>
              <b>{editingId ? "แก้ไขบัญชีธนาคาร" : "เพิ่มบัญชีธนาคาร"}</b>
            </div>
            <div className="compact-edit-actions">
              <button
                type="button"
                className="outline-button"
                onClick={cancelDraft}
              >
                <X size={14} /> ยกเลิก
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={commitDraft}
                disabled={disabled || !isComplete(draft)}
              >
                <Check size={14} /> {editingId ? "บันทึก" : "เพิ่มบัญชี"}
              </button>
            </div>
          </div>
          <div className="form-grid">
            <label>เลือกธนาคาร
              <select value={THAI_BANK_PRESETS.some(p => p.code === draft.bankCode) ? draft.bankCode : ""} disabled={disabled}
                onChange={e => { const preset = THAI_BANK_PRESETS.find(p => p.code === e.target.value); if (preset) pickPreset(preset); else setDraft({ ...draft, bankCode: "", qrPayload: "" }); }}>
                <option value="">ระบุเอง</option>
                {THAI_BANK_PRESETS.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
              </select>
            </label>
            <label className="wide">
              ชื่อธนาคาร *
              <input
                value={draft.bankName}
                onChange={e => setDraft({ ...draft, bankName: e.target.value })}
                placeholder="ชื่อธนาคาร"
                disabled={disabled}
              />
            </label>
            <label>
 เลขที่บัญชี *
              <input
                value={draft.accountNumber}
                onChange={e =>
                  setDraft({
                    ...draft,
                    accountNumber: sanitizeAccount(e.target.value),
                    qrPayload: "",
                  })
                }
                placeholder="เช่น 123-4-56789-0 หรือ 1234567890"
                inputMode="numeric"
                maxLength={20}
                disabled={disabled}
              />
            </label>
            <label>
 ชื่อบัญชี *
              <input
                value={draft.accountName}
                onChange={e => setDraft({ ...draft, accountName: e.target.value })}
                placeholder={storeName ? storeName : "ตามสมุดบัญชี"}
                disabled={disabled}
              />
            </label>
            <label>
 สาขา
              <input
                value={draft.branch}
                onChange={e => setDraft({ ...draft, branch: e.target.value })}
                placeholder="ไม่บังคับ — เช่น สำนักงานใหญ่"
                disabled={disabled}
              />
            </label>
            <label>
 หมายเหตุ
              <input
                value={draft.note}
                onChange={e => setDraft({ ...draft, note: e.target.value })}
                placeholder="ไม่บังคับ — เช่น บัญชีออมทรัพย์"
                disabled={disabled}
              />
            </label>
          </div>
          {QR_BANKS.some(bank => bank.code === draft.bankCode) && <BankQrInput
            key={`${draft.id}:${draft.bankCode}:${draft.accountNumber}`}
            value={draft.qrPayload}
            disabled={disabled || !isComplete(draft)}
            onChange={qrPayload => setDraft(current => current ? { ...current, qrPayload } : null)}
          />}
          {!isComplete(draft) && draft.accountNumber.length > 0 && (
            <div className="settings-inline-note amber">
              <CircleAlert size={16} />
              <span>
                ต้องกรอกชื่อธนาคาร ชื่อบัญชี และเลขที่บัญชีอย่างน้อย 7 หลัก
                ก่อนกดเพิ่ม/บันทึก
              </span>
            </div>
          )}
        </div>
      )}


    </section>
  );
}
