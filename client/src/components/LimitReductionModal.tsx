import { useState } from "react";
import { trpc } from "@/lib/trpc";
import type { MemberLite, Role } from "@/pages/pageData";
import { memberFullName, money, roleThaiLabel } from "@/pages/pageData";
import { getErrorMessage } from "@/pages/viewFormat";

export function LimitReductionModal({ member, role, userName, onClose, onSuccess }: {
  member: MemberLite; role: Role; userName: string; onClose: () => void; onSuccess: (message: string) => void;
}) {
  const utils = trpc.useUtils();
  const [requestedLimit, setRequestedLimit] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const mutation = trpc.member.requestLimitReduction.useMutation({
    onSuccess: async result => {
      await Promise.all([utils.reports.limitRequests.invalidate(), utils.reports.memberTransactions.invalidate(), utils.logs.list.invalidate()]);
      onSuccess(`ส่งคำขอลดวงเงินเหลือ ${money(result.requestedLimit)} แล้ว`);
      onClose();
    },
    onError: mutationError => setError(getErrorMessage(mutationError)),
  });
  const amount = Number(requestedLimit);
  const valid = amount > 0 && (member.creditLimit == null || amount < member.creditLimit);
  return <div className="modal-backdrop"><section className="form-modal" role="dialog" aria-modal="true" aria-label="ขอลดวงเงินสมาชิก">
    <div className="modal-heading"><div><h2>ขอลดวงเงิน</h2><p>{memberFullName(member)} · {member.memberNumber}</p></div><button type="button" className="icon-button" aria-label="ปิดหน้าต่าง" disabled={mutation.isPending} onClick={onClose}>×</button></div>
    <div className="receipt-line"><span>วงเงินปัจจุบัน</span><b>{member.creditLimit == null ? "ไม่จำกัด" : money(member.creditLimit)}</b></div>
    <label>วงเงินใหม่<input autoFocus type="number" min="1" max="1000000" step="1" value={requestedLimit} onChange={event => { setRequestedLimit(event.target.value); setError(""); }} placeholder="ระบุวงเงินที่ต้องการ" /></label>
    <label>เหตุผล <small>(ไม่บังคับ)</small><textarea maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="เช่น สมาชิกขอปรับวงเงินรายวัน" /></label>
    {requestedLimit && !valid && <p className="notice-bar error" role="alert">วงเงินใหม่ต้องมากกว่า 0{member.creditLimit != null ? ` และน้อยกว่า ${money(member.creditLimit)}` : ""}</p>}
    {error && <p className="notice-bar error" role="alert">{error}</p>}
    <p className="notice-bar">คำขอจะรอผู้บริหารพิจารณา วงเงินปัจจุบันยังไม่เปลี่ยนในขั้นตอนนี้</p>
    <div className="modal-actions"><button type="button" className="outline-button" disabled={mutation.isPending} onClick={onClose}>ยกเลิก</button><button type="button" className="primary-button" disabled={!valid || mutation.isPending} onClick={() => mutation.mutate({ memberNumber: member.memberNumber, requestedLimit: amount, reason: reason.trim() || undefined, actor: userName, actorRole: roleThaiLabel(role) })}>{mutation.isPending ? "กำลังส่งคำขอ…" : "ส่งคำขอ"}</button></div>
  </section></div>;
}
