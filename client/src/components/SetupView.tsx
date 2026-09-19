import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Eye, EyeOff, LogIn, ShieldCheck, Store } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { getErrorMessage } from "@/pages/viewFormat";
import { brandInitial, type BrandSettings } from "@/theme";
import PasswordMeter, { passwordIssues } from "./PasswordMeter";

/**
 * ROUND 36 (ข้อ 31) — หน้าลงทะเบียนครั้งแรก: แสดงเมื่อฐานข้อมูลยังไม่มีบัญชีผู้ใช้
 * เลย (auth.setupStatus → needsSetup) สร้างบัญชีผู้บริหารหลักของร้านผ่าน auth.setup
 * แล้วระบบจะพาไปหน้าบังคับเปลี่ยนรหัสผ่านทันที (must_change_password = 1)
 */
export function SetupView({ brand, onAuthed }: { brand?: BrandSettings | null | undefined; onAuthed: () => void }) {
  const utils = trpc.useUtils();
  const appName = (brand?.appName ?? "").trim() || "ร้านค้าสวัสดิการ";
  const appLogo = brand?.appLogo ?? "";
  const [storeName, setStoreName] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const setupMutation = trpc.auth.setup.useMutation({
    onSuccess: () => {
      setError("");
      onAuthed();
    },
    onError: (mutationError) => {
      setError(getErrorMessage(mutationError));
      // "ตั้งค่าไว้แล้ว" → ระบบมีผู้ใช้แล้วจริงๆ ให้ gate กลับไปหน้าเข้าสู่ระบบ
      if (/ตั้งค่าผู้บริหารไว้แล้ว|ลงทะเบียนซ้ำ/.test(getErrorMessage(mutationError))) {
        void utils.auth.setupStatus.invalidate();
      }
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (setupMutation.isPending) return;
    const trimmedUsername = username.trim();
    const trimmedName = displayName.trim();
    if (!trimmedUsername) { setError("กรุณาระบุชื่อผู้ใช้ (เช่น owner)"); return; }
    if (/\s/.test(trimmedUsername)) { setError("ชื่อผู้ใช้ห้ามมีช่องว่าง"); return; }
    if (!trimmedName) { setError("กรุณาระบุชื่อ-นามสกุลของผู้บริหาร"); return; }
    const issues = passwordIssues(password, { min: 8 });
    if (issues.length > 0) { setError(issues.join(" · ")); return; }
    if (password !== confirm) { setError("รหัสผ่านทั้งสองช่องไม่ตรงกัน"); return; }
    setError("");
    setupMutation.mutate({
      username: trimmedUsername,
      displayName: trimmedName,
      password,
      storeName: storeName.trim() || undefined,
    });
  };

  return (
    <div className="login-screen setup-screen">
      <i className="login-blob teal" aria-hidden="true" />
      <i className="login-blob amber" aria-hidden="true" />
      <div className="login-card setup-card">
        <div className="login-brand">
          {appLogo ? <img className="brand-logo login-logo" src={appLogo} alt={appName} /> : <div className="brand-mark"><span>{brandInitial(appName)}</span></div>}
          <b>{appName}</b>
          <small>ตั้งค่าระบบครั้งแรก · FIRST-TIME SETUP</small>
        </div>
        <div className="setup-head">
          <h1>ลงทะเบียนผู้บริหารหลัก</h1>
          <p>ยังไม่มีบัญชีผู้ใช้ในระบบ — สร้างบัญชีแรกของร้านเพื่อเริ่มใช้งาน</p>
        </div>
        <form className="login-form" ref={formRef} onSubmit={submit}>
          <label>
            ชื่อร้าน (ไม่บังคับ)
            <span className="setup-store-input">
              <Store size={15} />
              <input
                name="storeName"
                value={storeName}
                onChange={(event) => setStoreName(event.target.value)}
                maxLength={80}
                placeholder="เช่น ร้านค้าสวัสดิการ บจก."
              />
            </span>
          </label>
          <label>
            ชื่อผู้ใช้ *
            <input
              name="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoFocus
              autoComplete="username"
              maxLength={30}
              placeholder="เช่น owner"
            />
            <small className="setup-field-hint">ภาษาอังกฤษหรือตัวเลข ไม่มีช่องว่าง · ใช้เข้าสู่ระบบทุกครั้ง</small>
          </label>
          <label>
            ชื่อ-นามสกุลที่แสดง *
            <input
              name="displayName"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="เช่น วรพจน์ ใจดี"
            />
          </label>
          <label>
            รหัสผ่าน *
            <span className="login-password">
              <input
                name="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                placeholder="อย่างน้อย 8 ตัวอักษร มีตัวอักษรและตัวเลข"
              />
              <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}>
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </span>
          </label>
          <label>
            ยืนยันรหัสผ่าน *
            <input
              name="confirm"
              type={showPassword ? "text" : "password"}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
              placeholder="พิมพ์รหัสผ่านซ้ำอีกครั้ง"
            />
          </label>
          <PasswordMeter password={password} min={8} />
          {error && (
            <div className="login-error" role="alert">
              <ShieldCheck size={15} /> {error}
            </div>
          )}
          <button type="submit" className="primary-button login-submit" disabled={setupMutation.isPending}>
            <LogIn size={16} /> {setupMutation.isPending ? "กำลังสร้างบัญชี…" : "ลงทะเบียนและเริ่มใช้งาน"}
          </button>
        </form>
        <div className="login-scope-note" role="note">
          <ShieldCheck size={15} />
          <span>หลังลงทะเบียน ระบบจะให้ตั้งรหัสผ่านใหม่อีกครั้งในครั้งแรกที่เข้าใช้งาน เพื่อยืนยันว่าไม่มีผู้อื่นรู้รหัสของคุณ</span>
        </div>
        <p className="login-footer">v1.0.0 · ระบบร้านค้าสวัสดิการ</p>
      </div>
    </div>
  );
}
