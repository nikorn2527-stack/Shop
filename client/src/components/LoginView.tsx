import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Crown, Eye, EyeOff, LogIn, ShieldCheck, UserRound } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { getErrorMessage } from "@/pages/viewFormat";

/** Demo accounts behind the quick-fill chips (fill only — the user presses เข้าสู่ระบบ). */
const DEMO_ACCOUNTS = [
  { label: "เจ้าหน้าที่ · กัญญาณัฐ", username: "kanyanat", password: "1234", admin: false },
  { label: "ผู้บริหาร · วรพจน์", username: "woraphot", password: "1234", admin: true },
] as const;

/**
 * Full-screen login card shown by the Home auth gate when auth.me returns no
 * session. Real form submit (Enter works); errors surface the Thai TRPC
 * message (e.g. "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง") in the red bar.
 */
export function LoginView({ onAuthed }: { onAuthed: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: () => {
      setError("");
      onAuthed();
    },
    onError: (mutationError) => setError(getErrorMessage(mutationError)),
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loginMutation.isPending) return;
    if (!username.trim() || !password) {
      setError("กรุณาระบุชื่อผู้ใช้และรหัสผ่านให้ครบถ้วน");
      return;
    }
    setError("");
    loginMutation.mutate({ username: username.trim(), password });
  };

  const fillDemo = (account: (typeof DEMO_ACCOUNTS)[number]) => {
    setUsername(account.username);
    setPassword(account.password);
    setError("");
    // Focus the username field so Enter submits immediately after a quick-fill.
    const field = formRef.current?.elements.namedItem("username");
    if (field instanceof HTMLInputElement) field.focus();
  };

  return (
    <div className="login-screen">
      <i className="login-blob teal" aria-hidden="true" />
      <i className="login-blob amber" aria-hidden="true" />
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark"><span>ส</span></div>
          <b>ร้านค้าสวัสดิการ โรงพยาบาลผู้ป่วยจิตเวช</b>
          <small>Hospital Welfare Store · ระบบหน้าร้านและบัญชีสมาชิก</small>
        </div>
        <form className="login-form" ref={formRef} onSubmit={submit}>
          <label>
            ชื่อผู้ใช้
            <input
              name="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoFocus
              placeholder="กรอกชื่อผู้ใช้ เช่น kanyanat"
            />
          </label>
          <label>
            รหัสผ่าน
            <span className="login-password">
              <input
                name="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="กรอกรหัสผ่าน"
              />
              <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}>
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </span>
          </label>
          {error && (
            <div className="login-error" role="alert">
              <ShieldCheck size={15} /> {error}
            </div>
          )}
          <button type="submit" className="primary-button login-submit" disabled={loginMutation.isPending || !username.trim() || !password}>
            <LogIn size={16} /> {loginMutation.isPending ? "กำลังตรวจสอบ…" : "เข้าสู่ระบบ"}
          </button>
        </form>
        <div className="login-demo">
          <span>บัญชีทดลองสำหรับทดสอบระบบ</span>
          <div className="login-demo-row">
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.username}
                type="button"
                className={account.admin ? "login-demo-btn admin" : "login-demo-btn"}
                onClick={() => fillDemo(account)}
              >
                {account.admin ? <Crown size={13} /> : <UserRound size={13} />} {account.label}
              </button>
            ))}
          </div>
        </div>
        <p className="login-footer">v1.0.0 · ฝ่ายสวัสดิการ · Power by PNG TEAM</p>
      </div>
    </div>
  );
}
