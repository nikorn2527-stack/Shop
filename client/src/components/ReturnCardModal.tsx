import { useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { memberFullName, money, type MemberLite } from '@/pages/pageData';
import { getErrorMessage } from '@/pages/viewFormat';
import { CreditCard, RotateCcw, ScanLine, ShieldCheck, X } from '@/lib/icons';
import { WorkflowDialog, FeedbackDialog } from './WorkflowDialog';
import { MemberScanPicker } from './ScanPickers';
import { MemberAvatar } from './MemberAvatar';
import { ActionButton } from './ActionButton';

type Props = {
  members: MemberLite[];
  initialMember: MemberLite | null;
  allowMemberChange?: boolean;
  onClose: () => void;
  onReturned: (memberNumber: string, amount: number) => void;
};

export function ReturnCardModal({ members, initialMember, allowMemberChange = true, onClose, onReturned }: Props) {
  const [selected, setSelected] = useState(initialMember);
  return <WorkflowDialog title="คืนบัตรสมาชิก" description="เลือกสมาชิก ตรวจสอบยอดเงิน และยืนยันว่าได้รับบัตรจริงคืนแล้ว" className="form-modal card-return-modal" onClose={onClose}>
    <div className="modal-heading card-return-heading"><div className="card-return-title"><span><RotateCcw size={23} /></span><div><span className="eyebrow">บัตรสมาชิกและเงินคงเหลือ</span><h2>คืนบัตรสมาชิก</h2></div></div><button type="button" className="icon-button" aria-label="ปิดหน้าคืนบัตร" onClick={onClose}><X size={18} /></button></div>
    <ol className="card-return-steps" aria-label="ขั้นตอนคืนบัตร"><li aria-current={!selected ? 'step' : undefined}><span>1</span>เลือกสมาชิก</li><li aria-current={selected ? 'step' : undefined}><span>2</span>ตรวจสอบยอดคืน</li><li><span>3</span>ยืนยันคืนบัตร</li></ol>
    {selected ? <ReturnCardReview key={selected.memberNumber} memberNumber={selected.memberNumber} onBack={allowMemberChange ? () => setSelected(null) : undefined} onClose={onClose} onReturned={onReturned} /> : <>
      <section className="card-return-search" aria-labelledby="return-search-label"><label id="return-search-label" htmlFor="pos-return-card">สแกนบัตรหรือค้นหาสมาชิก</label><p>ค้นหาด้วยชื่อ เลขสมาชิก หรือเลขบัตร</p><MemberScanPicker members={members} selectedNumber={null} onSelect={setSelected} inputId="pos-return-card" inputLabel="สแกนบัตรหรือค้นหาสมาชิกเพื่อคืนบัตร" placeholder="สแกนบัตร หรือพิมพ์ชื่อ / เลขสมาชิก / เลขบัตร" allowGeneralCustomer={false} autoFocus /></section>
      <div className="card-return-empty"><span><ScanLine size={36} /></span><h3>เริ่มจากบัตรที่รับคืน</h3><p>สแกนบัตรด้วยเครื่องอ่านหรือกล้อง<br />จากนั้นตรวจสอบชื่อสมาชิกและเงินที่ต้องคืน</p></div>
      <div className="card-return-help"><ShieldCheck size={18} /><span>ระบบจะยังไม่คืนเงินหรือเปลี่ยนสถานะบัตร จนกว่าจะยืนยันรายการ</span></div>
      <div className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>ปิดหน้าต่าง</button></div>
    </>}
  </WorkflowDialog>;
}

function ReturnCardReview({ memberNumber, onBack, onClose, onReturned }: {
  memberNumber: string; onBack?: () => void; onClose: () => void; onReturned: Props['onReturned'];
}) {
  const utils = trpc.useUtils();
  const detail = trpc.member.detail.useQuery({ memberNumber });
  const member = detail.data?.member;
  const history = trpc.card.history.useQuery({ cardNumber: member?.cardNumber || '' }, { enabled: Boolean(member?.cardNumber) });
  const session = history.data?.sessions.find(s => !s.endedAt && s.memberNumber === memberNumber);
  const [received, setReceived] = useState(false);
  const [review, setReview] = useState<{ cardNumber: string; sessionId: number; amount: number; name: string } | null>(null);
  const [error, setError] = useState('');
  const requestId = useRef(crypto.randomUUID());
  const inFlight = useRef(false);
  const release = trpc.card.return.useMutation({
    onSuccess: async () => {
      const amount = review?.amount ?? 0;
      await Promise.all([utils.member.detail.invalidate(), utils.member.list.invalidate(), utils.card.list.invalidate(), utils.card.history.invalidate(), utils.logs.list.invalidate()]);
      onReturned(memberNumber, amount);
    },
    onError: e => setError(getErrorMessage(e)),
    onSettled: () => { inFlight.current = false; },
  });
  const loading = detail.isLoading || Boolean(member?.cardNumber && history.isLoading);
  const reason = detail.error || history.error ? getErrorMessage(detail.error || history.error)
    : !member ? 'ไม่พบข้อมูลสมาชิก' : !member.cardNumber ? 'สมาชิกนี้ไม่มีบัตรที่ผูกอยู่ จึงไม่มีบัตรให้รับคืน'
    : member.status !== 'active' ? 'สมาชิกถูกระงับ กรุณาตรวจสอบกับผู้บริหารก่อนคืนบัตร'
    : member.balance < 0 ? 'สมาชิกมียอดค้าง กรุณาจัดการยอดก่อนคืนบัตร'
    : !session ? 'ไม่พบรอบใช้งานบัตรที่เปิดอยู่ กรุณาตรวจสอบข้อมูลบัตร' : '';
  const ready = !loading && !reason && received;
  return <>
    {loading && <p role="status" className="card-return-help">กำลังตรวจสอบบัตรและยอดเงินล่าสุด…</p>}
    {member && <>
      <section className="card-return-member"><MemberAvatar member={member} size={52} /><div><h3>{memberFullName(member)}</h3><p>เลขสมาชิก {member.memberNumber}</p><span><CreditCard size={14} /> บัตร {member.cardNumber || 'ยังไม่มีบัตร'}</span></div>{onBack && <button type="button" className="outline-button compact" disabled={release.isPending} onClick={onBack}>เปลี่ยนสมาชิก</button>}</section>
      <section className="card-return-refund"><span>เงินคงเหลือที่ต้องคืนสมาชิก</span><strong>{money(Math.max(0, member.balance))}</strong><p>{member.balance > 0 ? 'คืนเงินทั้งหมดตามยอดคงเหลือของบัตร' : member.balance === 0 ? 'ยอดเป็นศูนย์ คืนบัตรได้โดยไม่ต้องจ่ายเงินคืน' : 'ยังคืนบัตรไม่ได้เนื่องจากมียอดค้าง'}</p><div><span>ยอดหลังคืนบัตร</span><b>{money(0)}</b></div></section>
      <div className="card-return-outcome"><RotateCcw size={18} /><p>หลังยืนยัน บัตรจะกลับเป็นบัตรว่างพร้อมจ่ายใหม่<br /><small>บัญชีและประวัติรายการของสมาชิกยังคงอยู่</small></p></div>
    </>}
    {!loading && reason && <div className="notice-bar warning" role="status"><ShieldCheck size={18} />{reason}</div>}
    {!loading && !reason && <label className="card-return-received"><input type="checkbox" checked={received} disabled={release.isPending} onChange={e => setReceived(e.target.checked)} /><span>ได้รับบัตรใบนี้กลับมาแล้ว และตรวจสอบผู้รับเงินถูกต้อง</span></label>}
    <div className="modal-actions"><button type="button" className="outline-button" disabled={release.isPending} onClick={onClose}>ยกเลิก</button><ActionButton className="primary-button" data-action-tone="warning" disabled={!ready} disabledReason={!received && !reason ? 'รับบัตรจริงและทำเครื่องหมายยืนยันก่อน' : reason || 'กำลังตรวจสอบข้อมูล'} onClick={() => {
      if (!ready || !member?.cardNumber || !session) return;
      setError(''); setReview({ cardNumber: member.cardNumber, sessionId: session.id, amount: member.balance, name: memberFullName(member) });
    }}>ตรวจสอบการคืนบัตร</ActionButton></div>
    {review && <FeedbackDialog tone="warning" title={review.amount > 0 ? 'ยืนยันคืนบัตรและคืนเงิน' : 'ยืนยันคืนบัตร'} description={`${review.name} · ${memberNumber}`} className="card-return-confirm" pending={release.isPending} error={error} actionLabel={review.amount > 0 ? `ยืนยันคืนบัตร · ${money(review.amount)}` : 'ยืนยันคืนบัตร'} onClose={() => setReview(null)} onCancel={() => setReview(null)} cancelLabel="กลับไปตรวจสอบ" onAction={() => {
      if (release.isPending || inFlight.current) return;
      inFlight.current = true;
      setError('');
      release.mutate({ memberNumber, cardNumber: review.cardNumber, expectedSessionId: review.sessionId, clientRequestId: requestId.current, mode: 'refund' });
    }}><div className="card-return-confirm-total"><span>เงินที่ต้องจ่ายคืน</span><strong>{money(review.amount)}</strong><small>บัตร {review.cardNumber}</small></div><p>{review.amount > 0 ? 'กดยืนยันเมื่อส่งมอบเงินคืนและได้รับบัตรจริงแล้ว' : 'กดยืนยันเมื่อได้รับบัตรจริงกลับมาแล้ว'}</p></FeedbackDialog>}
  </>;
}
