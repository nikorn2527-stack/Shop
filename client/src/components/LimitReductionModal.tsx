import { useState } from "react";
import { ActionButton } from "@/components/ActionButton";
import { Check, CircleHelp, ShieldCheck, TrendingDown, X } from "@/lib/icons";
import { trpc } from "@/lib/trpc";
import type { MemberLite, Role } from "@/pages/pageData";
import { memberFullName, money, roleThaiLabel } from "@/pages/pageData";
export function LimitReductionModal({
  member,
  role,
  userName,
  onClose,
  onSuccess,
}: {
  member: MemberLite;
  role: Role;
  userName: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const utils = trpc.useUtils();
  const detailQuery = trpc.member.detail.useQuery({
    memberNumber: member.memberNumber,
  });
  const profile = detailQuery.data?.member ?? member;
  const displayName = memberFullName(profile);
  const actor = userName || "ผู้ใช้ระบบ";
  const actorRole = roleThaiLabel(role);
  const [limitStep, setLimitStep] = useState<"form" | "confirm">("form");
  const [limitValue, setLimitValue] = useState("");
  const [limitReason, setLimitReason] = useState("");
  const [error, setError] = useState("");
  const setLimitOpen = (_open: boolean) => {
    if (!limitRequestMutation.isPending) onClose();
  };
  const limitRequestMutation = trpc.member.requestLimitReduction.useMutation({
    onSuccess: () => {
      onClose();
      setLimitStep("form");
      setLimitValue("");
      setLimitReason("");
      setError("");
      onSuccess("ส่งคำขอลดวงเงินเรียบร้อย · รอผู้บริหารพิจารณา");
      void utils.member.list.invalidate();
      void utils.member.detail.invalidate();
      void utils.reports.memberTransactions.invalidate();
    },
    onError: mutationError => setError(mutationError.message),
  });

  const submitLimitRequest = () => {
    const value = Number(limitValue);
    if (
      limitValue.trim() === "" ||
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value <= 0 ||
      value > 1_000_000
    ) {
      setError(
        "วงเงินใหม่ต้องเป็นตัวเลขจำนวนเต็มมากกว่า 0 และไม่เกิน 1,000,000"
      );
      return;
    }
    if (profile.creditLimit != null && value >= profile.creditLimit) {
      setError(
        `วงเงินใหม่ต้องน้อยกว่าวงเงินปัจจุบัน (${money(profile.creditLimit)})`
      );
      return;
    }
    setError("");
    setLimitStep("confirm");
  };
  const confirmLimitRequest = () => {
    const value = Number(limitValue);
    if (!Number.isInteger(value) || value <= 0) {
      setLimitStep("form");
      return;
    }
    limitRequestMutation.mutate({
      memberNumber: member.memberNumber,
      requestedLimit: value,
      reason: limitReason.trim() || undefined,
      actor,
      actorRole,
    });
  };
  return (
    <>
      {" "}
      {
        <div className="modal-backdrop" onClick={() => setLimitOpen(false)}>
          <div
            className="form-modal limit-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="ยื่นคำขอลดวงเงินซื้อสินค้าต่อวัน"
            onClick={event => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">ขอลดวงเงิน</span>
                <h2>ขอลดวงเงินซื้อสินค้าต่อวัน</h2>
                <p>
                  {displayName} · {profile.memberNumber}
                </p>
              </div>
              <button
                className="icon-button"
                onClick={() => setLimitOpen(false)}
                aria-label="ปิดหน้าต่าง"
              >
                <X size={17} />
              </button>
            </div>
            <div className="member-number-preview">
              <span>
                <TrendingDown size={16} /> วงเงินซื้อ/วัน ปัจจุบัน
              </span>
              <b>
                {profile.creditLimit != null
                  ? money(profile.creditLimit)
                  : "ไม่จำกัด"}
              </b>
            </div>
            {limitStep === "form" ? (
              <>
                <div className="form-grid compact-form">
                  <label>
                    วงเงินใหม่ (฿) *
                    <input
                      autoFocus
                      type="number"
                      inputMode="numeric"
                      min="1"
                      step="1"
                      value={limitValue}
                      onChange={event => setLimitValue(event.target.value)}
                      placeholder={
                        profile.creditLimit != null
                          ? "ต่ำกว่าวงเงินปัจจุบัน"
                          : "0"
                      }
                      onKeyDown={event => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          submitLimitRequest();
                        }
                      }}
                    />
                  </label>
                  <label>
                    เหตุผล (ไม่บังคับ)
                    <input
                      value={limitReason}
                      maxLength={500}
                      onChange={event => setLimitReason(event.target.value)}
                      placeholder="เช่น ขอควบคุมการใช้จ่ายของตนเอง"
                      onKeyDown={event => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          submitLimitRequest();
                        }
                      }}
                    />
                  </label>
                </div>
                <div className="initial-balance-note">
                  <CircleHelp size={15} />{" "}
                  {profile.creditLimit != null
                    ? "วงเงินใหม่ต้องน้อยกว่าวงเงินปัจจุบัน · คำขอจะเข้าสถานะรอพิจารณา — วงเงินเปลี่ยนเมื่อผู้บริหารอนุมัติ"
                    : "สมาชิกนี้ยังไม่จำกัดวงเงิน — ระบุวงเงินที่ต้องการ · คำขอจะเข้าสถานะรอพิจารณา ผู้บริหารพิจารณาที่รายงาน → ประวัติธุรกรรม"}
                </div>
                {error && (
                  <div className="notice-bar error">
                    <ShieldCheck size={16} /> {error}
                    <button onClick={() => setError("")}>
                      <X size={14} />
                    </button>
                  </div>
                )}
                <div className="modal-actions">
                  <button
                    className="outline-button"
                    onClick={() => setLimitOpen(false)}
                  >
                    ยกเลิก
                  </button>
                  <button
                    className="primary-button"
                    onClick={submitLimitRequest}
                  >
                    <Check size={16} /> ต่อไป: ตรวจสอบคำขอ
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="wallet-confirm-warning">
                  <ShieldCheck size={16} />
                  <span>
                    คำขอจะยังไม่ถูกส่งจนกว่าจะกด “ส่งคำขอ” —
                    วงเงินของสมาชิกยังไม่เปลี่ยนจนกว่าผู้บริหารจะอนุมัติ
                  </span>
                </div>
                <div className="wallet-confirm-rows">
                  <div>
                    <span>สมาชิก</span>
                    <b>
                      {displayName} · {profile.memberNumber}
                    </b>
                  </div>
                  <div>
                    <span>วงเงินปัจจุบัน</span>
                    <b>
                      {profile.creditLimit != null
                        ? money(profile.creditLimit)
                        : "ไม่จำกัด"}
                    </b>
                  </div>
                  <div>
                    <span>วงเงินใหม่ที่ขอ</span>
                    <b className="purple-text">
                      {money(Number(limitValue) || 0)}
                    </b>
                  </div>
                  {limitReason.trim() && (
                    <div>
                      <span>เหตุผล</span>
                      <b>{limitReason.trim()}</b>
                    </div>
                  )}
                  <div>
                    <span>ผู้ยื่นคำขอ</span>
                    <b>
                      {actor} · {actorRole}
                    </b>
                  </div>
                </div>
                {error && (
                  <div className="notice-bar error">
                    <ShieldCheck size={16} /> {error}
                    <button onClick={() => setError("")}>
                      <X size={14} />
                    </button>
                  </div>
                )}
                <div className="modal-actions">
                  <button
                    className="outline-button"
                    onClick={() => setLimitStep("form")}
                  >
                    ย้อนกลับ
                  </button>
                  <ActionButton
                    disabledReason="กรอกข้อมูลให้ครบ"
                    busy={limitRequestMutation.isPending}
                    className="primary-button"
                    disabled={limitRequestMutation.isPending}
                    onClick={confirmLimitRequest}
                  >
                    <Check size={16} />{" "}
                    {limitRequestMutation.isPending
                      ? "กำลังส่งคำขอ…"
                      : "ส่งคำขอ"}
                  </ActionButton>
                </div>
              </>
            )}
          </div>
        </div>
      }
    </>
  );
}
