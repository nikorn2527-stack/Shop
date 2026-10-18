import { WorkflowDialog } from "./WorkflowDialog";
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { getErrorMessage } from "@/pages/viewFormat";
import { MEMBER_CARD_ACTION_LABELS as labels } from "../../../shared/memberCardActions";
import { downloadSlipFile } from "@/exportUtils";
import {
  Check,
  Download,
  FileImage,
  Printer,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  X,
} from "@/lib/icons";
import { PrintPreviewModal } from "@/components/PrintPreviewModal";

export type CompletedMemberCardAction = "assign" | "replace" | "return" | "close";
export type InitialMemberCardAction = "return" | "close";

export function MemberCardActionsModal({ memberNumber, onClose, onSuccess, initialAction, initialCardNumber = "" }: {
  memberNumber: string; onClose: () => void; onSuccess: (action: CompletedMemberCardAction) => void; initialAction?: InitialMemberCardAction; initialCardNumber?: string;
}) {
  const utils = trpc.useUtils();
  const detail = trpc.member.detail.useQuery({ memberNumber });
  const member = detail.data?.member;
  const history = trpc.card.history.useQuery({ cardNumber: member?.cardNumber || "" }, { enabled: Boolean(member?.cardNumber) });
  const session = history.data?.sessions.find(s => !s.endedAt && s.memberNumber === memberNumber);
  const [choice, setChoice] = useState<"return" | "close" | "replace">(initialAction || "return");
  const action = initialAction === "return" ? "return" : member?.cardNumber ? (member.accountClosed ? "return" : choice) : "assign";
  const [code, setCode] = useState(initialCardNumber);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());

  // Wallet-style card return flow (mirrors deposit/withdrawal/refund UI in MemberDetail)
  const [returnStep, setReturnStep] = useState<"form" | "confirm" | "success">("form");
  const [returnNote, setReturnNote] = useState("");
  const [returnResult, setReturnResult] = useState<{
    memberName: string; memberNumber: string; amount: number;
    balanceBefore: number; balanceAfter: number; doneAt: Date;
  } | null>(null);
  const [slipBusy, setSlipBusy] = useState("");
  const [printPreview, setPrintPreview] = useState(false);
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
  const historyReady = !member?.cardNumber || (!history.isLoading && Boolean(session));
  const ready = Boolean(member && member.status === "active" && historyReady && (assigning ? code.trim() : member.cardNumber && member.balance >= 0 && (action !== "close" || !member.accountClosed)));
  useEffect(() => { setConfirm(false); setError(""); }, [choice, code]);

  /* ---------- Wallet-style card return handlers ---------- */
  const prepareReturn = () => {
    if (!member) return;
    setReturnResult({
      memberName: `${member.firstName} ${member.lastName}`,
      memberNumber,
      amount: member.balance,
      balanceBefore: member.balance,
      balanceAfter: 0,
      doneAt: new Date(),
    });
    setReturnStep("confirm");
  };

  const submitReturn = () => {
    if (!member || !member.cardNumber || !session) return;
    release.mutate({
      memberNumber,
      cardNumber: member.cardNumber,
      expectedSessionId: session.id,
      clientRequestId: requestId,
      mode: "refund",
    });
  };

  const closeReturnSlip = () => {
    setReturnStep("form");
    setReturnResult(null);
    setSlipBusy("");
    setPrintPreview(false);
    setReturnNote("");
  };

  const downloadReturnSlip = async (format: "pdf" | "image") => {
    if (!returnResult) return;
    setSlipBusy(format);
    try {
      const stamp = returnResult.doneAt
        ? `${String(returnResult.doneAt.getFullYear() + 543).slice(2)}${String(returnResult.doneAt.getMonth() + 1).padStart(2, "0")}${String(returnResult.doneAt.getDate()).padStart(2, "0")}-${String(returnResult.doneAt.getHours()).padStart(2, "0")}${String(returnResult.doneAt.getMinutes()).padStart(2, "0")}`
        : String(Date.now());
      await downloadSlipFile(
        "member-card-return-slip",
        `สลิปคืนบัตรเงินสด-${returnResult.memberNumber}-${stamp}`,
        format
      );
    } finally {
      setSlipBusy("");
    }
  };
  return (
    <WorkflowDialog title="จัดการบัตรสมาชิก" onClose={onClose} busy={busy} className="form-modal">
        {printPreview && (
          <PrintPreviewModal targetId="member-card-return-slip" title="สลิปคืนบัตรสมาชิก" onClose={() => setPrintPreview(false)} />
        )}
        <div className="modal-heading">
          <h2>{labels[action]}</h2>
          <button type="button" className="icon-button" aria-label="ปิดหน้าต่าง" disabled={busy} onClick={onClose}>
            ×
          </button>
        </div>
        {detail.isLoading && <p role="status">กำลังโหลด…</p>}
        {!detail.isLoading && member && (
  <>
            <p>{member.firstName} {member.lastName} · {memberNumber}</p>
            <p>บัตร {member.cardNumber ?? "ยังไม่มีบัตร"} · ยอดคงเหลือ {member.balance.toFixed(2)} บาท</p>
            {Boolean(member.accountClosed) && (
              <p className="notice-bar" role="status">
                บัญชีรอบนี้ปิดแล้ว · ยังไม่ได้รับบัตรคืน เลือกคืนบัตรเมื่อรับบัตรกลับมาจริง
              </p>
            )}
            {/* ===== WALLET-STYLE CARD RETURN (form → confirm → slip) ===== */}
            {action === "return" && returnStep === "form" && (
              <>
                <h3>คืนบัตรและคืนเงินคงเหลือทั้งหมด</h3>
                {member.balance < 0 && (
                  <p role="alert">มียอดค้าง ต้องจัดการยอดก่อนคืนบัตร</p>
                )}
                {member.balance === 0 && (
                  <p>ยอดคงเหลือเป็นศูนย์ — คืนบัตรได้โดยไม่ต้องคืนเงิน</p>
                )}
                {member.balance > 0 && (
                  <>
                    <span>เงินที่ต้องจ่ายคืน</span>
                    <div className="receipt-line">
                      <span>ยอดคงเหลือก่อนคืนบัตร</span>
                      <b>{member.balance.toFixed(2)} บาท</b>
                    </div>
                    <div className="receipt-line">
                      <span>จำนวนเงินที่จะคืน</span>
                      <b>{member.balance.toFixed(2)} บาท</b>
                    </div>
                    <div className="receipt-line">
                      <span>ยอดหลังทำรายการ</span><b>0.00 บาท</b>
                    </div>
                    <label className="wide">
                      หมายเหตุ
                      <input
                        type="text"
                        value={returnNote}
                        onChange={e => setReturnNote(e.target.value)}
                        placeholder="เช่น ผู้ป่วยคืนบัตร ออกจากโรงพยาบาลแล้ว"
                      />
                    </label>
                    {error && (
                      <div className="notice-bar error">
                        <ShieldCheck size={16} /> {error}
                        <button onClick={() => setError("")}><X size={14} /></button>
                      </div>
                    )}
                    <div className="modal-actions">
                      <button
                        type="button"
                        className="outline-button"
                        disabled={busy}
                        onClick={onClose}
                      >
                        ยกเลิก
                      </button>
                      <button
                        type="button"
                        className="primary-button"
                        disabled={busy || member.balance < 0 || !session}
                        onClick={prepareReturn}
                      >
                        <Check size={16} />{" "}
                        {member.balance > 0 ? "คืนเงินและคืนบัตร" : "คืนบัตร"}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
            {action === "return" && returnStep === "confirm" && (
              <>
                <div className="wallet-confirm-warning">
                  <ShieldCheck size={16} />
                  <span>
                    ยอดเงินจะถูกคืนให้สมาชิกและบัตรจะถูกปล่อยเป็นว่าง
                    จนกว่าจะกด “ยืนยันการคืนบัตร”
                  </span>
                </div>
                <div className="wallet-confirm-rows">
                  <div>
                    <span>สมาชิก</span>
                    <b>{returnResult?.memberName} · {returnResult?.memberNumber}</b>
                  </div>
                  <div>
                    <span>ยอดคงเหลือก่อนคืนบัตร</span>
                    <b>{returnResult?.balanceBefore.toFixed(2)} บาท</b>
                  </div>
                  <div>
                    <span>จำนวนเงินที่คืน</span>
                    <b>{returnResult?.amount.toFixed(2)} บาท</b>
                  </div>
                  <div>
                    <span>ยอดคงเหลือหลังคืนบัตร</span>
                    <b>0.00 บาท</b>
                  </div>
                  {returnNote.trim() && (
                    <div>
                      <span>หมายเหตุ</span>
                      <b>{returnNote.trim()}</b>
                    </div>
                  )}
                </div>
                {error && (
                  <div className="notice-bar error">
                    <ShieldCheck size={16} /> {error}
                    <button onClick={() => setError("")}><X size={14} /></button>
                  </div>
                )}
                <div className="modal-actions">
                  <button
                    type="button"
                    className="outline-button"
                    disabled={busy}
                    onClick={() => setReturnStep("form")}
                  >
                    <RotateCcw size={15} /> ย้อนกลับแก้ไข
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={busy || confirm}
                    onClick={submitReturn}
                  >
                    {busy ? "กำลังบันทึก…" : confirm ? "ยืนยัน" : "ตรวจสอบ"}
                  </button>
                </div>
              </>
            )}
            <>
        {member.cardNumber && <div className="modal-actions">{!member.accountClosed && <button type="button" className={choice === "close" ? "primary-button" : "outline-button"} onClick={() => setChoice("close")}>{labels.close}</button>}<button type="button" className={action === "return" ? "primary-button" : "outline-button"} onClick={() => setChoice("return")}>{labels.return}</button>{!member.accountClosed && <button type="button" className={choice === "replace" ? "primary-button" : "outline-button"} onClick={() => setChoice("replace")}>{labels.replace}</button>}</div>}
        <h3>{action === "close" ? "คืนเงินทั้งหมด แต่ยังไม่ได้รับบัตรคืน" : action === "return" ? "รับบัตรคืนและคืนเงินคงเหลือ" : action === "replace" ? "รับบัตรเดิมแล้วเปลี่ยนเป็นบัตรใบใหม่" : "สมาชิกยังไม่มีบัตร"}</h3>
        {action === "assign" && <p>จ่ายบัตรว่างให้สมาชิกก่อนเติมเงิน โดยใช้เลขสมาชิกเดิม</p>}
        {action === "replace" && <p>ยอดเงินและเลขสมาชิกจะคงเดิม บัตรใบเก่าจะกลับเป็นบัตรว่างเมื่อยืนยันรายการ</p>}
        {assigning ? <label>สแกนหรือกรอกรหัสบัตรใหม่<input type="text" autoComplete="off" maxLength={30} value={code} onChange={e => setCode(e.target.value)} /></label> : <><div className="receipt-line"><span>เงินที่ต้องจ่ายคืน</span><b>{member.balance.toFixed(2)} บาท</b></div><div className="receipt-line"><span>ยอดหลังทำรายการ</span><b>0.00 บาท</b></div><p>{action === "close" ? "ใช้เมื่อต้องคืนเงินให้สมาชิกก่อน แต่ยังไม่ได้รับบัตรจริง บัตรจะยังจ่ายให้คนอื่นไม่ได้ และบัญชีรอบนี้จะซื้อหรือเติมเงินไม่ได้จนกว่าจะรับบัตรคืน" : "ใช้เมื่อได้รับบัตรจริงแล้ว บัตรจะกลับเป็นบัตรว่างพร้อมจ่ายให้สมาชิกคนอื่น หากเคยคืนเงินแล้วระบบจะไม่คืนซ้ำ"}</p></>}
        {!member.cardNumber && action === "return" && <p>สมาชิกไม่มีบัตรที่ต้องคืน</p>}
        {member.balance < 0 && action === "return" && <p role="alert">มียอดค้าง ต้องจัดการยอดก่อนคืนบัตร</p>}
        {member.cardNumber && !history.isLoading && !session && <p className="notice-bar error" role="alert">ไม่พบรอบใช้งานที่เปิดอยู่ กรุณาตรวจสอบสถานะบัตรในคลังบัตรก่อนทำรายการ</p>}
            </>
            {action === "return" && returnStep === "success" && (
              <>
                <div className="wallet-success">
                  <div className="receipt-paper wallet-slip" id="member-card-return-slip">
                    <div className="receipt-success slip">
                      <span>คืนบัตรเงินสดสำเร็จ</span>
                      <small>บันทึกลงรายการธุรกรรมของสมาชิกแล้ว</small>
                    </div>
                    <div className="receipt-divider" />
                    <div className="receipt-meta">
                      <span>ใบยืนยันการคืนบัตรเงินสด</span>
                      <b>
                        {returnResult?.doneAt
                          ? `${returnResult.doneAt.toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric" })} · ${returnResult.doneAt.toLocaleTimeString("th-TH", { hourCycle: "h23", hour: "2-digit", minute: "2-digit" })} น.`
                          : ""}
                      </b>
                    </div>
                    <div className="receipt-customer">
                      <span>สมาชิก</span>
                      <b>{returnResult?.memberName} · {returnResult?.memberNumber}</b>
                    </div>
                    <div className="receipt-line">
                      <span>ยอดคงเหลือก่อนคืนบัตร</span>
                      <b>{returnResult?.balanceBefore.toFixed(2)} บาท</b>
                    </div>
                    <div className="receipt-line">
                      <span>จำนวนเงินที่คืน</span>
                      <b>{returnResult?.amount.toFixed(2)} บาท</b>
                    </div>
                    <div className="receipt-total">
                      <span>ยอดคงเหลือหลังคืนบัตร</span>
                      <b>0.00 บาท</b>
                    </div>
                    <div className="receipt-payment">
                      <span>ผู้ทำรายการ</span>
                      <b>เจ้าหน้าที่ร้านค้า</b>
                    </div>
                    <div className="receipt-thanks">
                      บันทึกเข้าระบบเรียบร้อย
                      <br />
                      <small>ข้อมูลถูกบันทึกในประวัติระบบ แล้ว</small>
                    </div>
                  </div>
                  <div className="wallet-success-actions">
                    <button
                      className="outline-button"
                      disabled={Boolean(slipBusy)}
                      onClick={() => void downloadReturnSlip("pdf")}
                    >
                      <Download size={16} />
                      {slipBusy === "pdf" ? "กำลังสร้าง PDF..." : "ดาวน์โหลด PDF"}
                    </button>
                    <button
                      className="outline-button"
                      disabled={Boolean(slipBusy)}
                      onClick={() => void downloadReturnSlip("image")}
                    >
                      <FileImage size={16} />
                      {slipBusy === "image" ? "กำลังสร้างรูป..." : "ดาวน์โหลดรูปภาพ"}
                    </button>
                    <button
                      className="outline-button"
                      onClick={() => setPrintPreview(true)}
                    >
                      <Printer size={16} /> พิมพ์สลิป
                    </button>
                    <button
                      className="primary-button"
                      onClick={closeReturnSlip}
                    >
                      <Check size={16} /> เสร็จสิ้น · ปิดหน้าต่าง
                    </button>
                  </div>
                </div>
              </>
            )}
            {action !== "return" && confirm && (
  <p>
    {action === "assign"
      ? `จ่ายบัตร ${code.trim()} ให้สมาชิก ${memberNumber}`
      : action === "replace"
        ? `เปลี่ยนจากบัตร ${member.cardNumber} เป็น ${code.trim()} · ยอดคงเหลือ ${member.balance.toFixed(2)} บาทเท่าเดิม`
        : action === "close"
          ? `ยืนยันว่าจ่ายเงินคืน ${member.balance.toFixed(2)} บาทแล้ว บัตรยังไม่ได้รับคืน และบัญชีรอบนี้จะปิดการใช้งาน`
          : `ยืนยันว่ารับบัตรคืนแล้ว${member.balance.toFixed(2) !== "0.00" ? ` และจ่ายเงินคืน ${member.balance.toFixed(2)} บาทแล้ว` : ""} · บัตรจะเป็นว่าง`}
  </p>
)}
</>)}
{(error || detail.error || history.error) && (
  <p className="notice-bar error" role="alert">
    {error || getErrorMessage(detail.error || history.error)}
  </p>
)}
<div className="modal-actions">
  <button
    type="button"
    className="outline-button"
    disabled={busy}
    onClick={() => (confirm ? setConfirm(false) : onClose())}
  >
    {confirm ? "ย้อนกลับ" : "ยกเลิก"}
  </button>
  <button
    type="button"
    className="primary-button"
    disabled={!ready || busy}
    onClick={() => {
      if (!confirm) {
        setConfirm(true);
        return;
      }
      if (!member) return;
      if (assigning) {
        assign.mutate({
          memberNumber,
          cardNumber: code.trim(),
          expectedCardNumber: member.cardNumber || null,
          expectedSessionId: session?.id,
        });
      } else if (session && member.cardNumber) {
        const input = {
          memberNumber,
          cardNumber: member.cardNumber,
          expectedSessionId: session.id,
          clientRequestId: requestId,
        };
        if (action === "close") closeAccount.mutate(input);
        else release.mutate({ ...input, mode: "refund" });
      }
    }}
  >
    {busy ? "กำลังบันทึก…" : confirm ? "ยืนยัน" : "ตรวจสอบ"}
  </button>
</div>
</WorkflowDialog>
);
}


