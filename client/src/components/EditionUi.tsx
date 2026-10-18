import { notify } from "@/lib/notifications";
import { useEffect, useState } from "react";
import { Check, CircleAlert, Crown, Gift, KeyRound, Lock, RefreshCw, Sparkles, X } from "@/lib/icons";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { getErrorMessage } from "@/pages/viewFormat";
import type { EditionStatus } from "../../../server/license";
import {
  EDITIONS,
  EDITION_COMPARE_ROWS,
  EDITION_FEATURE_INFO,
  EDITION_LEVEL,
  EDITION_TRIAL_DAYS,
  editionHas,
  editionStatusLabel,
  type Edition,
  type EditionFeatureKey,
} from "@shared/editions";

/**
 * ROUND 61 (user) — ชิ้นส่วน UI ระบบเวอร์ชัน 3 แบบ (ทั่วไป/โปร/โปรพลัส)
 * useEditionStatus: ดึงสถานะจริงจากเซิร์ฟเวอร์ (ลิขสิทธิ์/ช่วงทดลอง) + ตรวจสิทธิ์ฝั่งหน้าจอ
 * EditionPill: ป้ายเวอร์ชันเล็ก ๆ ที่ sidebar
 * FeatureLockButton: ปุ่มล็อก — กดแล้วเปิดหน้าเวอร์ชัน (บอกว่าต้องอัปเกรดอะไร)
 * EditionUpgradeModal: ตารางเทียบ 3 เวอร์ชัน + ใส่รหัสลิขสิทธิ์ + เริ่มทดลองใช้
 */

export type EditionStatusPlus = EditionStatus & { has: (feature: EditionFeatureKey) => boolean; atLeast: (edition: Edition) => boolean };

/** ดึงสถานะเวอร์ชันจากเซิร์ฟเวอร์ + helper ตรวจสิทธิ์ฝั่งหน้าจอ (เร็ว — ไม่ต้องรอ refetch) */
export function useEditionStatus() {
  const query = trpc.edition.status.useQuery(undefined);
  const status: EditionStatusPlus | null = query.data
    ? {
        ...query.data,
        has: (feature: EditionFeatureKey) => editionHas(query.data!.edition, feature),
        atLeast: (edition: Edition) => EDITION_LEVEL[query.data!.edition] >= EDITION_LEVEL[edition],
      }
    : null;
  return { status, isLoading: query.isLoading, refetch: query.refetch };
}

/** ป้ายเวอร์ชันเล็ก ๆ ติด sidebar — แสดงเวอร์ชัน + สถานะ (ทดลอง/ลิขสิทธิ์) */
export function EditionPill({ status, onClick }: { status: EditionStatusPlus; onClick: () => void }) {
  const tone = EDITIONS[status.edition].tone;
  return (
    <button type="button" className={`edition-pill tone-${tone}`} onClick={onClick} title="ดูรายละเอียดเวอร์ชันและลิขสิทธิ์">
      <Crown size={13} />
      <span>{EDITIONS[status.edition].shortLabel}</span>
      {status.source === "trial" && <em>ทดลอง {status.trialDaysLeft} วัน</em>}
      {status.source === "license" && <em>ลิขสิทธิ์</em>}
    </button>
  );
}

/** ป้ายล็อกฟีเจอร์ — ใช้แทนปุ่ม/แท็บที่เวอร์ชันปัจจุบันยังไม่รวม (กดแล้วเปิดหน้าเวอร์ชัน) */
export function FeatureLockButton({ feature, onClick, compact }: { feature: EditionFeatureKey; onClick: () => void; compact?: boolean }) {
  const info = EDITION_FEATURE_INFO[feature];
  return (
    <button type="button" className={`feature-lock${compact ? " compact" : ""}`} onClick={onClick} title={`${info.label} — สำหรับเวอร์ชันสูงกว่า`}>
      <Lock size={compact ? 13 : 15} />
      {!compact && <span>{info.label}</span>}
      <em>อัปเกรด</em>
    </button>
  );
}

