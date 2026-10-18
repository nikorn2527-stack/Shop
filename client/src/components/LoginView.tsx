import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Eye, EyeOff, IdCard, LogIn, ShieldCheck } from "@/lib/icons";
import { trpc } from "@/lib/trpc";
import { getErrorMessage } from "@/pages/viewFormat";
import { brandInitial, resolveBackgroundImage, type BrandSettings } from "@/theme";
import { FeedbackDialog } from "./WorkflowDialog";

/**
 * Full-screen login card shown by the Home auth gate when auth.me returns no
 * session. Real form submit (Enter works); errors surface the Thai TRPC
 * message (e.g. "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง") in the red bar.
 */
export function LoginView({ brand, onAuthed }: { brand?: BrandSettings | null | undefined; onAuthed: () => void }) {
  const appName = (brand?.appName ?? "").trim() || "ร้านค้าสวัสดิการ";
  const appLogo = brand?.appLogo ?? "";
  const backgroundImage = resolveBackgroundImage(brand?.loginBackground);
  const [failedBackground, setFailedBackground] = useState("");
  const showBackground = Boolean(backgroundImage && failedBackground !== backgroundImage);
  const loginInFlight = useRef(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [transfer, setTransfer] = useState<{ createdAt: string; lastSeenAt: string } | null>(null);
  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: result => {
      if (result.requiresTransfer === true) { setTransfer({ createdAt: result.createdAt, lastSeenAt: result.lastSeenAt }); return; }
      setTransfer(null);
      setError("");
      onAuthed();
    },
    onError: (mutationError) => setError(getErrorMessage(mutationError)),
    onSettled: () => { loginInFlight.current = false; },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loginMutation.isPending || loginInFlight.current) return;
    if (!username.trim() || !password) {
      setError("กรุณาระบุชื่อผู้ใช้และรหัสผ่านให้ครบถ้วน");
      return;
    }
    setError("");
    loginInFlight.current = true;
    loginMutation.mutate({ username: username.trim(), password });
  };

  return (
    <div className={`login-screen${showBackground ? " login-with-background" : ""}`}>
      {showBackground && <><img className="login-background-image" src={backgroundImage} alt="" onError={() => setFailedBackground(backgroundImage)} /><div className="login-background-shade" aria-hidden="true" /></>}
      <i className="login-blob teal" aria-hidden="true" />
      <i className="login-blob amber" aria-hidden="true" />
      <div className="login-card">
        <div className="login-brand">
          {appLogo ? <img className="brand-logo login-logo" src={appLogo} alt={appName} /> : <div className="brand-mark"><span>{brandInitial(appName)}</span></div>}
          <b>{appName}</b>
          <small>ระบบหน้าร้านและบัญชีสมาชิก</small>
        </div>
        <form className="login-form" onSubmit={submit}>
          <label>
            ชื่อผู้ใช้
            <input
              name="username"
              disabled={loginMutation.isPending}
              value={username}
              onChange={(event) => { setUsername(event.target.value); setTransfer(null); }}
              autoComplete="username"
              autoFocus
              placeholder="กรอกชื่อผู้ใช้ของบัญชีเจ้าหน้าที่/ผู้บริหาร"
            />
          </label>
          <label>
            รหัสผ่าน
            <span className="login-password">
              <input
                name="password"
                disabled={loginMutation.isPending}
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => { setPassword(event.target.value); setTransfer(null); }}
                autoComplete="current-password"
                placeholder="กรอกรหัสผ่าน"
              />
              <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}>
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </span>
          </label>
          {error && !transfer && (
            <div className="login-error" role="alert">
              <ShieldCheck size={15} /> {error}
            </div>
          )}
          <button type="submit" className="primary-button login-submit" disabled={loginMutation.isPending || !username.trim() || !password}>
            <LogIn size={16} /> {loginMutation.isPending ? "กำลังตรวจสอบ…" : "เข้าสู่ระบบ"}
          </button>
        </form>
        <div className="login-scope-note" role="note">
          <IdCard size={15} />
          <span>ระบบนี้สำหรับ<b>เจ้าหน้าที่และผู้บริหารร้านค้า</b>เท่านั้น · สมาชิกสวัสดิการไม่มีการเข้าสู่ระบบ — ใช้สิทธิ์ที่เคาน์เตอร์ด้วยหมายเลขสมาชิก</span>
        </div>
        <p className="login-footer">v1.0.0 · ระบบร้านค้าสวัสดิการ<span className="powered-line">⚡ Powered by <b>PNG TEAM</b></span></p>
      </div>
      {transfer && <FeedbackDialog tone="warning" title="บัญชีนี้เข้าใช้งานอยู่แล้ว" description="การย้ายมาเครื่องนี้จะออกจากระบบที่เครื่องเดิม กรุณาตรวจให้แน่ใจว่างานที่เครื่องเดิมเสร็จแล้วก่อนยืนยัน" className="login-session-dialog" pending={loginMutation.isPending} error={error} actionLabel="ยืนยันย้ายมาเครื่องนี้" onAction={() => {
        if (loginMutation.isPending || loginInFlight.current) return;
        loginInFlight.current = true;
        setError("");
        loginMutation.mutate({ username: username.trim(), password, replaceSession: true });
      }} onClose={() => { setTransfer(null); setError(""); }} onCancel={() => { setTransfer(null); setError(""); }}>
        <div className="login-session-context"><p>เข้าสู่ระบบเมื่อ {transfer.createdAt}</p><p>ติดต่อระบบล่าสุด {transfer.lastSeenAt}</p></div>
      </FeedbackDialog>}
    </div>
  );
}
