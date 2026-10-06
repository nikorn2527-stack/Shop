import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { X } from "@/lib/icons";
import { getErrorMessage } from "@/pages/viewFormat";

export function MemberRegistrationModal({ actor, actorRole, onClose, onRegistered }: {
  actor: string;
  actorRole: string;
  onClose: () => void;
  onRegistered: (member: { firstName: string; lastName: string; memberNumber: string }) => void;
}) {
  const utils = trpc.useUtils();
  const settings = trpc.settings.get.useQuery(undefined);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ prename: "", firstName: "", lastName: "", phone: "", citizenId: "", memberNumber: "", cardNumber: "", patientCode: "", type: "สมาชิก", gender: "", initialDeposit: "" });
  const mutation = trpc.member.register.useMutation({
    onSuccess: async result => {
      await Promise.all([utils.member.list.invalidate(), utils.reports.memberBalances.invalidate(), utils.logs.list.invalidate()]);
      onRegistered(result.member);
    },
    onError: cause => setError(getErrorMessage(cause)),
  });
  const manual = settings.data?.memberNumberMode === "manual";
  return <div className="modal-backdrop"><form className="form-modal" role="dialog" aria-modal="true" aria-labelledby="member-registration-title" onSubmit={event => {
    event.preventDefault();
    if (mutation.isPending || !settings.data) return;
    if (!form.firstName.trim() || !form.lastName.trim()) { setError("กรุณาระบุชื่อและนามสกุลสมาชิก"); return; }
    if (manual && !form.memberNumber.trim()) { setError("กรุณาระบุหมายเลขสมาชิก"); return; }
    const initialDeposit = form.initialDeposit === "" ? undefined : Number(form.initialDeposit);
    if (initialDeposit !== undefined && (!Number.isFinite(initialDeposit) || initialDeposit <= 0)) { setError("เงินเริ่มต้นต้องมากกว่า 0 หรือเว้นว่าง"); return; }
    setError("");
    mutation.mutate({ prename: form.prename.trim() || undefined, firstName: form.firstName.trim(), lastName: form.lastName.trim(), phone: form.phone.trim() || undefined, citizenId: form.citizenId.trim() || undefined, memberNumber: manual ? form.memberNumber.trim() : undefined, cardNumber: form.cardNumber.trim() || undefined, patientCode: form.patientCode.trim() || undefined, type: form.type, gender: form.gender === "ชาย" || form.gender === "หญิง" ? form.gender : undefined, initialDeposit, actor, actorRole });
  }}>
    <div className="modal-heading"><h2 id="member-registration-title">เพิ่มสมาชิก</h2><button type="button" className="icon-button" disabled={mutation.isPending} onClick={onClose} aria-label="ปิดหน้าต่างเพิ่มสมาชิก"><X size={18} /></button></div>
    <fieldset disabled={mutation.isPending} style={{ border: 0, padding: 0, margin: 0 }}><div className="form-grid">
      {([['prename', 'คำนำหน้า'], ['firstName', 'ชื่อ *'], ['lastName', 'นามสกุล *'], ['phone', 'เบอร์โทรศัพท์'], ['citizenId', 'เลขบัตรประชาชน'], ['cardNumber', 'รหัสบัตรเงินสด'], ['patientCode', 'รหัสผู้ป่วย (HN)']] as const).map(([key, label]) => <label key={key}>{label}<input name={key} value={form[key]} required={key === 'firstName' || key === 'lastName'} onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))} /></label>)}
      <label>ประเภทสมาชิก<select value={form.type} onChange={event => setForm({ ...form, type: event.target.value })}><option>สมาชิก</option><option>เจ้าหน้าที่</option></select></label>
      <label>เพศ<select value={form.gender} onChange={event => setForm({ ...form, gender: event.target.value })}><option value="">ไม่ระบุ</option><option>ชาย</option><option>หญิง</option></select></label>
      {manual && <label>หมายเลขสมาชิก *<input name="memberNumber" required value={form.memberNumber} onChange={event => setForm({ ...form, memberNumber: event.target.value })} /></label>}
      <label>เงินเริ่มต้น (ถ้ามี)<input name="initialDeposit" type="number" min="0.01" step="0.01" value={form.initialDeposit} onChange={event => setForm({ ...form, initialDeposit: event.target.value })} /></label>
    </div></fieldset>
    {(error || settings.isError) && <div className="inline-message error" role="alert">{error || getErrorMessage(settings.error)}</div>}
    <div className="modal-actions"><button type="button" className="outline-button" disabled={mutation.isPending} onClick={onClose}>ยกเลิก</button><button type="submit" className="primary-button" disabled={mutation.isPending || !settings.data}>{mutation.isPending ? "กำลังบันทึก…" : "บันทึกสมาชิก"}</button></div>
  </form></div>;
}