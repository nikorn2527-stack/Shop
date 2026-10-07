import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Camera,
  Trash2,
  ImagePlus,
  IdCard,
  ShieldCheck,
  CircleAlert,
  X,
} from "@/lib/icons";
import { toast } from "sonner";
import {
  PRENAME_OPTIONS,
  compressImageToDataUrl,
  formatMemberNumber,
} from "@/pages/pageData";
import { nextMemberSequence, getErrorMessage } from "@/pages/viewFormat";
import { formEnterNav } from "@/pages/PagePrimitives";
import { CameraCaptureModal } from "./CameraCaptureModal";
import { type MemberCardData } from "./MemberCardModal";
export function MemberRegistrationModal({
  actor: cashier,
  actorRole,
  onClose,
  onRegistered,
}: {
  actor: string;
  actorRole: string;
  onClose: () => void;
  onRegistered: (member: MemberCardData) => void;
}) {
  const utils = trpc.useUtils();
  const settingsQuery = trpc.settings.get.useQuery(undefined);
  const membersQuery = trpc.member.list.useQuery(undefined);
  const members = membersQuery.data ?? [];
  const [error, setError] = useState("");
  const [registerForm, setRegisterForm] = useState({
    prename: "",
    firstName: "",
    lastName: "",
    idCard: "",
    phone: "",
    type: "สมาชิก",
    gender: "ไม่ระบุ" as "ชาย" | "หญิง" | "ไม่ระบุ",
    photoUrl: "",
    memberNumber: "",
    initialBalance: "",
    cardNumber: "",
    patientCode: "",
  });
  const [registerCameraOpen, setRegisterCameraOpen] = useState(false);
  const cardsQuery = trpc.card.list.useQuery(undefined);
  const registerMutation = trpc.member.register.useMutation({
    onSuccess: result => {
      onRegistered(result.member);
      void utils.card.list.invalidate();
      void utils.member.list.invalidate();
      void utils.reports.memberBalances.invalidate();
      void utils.logs.list.invalidate();
    },
    onError: cause => setError(getErrorMessage(cause)),
  });
  const numberMode = settingsQuery.data?.memberNumberMode ?? "running";
  const numberFormat = settingsQuery.data
    ? {
        prefix: settingsQuery.data.memberNumberPrefix,
        yearMode: settingsQuery.data.memberNumberYearMode,
        yearDigits: settingsQuery.data.memberNumberYearDigits,
        resetMonth: settingsQuery.data.memberNumberResetMonth,
        sequenceDigits: settingsQuery.data.memberNumberSequenceDigits,
        separator: settingsQuery.data.memberNumberSeparator,
      }
    : undefined;
  const nextNumber = formatMemberNumber(
    numberMode,
    nextMemberSequence(members, numberMode, numberFormat),
    numberFormat
  );
  const onRegisterPhotoPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      setError("รองรับเฉพาะไฟล์รูป PNG JPG WEBP");
      toast.error("รองรับเฉพาะไฟล์รูป PNG JPG WEBP", {
        description: "เลือกไฟล์รูปชนิด PNG, JPG หรือ WEBP",
      });
      return;
    }
    if (file.size > 8_000_000) {
      setError("ไฟล์รูปใหญ่เกิน 8MB — เลือกไฟล์เล็กลง");
      toast.error("ไฟล์รูปใหญ่เกิน 8MB", {
        description: "ย่อขนาดรูปหรือเลือกไฟล์เล็กลงก่อนอัปโหลด",
      });
      return;
    }
    compressImageToDataUrl(file, 480, 0.72)
      .then(dataUrl => {
        setRegisterForm(current => ({ ...current, photoUrl: dataUrl }));
        setError("");
      })
      .catch(() => {
        setError("อ่านไฟล์รูปไม่สำเร็จ");
        toast.error("อ่านไฟล์รูปไม่สำเร็จ", {
          description: "ลองเลือกไฟล์ใหม่อีกครั้ง",
        });
      });
  };
  const submitRegister = () => {
    if (registerMutation.isPending || !settingsQuery.data) return;
    if (!registerForm.firstName.trim() || !registerForm.lastName.trim()) {
      setError("กรุณาระบุชื่อและนามสกุลสมาชิก");
      toast.error("กรุณาระบุชื่อและนามสกุลสมาชิก", {
        description: "ต้องมีทั้งชื่อและนามสกุลก่อนบันทึก",
      });
      return;
    }
    if (numberMode === "manual" && !registerForm.memberNumber.trim()) {
      setError("โหมดกำหนดหมายเลขเอง: กรุณาระบุหมายเลขสมาชิก");
      toast.error("กรุณาระบุหมายเลขสมาชิก", {
        description: "โหมดนี้ต้องกำหนดหมายเลขสมาชิกด้วยตนเอง",
      });
      return;
    }
    const initialBalance =
      registerForm.initialBalance.trim() === ""
        ? undefined
        : Number(registerForm.initialBalance);
    if (
      initialBalance !== undefined &&
      (!Number.isFinite(initialBalance) || !(initialBalance > 0))
    ) {
      setError("เงินเริ่มต้นต้องมากกว่า 0");
      toast.error("เงินเริ่มต้นต้องมากกว่า 0", {
        description: "เว้นว่างไว้หากยังไม่เติมเงิน",
      });
      return;
    }
    const card = cardsQuery.data?.find(
      card => card.cardNumber === registerForm.cardNumber.trim()
    );
    if (!card || !["blank", "returned_vacant"].includes(card.status)) {
      setError("กรุณายิงบัตรว่างที่มีในระบบ");
      return;
    }
    setError("");
    registerMutation.mutate({
      prename: registerForm.prename.trim() || undefined,
      firstName: registerForm.firstName.trim(),
      lastName: registerForm.lastName.trim(),
      citizenId: registerForm.idCard.trim() || undefined,
      phone: registerForm.phone.trim() || undefined,
      type: registerForm.type,
      gender:
        registerForm.gender === "ไม่ระบุ" ? undefined : registerForm.gender,
      photoUrl: registerForm.photoUrl || undefined,
      memberNumber:
        numberMode === "manual" ? registerForm.memberNumber.trim() : undefined,
      initialDeposit: initialBalance,
      cardNumber: registerForm.cardNumber.trim() || undefined,
      patientCode: registerForm.patientCode.trim() || undefined,
      actor: cashier,
      actorRole,
    });
  };

  return (
    <>
      {registerCameraOpen && (
        <CameraCaptureModal
          open
          title="ถ่ายรูปสมาชิก"
          onClose={() => setRegisterCameraOpen(false)}
          onCapture={dataUrl => {
            setRegisterForm(current => ({ ...current, photoUrl: dataUrl }));
            setError("");
          }}
        />
      )}
      <div
        className="modal-backdrop"
        onClick={() => {
          if (!registerMutation.isPending) onClose();
        }}
      >
        <div
          className="form-modal pos-register-modal"
          role="dialog"
          aria-modal="true"
          aria-label="ลงทะเบียนสมาชิกใหม่"
          onClick={event => event.stopPropagation()}
        >
          <div className="modal-heading">
            <div>
              <span className="eyebrow">MEMBER REGISTRATION · POS</span>
              <h2>ลงทะเบียนสมาชิกใหม่</h2>
            </div>
            <button
              className="icon-button"
              onClick={() => {
                if (!registerMutation.isPending) onClose();
              }}
              aria-label="ปิดหน้าต่าง"
            >
              <X size={17} />
            </button>
          </div>
          <div className="member-number-preview">
            <span>
              <IdCard size={16} />{" "}
              {numberMode === "manual"
                ? "โหมดกำหนดหมายเลขสมาชิกด้วยตนเอง"
                : `หมายเลขสมาชิกถัดไป (${numberMode === "year" ? "ขึ้นต้นด้วยปี" : "รันเลขต่อเนื่อง"})`}
            </span>
            <b>{nextNumber}</b>
          </div>
          <div
            className="form-grid compact-form"
            onKeyDownCapture={event => formEnterNav(event, submitRegister)}
          >
            <label>
              คำนำหน้า
              <input
                list="prename-options"
                value={registerForm.prename}
                onChange={event =>
                  setRegisterForm({
                    ...registerForm,
                    prename: event.target.value,
                  })
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
                id="pos-register-first-name"
                name="firstName"
                value={registerForm.firstName}
                onChange={event =>
                  setRegisterForm({
                    ...registerForm,
                    firstName: event.target.value,
                  })
                }
                placeholder="ชื่อ"
              />
            </label>
            <label>
              นามสกุล *
              <input
                name="lastName"
                value={registerForm.lastName}
                onChange={event =>
                  setRegisterForm({
                    ...registerForm,
                    lastName: event.target.value,
                  })
                }
                placeholder="นามสกุล"
              />
            </label>
            <label>
              ประเภทสมาชิก
              <select
                value={registerForm.type}
                onChange={event =>
                  setRegisterForm({ ...registerForm, type: event.target.value })
                }
              >
                <option>สมาชิก</option>
                <option>เจ้าหน้าที่</option>
              </select>
            </label>
            <label>
              เพศ
              <select
                value={registerForm.gender}
                onChange={event =>
                  setRegisterForm({
                    ...registerForm,
                    gender: event.target.value as "ชาย" | "หญิง" | "ไม่ระบุ",
                  })
                }
              >
                <option value="ไม่ระบุ">ไม่ระบุ</option>
                <option value="ชาย">ชาย</option>
                <option value="หญิง">หญิง</option>
              </select>
            </label>
            <label className="wide">
              รูปสมาชิก (สำหรับบัตร)
              <div className="member-photo-uploader">
                {registerForm.photoUrl ? (
                  <>
                    <img
                      className="member-photo-preview"
                      src={registerForm.photoUrl}
                      alt="รูปสมาชิกที่เลือก"
                    />
                    <div className="member-photo-actions">
                      <div className="photo-action-row">
                        <button
                          type="button"
                          className="outline-button compact"
                          onClick={() => setRegisterCameraOpen(true)}
                        >
                          <Camera size={15} /> ถ่ายใหม่จากกล้อง
                        </button>
                        <button
                          type="button"
                          className="danger-outline-button compact"
                          onClick={() =>
                            setRegisterForm({ ...registerForm, photoUrl: "" })
                          }
                        >
                          <Trash2 size={15} /> ลบรูป
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <label
                      className="upload-drop member-photo-drop"
                      htmlFor="pos-register-photo"
                    >
                      <ImagePlus size={17} />
                      <span>
                        <b>เลือกรูปสมาชิก</b>
                        <small>
                          ไม่ใส่ก็ได้ — บัตรจะใช้รูป
                          {registerForm.gender === "ชาย"
                            ? "ชาย"
                            : registerForm.gender === "หญิง"
                              ? "หญิง"
                              : "เริ่มต้น"}
                          แทน
                        </small>
                      </span>
                      <input
                        id="pos-register-photo"
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        hidden
                        onChange={onRegisterPhotoPick}
                      />
                    </label>
                    <button
                      type="button"
                      className="outline-button compact camera-hint-inline"
                      onClick={() => setRegisterCameraOpen(true)}
                    >
                      <Camera size={15} /> หรือถ่ายรูปจากกล้องเลย —
                      เครื่องไหนมีเว็บแคมใช้ได้เลย
                    </button>
                  </>
                )}
              </div>
            </label>
            <label>
              เบอร์โทรศัพท์
              <input
                value={registerForm.phone}
                onChange={event =>
                  setRegisterForm({
                    ...registerForm,
                    phone: event.target.value,
                  })
                }
                placeholder="เช่น 08x-xxx-xxxx"
              />
            </label>
            <label>
              ยิงรหัสบัตรว่าง *
              <input
                value={registerForm.cardNumber}
                onChange={event =>
                  setRegisterForm({
                    ...registerForm,
                    cardNumber: event.target.value,
                  })
                }
                placeholder="เช่น 2395100201"
                name="cardNumber"
                maxLength={100}
                title="ใช้บัตรว่างจากหน้าจัดการบัตรเปล่า"
              />
            </label>
            <label>
              รหัสผู้ป่วย (HN)
              <input
                value={registerForm.patientCode}
                onChange={event =>
                  setRegisterForm({
                    ...registerForm,
                    patientCode: event.target.value,
                  })
                }
                placeholder="เช่น 70001"
                maxLength={30}
                title="รหัสผู้ป่วยที่ผูกกับบัตร — แสดงในรายงานยอดเงินในบัตร"
              />
            </label>
            <label className="wide">
              เลขที่บัตรประชาชน
              <input
                value={registerForm.idCard}
                onChange={event =>
                  setRegisterForm({
                    ...registerForm,
                    idCard: event.target.value,
                  })
                }
                placeholder="-"
              />
            </label>
            {numberMode === "manual" && (
              <label className="wide">
                หมายเลขสมาชิก *
                <input
                  value={registerForm.memberNumber}
                  onChange={event =>
                    setRegisterForm({
                      ...registerForm,
                      memberNumber: event.target.value,
                    })
                  }
                  placeholder="กำหนดหมายเลขเอง เช่น VIP-001"
                />
              </label>
            )}
            <label className="wide">
              เงินเริ่มต้น (ถ้ามี)
              <input
                type="number"
                min="0"
                name="initialDeposit"
                value={registerForm.initialBalance}
                onChange={event =>
                  setRegisterForm({
                    ...registerForm,
                    initialBalance: event.target.value,
                  })
                }
                placeholder="เว้นว่างได้ หากยังไม่เติมเงิน"
              />
            </label>
          </div>
          {error && (
            <div className="notice-bar error">
              <CircleAlert size={16} /> {error}
              <button onClick={() => setError("")}>
                <X size={14} />
              </button>
            </div>
          )}
          <div className="modal-actions">
            <button
              className="outline-button"
              onClick={() => {
                if (!registerMutation.isPending) onClose();
              }}
            >
              <X size={16} /> ยกเลิก
            </button>
            <button
              className="primary-button"
              disabled={registerMutation.isPending || !settingsQuery.data}
              onClick={submitRegister}
            >
              <IdCard size={16} />{" "}
              {registerMutation.isPending
                ? "กำลังบันทึก…"
                : "บันทึกสมาชิก"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
