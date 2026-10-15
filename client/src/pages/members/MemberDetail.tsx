import { ActionButton } from "@/components/ActionButton";
import { useState } from "react";
import { MemberCardActionsModal } from "@/components/MemberCardActionsModal";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CalendarDays,
  Camera,
  Check,
  CircleHelp,
  Download,
  FileImage,
  FileText,
  IdCard,
  ImagePlus,
  LockKeyhole,
  Printer,
  ReceiptText,
  RotateCcw,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Star,
  Trash2,
  WalletCards,
  X,
} from "@/lib/icons";
import { blocker } from "@/components/BlockerAlert";
import { CameraCaptureModal } from "@/components/CameraCaptureModal";
import { MemberCardModal } from "@/components/MemberCardModal";
import { PrintPreviewModal } from "@/components/PrintPreviewModal";
import { SlipViewButton } from "@/components/SlipViewModal";
import { StatementModal } from "@/components/StatementModal";
import { trpc } from "@/lib/trpc";
import { downloadSlipFile } from "@/exportUtils";
import {
  ConfirmDialog,
  SectionHeader,
  StatusPill,
  formEnterNav,
} from "../PagePrimitives";
import {
  PRENAME_OPTIONS,
  compressImageToDataUrl,
  isAdminRole,
  memberFullName,
  money,
  roleThaiLabel,
  type MemberLite,
  type Role,
} from "../pageData";
import {
  MEMBER_STATUS_META,
  WALLET_TX_META,
  formatHistoryDate,
  formatLastActivity,
  formatThaiDate,
  getErrorMessage,
  isSameMonth,
  parseStoreDate,
} from "../viewFormat";

/**
 * MemberDetail — single-member view: profile, stats, transaction history,
 * wallet modals (deposit/withdrawal/refund) with slip print, edit modal,
 * card print, and statement export.
 *
 * Extracted from Home.tsx (V2-C2) — pure move, no business-logic change.
 *
 * ROUND 77 (user) — wallet modal becomes a slip after success with the same
 * download/print buttons as receipts, instead of closing immediately.
 * Round 31 — deposit/withdrawal here also use a 2-step flow (form → confirm).
 * ROUND 38 (ข้อ 37) — member photo upload from camera in the edit dialog.
 */