/** ตารางเทียบสิทธิ์ 3 เวอร์ชัน — ใช้ทั้งในโมดัลอัปเกรดและแท็บเวอร์ชันของหน้าตั้งค่า */
export function EditionCompareTable({ current }: { current: Edition }) {
  return (
    <div className="edition-compare" role="table" aria-label="ตารางเทียบสิทธิ์แต่ละเวอร์ชัน">
      <div className="edition-compare-head" role="row">
        <span role="columnheader">ฟีเจอร์</span>
        {(Object.keys(EDITIONS) as Edition[]).map((id) => (
          <span key={id} role="columnheader" className={`col-edition tone-${EDITIONS[id].tone}${current === id ? " current" : ""}`}>
            {EDITIONS[id].shortLabel}
            {current === id && <em>ใช้อยู่</em>}
          </span>
        ))}
      </div>
      <div className="edition-compare-body">
        {EDITION_COMPARE_ROWS.map((row) => (
          <div className="edition-compare-row" role="row" key={row}>
            <span className="edition-feature-cell" role="cell" title={EDITION_FEATURE_INFO[row].detail}>
              <b>{EDITION_FEATURE_INFO[row].label}</b>
              <small>{EDITION_FEATURE_INFO[row].detail}</small>
            </span>
            {(Object.keys(EDITIONS) as Edition[]).map((id) => (
              <span key={id} role="cell" className={editionHas(id, row) ? "yes" : "no"}>
                {editionHas(id, row) ? <Check size={15} /> : <X size={14} />}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** เครื่องมือออกรหัสลิขสิทธิ์ให้ลูกค้า — โซนผู้พัฒนาเท่านั้น (แท็บเวอร์ชันส่วนล่าง) */
export function DevKeygenTool() {
  const [editionChoice, setEditionChoice] = useState<Edition>("proplus");
  const [monthsText, setMonthsText] = useState("");
  const [result, setResult] = useState("");
  const generateMutation = trpc.edition.generateKey.useMutation({
    onSuccess: (data) => {
      setResult(data.key);
      toast.success("ออกรหัสลิขสิทธิ์เรียบร้อย", { description: "คัดลอกส่งให้ลูกค้าได้เลย — ใช้ได้กับระบบที่ยังไม่เคยใส่รหัสนี้" });
    },
    onError: (mutationError) => notify.error("ออกรหัสไม่สำเร็จ", { description: getErrorMessage(mutationError) }),
  });
  const months = monthsText.trim() === "" ? null : Math.max(1, Math.min(48, Math.floor(Number(monthsText) || 0)));
  const copyKey = () => {
    navigator.clipboard?.writeText(result)
      .then(() => toast.success("คัดลอกรหัสแล้ว", { description: result, duration: 4000 }))
      .catch(() => notify.error("คัดลอกไม่สำเร็จ", { description: `คัดลอกด้วยตนเอง: ${result}` }));
  };
  return (
    <div className="dev-keygen">
      <div className="dev-keygen-head"><KeyRound size={16} /> เครื่องมือออกรหัสลิขสิทธิ์ (เจ้าของระบบ)</div>
      <p className="dev-keygen-sub">ออกรหัสให้ลูกค้าตามเวอร์ชันที่ซื้อ — ลูกค้านำไปใส่ที่ ตั้งค่า → เวอร์ชันและลิขสิทธิ์ · ทุกครั้งที่ออกจะบันทึกลงระบบ Log</p>
      <div className="dev-keygen-form">
        <label>เวอร์ชัน
          <select value={editionChoice} onChange={(event) => setEditionChoice(event.target.value as Edition)}>
            {(Object.keys(EDITIONS) as Edition[]).map((id) => (
              <option key={id} value={id}>{EDITIONS[id].label}</option>
            ))}
          </select>
        </label>
        <label>อายุ (เดือน — ว่าง = ถาวร)
          <input value={monthsText} onChange={(event) => setMonthsText(event.target.value.replace(/[^0-9]/g, ""))} placeholder="ถาวร" maxLength={2} style={{ width: 90 }} />
        </label>
        <button type="button" className="primary-button" disabled={generateMutation.isPending} onClick={() => generateMutation.mutate({ edition: editionChoice, months })}>
          <KeyRound size={15} /> {generateMutation.isPending ? "กำลังออกรหัส…" : "ออกรหัส"}
        </button>
      </div>
      {result && (
        <div className="dev-keygen-result">
          <code>{result}</code>
          <button type="button" className="outline-button compact" onClick={copyKey}><Check size={15} /> คัดลอก</button>
        </div>
      )}
    </div>
  );
}

/** โมดัลอัปเกรดเวอร์ชัน: สรุปสถานะ + ตารางเทียบ + ใส่รหัสลิขสิทธิ์ / เริ่มทดลองใช้ */
export function EditionUpgradeModal({ open, onClose, status, focusFeature, onApplied }: { open: boolean; onClose: () => void; status: EditionStatusPlus | null; focusFeature?: EditionFeatureKey | null; onApplied?: (next: EditionStatus) => void }) {
  const utils = trpc.useUtils();
  const [keyText, setKeyText] = useState("");
  const [licenseName, setLicenseName] = useState("");
  const applyMutation = trpc.edition.applyLicense.useMutation({
    onSuccess: (next) => {
      notify.completed(`เปิดใช้${EDITIONS[next.edition].label}เรียบร้อย`, { description: next.licenseExpiresAt ? `ลิขสิทธิ์ถึง ${next.licenseExpiresAt}` : "ลิขสิทธิ์ถาวร" });
      setKeyText("");
      void utils.edition.status.invalidate();
      void utils.settings.get.invalidate();
      onApplied?.(next);
      onClose();
    },
    onError: (mutationError) => notify.error("ใช้รหัสลิขสิทธิ์ไม่สำเร็จ", { description: getErrorMessage(mutationError) }),
  });
  const trialMutation = trpc.edition.startTrial.useMutation({
    onSuccess: (next) => {
      notify.completed(`เริ่มทดลองใช้โปรพลัส ${EDITION_TRIAL_DAYS} วันแล้ว`, { description: "ทุกฟีเจอร์เปิดใช้งานทันที — เมื่อครบกำหนดจะกลับเป็นเวอร์ชันทั่วไป" });
      void utils.edition.status.invalidate();
      onApplied?.(next);
      onClose();
    },
    onError: (mutationError) => notify.error("เริ่มทดลองใช้ไม่สำเร็จ", { description: getErrorMessage(mutationError) }),
  });
  useEffect(() => {
    if (open) {
      setKeyText("");
      setError("");
    }
  }, [open]);
  const [error, setError] = useState("");
  if (!open || !status) return null;
  const submitLicense = () => {
    const key = keyText.trim().toUpperCase();
    if (!key) { setError("กรุณาพิมพ์รหัสลิขสิทธิ์ก่อนกดใช้รหัส"); return; }
    setError("");
    applyMutation.mutate({ key, licensedTo: licenseName.trim() || undefined });
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="edition-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="เวอร์ชันและลิขสิทธิ์">
        <div className="modal-heading">
          <div className="edition-modal-title">
            <Crown size={20} />
            <div>
              <h2>เวอร์ชันและลิขสิทธิ์</h2>
              <p>ปัจจุบัน: {editionStatusLabel(status)}</p>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="ปิดหน้าต่าง"><X size={17} /></button>
        </div>
        {focusFeature && (
          <div className="edition-focus-feature" role="note">
            <CircleAlert size={15} />
            <span>
              “{EDITION_FEATURE_INFO[focusFeature].label}” อยู่ใน{EDITIONS.proplus.label}
              {editionHas("pro", focusFeature) ? " หรือ" + EDITIONS.pro.label : ""} — {EDITION_FEATURE_INFO[focusFeature].detail}
            </span>
          </div>
        )}
        <EditionCompareTable current={status.edition} />
        <div className="edition-apply">
          <div className="edition-apply-title"><KeyRound size={15} /> มีรหัสลิขสิทธิ์อยู่แล้ว</div>
          <div className="edition-key-row">
            <input
              value={keyText}
              onChange={(event) => setKeyText(event.target.value.toUpperCase())}
              placeholder="WSH-X-XXXX-XXXX-XXXX-XXXX"
              aria-label="รหัสลิขสิทธิ์"
              maxLength={40}
              spellCheck={false}
              onKeyDown={(event) => { if (event.key === "Enter") submitLicense(); }}
            />
            <button type="button" className="primary-button" onClick={submitLicense} disabled={applyMutation.isPending}>
              {applyMutation.isPending ? "กำลังตรวจ…" : "ใช้รหัส"}
            </button>
          </div>
          <input
            value={licenseName}
            onChange={(event) => setLicenseName(event.target.value)}
            placeholder="ชื่อร้าน/หน่วยงานผู้ถือลิขสิทธิ์ (ไม่บังคับ)"
            aria-label="ชื่อผู้ถือลิขสิทธิ์"
            maxLength={120}
          />
          {error && <div className="edition-apply-error">{error}</div>}
          {status.licenseState === "expired" && (
            <div className="edition-apply-error">ลิขสิทธิ์เดิมหมดอายุแล้ว — ใส่รหัสใหม่เพื่อเปิดใช้งานต่อ</div>
          )}
        </div>
        {status.source === "free" && !status.trialStart && (
          <div className="edition-trial-card">
            <div><Gift size={16} /><b>เริ่มทดลองใช้ {EDITIONS.proplus.label} ฟรี {EDITION_TRIAL_DAYS} วัน</b><p>เปิดทุกฟีเจอร์ทันที — ครบกำหนดระบบกลับเป็นเวอร์ชันทั่วไป (ข้อมูลทั้งหมดยังอยู่ครบ)</p></div>
            <button type="button" className="primary-button" onClick={() => trialMutation.mutate(undefined)} disabled={trialMutation.isPending}>
              <Sparkles size={15} /> {trialMutation.isPending ? "กำลังเริ่ม…" : "เริ่มทดลองใช้"}
            </button>
          </div>
        )}
        {status.source === "trial" && (
          <div className="edition-trial-note">
            <RefreshCw size={14} />
            <span>ช่วงทดลองใช้เหลืออีก <b>{status.trialDaysLeft} วัน</b> — ใส่รหัสลิขสิทธิ์เพื่อใช้ต่อแบบถาวร</span>
          </div>
        )}
      </div>
    </div>
  );
}
