import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { getErrorMessage } from "@/pages/viewFormat";

export function MemberCardActionsModal({ memberNumber, onClose, onSuccess }: {
  memberNumber: string; onClose: () => void; onSuccess: () => void;
}) {
  const utils = trpc.useUtils();
  const detail = trpc.member.detail.useQuery({ memberNumber });
  const member = detail.data?.member;
  const history = trpc.card.history.useQuery({ cardNumber: member?.cardNumber || "" }, { enabled: Boolean(member?.cardNumber) });
  const session = history.data?.sessions.find(s => !s.endedAt && s.memberNumber === memberNumber);
  const action = member?.cardNumber ? "return" : "assign";
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const done = async () => {
    await Promise.all([utils.member.detail.invalidate(), utils.member.list.invalidate(), utils.card.list.invalidate(), utils.card.history.invalidate(), utils.logs.list.invalidate()]);
    onSuccess(); onClose();
  };
  const fail = (e: unknown) => { setError(getErrorMessage(e)); setConfirm(false); };
  const release = trpc.card.return.useMutation({ onSuccess: done, onError: fail });
  const assign = trpc.card.assign.useMutation({ onSuccess: done, onError: fail });
  const busy = release.isPending || assign.isPending;
  const ready = Boolean(member && member.status === "active" && (action === "assign" ? code.trim() && (!member.cardNumber || session) : member.cardNumber && session && member.balance >= 0));
  return <div className="modal-backdrop"><section className="form-modal" role="dialog" aria-modal="true" aria-label="จัดการบัตรสมาชิก">
    <div className="modal-heading"><h2>{action === "return" ? "คืนเงินและคืนบัตร" : "จ่ายบัตรให้สมาชิกเดิม"}</h2><button type="button" className="icon-button" aria-label="ปิดหน้าต่าง" disabled={busy} onClick={onClose}>×</button></div>
    {detail.isLoading ? <p role="status">กำลังโหลด…</p> : member && <>
      <p>{member.firstName} {member.lastName} · {memberNumber}</p>
      <p>บัตร {member.cardNumber || "ยังไม่มีบัตร"} · ยอดคงเหลือ {member.balance.toFixed(2)} บาท</p>
      {!confirm ? <>
        <h3>{action === "return" ? "รับบัตรคืนและคืนเงินทั้งหมด" : "สมาชิกยังไม่มีบัตร"}</h3>
        {action === "assign" && <p>จ่ายบัตรว่างให้สมาชิกก่อนเติมเงิน โดยใช้เลขสมาชิกเดิม</p>}
        {action === "assign" ? <label>สแกนหรือกรอกรหัสบัตร<input type="text" autoComplete="off" maxLength={30} value={code} onChange={e => setCode(e.target.value)} /></label> : <p>{member.balance > 0 ? `คืนเงินทั้งหมด ${member.balance.toFixed(2)} บาท พร้อมคืนบัตร` : "รับคืนบัตรและปิดรอบการใช้บัตร"}</p>}
        {!member.cardNumber && action === "return" && <p>สมาชิกไม่มีบัตรที่ต้องคืน</p>}
        {member.balance < 0 && action === "return" && <p role="alert">มียอดค้าง ต้องจัดการยอดก่อนคืนบัตร</p>}
      </> : <p>{action === "assign" ? `จ่ายบัตร ${code.trim()} ให้สมาชิก ${memberNumber}` : `ยืนยันว่ารับบัตรคืนแล้ว${member.balance.toFixed(2) !== "0.00" ? ` และจ่ายเงินคืน ${member.balance.toFixed(2)} บาทแล้ว` : ""} · บัตรจะเป็นว่าง`}</p>}
    </>}
    {(error || detail.error || history.error) && <p className="notice-bar error" role="alert">{error || getErrorMessage(detail.error || history.error)}</p>}
    <div className="modal-actions"><button type="button" className="outline-button" disabled={busy} onClick={() => confirm ? setConfirm(false) : onClose()}>{confirm ? "ย้อนกลับ" : "ยกเลิก"}</button><button type="button" className="primary-button" disabled={!ready || busy} onClick={() => {
      if (!confirm) { setConfirm(true); return; }
      if (!member) return;
      if (action === "assign") assign.mutate({ memberNumber, cardNumber: code.trim(), expectedCardNumber: member.cardNumber || null, expectedSessionId: session?.id });
      else if (session && member.cardNumber) release.mutate({ memberNumber, cardNumber: member.cardNumber, expectedSessionId: session.id, mode: "refund", clientRequestId: requestId });
    }}>{busy ? "กำลังบันทึก…" : confirm ? "ยืนยัน" : "ตรวจสอบ"}</button></div>
  </section></div>;
}