export function MemberDetail({
  member,
  onBack,
  role,
  userName,
  onDeleted,
}: {
  member: MemberLite;
  onBack: () => void;
  role: Role;
  userName: string;
  onDeleted: (message: string) => void;
}) {
  const utils = trpc.useUtils();
  const detailQuery = trpc.member.detail.useQuery({
    memberNumber: member.memberNumber,
  });
  // Enhancement panel — real spending stats from sales (hidden silently on error).
  const statsQuery = trpc.member.stats.useQuery(
    { memberNumber: member.memberNumber },
    { enabled: Boolean(member.memberNumber) }
  );
  const [tab, setTab] = useState<
    | "ทั้งหมด"
    | "ซื้อสินค้า"
    | "เติมเงิน"
    | "ถอนเงิน"
    | "เปิดใช้บัตร"
    | "คืนบัตรเงินสด"
  >("ทั้งหมด");
  const [confirmStatus, setConfirmStatus] = useState(false);
  const [walletOpen, setWalletOpen] = useState<
    "deposit" | "withdrawal" | "refund" | null
  >(null);
  const [walletAmount, setWalletAmount] = useState("");
  const [walletNote, setWalletNote] = useState("");
  // ROUND 77 (user) — สลิปเติม/ถอน/คืนบัตรที่หน้าสมาชิก: หลังบันทึกโมดัลเปลี่ยนเป็นสลิป
  // พร้อมปุ่มเหมือนใบเสร็จ (ดาวน์โหลด PDF / ดาวน์โหลดรูป / พิมพ์ผ่านพรีวิว) แทนการปิดทันที
  const [walletResult, setWalletResult] = useState<{
    memberNumber: string;
    memberName: string;
    type: "deposit" | "withdrawal" | "refund";
    amount: number;
    balanceBefore: number;
    balanceAfter: number;
    detail: string;
  } | null>(null);
  const [walletDoneAt, setWalletDoneAt] = useState<Date | null>(null);
  const [walletSlipBusy, setWalletSlipBusy] = useState("");
  const [walletPrintPreview, setWalletPrintPreview] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<{
    prename: string;
    firstName: string;
    lastName: string;
    type: string;
    phone: string;
    idCard: string;
    gender: "ชาย" | "หญิง" | "ไม่ระบุ";
    photoUrl: string;
    cardNumber: string;
    patientCode: string;
  } | null>(null);
  // ROUND 38 (ข้อ 37) — ถ่ายรูปสมาชิกจากกล้อง ในโมดัลแก้ไขข้อมูล
  const [editCameraOpen, setEditCameraOpen] = useState(false);
  // Round 31 — เติม/ถอนจากหน้ารายละเอียดก็เป็น 2 ขั้นเหมือน POS: กรอก → ยืนยัน → บันทึก
  const [walletConfirm, setWalletConfirm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [cardAction, setCardAction] = useState<"return" | null>(null);
  const [statementOpen, setStatementOpen] = useState(false);
  const actor = userName || "ผู้ใช้ระบบ";
  const actorRole = roleThaiLabel(role);
  const profile = detailQuery.data?.member ?? member;
  const transactions = detailQuery.data?.transactions ?? [];
  const monthPurchase = transactions
    .filter(
      tx =>
        tx.type === "purchase" &&
        isSameMonth(parseStoreDate(tx.createdAt), new Date())
    )
    .reduce((sum, tx) => sum - tx.amount, 0);
  const totalDeposited = transactions
    .filter(tx => tx.type === "deposit" || tx.type === "activation")
    .reduce((sum, tx) => sum + tx.amount, 0);
  const lastActivity = formatLastActivity(
    transactions[0]?.createdAt ?? member.lastTransactionAt
  );
  const displayName = memberFullName(profile);
  const statusMeta = MEMBER_STATUS_META[profile.status];
  const cardReady = Boolean(profile.cardNumber && profile.cardUsable);
  const filtered = transactions.filter(
    tx => tab === "ทั้งหมด" || WALLET_TX_META[tx.type]?.label === tab
  );
  const walletPreviewAmount = Number(walletAmount) || 0;
  // FIX-4 issue 3 — round to 2 decimals so float noise (e.g. -0.0000001)
  // doesn't disable the "ยืนยันการทำรายการ" button on a refund that zeros
  // the balance. Mirrors server round2() in sqliteStore.walletTx.
  const round2 = (value: number) =>
    Math.round((value + Number.EPSILON) * 100) / 100;
  const balanceAfterWallet = round2(
    walletOpen === "deposit"
      ? profile.balance + walletPreviewAmount
      : profile.balance - walletPreviewAmount
  );
  // ROUND 65 — ป้ายประเภทการเติม/ถอน/คืนบัตร ใช้ร่วมกันทั้งโมดัล
  const walletModeLabel =
    walletOpen === "deposit"
      ? "เติมเงิน"
      : walletOpen === "refund"
        ? "คืนบัตรเงินสด"
        : "ถอนเงิน";
  const walletMutation = trpc.member.wallet.useMutation({
    onSuccess: result => {
      // ROUND 77 — ไม่ปิดโมดัลทันที: เปลี่ยนเป็นหน้าสลิกให้พิมพ์/ดาวน์โหลดก่อน
      setWalletResult(result);
      setWalletDoneAt(new Date());
      setWalletConfirm(false);
      setWalletAmount("");
      setWalletNote("");
      setError("");
      setNotice(
        `${result.type === "deposit" ? "เติมเงิน" : result.type === "refund" ? "คืนบัตรเงินสด" : "ถอนเงิน"} ${result.memberName} (${result.memberNumber}) สำเร็จ · ยอดคงเหลือ ${money(result.balanceAfter)}`
      );
      void utils.member.list.invalidate();
      void utils.member.detail.invalidate();
    },
    // ROUND 78 — เติม/ถอน/คืนบัตรไม่สำเร็จ (เช่น "ยอดเงินคงเหลือไม่พอ") — เด้งกลางจอ
    // ให้ชัด (notice-bar ในโมดัลยังอยู่เป็นหลักฐานหลังปิดกล่อง)
    onError: mutationError => {
      setError(getErrorMessage(mutationError));
      blocker.error("บันทึกรายการไม่สำเร็จ", getErrorMessage(mutationError), {
        hint: "รายการนี้ยังไม่ถูกบันทึก — แก้ไขจำนวนแล้วยืนยันใหม่ได้เลย",
      });
    },
  });
  // ROUND 77 — ปิดสลิป (และล้างผลลัพธ์) กลับไปหน้ารายละเอียดสมาชิก
  const closeWalletSlip = () => {
    setWalletOpen(null);
    setWalletResult(null);
    setWalletDoneAt(null);
    setWalletSlipBusy("");
    setWalletPrintPreview(false);
  };
  const downloadWalletSlip = async (format: "pdf" | "image") => {
    if (!walletResult) return;
    setWalletSlipBusy(format);
    try {
      const stamp = walletDoneAt
        ? `${String(walletDoneAt.getFullYear() + 543).slice(2)}${String(walletDoneAt.getMonth() + 1).padStart(2, "0")}${String(walletDoneAt.getDate()).padStart(2, "0")}-${String(walletDoneAt.getHours()).padStart(2, "0")}${String(walletDoneAt.getMinutes()).padStart(2, "0")}`
        : String(Date.now());
      const kindLabel =
        walletResult.type === "deposit"
          ? "เติมเงิน"
          : walletResult.type === "refund"
            ? "คืนบัตรเงินสด"
            : "ถอนเงิน";
      await downloadSlipFile(
        "member-wallet-slip",
        `สลิป${kindLabel}-${walletResult.memberNumber}-${stamp}`,
        format
      );
    } finally {
      setWalletSlipBusy("");
    }
  };
  const statusMutation = trpc.member.setStatus.useMutation({
    onSuccess: result => {
      const member = result?.member;
      if (!member) return;
      setNotice(
        `${member.status === "suspended" ? "ระงับการใช้งาน" : "คืนสถานะการใช้งาน"} ${memberFullName(member)} แล้ว`
      );
      void utils.member.list.invalidate();
      void utils.member.detail.invalidate();
    },
    onError: mutationError => setError(getErrorMessage(mutationError)),
  });
  const releaseCardMutation = trpc.card.release.useMutation({
    onSuccess: () => {
      setNotice("รับคืนบัตรแล้ว · บัตรพร้อมใช้กับสมาชิกใหม่");
      void utils.member.list.invalidate();
      void utils.member.detail.invalidate();
      void utils.card.list.invalidate();
      void utils.card.history.invalidate();
    },
    onError: e => setError(getErrorMessage(e)),
  });
  const updateMutation = trpc.member.update.useMutation({
    onSuccess: result => {
      setEditOpen(false);
      setError("");
      setNotice(
        `บันทึกการแก้ไขข้อมูลสมาชิกเรียบร้อยแล้ว · ${memberFullName(result)}`
      );
      void utils.member.detail.invalidate({
        memberNumber: member.memberNumber,
      });
      void utils.member.list.invalidate();
    },
    onError: mutationError => setError(getErrorMessage(mutationError)),
  });
  const deleteMutation = trpc.member.delete.useMutation({
    onSuccess: result => {
      void utils.member.list.invalidate();
      void utils.dashboard.stats.invalidate();
      onDeleted(
        `ลบสมาชิก ${result.memberName} (${result.memberNumber}) ออกจากระบบแล้ว`
      );
    },
    onError: mutationError => setError(getErrorMessage(mutationError)),
  });
  const openEdit = () => {
    const detail = detailQuery.data?.member;
    setEditForm({
      prename: detail?.prename ?? profile.prename ?? "",
      firstName: detail?.firstName ?? profile.firstName,
      lastName: detail?.lastName ?? profile.lastName,
      type: detail?.type ?? profile.type,
      phone: detail?.phone ?? "",
      idCard: detail?.idCard ?? "",
      gender:
        detail?.gender === "ชาย"
          ? "ชาย"
          : detail?.gender === "หญิง"
            ? "หญิง"
            : "ไม่ระบุ",
      photoUrl: detail?.photoUrl ?? "",
      cardNumber: detail?.cardNumber ?? profile.cardNumber ?? "",
      patientCode: detail?.patientCode ?? profile.patientCode ?? "",
    });
    setError("");
    setEditOpen(true);
  };
  // Round 31 — member photo upload in the edit dialog (shrunk to a data-URL).
  const onEditPhotoPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      setError("รองรับเฉพาะไฟล์รูป PNG JPG WEBP");
      return;
    }
    if (file.size > 8_000_000) {
      setError("ไฟล์รูปใหญ่เกิน 8MB — เลือกไฟล์เล็กลง");
      return;
    }
    compressImageToDataUrl(file, 480, 0.72)
      .then(dataUrl => {
        setEditForm(current =>
          current ? { ...current, photoUrl: dataUrl } : current
        );
        setError("");
      })
      .catch(() => setError("อ่านไฟล์รูปไม่สำเร็จ"));
  };
  const submitEdit = () => {
    if (!editForm) return;
    if (!editForm.firstName.trim() || !editForm.lastName.trim()) {
      setError("กรุณาระบุชื่อและนามสกุลสมาชิก");
      return;
    }
    setError("");
    updateMutation.mutate({
      memberNumber: member.memberNumber,
      prename: editForm.prename.trim() || null,
      firstName: editForm.firstName.trim(),
      lastName: editForm.lastName.trim(),
      idCard: editForm.idCard.trim() || null,
      phone: editForm.phone.trim() || null,
      type: editForm.type,
      gender: editForm.gender,
      photoUrl: editForm.photoUrl || null,
      cardNumber: editForm.cardNumber.trim() || null,
      actor,
      actorRole,
    });
  };
  const submitWallet = () => {
    if (!walletOpen) return;
    const amount = Number(walletAmount);
    if (!(amount > 0)) {
      setError("กรุณาระบุจำนวนเงินมากกว่า 0");
      return;
    }
    // FIX-4 issue 3 — refund pre-fills walletAmount with String(profile.balance)
    // so amount should equal profile.balance. Allow a 0.01 ฿ epsilon for any
    // float-round-trip noise (String(99.99) → 99.99 → matches server's
    // round2(stored-as-float 99.99)). Genuine "over-draft" stays blocked.
    const epsilon = 0.01;
    if (walletOpen !== "deposit" && amount - profile.balance > epsilon) {
      setError(
        `ยอดเงินคงเหลือไม่พอ · ${walletOpen === "refund" ? "คืนบัตร" : "ถอน"} ${money(amount)} คงเหลือ ${money(profile.balance)}`
      );
      return;
    }
    setError("");
    setWalletConfirm(true);
  };
  const confirmWallet = () => {
    if (!walletOpen || !(Number(walletAmount) > 0)) {
      setWalletConfirm(false);
      return;
    }
    walletMutation.mutate({
      clientRequestId: crypto.randomUUID(),
      memberNumber: member.memberNumber,
      type: walletOpen,
      amount: Number(walletAmount),
      note: walletNote.trim() || undefined,
      actor,
      actorRole,
    });
  };
  return (
    <>
      <SectionHeader
        eyebrow="สมาชิกและบัญชี / รายละเอียด"
        title={`รายละเอียด ${displayName}`}
        description="ตรวจสอบประวัติการซื้อสินค้า เติมเงิน และถอนเงินของสมาชิกแต่ละราย"
        action={
          <button className="outline-button" onClick={onBack}>
            <ArrowDownToLine size={16} style={{ transform: "rotate(90deg)" }} />{" "}
            กลับไปรายการสมาชิก
          </button>
        }
      />
      <div className="member-detail-head">
        <div className="member-detail-profile">
          <span className="member-detail-avatar">
            {profile.firstName.slice(0, 1)}
          </span>
          <div>
            <span className="eyebrow">
              {profile.type} · {profile.memberNumber}
            </span>
            <h2>{displayName}</h2>
            <p>
              บัตร <b className="cell-mono">{profile.cardNumber ?? "—"}</b> ·
              รหัสผู้ป่วย{" "}
              <b className="cell-mono">{profile.patientCode ?? "—"}</b> ·
              เปิดใช้ {formatThaiDate(profile.createdAt)}
              <br />
              สถานะ{" "}
              <StatusPill tone={statusMeta.tone}>
                {statusMeta.label}
              </StatusPill>{" "}
            </p>
          </div>
        </div>
        <div className="member-detail-actions">
          {cardAction && <MemberCardActionsModal memberNumber={member.memberNumber} initialAction="return" onClose={() => setCardAction(null)} onSuccess={() => { void detailQuery.refetch(); setNotice("รับบัตรคืนและคืนเงินคงเหลือเรียบร้อยแล้ว"); }} />}
          <button
            className="primary-button"
            disabled={profile.status !== "active" || !cardReady}
            title={!profile.cardNumber ? "กรุณาจ่ายบัตรก่อนเติมเงิน" : !cardReady ? "บัตรยังไม่พร้อมใช้งาน กรุณาตรวจสอบสถานะบัตร" : undefined}
            onClick={() => {
              setWalletOpen("deposit");
              setWalletConfirm(false);
              setWalletResult(null);
              setError("");
            }}
          >
            <ArrowDownToLine size={15} /> เติมเงิน
          </button>
          <button
            className="outline-button"
            disabled={profile.status !== "active" || !cardReady}
            title={!profile.cardNumber ? "กรุณาจ่ายบัตรก่อนถอนเงิน" : !cardReady ? "บัตรยังไม่พร้อมใช้งาน กรุณาตรวจสอบสถานะบัตร" : undefined}
            onClick={() => {
              setWalletOpen("withdrawal");
              setWalletConfirm(false);
              setWalletResult(null);
              setError("");
            }}
          >
            <ArrowUpFromLine size={15} /> ถอนเงิน
          </button>
          <button
            className="outline-button"
            disabled={profile.status !== "active" || !profile.cardNumber}
            onClick={() => setCardAction("return")}
            title={!profile.cardNumber ? "สมาชิกยังไม่มีบัตรที่ต้องคืน" : "รับบัตรคืน คืนยอดคงเหลือทั้งหมด และปิดรอบบัตร"}
          >
            <RotateCcw size={15} /> คืนบัตร
          </button>
          {profile.status === "active" ? (
            <button
              className="danger-outline-button"
              onClick={() => setConfirmStatus(true)}
            >
              <LockKeyhole size={15} /> ระงับการใช้งาน
            </button>
          ) : (
            <button
              className="outline-button"
              onClick={() => setConfirmStatus(true)}
            >
              <Check size={15} /> คืนสถานะ
            </button>
          )}
          <button className="outline-button" onClick={openEdit}>
            <Settings2 size={15} /> แก้ไขข้อมูลสมาชิก
          </button>
          <button
            className="outline-button"
            disabled={detailQuery.isLoading}
            onClick={() => setStatementOpen(true)}
          >
            <FileText size={15} /> ส่งออกรายงานธุรกรรม
          </button>
          <button className="outline-button" onClick={() => setCardOpen(true)}>
            <IdCard size={15} /> บัตรสมาชิก
          </button>
          {isAdminRole(role) && (
            <button
              className="danger-outline-button"
              onClick={() => {
                setConfirmDelete(true);
                setError("");
              }}
            >
              <Trash2 size={15} /> ลบสมาชิก
            </button>
          )}
        </div>
      </div>
      {error && !walletOpen && !editOpen && (
        <div className="notice-bar error" style={{ marginBottom: 14 }}>
          <ShieldCheck size={16} /> {error}
          <button onClick={() => setError("")}>
            <X size={14} />
          </button>
        </div>
      )}
      <div className="member-detail-stats">
        <div>
          <span className="stat-icon green">
            <WalletCards size={18} />
          </span>
          <div>
            <small>ยอดเงินคงเหลือ</small>
            <strong>{money(profile.balance)}</strong>
          </div>
        </div>
        <div>
          <span className="stat-icon blue">
            <ShoppingCart size={18} />
          </span>
          <div>
            <small>ยอดซื้อเดือนนี้</small>
            <strong>{money(monthPurchase)}</strong>
          </div>
        </div>
        <div>
          <span className="stat-icon purple">
            <ArrowDownToLine size={18} />
          </span>
          <div>
            <small>เติมเงินสะสม</small>
            <strong>{money(totalDeposited)}</strong>
          </div>
        </div>
        <div>
          <span className="stat-icon amber">
            <CalendarDays size={18} />
          </span>
          <div>
            <small>รายการล่าสุด</small>
            <strong>{lastActivity}</strong>
          </div>
        </div>
      </div>
      {statsQuery.isLoading ? (
        <div
          className="member-detail-stats member-purchase-stats"
          aria-busy="true"
        >
          {Array.from({ length: 4 }, (_, index) => (
            <div key={`stat-skeleton-${index}`}>
              <span className="skeleton-avatar" />
              <div className="member-stat-skeleton">
                <span className="skeleton-cell-n" />
                <span className="skeleton-cell-w" />
              </div>
            </div>
          ))}
        </div>
      ) : statsQuery.data ? (
        <div className="member-detail-stats member-purchase-stats">
          <div>
            <span className="stat-icon blue">
              <ReceiptText size={18} />
            </span>
            <div>
              <small>ยอดซื้อสะสม</small>
              <strong>{money(statsQuery.data.totalSpent)}</strong>
            </div>
          </div>
          <div>
            <span className="stat-icon green">
              <ShoppingBag size={18} />
            </span>
            <div>
              <small>จำนวนบิล</small>
              <strong>{statsQuery.data.billCount} บิล</strong>
            </div>
          </div>
          <div>
            <span className="stat-icon purple">
              <CalendarDays size={18} />
            </span>
            <div>
              <small>ซื้อครั้งล่าสุด</small>
              <strong>
                {statsQuery.data.lastPurchaseAt
                  ? formatHistoryDate(statsQuery.data.lastPurchaseAt)
                  : "ยังไม่เคยซื้อ"}
              </strong>
            </div>
          </div>
          <div>
            <span className="stat-icon amber">
              <Star size={18} />
            </span>
            <div className="member-top-products">
              <small>สินค้าที่ซื้อบ่อย</small>
              {statsQuery.data.topProducts.length === 0 ? (
                <span className="top-products-empty">
                  ยังไม่มีประวัติการซื้อสินค้า
                </span>
              ) : (
                <div className="top-products-list">
                  {statsQuery.data.topProducts.map(product => (
                    <span className="top-product-chip" key={product.name}>
                      {product.name} <b>×{product.qty}</b>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
      <section className="panel table-panel member-history-panel">
        <div className="table-toolbar">
          <div>
            <h2>ประวัติการทำรายการ</h2>
            <p>
              ข้อมูลย้อนหลังของ {displayName} · รวม {transactions.length} รายการ
            </p>
          </div>
          <div className="filter-pills history-tabs">
            {[
              "ทั้งหมด",
              "ซื้อสินค้า",
              "เติมเงิน",
              "ถอนเงิน",
              "เปิดใช้บัตร",
              "คืนบัตรเงินสด",
            ].map(item => (
              <button
                className={tab === item ? "active" : ""}
                key={item}
                onClick={() => setTab(item as typeof tab)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="member-history-list">
          {detailQuery.isLoading ? (
            <div className="table-loading">
              <ReceiptText size={22} />
              <b>กำลังโหลดประวัติการทำรายการ</b>
              <span>ดึงข้อมูลธุรกรรมของสมาชิกจากระบบ</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="table-loading">
              <ReceiptText size={22} />
              <b>ไม่พบรายการตามเงื่อนไข</b>
              <span>ลองเปลี่ยนแท็บหรือทำรายการผ่าน POS</span>
            </div>
          ) : (
            filtered.map(transaction => {
              const meta = WALLET_TX_META[transaction.type] ?? {
                label: transaction.type,
                tone: "blue",
              };
              return (
                <div className="history-row" key={transaction.id}>
                  <span className={`history-icon ${meta.tone}`}>
                    {transaction.type === "purchase" ? (
                      <ShoppingCart size={16} />
                    ) : transaction.type === "deposit" ? (
                      <ArrowDownToLine size={16} />
                    ) : transaction.type === "activation" ? (
                      <IdCard size={16} />
                    ) : (
                      <ArrowUpFromLine size={16} />
                    )}
                  </span>
                  <div className="history-main">
                    <div>
                      <b>{meta.label}</b>
                      <span>{`TX-${String(transaction.id).padStart(3, "0")}`}</span>
                    </div>
                    <small>{transaction.detail}</small>
                    <time>{formatHistoryDate(transaction.createdAt)}</time>
                  </div>
                  {transaction.hasSlip === 1 && (
                    <SlipViewButton
                      kind="tx"
                      id={transaction.id}
                      title={`หลักฐาน${meta.label}`}
                      subtitle={`${profile.memberNumber} · ${formatHistoryDate(transaction.createdAt)}`}
                    />
                  )}
                  <strong
                    className={transaction.amount > 0 ? "positive" : "negative"}
                  >
                    {transaction.amount > 0 ? "+ " : "- "}
                    {money(Math.abs(transaction.amount))}
                  </strong>
                </div>
              );
            })
          )}
        </div>
        {notice && (
          <div className="notice-bar">
            <Check size={16} /> {notice}
            <button onClick={() => setNotice("")}>
              <X size={14} />
            </button>
          </div>
        )}
      </section>
      {walletOpen && (
        <div className="modal-backdrop" onClick={closeWalletSlip}>
          <div
            className="form-modal"
            onClick={event => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">
                  {walletResult
                    ? walletResult.type === "deposit"
                      ? "สลิปเติมเงิน"
                      : walletResult.type === "refund"
                        ? "สลิปคืนบัตรเงินสด"
                        : "สลิปถอนเงิน"
                    : "รายการธุรกรรม"}
                </span>
                <h2>
                  {walletResult
                    ? walletResult.type === "deposit"
                      ? "สลิปเติมเงิน"
                      : walletResult.type === "refund"
                        ? "สลิปคืนบัตรเงินสด"
                        : "สลิปถอนเงิน"
                    : walletOpen === "deposit"
                      ? "เติมเงินเข้าบัญชีสมาชิก"
                      : walletOpen === "refund"
                        ? "คืนบัตรเงินสด (จ่ายเงินคืนผู้ป่วย)"
                        : "ถอนเงินจากบัญชีสมาชิก"}
                </h2>
                <p>
                  {walletResult
                    ? `${walletResult.memberName} · ${walletResult.memberNumber} · บันทึกเรียบร้อย`
                    : `${displayName} · ${profile.memberNumber} · ยอดคงเหลือ ${money(profile.balance)}${walletOpen === "refund" ? " · บัตรที่คืนต้องเหลือยอด 0" : ""}`}
                </p>
              </div>
              <button className="icon-button" onClick={closeWalletSlip}>
                <X size={17} />
              </button>
            </div>
            {walletResult ? (
              <>
                <div className="wallet-success">
                  <div
                    className="receipt-paper wallet-slip"
                    id="member-wallet-slip"
                  >
                    <div className="receipt-success slip">
                      <span>
                        {walletResult.type === "deposit" ? (
                          <ArrowDownToLine size={22} />
                        ) : (
                          <ArrowUpFromLine size={22} />
                        )}
                      </span>
                      <div>
                        <b>
                          {walletResult.type === "deposit"
                            ? "เติมเงินสำเร็จ"
                            : walletResult.type === "refund"
                              ? "คืนบัตรเงินสดสำเร็จ"
                              : "ถอนเงินสำเร็จ"}
                        </b>
                        <small>บันทึกลงรายการธุรกรรมของสมาชิกแล้ว</small>
                      </div>
                    </div>
                    <div className="receipt-divider" />
                    <div className="receipt-meta">
                      <span>
                        {walletResult.type === "deposit"
                          ? "ใบยืนยันการเติมเงิน"
                          : walletResult.type === "refund"
                            ? "ใบยืนยันการคืนบัตรเงินสด"
                            : "ใบยืนยันการถอนเงิน"}
                      </span>
                      <b>
                        {walletDoneAt
                          ? `${walletDoneAt.toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric" })} · ${walletDoneAt.toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hourCycle: "h23", hour: "2-digit", minute: "2-digit" })} น.`
                          : ""}
                      </b>
                    </div>
                    <div className="receipt-customer">
                      <span>สมาชิก</span>
                      <b>
                        {walletResult.memberName} · {walletResult.memberNumber}
                      </b>
                    </div>
                    <div className="receipt-line">
                      <span>
                        {walletResult.type === "deposit"
                          ? "จำนวนเงินที่เติม"
                          : walletResult.type === "refund"
                            ? "จำนวนเงินที่คืน"
                            : "จำนวนเงินที่ถอน"}
                      </span>
                      <b>{money(walletResult.amount)}</b>
                    </div>
                    <div className="receipt-line">
                      <span>ยอดคงเหลือก่อนรายการ</span>
                      <b>{money(walletResult.balanceBefore)}</b>
                    </div>
                    <div className="receipt-total">
                      <span>ยอดคงเหลือหลังรายการ</span>
                      <b>{money(walletResult.balanceAfter)}</b>
                    </div>
                    <div className="receipt-payment">
                      <span>ผู้ทำรายการ</span>
                      <b>
                        {actor} · {actorRole}
                      </b>
                    </div>
                    <div className="receipt-thanks">
                      บันทึกเข้าระบบเรียบร้อย
                      ตรวจสอบยอดได้ที่ประวัติการทำรายการด้านล่าง
                      <br />
                      <small>ข้อมูลถูกบันทึกในประวัติระบบ แล้ว</small>
                    </div>
                  </div>
                  <div className="wallet-success-actions">
                    <button
                      className="outline-button"
                      disabled={Boolean(walletSlipBusy)}
                      onClick={() => void downloadWalletSlip("pdf")}
                    >
                      <Download size={16} />{" "}
                      {walletSlipBusy === "pdf"
                        ? "กำลังสร้าง PDF..."
                        : "ดาวน์โหลด PDF"}
                    </button>
                    <button
                      className="outline-button"
                      disabled={Boolean(walletSlipBusy)}
                      onClick={() => void downloadWalletSlip("image")}
                    >
                      <FileImage size={16} />{" "}
                      {walletSlipBusy === "image"
                        ? "กำลังสร้างรูป..."
                        : "ดาวน์โหลดรูปภาพ"}
                    </button>
                    <button
                      className="outline-button"
                      onClick={() => setWalletPrintPreview(true)}
                    >
                      <Printer size={16} /> พิมพ์สลิป
                    </button>
                    <button
                      className="primary-button"
                      onClick={closeWalletSlip}
                    >
                      <Check size={16} /> เสร็จสิ้น · ปิดหน้าต่าง
                    </button>
                  </div>
                </div>
              </>
            ) : walletConfirm ? (
              <>
                <div className="wallet-confirm-warning">
                  <ShieldCheck size={16} />
                  <span>
                    ยอดเงินจะยังไม่ถูกบันทึกเข้าบัญชี จนกว่าจะกด
                    “ยืนยันการทำรายการ”
                  </span>
                </div>
                <div className="wallet-confirm-rows">
                  <div>
                    <span>ประเภทรายการ</span>
                    <b
                      className={
                        walletOpen === "deposit" ? "green-text" : "amber-text"
                      }
                    >
                      {walletModeLabel}
                    </b>
                  </div>
                  <div>
                    <span>สมาชิก</span>
                    <b>
                      {displayName} · {profile.memberNumber}
                    </b>
                  </div>
                  <div>
                    <span>จำนวนเงิน</span>
                    <b>{money(walletPreviewAmount)}</b>
                  </div>
                  <div>
                    <span>ยอดคงเหลือก่อนรายการ</span>
                    <b>{money(profile.balance)}</b>
                  </div>
                  <div>
                    <span>ยอดคงเหลือหลังยืนยัน</span>
                    <b className={balanceAfterWallet < 0 ? "red-text" : ""}>
                      {money(balanceAfterWallet)}
                    </b>
                  </div>
                  <div>
                    <span>ผู้ทำรายการ</span>
                    <b>
                      {actor} · {actorRole}
                    </b>
                  </div>
                  {walletNote.trim() && (
                    <div>
                      <span>หมายเหตุ</span>
                      <b>{walletNote.trim()}</b>
                    </div>
                  )}
                </div>
                {balanceAfterWallet < 0 && (
                  <div className="notice-bar error">
                    <ShieldCheck size={16} />{" "}
                    ยอดเงินคงเหลือไม่พอสำหรับถอนจำนวนนี้ —
                    ย้อนกลับแก้ไขจำนวนเงิน
                    <button onClick={() => setError("")}>
                      <X size={14} />
                    </button>
                  </div>
                )}
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
                    onClick={() => setWalletConfirm(false)}
                  >
                    <RotateCcw size={15} /> ย้อนกลับแก้ไข
                  </button>
                  <ActionButton
                    disabledReason="กรอกข้อมูลให้ครบ"
                    busy={walletMutation.isPending}
                    className="primary-button"
                    disabled={
                      walletMutation.isPending || balanceAfterWallet < 0
                    }
                    onClick={confirmWallet}
                  >
                    <Check size={16} />{" "}
                    {walletMutation.isPending
                      ? "กำลังบันทึก…"
                      : "ยืนยันการทำรายการ"}
                  </ActionButton>
                </div>
              </>
            ) : (
              <>
                <div className="member-number-preview">
                  <span>
                    <WalletCards size={16} /> ยอดคงเหลือหลังรายการ
                  </span>
                  <b className={balanceAfterWallet < 0 ? "red-text" : ""}>
                    {money(balanceAfterWallet)}
                  </b>
                </div>
                {balanceAfterWallet < 0 && (
                  <div className="notice-bar error">
                    <ShieldCheck size={16} />{" "}
                    ยอดเงินคงเหลือไม่พอสำหรับถอนจำนวนนี้
                    <button onClick={() => setError("")}>
                      <X size={14} />
                    </button>
                  </div>
                )}
                <div className="form-grid compact-form">
                  <label>
                    จำนวนเงิน (฿) *
                    <input
                      autoFocus
                      type="number"
                      min="0"
                      step="0.01"
                      value={walletAmount}
                      onChange={event => setWalletAmount(event.target.value)}
                      onKeyDown={event => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          submitWallet();
                        }
                      }}
                      placeholder="0.00"
                    />
                  </label>
                  <label className="wide">
                    หมายเหตุ
                    <input
                      value={walletNote}
                      onChange={event => setWalletNote(event.target.value)}
                      onKeyDown={event => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          submitWallet();
                        }
                      }}
                      placeholder={
                        walletOpen === "deposit"
                          ? "เช่น เติมเงินสดที่เคาน์เตอร์"
                          : walletOpen === "refund"
                            ? "เช่น ผู้ป่วยคืนบัตร ออกจากโรงพยาบาลแล้ว"
                            : "เช่น ถอนเพื่อใช้จ่ายส่วนตัว"
                      }
                    />
                  </label>
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
                    onClick={() => setWalletOpen(null)}
                  >
                    ยกเลิก
                  </button>
                  <ActionButton
                    disabledReason="กรอกข้อมูลให้ครบ"
                    busy={walletMutation.isPending}
                    className="primary-button"
                    disabled={
                      walletMutation.isPending ||
                      !(Number(walletAmount) > 0) ||
                      balanceAfterWallet < 0
                    }
                    onClick={submitWallet}
                  >
                    <Check size={16} />{" "}
                    {walletMutation.isPending
                      ? "กำลังบันทึก…"
                      : walletOpen === "deposit"
                        ? "บันทึกการเติมเงิน"
                        : walletOpen === "refund"
                          ? "ยืนยันคืนบัตรเงินสด"
                          : "บันทึกการถอนเงิน"}
                  </ActionButton>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmStatus}
        tone={profile.status === "active" ? "warning" : "primary"}
        title={
          profile.status === "active"
            ? "ยืนยันการระงับสมาชิก?"
            : "ยืนยันการคืนสถานะสมาชิก?"
        }
        description={
          profile.status === "active"
            ? `สมาชิก ${displayName} จะไม่สามารถใช้ยอดคงเหลือซื้อสินค้าได้จนกว่าจะเปิดใช้งานอีกครั้ง`
            : `สมาชิก ${displayName} จะสามารถใช้ยอดคงเหลือซื้อสินค้าและรับการเติมเงินได้อีกครั้ง`
        }
        confirmLabel={
          profile.status === "active"
            ? "ยืนยันระงับการใช้งาน"
            : "ยืนยันคืนสถานะการใช้งาน"
        }
        onCancel={() => setConfirmStatus(false)}
        onConfirm={() => {
          setConfirmStatus(false);
          statusMutation.mutate({
            memberNumber: member.memberNumber,
            suspended: profile.status === "active",
            actor,
            actorRole,
          });
        }}
      />
      {editOpen && editForm && (
        <div className="modal-backdrop" onClick={() => setEditOpen(false)}>
          <div
            className="form-modal"
            onClick={event => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">แก้ไขสมาชิก</span>
                <h2>แก้ไขข้อมูลสมาชิก</h2>
                <p>
                  {displayName} · {profile.memberNumber}
                </p>
              </div>
              <button
                className="icon-button"
                onClick={() => setEditOpen(false)}
              >
                <X size={17} />
              </button>
            </div>
            <div
              className="form-grid compact-form"
              onKeyDownCapture={event => formEnterNav(event, submitEdit)}
            >
              <label>
                คำนำหน้า
                <input
                  list="prename-options"
                  value={editForm.prename}
                  onChange={event =>
                    setEditForm({ ...editForm, prename: event.target.value })
                  }
                  placeholder="เช่น นาย / นาง / นางสาว"
                  maxLength={30}
                  title="คำนำหน้าชื่อสมาชิก — เลือกจากรายการหรือพิมพ์เอง เว้นว่างได้"
                />
                <datalist id="prename-options">
                  {PRENAME_OPTIONS.map(option => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </label>
              <label>
                ชื่อ *
                <input
                  autoFocus
                  value={editForm.firstName}
                  onChange={event =>
                    setEditForm({ ...editForm, firstName: event.target.value })
                  }
                  placeholder="ชื่อ"
                />
              </label>
              <label>
                นามสกุล *
                <input
                  value={editForm.lastName}
                  onChange={event =>
                    setEditForm({ ...editForm, lastName: event.target.value })
                  }
                  placeholder="นามสกุล"
                />
              </label>
              <label>
                ประเภทสมาชิก
                <select
                  value={editForm.type}
                  onChange={event =>
                    setEditForm({ ...editForm, type: event.target.value })
                  }
                >
                  <option>สมาชิก</option>
                  <option>เจ้าหน้าที่</option>
                </select>
              </label>
              <label>
                เบอร์โทรศัพท์
                <input
                  value={editForm.phone}
                  onChange={event =>
                    setEditForm({ ...editForm, phone: event.target.value })
                  }
                  placeholder="เช่น 08x-xxx-xxxx"
                />
              </label>
              <label>
                รหัสบัตรเงินสด
                <input
                  value={editForm.cardNumber}
                  onChange={event =>
                    setEditForm({ ...editForm, cardNumber: event.target.value })
                  }
                  placeholder="เช่น 2395100201"
                  maxLength={30}
                  title="รหัสบัตรเงินสดของสมาชิก — ใช้ค้นหาและขึ้นรายงานยอดเงินในบัตร"
                />
              </label>

              <label className="wide">
                เลขที่บัตรประชาชน
                <input
                  value={editForm.idCard}
                  onChange={event =>
                    setEditForm({ ...editForm, idCard: event.target.value })
                  }
                  placeholder="-"
                />
              </label>
              <label className="wide">
                รูปสมาชิก (แสดงบนบัตร)
                <div className="member-photo-uploader">
                  {editForm.photoUrl ? (
                    <>
                      <img
                        className="member-photo-preview"
                        src={editForm.photoUrl}
                        alt="รูปสมาชิกปัจจุบัน"
                      />
                      <div className="member-photo-actions">
                        <div className="photo-action-row">
                          <button
                            type="button"
                            className="outline-button compact"
                            onClick={() => setEditCameraOpen(true)}
                          >
                            <Camera size={15} /> ถ่ายใหม่จากกล้อง
                          </button>
                          <button
                            type="button"
                            className="danger-outline-button compact"
                            onClick={() =>
                              setEditForm(current =>
                                current ? { ...current, photoUrl: "" } : current
                              )
                            }
                          >
                            <Trash2 size={15} /> ลบรูป
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="photo-action-row">
                        <label
                          className="upload-drop member-photo-drop"
                          htmlFor="edit-member-photo"
                        >
                          <ImagePlus size={17} />
                          <span>
                            <b>เลือกรูปจากไฟล์</b>
                            <small>
                              PNG JPG WEBP · ระบบย่อ 480px อัตโนมัติ
                            </small>
                          </span>
                          <input
                            id="edit-member-photo"
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            hidden
                            onChange={onEditPhotoPick}
                          />
                        </label>
                      </div>
                      <button
                        type="button"
                        className="outline-button compact camera-hint-inline"
                        onClick={() => setEditCameraOpen(true)}
                      >
                        <Camera size={15} /> หรือถ่ายรูปจากกล้องเลย
                      </button>
                    </>
                  )}
                </div>
              </label>
            </div>
            <div className="initial-balance-note">
              <ShieldCheck size={15} /> การแก้ไขจะบันทึกลงระบบทันทีและบันทึกลง
              Log
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
                onClick={() => setEditOpen(false)}
              >
                ยกเลิก
              </button>
              <ActionButton
                disabledReason="กรอกข้อมูลให้ครบ"
                busy={updateMutation.isPending}
                className="primary-button"
                disabled={
                  updateMutation.isPending ||
                  !editForm.firstName.trim() ||
                  !editForm.lastName.trim()
                }
                onClick={submitEdit}
              >
                <Check size={16} />{" "}
                {updateMutation.isPending ? "กำลังบันทึก…" : "บันทึกการแก้ไข"}
              </ActionButton>
            </div>
          </div>
        </div>
      )}
      {walletPrintPreview && walletResult && (
        <PrintPreviewModal
          targetId="member-wallet-slip"
          title={
            walletResult.type === "deposit"
              ? "พรีวิวก่อนพิมพ์สลิปเติมเงิน"
              : walletResult.type === "refund"
                ? "พรีวิวก่อนพิมพ์สลิปคืนบัตรเงินสด"
                : "พรีวิวก่อนพิมพ์สลิปถอนเงิน"
          }
          subtitle={`${walletResult.memberName} · ${walletResult.memberNumber} · ${money(walletResult.amount)}`}
          paper="thermal"
          chips={[
            walletResult.type === "deposit"
              ? "เติมเงินเข้าบัญชีสมาชิก"
              : walletResult.type === "refund"
                ? "คืนบัตรเงินสด"
                : "ถอนเงินจากบัญชีสมาชิก",
            `คงเหลือ ${money(walletResult.balanceAfter)}`,
          ]}
          onClose={() => setWalletPrintPreview(false)}
        />
      )}
      {editCameraOpen && (
        <CameraCaptureModal
          open
          title={`ถ่ายรูปสมาชิก · ${displayName}`}
          hint="ตรวจสอบรูปก่อนกด “ใช้รูปนี้” — รูปจะแทนที่รูปเดิมของสมาชิกทันทีในฟอร์ม (ยังไม่บันทึกจนกดบันทึกการแก้ไข)"
          onClose={() => setEditCameraOpen(false)}
          onCapture={dataUrl => {
            setEditForm(current =>
              current ? { ...current, photoUrl: dataUrl } : current
            );
            setError("");
          }}
        />
      )}
      <ConfirmDialog
        open={confirmDelete}
        title="ยืนยันการลบสมาชิก?"
        description={`ลบ ${displayName} (${member.memberNumber}) ออกจากระบบถาวร · ลบได้เฉพาะบัญชีที่ยอดเงินเป็น 0 และไม่มีประวัติธุรกรรม หากมีประวัติการใช้งาน แนะนำใช้การระงับการใช้งานแทน`}
        confirmLabel="ยืนยันลบสมาชิก"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          deleteMutation.mutate({
            memberNumber: member.memberNumber,
            actor,
            actorRole,
          });
        }}
      />
      {cardOpen && (
        <MemberCardModal
          member={
            detailQuery.data?.member ?? {
              ...member,
              createdAt: new Date().toISOString(),
            }
          }
          onClose={() => setCardOpen(false)}
        />
      )}
      {statementOpen && (
        <StatementModal
          member={
            detailQuery.data?.member ?? {
              ...member,
              createdAt: new Date().toISOString(),
            }
          }
          transactions={transactions}
          onClose={() => setStatementOpen(false)}
        />
      )}
    </>
  );
}
