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

export function MemberCardActionsModal({ memberNumber, onClose, onSuccess, initialAction }: {
  memberNumber: string; onClose: () => void; onSuccess: (action: CompletedMemberCardAction) => void; initialAction?: InitialMemberCardAction;
}) {
  const utils = trpc.useUtils();
  const detail = trpc.member.detail.useQuery({ memberNumber });
  const member = detail.data?.member;
  const history = trpc.card.history.useQuery({ cardNumber: member?.cardNumber || "" }, { enabled: Boolean(member?.cardNumber) });
  const session = history.data?.sessions.find(s => !s.endedAt && s.memberNumber === memberNumber);
  const [choice, setChoice] = useState<"return" | "close" | "replace">(initialAction || "return");
  const action = initialAction === "return" ? "return" : member?.cardNumber ? (member.accountClosed ? "return" : choice) : "assign";
  const [code, setCode] = useState("");
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
        `เธชเธฅเธดเธเธเธทเธเธเธฑเธ•เธฃเน€เธเธดเธเธชเธ”-${returnResult.memberNumber}-${stamp}`,
        format
      );
    } finally {
      setSlipBusy("");
    }
  };
  return (
    <div className="modal-backdrop">
      <section className="form-modal" role="dialog" aria-modal="true" aria-label="เธเธฑเธ”เธเธฒเธฃเธเธฑเธ•เธฃเธชเธกเธฒเธเธดเธ">
        {printPreview && (
          <PrintPreviewModal targetId="member-card-return-slip" title="สลิปคืนบัตรสมาชิก" onClose={() => setPrintPreview(false)} />
        )}
        <div className="modal-heading">
          <h2>{labels[action]}</h2>
          <button type="button" className="icon-button" aria-label="เธเธดเธ”เธซเธเนเธฒเธ•เนเธฒเธ" disabled={busy} onClick={onClose}>
            ร—
          </button>
        </div>
        {detail.isLoading && <p role="status">เธเธณเธฅเธฑเธเนเธซเธฅเธ”โ€ฆ</p>}
        {!detail.isLoading && member && (
  <>
            <p>{member.firstName} {member.lastName} ยท {memberNumber}</p>
            <p>เธเธฑเธ•เธฃ {member.cardNumber ?? "เธขเธฑเธเนเธกเนเธกเธตเธเธฑเธ•เธฃ"} ยท เธขเธญเธ”เธเธเน€เธซเธฅเธทเธญ {member.balance.toFixed(2)} เธเธฒเธ—</p>
            {Boolean(member.accountClosed) && (
              <p className="notice-bar" role="status">
                เธเธฑเธเธเธตเธฃเธญเธเธเธตเนเธเธดเธ”เนเธฅเนเธง ยท เธขเธฑเธเนเธกเนเนเธ”เนเธฃเธฑเธเธเธฑเธ•เธฃเธเธทเธ เน€เธฅเธทเธญเธเธเธทเธเธเธฑเธ•เธฃเน€เธกเธทเนเธญเธฃเธฑเธเธเธฑเธ•เธฃเธเธฅเธฑเธเธกเธฒเธเธฃเธดเธ
              </p>
            )}
            {/* ===== WALLET-STYLE CARD RETURN (form โ’ confirm โ’ slip) ===== */}
            {action === "return" && returnStep === "form" && (
              <>
                <h3>เธเธทเธเธเธฑเธ•เธฃเนเธฅเธฐเธเธทเธเน€เธเธดเธเธเธเน€เธซเธฅเธทเธญเธ—เธฑเนเธเธซเธกเธ”</h3>
                {member.balance < 0 && (
                  <p role="alert">เธกเธตเธขเธญเธ”เธเนเธฒเธ เธ•เนเธญเธเธเธฑเธ”เธเธฒเธฃเธขเธญเธ”เธเนเธญเธเธเธทเธเธเธฑเธ•เธฃ</p>
                )}
                {member.balance === 0 && (
                  <p>เธขเธญเธ”เธเธเน€เธซเธฅเธทเธญเน€เธเนเธเธจเธนเธเธขเน โ€” เธเธทเธเธเธฑเธ•เธฃเนเธ”เนเนเธ”เธขเนเธกเนเธ•เนเธญเธเธเธทเธเน€เธเธดเธ</p>
                )}
                {member.balance > 0 && (
                  <>
                    <span>เงินที่ต้องจ่ายคืน</span>
                    <div className="receipt-line">
                      <span>เธขเธญเธ”เธเธเน€เธซเธฅเธทเธญเธเนเธญเธเธเธทเธเธเธฑเธ•เธฃ</span>
                      <b>{member.balance.toFixed(2)} เธเธฒเธ—</b>
                    </div>
                    <div className="receipt-line">
                      <span>เธเธณเธเธงเธเน€เธเธดเธเธ—เธตเนเธเธฐเธเธทเธ</span>
                      <b>{member.balance.toFixed(2)} เธเธฒเธ—</b>
                    </div>
                    <div className="receipt-line">
                      <span>ยอดหลังทำรายการ</span><b>0.00 บาท</b>
                    </div>
                    <label className="wide">
                      เธซเธกเธฒเธขเน€เธซเธ•เธธ
                      <input
                        type="text"
                        value={returnNote}
                        onChange={e => setReturnNote(e.target.value)}
                        placeholder="เน€เธเนเธ เธเธนเนเธเนเธงเธขเธเธทเธเธเธฑเธ•เธฃ เธญเธญเธเธเธฒเธเนเธฃเธเธเธขเธฒเธเธฒเธฅเนเธฅเนเธง"
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
                        เธขเธเน€เธฅเธดเธ
                      </button>
                      <button
                        type="button"
                        className="primary-button"
                        disabled={busy || member.balance < 0 || !session}
                        onClick={prepareReturn}
                      >
                        <Check size={16} />{" "}
                        {member.balance > 0 ? "เธเธทเธเน€เธเธดเธเนเธฅเธฐเธเธทเธเธเธฑเธ•เธฃ" : "เธเธทเธเธเธฑเธ•เธฃ"}
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
                    เธขเธญเธ”เน€เธเธดเธเธเธฐเธ–เธนเธเธเธทเธเนเธซเนเธชเธกเธฒเธเธดเธเนเธฅเธฐเธเธฑเธ•เธฃเธเธฐเธ–เธนเธเธเธฅเนเธญเธขเน€เธเนเธเธงเนเธฒเธ
                    เธเธเธเธงเนเธฒเธเธฐเธเธ” โ€เธขเธทเธเธขเธฑเธเธเธฒเธฃเธเธทเธเธเธฑเธ•เธฃโ€
                  </span>
                </div>
                <div className="wallet-confirm-rows">
                  <div>
                    <span>เธชเธกเธฒเธเธดเธ</span>
                    <b>{returnResult?.memberName} ยท {returnResult?.memberNumber}</b>
                  </div>
                  <div>
                    <span>เธขเธญเธ”เธเธเน€เธซเธฅเธทเธญเธเนเธญเธเธเธทเธเธเธฑเธ•เธฃ</span>
                    <b>{returnResult?.balanceBefore.toFixed(2)} เธเธฒเธ—</b>
                  </div>
                  <div>
                    <span>เธเธณเธเธงเธเน€เธเธดเธเธ—เธตเนเธเธทเธ</span>
                    <b>{returnResult?.amount.toFixed(2)} เธเธฒเธ—</b>
                  </div>
                  <div>
                    <span>เธขเธญเธ”เธเธเน€เธซเธฅเธทเธญเธซเธฅเธฑเธเธเธทเธเธเธฑเธ•เธฃ</span>
                    <b>0.00 เธเธฒเธ—</b>
                  </div>
                  {returnNote.trim() && (
                    <div>
                      <span>เธซเธกเธฒเธขเน€เธซเธ•เธธ</span>
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
                    <RotateCcw size={15} /> เธขเนเธญเธเธเธฅเธฑเธเนเธเนเนเธ
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={busy || confirm}
                    onClick={submitReturn}
                  >
                    {busy ? "เธเธณเธฅเธฑเธเธเธฑเธเธ—เธถเธโ€ฆ" : confirm ? "เธขเธทเธเธขเธฑเธ" : "เธ•เธฃเธงเธเธชเธญเธ"}
                  </button>
                </div>
              </>
            )}
            <>
        {member.cardNumber && <div className="modal-actions">{!member.accountClosed && <button type="button" className={choice === "close" ? "primary-button" : "outline-button"} onClick={() => setChoice("close")}>{labels.close}</button>}<button type="button" className={action === "return" ? "primary-button" : "outline-button"} onClick={() => setChoice("return")}>{labels.return}</button>{!member.accountClosed && <button type="button" className={choice === "replace" ? "primary-button" : "outline-button"} onClick={() => setChoice("replace")}>{labels.replace}</button>}</div>}
        <h3>{action === "close" ? "เธเธทเธเน€เธเธดเธเธ—เธฑเนเธเธซเธกเธ” เนเธ•เนเธขเธฑเธเนเธกเนเนเธ”เนเธฃเธฑเธเธเธฑเธ•เธฃเธเธทเธ" : action === "return" ? "เธฃเธฑเธเธเธฑเธ•เธฃเธเธทเธเนเธฅเธฐเธเธทเธเน€เธเธดเธเธเธเน€เธซเธฅเธทเธญ" : action === "replace" ? "เธฃเธฑเธเธเธฑเธ•เธฃเน€เธ”เธดเธกเนเธฅเนเธงเน€เธเธฅเธตเนเธขเธเน€เธเนเธเธเธฑเธ•เธฃเนเธเนเธซเธกเน" : "เธชเธกเธฒเธเธดเธเธขเธฑเธเนเธกเนเธกเธตเธเธฑเธ•เธฃ"}</h3>
        {action === "assign" && <p>เธเนเธฒเธขเธเธฑเธ•เธฃเธงเนเธฒเธเนเธซเนเธชเธกเธฒเธเธดเธเธเนเธญเธเน€เธ•เธดเธกเน€เธเธดเธ เนเธ”เธขเนเธเนเน€เธฅเธเธชเธกเธฒเธเธดเธเน€เธ”เธดเธก</p>}
        {action === "replace" && <p>เธขเธญเธ”เน€เธเธดเธเนเธฅเธฐเน€เธฅเธเธชเธกเธฒเธเธดเธเธเธฐเธเธเน€เธ”เธดเธก เธเธฑเธ•เธฃเนเธเน€เธเนเธฒเธเธฐเธเธฅเธฑเธเน€เธเนเธเธเธฑเธ•เธฃเธงเนเธฒเธเน€เธกเธทเนเธญเธขเธทเธเธขเธฑเธเธฃเธฒเธขเธเธฒเธฃ</p>}
        {assigning ? <label>เธชเนเธเธเธซเธฃเธทเธญเธเธฃเธญเธเธฃเธซเธฑเธชเธเธฑเธ•เธฃเนเธซเธกเน<input type="text" autoComplete="off" maxLength={30} value={code} onChange={e => setCode(e.target.value)} /></label> : <><div className="receipt-line"><span>เน€เธเธดเธเธ—เธตเนเธ•เนเธญเธเธเนเธฒเธขเธเธทเธ</span><b>{member.balance.toFixed(2)} เธเธฒเธ—</b></div><div className="receipt-line"><span>เธขเธญเธ”เธซเธฅเธฑเธเธ—เธณเธฃเธฒเธขเธเธฒเธฃ</span><b>0.00 เธเธฒเธ—</b></div><p>{action === "close" ? "เนเธเนเน€เธกเธทเนเธญเธ•เนเธญเธเธเธทเธเน€เธเธดเธเนเธซเนเธชเธกเธฒเธเธดเธเธเนเธญเธ เนเธ•เนเธขเธฑเธเนเธกเนเนเธ”เนเธฃเธฑเธเธเธฑเธ•เธฃเธเธฃเธดเธ เธเธฑเธ•เธฃเธเธฐเธขเธฑเธเธเนเธฒเธขเนเธซเนเธเธเธญเธทเนเธเนเธกเนเนเธ”เน เนเธฅเธฐเธเธฑเธเธเธตเธฃเธญเธเธเธตเนเธเธฐเธเธทเนเธญเธซเธฃเธทเธญเน€เธ•เธดเธกเน€เธเธดเธเนเธกเนเนเธ”เนเธเธเธเธงเนเธฒเธเธฐเธฃเธฑเธเธเธฑเธ•เธฃเธเธทเธ" : "เนเธเนเน€เธกเธทเนเธญเนเธ”เนเธฃเธฑเธเธเธฑเธ•เธฃเธเธฃเธดเธเนเธฅเนเธง เธเธฑเธ•เธฃเธเธฐเธเธฅเธฑเธเน€เธเนเธเธเธฑเธ•เธฃเธงเนเธฒเธเธเธฃเนเธญเธกเธเนเธฒเธขเนเธซเนเธชเธกเธฒเธเธดเธเธเธเธญเธทเนเธ เธซเธฒเธเน€เธเธขเธเธทเธเน€เธเธดเธเนเธฅเนเธงเธฃเธฐเธเธเธเธฐเนเธกเนเธเธทเธเธเนเธณ"}</p></>}
        {!member.cardNumber && action === "return" && <p>เธชเธกเธฒเธเธดเธเนเธกเนเธกเธตเธเธฑเธ•เธฃเธ—เธตเนเธ•เนเธญเธเธเธทเธ</p>}
        {member.balance < 0 && action === "return" && <p role="alert">เธกเธตเธขเธญเธ”เธเนเธฒเธ เธ•เนเธญเธเธเธฑเธ”เธเธฒเธฃเธขเธญเธ”เธเนเธญเธเธเธทเธเธเธฑเธ•เธฃ</p>}
        {member.cardNumber && !history.isLoading && !session && <p className="notice-bar error" role="alert">เนเธกเนเธเธเธฃเธญเธเนเธเนเธเธฒเธเธ—เธตเนเน€เธเธดเธ”เธญเธขเธนเน เธเธฃเธธเธ“เธฒเธ•เธฃเธงเธเธชเธญเธเธชเธ–เธฒเธเธฐเธเธฑเธ•เธฃเนเธเธเธฅเธฑเธเธเธฑเธ•เธฃเธเนเธญเธเธ—เธณเธฃเธฒเธขเธเธฒเธฃ</p>}
            </>
            {action === "return" && returnStep === "success" && (
              <>
                <div className="wallet-success">
                  <div className="receipt-paper wallet-slip" id="member-card-return-slip">
                    <div className="receipt-success slip">
                      <span>เธเธทเธเธเธฑเธ•เธฃเน€เธเธดเธเธชเธ”เธชเธณเน€เธฃเนเธ</span>
                      <small>เธเธฑเธเธ—เธถเธเธฅเธเธฃเธฒเธขเธเธฒเธฃเธเธธเธฃเธเธฃเธฃเธกเธเธญเธเธชเธกเธฒเธเธดเธเนเธฅเนเธง</small>
                    </div>
                    <div className="receipt-divider" />
                    <div className="receipt-meta">
                      <span>เนเธเธขเธทเธเธขเธฑเธเธเธฒเธฃเธเธทเธเธเธฑเธ•เธฃเน€เธเธดเธเธชเธ”</span>
                      <b>
                        {returnResult?.doneAt
                          ? `${returnResult.doneAt.toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric" })} ยท ${returnResult.doneAt.toLocaleTimeString("th-TH", { hourCycle: "h23", hour: "2-digit", minute: "2-digit" })} เธ.`
                          : ""}
                      </b>
                    </div>
                    <div className="receipt-customer">
                      <span>เธชเธกเธฒเธเธดเธ</span>
                      <b>{returnResult?.memberName} ยท {returnResult?.memberNumber}</b>
                    </div>
                    <div className="receipt-line">
                      <span>เธขเธญเธ”เธเธเน€เธซเธฅเธทเธญเธเนเธญเธเธเธทเธเธเธฑเธ•เธฃ</span>
                      <b>{returnResult?.balanceBefore.toFixed(2)} เธเธฒเธ—</b>
                    </div>
                    <div className="receipt-line">
                      <span>เธเธณเธเธงเธเน€เธเธดเธเธ—เธตเนเธเธทเธ</span>
                      <b>{returnResult?.amount.toFixed(2)} เธเธฒเธ—</b>
                    </div>
                    <div className="receipt-total">
                      <span>เธขเธญเธ”เธเธเน€เธซเธฅเธทเธญเธซเธฅเธฑเธเธเธทเธเธเธฑเธ•เธฃ</span>
                      <b>0.00 เธเธฒเธ—</b>
                    </div>
                    <div className="receipt-payment">
                      <span>เธเธนเนเธ—เธณเธฃเธฒเธขเธเธฒเธฃ</span>
                      <b>เน€เธเนเธฒเธซเธเนเธฒเธ—เธตเนเธฃเนเธฒเธเธเนเธฒ</b>
                    </div>
                    <div className="receipt-thanks">
                      เธเธฑเธเธ—เธถเธเน€เธเนเธฒเธฃเธฐเธเธเน€เธฃเธตเธขเธเธฃเนเธญเธข
                      <br />
                      <small>เธเนเธญเธกเธนเธฅเธ–เธนเธเธเธฑเธเธ—เธถเธเนเธเธเธฃเธฐเธงเธฑเธ•เธดเธฃเธฐเธเธ เนเธฅเนเธง</small>
                    </div>
                  </div>
                  <div className="wallet-success-actions">
                    <button
                      className="outline-button"
                      disabled={Boolean(slipBusy)}
                      onClick={() => void downloadReturnSlip("pdf")}
                    >
                      <Download size={16} />
                      {slipBusy === "pdf" ? "เธเธณเธฅเธฑเธเธชเธฃเนเธฒเธ PDF..." : "เธ”เธฒเธงเธเนเนเธซเธฅเธ” PDF"}
                    </button>
                    <button
                      className="outline-button"
                      disabled={Boolean(slipBusy)}
                      onClick={() => void downloadReturnSlip("image")}
                    >
                      <FileImage size={16} />
                      {slipBusy === "image" ? "เธเธณเธฅเธฑเธเธชเธฃเนเธฒเธเธฃเธนเธ..." : "เธ”เธฒเธงเธเนเนเธซเธฅเธ”เธฃเธนเธเธ เธฒเธ"}
                    </button>
                    <button
                      className="outline-button"
                      onClick={() => setPrintPreview(true)}
                    >
                      <Printer size={16} /> เธเธดเธกเธเนเธชเธฅเธดเธ
                    </button>
                    <button
                      className="primary-button"
                      onClick={closeReturnSlip}
                    >
                      <Check size={16} /> เน€เธชเธฃเนเธเธชเธดเนเธ ยท เธเธดเธ”เธซเธเนเธฒเธ•เนเธฒเธ
                    </button>
                  </div>
                </div>
              </>
            )}
            {action !== "return" && confirm && (
  <p>
    {action === "assign"
      ? `เธเนเธฒเธขเธเธฑเธ•เธฃ ${code.trim()} เนเธซเนเธชเธกเธฒเธเธดเธ ${memberNumber}`
      : action === "replace"
        ? `เน€เธเธฅเธตเนเธขเธเธเธฒเธเธเธฑเธ•เธฃ ${member.cardNumber} เน€เธเนเธ ${code.trim()} ยท เธขเธญเธ”เธเธเน€เธซเธฅเธทเธญ ${member.balance.toFixed(2)} เธเธฒเธ—เน€เธ—เนเธฒเน€เธ”เธดเธก`
        : action === "close"
          ? `เธขเธทเธเธขเธฑเธเธงเนเธฒเธเนเธฒเธขเน€เธเธดเธเธเธทเธ ${member.balance.toFixed(2)} เธเธฒเธ—เนเธฅเนเธง เธเธฑเธ•เธฃเธขเธฑเธเนเธกเนเนเธ”เนเธฃเธฑเธเธเธทเธ เนเธฅเธฐเธเธฑเธเธเธตเธฃเธญเธเธเธตเนเธเธฐเธเธดเธ”เธเธฒเธฃเนเธเนเธเธฒเธ`
          : `เธขเธทเธเธขเธฑเธเธงเนเธฒเธฃเธฑเธเธเธฑเธ•เธฃเธเธทเธเนเธฅเนเธง${member.balance.toFixed(2) !== "0.00" ? ` เนเธฅเธฐเธเนเธฒเธขเน€เธเธดเธเธเธทเธ ${member.balance.toFixed(2)} เธเธฒเธ—เนเธฅเนเธง` : ""} ยท เธเธฑเธ•เธฃเธเธฐเน€เธเนเธเธงเนเธฒเธ`}
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
    {confirm ? "เธขเนเธญเธเธเธฅเธฑเธ" : "เธขเธเน€เธฅเธดเธ"}
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
    {busy ? "เธเธณเธฅเธฑเธเธเธฑเธเธ—เธถเธโ€ฆ" : confirm ? "เธขเธทเธเธขเธฑเธ" : "เธ•เธฃเธงเธเธชเธญเธ"}
  </button>
</div>
</section>
{printPreview && (
  <PrintPreviewModal
    targetId="member-card-return-slip"
    title="สลิปคืนบัตรสมาชิก"
    onClose={() => setPrintPreview(false)}
  />
)}
</div>
);
}


