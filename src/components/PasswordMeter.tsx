"use client";

/**
 * PasswordMeter — client-side password strength meter.
 *
 * Mirrors the rules of the original Shop's `PasswordMeter`:
 *   - 4 segments lit by score 0-4
 *   - Labels: ง่ายเกินไป / ยังอ่อนไหว / พอใช้ได้ / แข็งแรงดี / แข็งแรงมาก
 *   - Checklist: length · letter · digit · (symbol when role requires it)
 *
 * Score rules (mirror server `passwordPolicyForRole`):
 *   - role === 'administrator' || 'dev_service' → min 12, needSymbol true
 *   - everyone else → min 8, no symbol required
 *
 * Exported helper `passwordIssues(password, opts)` returns the Thai list of
 * unsatisfied rules (empty = passes). The form components call this before
 * submitting so we surface inline validation in addition to server response.
 */

import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

// Character classes — Thai letters count as "letters" to match the server's
// regex behaviour in src/lib/auth.ts (well, the server uses [A-Za-z]; we keep
// the original Shop's permissive Thai-aware regex here for friendlier UX).
const PW_HAS_LETTER = /[A-Za-z\u0E00-\u0E7F]/;
const PW_HAS_DIGIT = /[0-9]/;
const PW_HAS_SYMBOL = /[^A-Za-z0-9\u0E00-\u0E7F\s]/;

export type PasswordRuleState = {
  lengthOk: boolean;
  letterOk: boolean;
  digitOk: boolean;
  symbolOk: boolean;
};

export interface PasswordIssuesOpts {
  /** Minimum length required for the role. */
  min: number;
  /** Whether a special symbol is required (dev_service / administrator). */
  needSymbol?: boolean;
}

/** Compute the per-rule boolean state for a password + opts. */
export function passwordRuleState(
  password: string,
  opts: PasswordIssuesOpts,
): PasswordRuleState {
  return {
    lengthOk: password.length >= opts.min,
    letterOk: PW_HAS_LETTER.test(password),
    digitOk: PW_HAS_DIGIT.test(password),
    symbolOk: !opts.needSymbol || PW_HAS_SYMBOL.test(password),
  };
}

/** Thai list of unsatisfied rules (empty = passes). Mirrors server `validatePassword`. */
export function passwordIssues(
  password: string,
  opts: PasswordIssuesOpts,
): string[] {
  if (password === "") return ["กรุณาระบุรหัสผ่าน"];
  const state = passwordRuleState(password, opts);
  const issues: string[] = [];
  if (!state.lengthOk) {
    issues.push(`รหัสผ่านต้องมีความยาวอย่างน้อย ${opts.min} ตัวอักษร`);
  }
  if (!state.letterOk) {
    issues.push("รหัสผ่านต้องมีตัวอักษรอย่างน้อย 1 ตัว");
  }
  if (!state.digitOk) {
    issues.push("รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว");
  }
  if (!state.symbolOk) {
    issues.push(
      "รหัสผ่านต้องมีสัญลักษณ์พิเศษอย่างน้อย 1 ตัว เช่น ! @ # $",
    );
  }
  return issues;
}

/** Score 0-4 — long enough + letter+digit + symbol + extra length bonus. */
function passwordScore(password: string, opts: PasswordIssuesOpts): number {
  if (password === "") return 0;
  const state = passwordRuleState(password, opts);
  let score = 0;
  if (state.lengthOk) score += 1;
  if (state.letterOk && state.digitOk) score += 1;
  if (PW_HAS_SYMBOL.test(password)) score += 1;
  if (password.length >= opts.min + 4) score += 1;
  return Math.min(4, score);
}

const STRENGTH_LABEL = [
  "ง่ายเกินไป",
  "ยังอ่อนไหว",
  "พอใช้ได้",
  "แข็งแรงดี",
  "แข็งแรงมาก",
];

/**
 * Resolve the client-side password policy for a role — mirrors the server's
 * `passwordPolicyForRole` in src/lib/auth.ts so the meter agrees with the
 * eventual server validation.
 */
export function passwordPolicyForRole(role: string): PasswordIssuesOpts {
  if (role === "dev_service" || role === "administrator") {
    return { min: 12, needSymbol: true };
  }
  return { min: 8, needSymbol: false };
}

export interface PasswordMeterProps {
  password: string;
  /** Role name — controls min length + symbol requirement. */
  role: string;
  className?: string;
}

/** Default export — the meter component used by SetupView + ForceChangeView. */
export default function PasswordMeter({
  password,
  role,
  className,
}: PasswordMeterProps) {
  const opts = passwordPolicyForRole(role);
  const state = passwordRuleState(password, opts);
  const score = passwordScore(password, opts);

  const rules: { ok: boolean; label: string }[] = [
    { ok: state.lengthOk, label: `ยาวอย่างน้อย ${opts.min} ตัวอักษร` },
    { ok: state.letterOk, label: "มีตัวอักษร (ไทย/อังกฤษ)" },
    { ok: state.digitOk, label: "มีตัวเลข" },
  ];
  if (opts.needSymbol) {
    rules.push({
      ok: state.symbolOk,
      label: "มีสัญลักษณ์พิเศษ เช่น ! @ #",
    });
  }

  const segmentColor =
    score === 0
      ? "bg-muted"
      : score === 1
        ? "bg-red-500"
        : score === 2
          ? "bg-amber-500"
          : score === 3
            ? "bg-lime-500"
            : "bg-emerald-600";

  return (
    <div className={cn("space-y-2", className)} aria-live="polite">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          ความปลอดภัยของรหัสผ่าน
        </span>
        <b
          className={cn(
            "font-medium",
            score === 0
              ? "text-muted-foreground"
              : score === 1
                ? "text-red-600"
                : score === 2
                  ? "text-amber-600"
                  : score === 3
                    ? "text-lime-700"
                    : "text-emerald-700",
          )}
        >
          {password === "" ? "—" : STRENGTH_LABEL[score]}
        </b>
      </div>
      <div className="flex gap-1" role="presentation">
        {[1, 2, 3, 4].map((segment) => (
          <i
            key={segment}
            aria-hidden="true"
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors",
              score >= segment ? segmentColor : "bg-muted",
            )}
          />
        ))}
      </div>
      <ul className="grid gap-1 text-xs">
        {rules.map((rule) => (
          <li
            key={rule.label}
            className={cn(
              "flex items-center gap-1.5",
              rule.ok ? "text-emerald-700" : "text-muted-foreground",
            )}
          >
            {rule.ok ? (
              <Check size={12} className="text-emerald-600" />
            ) : (
              <X size={12} />
            )}
            {rule.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
