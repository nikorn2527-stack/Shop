import { useState } from "react";
import type { FormEvent } from "react";
import { Eye, EyeOff, IdCard, LogIn, ShieldCheck } from "@/lib/icons";
import { trpc } from "@/lib/trpc";
import { getErrorMessage } from "@/pages/viewFormat";
import { brandInitial, type BrandSettings } from "@/theme";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Full-screen login card shown by the Home auth gate when auth.me returns no
 * session. Real form submit (Enter works); errors surface the Thai TRPC
 * message (e.g. "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง") in the red bar.
 */
export function LoginView({ brand, onAuthed }: { brand?: BrandSettings | null | undefined; onAuthed: () => void }) {
  const appName = (brand?.appName ?? "").trim() || "ร้านค้าสวัสดิการ";
  const appLogo = brand?.appLogo ?? "";
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

  return (
    <div className="login-screen">
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
      <Dialog open={transfer !== null} onOpenChange={open => { if (!open && !loginMutation.isPending) { setTransfer(null); setError(""); } }}>
        <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-2rem)] overflow-y-auto" onEscapeKeyDown={event => { if (loginMutation.isPending) event.preventDefault(); }} onPointerDownOutside={event => event.preventDefault()} onOpenAutoFocus={event => { event.preventDefault(); document.getElementById("cancel-session-transfer")?.focus(); }}>
          <DialogHeader>
            <DialogTitle className="text-amber-800">บัญชีนี้เข้าใช้งานอยู่แล้ว</DialogTitle>
            <DialogDescription>ย้ายมาเครื่องนี้จะออกจากระบบที่เครื่องเดิม ตรวจให้แน่ใจว่างานที่เครื่องเดิมเสร็จแล้วก่อนยืนยัน</DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p>เข้าสู่ระบบเมื่อ {transfer?.createdAt}</p>
            <p>ติดต่อระบบล่าสุด {transfer?.lastSeenAt}</p>
          </div>
          {error && <div className="login-error" role="alert">{error}</div>}
          <DialogFooter>
            <button id="cancel-session-transfer" type="button" className="outline-button" disabled={loginMutation.isPending} onClick={() => { setTransfer(null); setError(""); }}>ยกเลิก</button>
            <button type="button" className="primary-button" disabled={loginMutation.isPending} onClick={() => { if (loginMutation.isPending) return; setError(""); loginMutation.mutate({ username: username.trim(), password, replaceSession: true }); }}>{loginMutation.isPending ? "กำลังย้ายเครื่อง…" : "ยืนยันย้ายมาเครื่องนี้"}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
