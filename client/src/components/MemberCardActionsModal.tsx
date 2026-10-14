import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { getErrorMessage } from "@/pages/viewFormat";
import { MEMBER_CARD_ACTION_LABELS as labels } from "../../../shared/memberCardActions";

export type CompletedMemberCardAction = "assign" | "replace" | "return" | "close";

export function MemberCardActionsModal({ memberNumber, onClose, onSuccess, initialAction }: {
  memberNumber: string; onClose: () => void; onSuccess: (action: CompletedMemberCardAction) => void; initialAction?: "close";
}) {
  const utils = trpc.useUtils();
  const detail = trpc.member.detail.useQuery({ memberNumber });
  const member = detail.data?.member;
  const history = trpc.card.history.useQuery({ cardNumber: member?.cardNumber || "" }, { enabled: Boolean(member?.cardNumber) });
  const session = history.data?.sessions.find(s => !s.endedAt && s.memberNumber === memberNumber);
  const [choice, setChoice] = useState<"return" | "close" | "replace">(initialAction || "return");
  const action = member?.cardNumber ? choice : "assign";
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const done = async (completedAction: CompletedMemberCardAction) => {
    await Promise.all([utils.member.detail.invalidate(), utils.member.list.invalidate(), utils.card.list.invalidate(), utils.card.history.invalidate(), utils.logs.list.invalidate()]);
    onSuccess(completedAction); onClose();
  };
  const fail = (e: unknown) => { setError(getErrorMessage(e)); setConfirm(false); };
  const release = trpc.card.return.useMutation({ onSuccess: () => done("return"), onError: fail });
  const assign = trpc.card.assign.useMutation({ onSuccess: () => done(action === "replace" ? "replace" : "assign"), onError: fail });
  const closeAccount = trpc.card.closeAccount.useMutation({ onSuccess: () => done("close"), onError: fail });
  const busy = release.isPending || assign.isPending || closeAccount.isPending;
  const assigning = action === "assign" || action === "replace";
  const ready = Boolean(member && member.status === "active" && (assigning ? code.trim() && (!member.cardNumber || session) : member.cardNumber && session && member.balance >= 0 && (action !== "close" || !member.accountClosed)));
  return <div className="modal-backdrop"><section className="form-modal" role="dialog" aria-modal="true" aria-label="จัดการบัตรสมาชิก">
    <div className="modal-heading"><h2>{labels[action]}</h2><button type="button" className="icon-button" aria-label="ปิดหน้าต่าง" disabled={busy} onClick={onClose}>×</button></div>
    {detail.isLoading ? <p role="status">กำลังโหลด…</p> : member && <>
      <p>{member.firstName} {member.lastName} · {memberNumber}</p>
      <p>บัตร {member.cardNumber || "ยังไม่มีบัตร"} · ยอดคงเหลือ {member.balance.toFixed(2)} บาท</p>
      {Boolean(member.accountClosed) && <p className="notice-bar" role="status">บัญชีรอบนี้ปิดแล้ว · ยังไม่ได้รับบัตรคืน เลือกคืนบัตรเมื่อรับบัตรกลับมาจริง</p>}
      {!confirm ? <>
        {member.cardNumber && <div className="modal-actions"><button type="button" className={choice === "close" ? "primary-button" : "outline-button"} onClick={() => { setChoice("close"); setError(""); }}>{labels.close}</button><button type="button" className={choice === "return" ? "primary-button" : "outline-button"} onClick={() => { setChoice("return"); setError(""); }}>{labels.return}</button><button type="button" className={choice === "replace" ? "primary-button" : "outline-button"} onClick={() => { setChoice("replace"); setError(""); }}>{labels.replace}</button></div>}
        <h3>{action === "close" ? "คืนเงินทั้งหมด แต่ยังไม่ได้รับบัตรคืน" : action === "return" ? "รับบัตรคืนและคืนเงินคงเหลือ" : action === "replace" ? "รับบัตรเดิมแล้วเปลี่ยนเป็นบัตรใบใหม่" : "สมาชิกยังไม่มีบัตร"}</h3>
        {action === "assign" && <p>จ่ายบัตรว่างให้สมาชิกก่อนเติมเงิน โดยใช้เลขสมาชิกเดิม</p>}
        {action === "replace" && <p>ยอดเงินและเลขสมาชิกจะคงเดิม บัตรใบเก่าจะกลับเป็นบัตรว่างเมื่อยืนยันรายการ</p>}
        {assigning ? <label>สแกนหรือกรอกรหัสบัตรใหม่<input type="text" autoComplete="off" maxLength={30} value={code} onChange={e => setCode(e.target.value)} /></label> : <><div className="receipt-line"><span>เงินที่ต้องจ่ายคืน</span><b>{member.balance.toFixed(2)} บาท</b></div><div className="receipt-line"><span>ยอดหลังทำรายการ</span><b>0.00 บาท</b></div><p>{action === "close" ? "ใช้เมื่อต้องคืนเงินให้สมาชิกก่อน แต่ยังไม่ได้รับบัตรจริง บัตรจะยังจ่ายให้คนอื่นไม่ได้ และบัญชีรอบนี้จะซื้อหรือเติมเงินไม่ได้จนกว่าจะรับบัตรคืน" : "ใช้เมื่อได้รับบัตรจริงแล้ว บัตรจะกลับเป็นบัตรว่างพร้อมจ่ายให้สมาชิกคนอื่น หากเคยคืนเงินแล้วระบบจะไม่คืนซ้ำ"}</p></>}
        {!member.cardNumber && action === "return" && <p>สมาชิกไม่มีบัตรที่ต้องคืน</p>}
        {member.balance < 0 && action === "return" && <p role="alert">มียอดค้าง ต้องจัดการยอดก่อนคืนบัตร</p>}
      </> : <p>{action === "assign" ? `จ่ายบัตร ${code.trim()} ให้สมาชิก ${memberNumber}` : action === "replace" ? `เปลี่ยนจากบัตร ${member.cardNumber} เป็น ${code.trim()} · ยอดคงเหลือ ${member.balance.toFixed(2)} บาทเท่าเดิม` : action === "close" ? `ยืนยันว่าจ่ายเงินคืน ${member.balance.toFixed(2)} บาทแล้ว บัตรยังไม่ได้รับคืน และบัญชีรอบนี้จะปิดการใช้งาน` : `ยืนยันว่ารับบัตรคืนแล้ว${member.balance.toFixed(2) !== "0.00" ? ` และจ่ายเงินคืน ${member.balance.toFixed(2)} บาทแล้ว` : ""} · บัตรจะเป็นว่าง`}</p>}
    </>}
    {(error || detail.error || history.error) && <p className="notice-bar error" role="alert">{error || getErrorMessage(detail.error || history.error)}</p>}
    <div className="modal-actions"><button type="button" className="outline-button" disabled={busy} onClick={() => confirm ? setConfirm(false) : onClose()}>{confirm ? "ย้อนกลับ" : "ยกเลิก"}</button><button type="button" className="primary-button" disabled={!ready || busy} onClick={() => {
      if (!confirm) { setConfirm(true); return; }
      if (!member) return;
      if (assigning) assign.mutate({ memberNumber, cardNumber: code.trim(), expectedCardNumber: member.cardNumber || null, expectedSessionId: session?.id });
      else if (session && member.cardNumber) {
        const input = { memberNumber, cardNumber: member.cardNumber, expectedSessionId: session.id, clientRequestId: requestId };
        if (action === "close") closeAccount.mutate(input);
        else release.mutate({ ...input, mode: "refund" });
      }
    }}>{busy ? "กำลังบันทึก…" : confirm ? "ยืนยัน" : "ตรวจสอบ"}</button></div>
  </section></div>;
}