import { useState } from "react";
import type { FormEvent } from "react";
import { Eye, EyeOff, KeyRound, LogOut, ShieldAlert, ShieldCheck } from "lucide-react";
import type { User } from "../../../drizzle/schema";
import { trpc } from "@/lib/trpc";
import { getErrorMessage } from "@/pages/viewFormat";
import { brandInitial, type BrandSettings } from "@/theme";
import PasswordMeter, { passwordIssues } from "./PasswordMeter";

/** ป้ายบทบาทภาษาไทยของผู้ใช้ที่กำลังเข้าสู่ระบบ */
function roleText(user: User): string {
  if (user.appRole === "dev") return "ผู้พัฒนาระบบ";
  return user.role === "admin" ? "ผู้บริหารระบบ" : "เจ้าหน้าที่ร้านค้า";
}

/**
 * ROUND 36 (ข้อ 31) — หน้าบังคับเปลี่ยนรหัสผ่าน: แสดงเมื่อบัญชีที่เข้าสู่ระบบยัง
 * ติดธง must_change_password (บัญชีใหม่ / รหัสที่ผู้บริหารตั้งให้ / ลงทะเบียนครั้งแรก)
 * ไม่มีทางข้ามไปหน้าหลักจนกว่าจะเปลี่ยนรหัสผ่านสำเร็จ — ออกจากระบบได้อย่างเดียว
 */
export function ForceChangeView({ user, brand, onDone, onLogout }: { user: User; brand?: BrandSettings | null | undefined; onDone: () => void; onLogout: () => void }) {
  const appName = (brand?.appName ?? "").trim() || "ร้านค้าสวัสดิการ";
  const appLogo = brand?.appLogo ?? "";
  const isDev = user.appRole === "dev";
  const min = isDev ? 12 : 8;
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const changeMutation = trpc.auth.changePassword.useMutation({
    onSuccess: () => {
      setError("");
      onDone();
    },
    onError: (mutationError) => setError(getErrorMessage(mutationError)),
  });
  const logoutMutation = trpc.auth.logout.useMutation({ onSuccess: () => onLogout() });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (changeMutation.isPending) return;
    if (!currentPassword) { setError("กรุณากรอกรหัสผ่านปัจจุบัน"); return; }
    const issues = passwordIssues(newPassword, { min, needSymbol: isDev });
    if (issues.length > 0) { setError(issues.join(" · ")); return; }
    if (newPassword !== confirm) { setError("รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน"); return; }
    if (newPassword === currentPassword) { setError("รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านปัจจุบัน"); return; }
    setError("");
    changeMutation.mutate({ currentPassword, newPassword });
  };

  return (
    <div className="login-screen force-change-screen">
      <i className="login-blob teal" aria-hidden="true" />
      <i className="login-blob amber" aria-hidden="true" />
      <div className="login-card force-change-card">
        <div className="login-brand">
          {appLogo ? <img className="brand-logo login-logo" src={appLogo} alt={appName} /> : <div className="brand-mark"><span>{brandInitial(appName)}</span></div>}
          <b>{appName}</b>
          <small>ความปลอดภัยของบัญชี · PASSWORD REQUIRED</small>
        </div>
        <div className="force-change-head">
          <span className="force-change-icon"><ShieldAlert size={22} /></span>
          <h1>กรุณาเปลี่ยนรหัสผ่านก่อนเริ่มใช้งาน</h1>
          <p>บัญชีนี้กำลังใช้รหัสผ่านชั่วคราว/ครั้งแรก — เพื่อความปลอดภัยของข้อมูลร้าน กรุณาตั้งรหัสผ่านใหม่</p>
        </div>
        <div className="force-change-identity">
          <span className={`role-avatar ${isDev ? "dev" : user.role === "admin" ? "admin" : "staff"}`}>{(user.name ?? "ผ").slice(0, 1)}</span>
          <div>
            <b>{user.name ?? "ผู้ใช้ระบบ"}</b>
            <small>
              @{user.openId} · {roleText(user)}
              {isDev && <span className="dev-role-badge">DEV</span>}
            </small>
          </div>
        </div>
        <form className="login-form" onSubmit={submit}>
          <label>
            รหัสผ่านปัจจุบัน *
            <span className="login-password">
              <input
                name="currentPassword"
                type={showPassword ? "text" : "password"}
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
                autoFocus
                placeholder="รหัสผ่านที่ได้รับ / ใช้อยู่ในตอนนี้"
              />
              <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}>
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </span>
          </label>
          <label>
            รหัสผ่านใหม่ *
            <input
              name="newPassword"
              type={showPassword ? "text" : "password"}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              placeholder={`อย่างน้อย ${min} ตัวอักษร มีตัวอักษรและตัวเลข${isDev ? " และสัญลักษณ์" : ""}`}
            />
          </label>
          <label>
            ยืนยันรหัสผ่านใหม่ *
            <input
              name="confirm"
              type={showPassword ? "text" : "password"}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
              placeholder="พิมพ์รหัสผ่านใหม่ซ้ำอีกครั้ง"
            />
          </label>
          <PasswordMeter password={newPassword} min={min} needSymbol={isDev} />
          {error && (
            <div className="login-error" role="alert">
              <ShieldCheck size={15} /> {error}
            </div>
          )}
          <button type="submit" className="primary-button login-submit" disabled={changeMutation.isPending}>
            <KeyRound size={16} /> {changeMutation.isPending ? "กำลังบันทึก…" : "บันทึกรหัสผ่านใหม่"}
          </button>
        </form>
        <div className="login-scope-note" role="note">
          <ShieldCheck size={15} />
          <span>เปลี่ยนรหัสผ่านสำเร็จแล้ว ระบบจะยกเลิกการเข้าสู่ระบบของอุปกรณ์อื่นทุกเครื่องของบัญชีนี้ ให้เหลือเฉพาะเครื่องที่คุณใช้อยู่</span>
        </div>
        <button type="button" className="force-change-logout" disabled={logoutMutation.isPending} onClick={() => { if (!logoutMutation.isPending) logoutMutation.mutate(); }}>
          <LogOut size={13} /> ออกจากระบบ
        </button>
        <p className="login-footer">v1.0.0 · ระบบร้านค้าสวัสดิการ</p>
      </div>
    </div>
  );
}
