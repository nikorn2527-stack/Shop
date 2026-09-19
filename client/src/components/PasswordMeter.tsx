import { Check, X } from "lucide-react";

/**
 * ROUND 36 (ข้อ 31) — ตัววัดความแข็งแรงของรหัสผ่าน (client)
 * กฎมิเรอร์กับ server/sqliteStore.ts → validatePasswordStrength:
 * ทุกบทบาท ยาว ≥ min + มีตัวอักษร + มีตัวเลข · บทบาท dev ต้องมีสัญลักษณ์พิเศษด้วย
 */
const PW_HAS_LETTER = /[A-Za-z\u0E00-\u0E7F]/;
const PW_HAS_DIGIT = /[0-9]/;
const PW_HAS_SYMBOL = /[^A-Za-z0-9\u0E00-\u0E7F\s]/;

export type PasswordRuleState = {
  lengthOk: boolean;
  letterOk: boolean;
  digitOk: boolean;
  symbolOk: boolean;
};

/** สถานะของแต่ละกฎ (ไว้เช็คก่อนส่งฟอร์ม) */
export function passwordRuleState(password: string, opts: { min: number; needSymbol?: boolean }): PasswordRuleState {
  return {
    lengthOk: password.length >= opts.min,
    letterOk: PW_HAS_LETTER.test(password),
    digitOk: PW_HAS_DIGIT.test(password),
    symbolOk: !opts.needSymbol || PW_HAS_SYMBOL.test(password),
  };
}

/** ข้อความปัญหาภาษาไทย (เหมือน server เปี๊ยบ) — ว่าง = ผ่านทุกกฎ */
export function passwordIssues(password: string, opts: { min: number; needSymbol?: boolean }): string[] {
  if (password === "") return ["กรุณาระบุรหัสผ่าน"];
  const state = passwordRuleState(password, opts);
  const issues: string[] = [];
  if (!state.lengthOk) issues.push(`รหัสผ่านต้องมีความยาวอย่างน้อย ${opts.min} ตัวอักษร`);
  if (!state.letterOk) issues.push("รหัสผ่านต้องมีตัวอักษรอย่างน้อย 1 ตัว");
  if (!state.digitOk) issues.push("รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว");
  if (!state.symbolOk) issues.push("รหัสผ่านบัญชีผู้พัฒนา (dev) ต้องมีสัญลักษณ์พิเศษอย่างน้อย 1 ตัว เช่น ! @ # $");
  return issues;
}

/** คะแนนความแข็งแรง 0-4 (ยาวพอ + หลากหลายชนิดตัวอักษร + ยาวพิเศษ) */
function passwordScore(password: string, opts: { min: number; needSymbol?: boolean }): number {
  if (password === "") return 0;
  const state = passwordRuleState(password, opts);
  let score = 0;
  if (state.lengthOk) score += 1;
  if (state.letterOk && state.digitOk) score += 1;
  if (PW_HAS_SYMBOL.test(password)) score += 1;
  if (password.length >= opts.min + 4) score += 1;
  return Math.min(4, score);
}

const STRENGTH_LABEL = ["ง่ายเกินไป", "ยังอ่อนไหว", "พอใช้ได้", "แข็งแรงดี", "แข็งแรงมาก"];

/**
 * แถบวัดความแข็งแรง 4 ช่อง + เช็กลิสต์กฎที่ต้องผ่าน — ใช้ร่วมกันทั้งหน้า
 * ลงทะเบียนครั้งแรก (SetupView) และหน้าบังคับเปลี่ยนรหัสผ่าน (ForceChangeView)
 */
export default function PasswordMeter({ password, min, needSymbol }: { password: string; min: number; needSymbol?: boolean }) {
  const opts = { min, needSymbol };
  const state = passwordRuleState(password, opts);
  const score = passwordScore(password, opts);
  const rules: { ok: boolean; label: string }[] = [
    { ok: state.lengthOk, label: `ยาวอย่างน้อย ${min} ตัวอักษร` },
    { ok: state.letterOk, label: "มีตัวอักษร (ไทย/อังกฤษ)" },
    { ok: state.digitOk, label: "มีตัวเลข" },
  ];
  if (needSymbol) rules.push({ ok: state.symbolOk, label: "มีสัญลักษณ์พิเศษ เช่น ! @ #" });
  return (
    <div className="pw-meter" aria-live="polite">
      <div className="pw-meter-head">
        <span>ความปลอดภัยของรหัสผ่าน</span>
        <b data-score={score}>{password === "" ? "—" : STRENGTH_LABEL[score]}</b>
      </div>
      <div className="pw-meter-bar" role="presentation">
        {[1, 2, 3, 4].map((segment) => (
          <i key={segment} data-on={score >= segment ? "true" : "false"} className={score >= segment ? `s${score}` : ""} />
        ))}
      </div>
      <ul className="pw-meter-rules">
        {rules.map((rule) => (
          <li key={rule.label} data-ok={rule.ok ? "true" : "false"}>
            {rule.ok ? <Check size={12} /> : <X size={12} />} {rule.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
