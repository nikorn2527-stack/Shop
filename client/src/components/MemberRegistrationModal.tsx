import { WorkflowDialog } from "./WorkflowDialog";
import { useRef, useState } from "react";
import { blocker } from "./BlockerAlert";
import { DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";
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
import {
  type MemberLite,
  PRENAME_OPTIONS,
  compressImageToDataUrl,
} from "@/pages/pageData";
import { getErrorMessage } from "@/pages/viewFormat";
import { formEnterNav } from "@/pages/PagePrimitives";
import { CameraCaptureModal } from "./CameraCaptureModal";
import { type MemberCardData } from "./MemberCardModal";
export function MemberRegistrationModal({
  actor: cashier,
  actorRole,
  onClose,
  onRegistered,
  onUseExisting,
}: {
  actor: string;
  actorRole: string;
  onClose: () => void;
  onRegistered: (member: MemberCardData) => void;
  onUseExisting: (member: MemberLite, cardNumber: string, openDetails: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const settingsQuery = trpc.settings.get.useQuery(undefined);
  const nextNumberQuery = trpc.member.nextNumber.useQuery(undefined, { staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true });
  const [error, setError] = useState("");
  // แจ้งเตือนจุดเดียวกลางจอ: เหลือง = ข้อมูลแก้ได้ · แดง = บันทึกไม่ผ่านจริง
  // เรียก fail() ทุกครั้งที่มีข้อผิดพลาด — ข้อความเดิมซ้ำก็เด้งซ้ำได้ (useEffect เดิมแปะ state เดิมแล้วไม่ขึ้นซ้ำ)
  const fail = (message: string, fix: string) => {
    setError(message);
    blocker.warning("ข้อมูลยังไม่พร้อมบันทึก", `${message}\n${fix}`, {
      confirmLabel: "กลับไปแก้ไข",
      hint: "ยังไม่มีข้อมูลใดถูกบันทึก — แก้ในฟอร์มแล้วกดบันทึกสมาชิกใหม่ได้เลย",
    });
  };
  const [checkingExisting, setCheckingExisting] = useState(false);
  const [existingMembers, setExistingMembers] = useState<{ memberNumber: string; name: string; status: string; reason: string }[]>([]);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [openingMember, setOpeningMember] = useState<string | null>(null);
  const [existingError, setExistingError] = useState("");
  const checkSequence = useRef(0);
  const openingRef = useRef(false);
  const useExisting = async (memberNumber: string, openDetails = false) => {
    if (openingRef.current || registerMutation.isPending || checkingExisting) return;
    openingRef.current = true;
    ++checkSequence.current;
    setOpeningMember(memberNumber);
    setExistingError("");
    try {
      // Read current card/status before continuing; never overwrite registration data onto this account.
      const result = await utils.member.detail.fetch({ memberNumber });
      onUseExisting({ ...result.member, lastTransactionAt: null }, registerForm.cardNumber.trim(), openDetails);
    } catch (cause) {
      setExistingError(`เปิดข้อมูลสมาชิกไม่สำเร็จ: ${getErrorMessage(cause)} กรุณาลองอีกครั้ง ข้อมูลที่กรอกยังอยู่ครบ`);
    } finally {
      openingRef.current = false;
      setOpeningMember(null);
    }
  };
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
  const checkMemberOnBlur = async () => {
    if (!registerForm.firstName.trim() || !registerForm.lastName.trim() || duplicateOpen || openingRef.current || registerMutation.isPending) return;
    const sequence = ++checkSequence.current;
    try {
      const matches = await utils.member.checkExisting.fetch({ firstName: registerForm.firstName.trim(), lastName: registerForm.lastName.trim(), citizenId: registerForm.idCard.trim() || undefined, phone: registerForm.phone.trim() || undefined });
      if (sequence !== checkSequence.current || openingRef.current) return;
      if (matches.length) {
        setExistingMembers(matches);
        setDuplicateOpen(true);
      }
    } catch {
      if (sequence !== checkSequence.current) return;
      fail("ตรวจรายชื่อสมาชิกเดิมไม่ได้", "อินเทอร์เน็ตขัดข้องชั่วคราว — รอสักครู่แล้วพิมพ์ชื่อใหม่อีกครั้ง ระบบจะตรวจให้เอง");
    }
  };
  const cardsQuery = trpc.card.list.useQuery(undefined);
  const registerMutation = trpc.member.register.useMutation({
    onSuccess: result => {
      onRegistered(result.member);
      void utils.card.list.invalidate();
      void utils.member.list.invalidate();
      void utils.member.nextNumber.invalidate();
      void utils.reports.memberBalances.invalidate();
      void utils.logs.list.invalidate();
    },
    onError: cause => blocker.error("บันทึกสมาชิกไม่สำเร็จ", getErrorMessage(cause), { confirmLabel: "ปิดหน้าต่างนี้", hint: "ข้อมูลที่กรอกยังอยู่ครบ — แก้จุดที่ขัดข้อง แล้วกดบันทึกใหม่อีกครั้งได้เลย" }),
  });
  const numberMode = settingsQuery.data?.memberNumberMode ?? "running";
  const nextNumber = nextNumberQuery.data?.memberNumber;
  const onRegisterPhotoPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      fail("รองรับเฉพาะไฟล์รูป PNG JPG WEBP", "เปลี่ยนไฟล์เป็น .png .jpg หรือ .webp แล้วเลือกใหม่");
      return;
    }
    if (file.size > 8_000_000) {
      fail("ไฟล์รูปใหญ่เกิน 8MB", "ย่อรูปก่อน หรือเลือกไฟล์เล็กลง แล้วลองใหม่");
      return;
    }
    compressImageToDataUrl(file, 480, 0.72)
      .then(dataUrl => {
        setRegisterForm(current => ({ ...current, photoUrl: dataUrl }));
        setError("");
      })
      .catch(() => {
        fail("อ่านไฟล์รูปไม่สำเร็จ", "ไฟล์อาจเสีย — เลือกไฟล์ใหม่ หรือถ่ายรูปจากกล้องแทน");
      });
  };
  const submitRegister = async (confirmedDifferentPerson = false) => {
    if (registerMutation.isPending || checkingExisting || openingRef.current || !settingsQuery.data) return;
    if (!registerForm.firstName.trim() || !registerForm.lastName.trim()) {
      fail("ยังกรอกชื่อหรือนามสกุลไม่ครบ", "พิมพ์ชื่อและนามสกุลให้ครบทั้งสองช่อง แล้วกดบันทึกอีกครั้ง");
      return;
    }
    ++checkSequence.current;
    setError("");
    setCheckingExisting(true);
    try {
      const matches = await utils.member.checkExisting.fetch({ firstName: registerForm.firstName.trim(), lastName: registerForm.lastName.trim(), citizenId: registerForm.idCard.trim() || undefined, phone: registerForm.phone.trim() || undefined });
      if (matches.length && (!confirmedDifferentPerson || matches.some(member => member.reason === "citizenId"))) {
        setExistingMembers(matches);
        setError("");
        setDuplicateOpen(true);
        return;
      }
      setExistingMembers([]);
      setDuplicateOpen(false);
    } catch (cause) {
      fail("ตรวจรายชื่อสมาชิกเดิมไม่สำเร็จ", "ระบบยังเชื่อมต่อฐานข้อมูลไม่ได้ — รอสักครู่แล้วบันทึกใหม่อีกครั้ง");
      return;
    } finally {
      setCheckingExisting(false);
    }
    if (numberMode === "manual" && !registerForm.memberNumber.trim()) {
      fail("โหมดกำหนดหมายเลขเอง — ยังไม่ได้ใส่หมายเลขสมาชิก", "พิมพ์หมายเลขที่ต้องการใช้ เช่น VIP-001 แล้วบันทึกใหม่");
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
      fail("เงินเริ่มต้นต้องมากกว่า 0", "ใส่ตัวเลข เช่น 100 หรือเว้นว่างไว้ก่อน แล้วบันทึกใหม่");
      return;
    }
    const cardEntry = cardsQuery.data?.find(
      card => card.cardNumber === registerForm.cardNumber.trim()
    );
    if (cardEntry && !["blank", "returned_vacant"].includes(cardEntry.status)) {
      // บัตรนี้ยังใช้งานไม่ได้ (assigned / lost / damaged) — ตรวจสอบว่าผูกกับใคร
      const assignedMemberNumber = cardEntry.assignedMemberNumber;
      if (assignedMemberNumber) {
        try {
          const detail = await utils.member.detail.fetch({
            memberNumber: assignedMemberNumber,
          });
          setExistingMembers((prev) => [
            ...prev,
            {
              memberNumber: detail.member.memberNumber,
              name: `${detail.member.firstName} ${detail.member.lastName}`,
              status: detail.member.status,
              reason: "card",
            } as const,
          ]);
          setDuplicateOpen(true);
          return;
        } catch {
          fail(
            "บัตรนี้ถูกผูกกับสมาชิกอื่นแล้ว",
            "ระบุบัตรใหม่ หรือใช้บัตร/สมาชิกเดิมที่ระบบรักษาไว้แล้ว"
          );
          return;
        }
      } else {
        fail(
          "บัตรนี้ไม่พร้อมใช้งาน",
          "เลือกบัตรว่างใบอื่น บัตรที่แจ้งหายหรือชำรุดใช้สมัครไม่ได้"
        );
        return;
      }
    }

    if (!cardEntry || !["blank", "returned_vacant"].includes(cardEntry.status)) {
      fail("ยังไม่มีบัตรพร้อมใช้สำหรับสมาชิกใหม่", "สแกนหรือกรอกรหัสบัตรที่ขึ้นทะเบียนแล้ว (สถานะว่าง/คืนแล้ว) — ดูรายการบัตรว่างได้ที่ทะเบียนบัตร แล้วบันทึกใหม่");
      return;
    }
    registerMutation.mutate({
      citizenId: registerForm.idCard.trim() || undefined,
      phone: registerForm.phone.trim() || undefined,
      prename: registerForm.prename.trim() || undefined,
      firstName: registerForm.firstName.trim(),
      lastName: registerForm.lastName.trim(),
      type: registerForm.type,
      gender:
        registerForm.gender === "ไม่ระบุ" ? undefined : registerForm.gender,
      photoUrl: registerForm.photoUrl || undefined,
      memberNumber:
        numberMode === "manual" ? registerForm.memberNumber.trim() : undefined,
      initialDeposit: initialBalance,
      cardNumber: registerForm.cardNumber.trim() || undefined,
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
      <WorkflowDialog title="ลงทะเบียนสมาชิกใหม่" onClose={onClose} busy={registerMutation.isPending || checkingExisting || openingMember !== null} className="form-modal pos-register-modal">
          <div className="modal-heading">
            <div>
              <span className="eyebrow">MEMBER REGISTRATION · POS</span>
              <h2>ลงทะเบียนสมาชิกใหม่</h2>
            </div>
            <button
              className="icon-button"
              onClick={() => {
                if (!registerMutation.isPending && !checkingExisting && !openingRef.current) onClose();
              }}
              aria-label="ปิดหน้าต่าง"
            >
              <X size={17} />
            </button>
          </div>
          <div className="member-registration-body">
          <div className="member-number-preview">
            <span>
              <IdCard size={16} />{" "}
              {numberMode === "manual"
                ? "กรอกหมายเลขสมาชิกเอง"
                : `หมายเลขสมาชิกถัดไป (${numberMode === "year" ? "ขึ้นต้นด้วยปี" : "รันเลขต่อเนื่อง"})`}
            </span>
            <b>{numberMode === "manual" ? "ใส่ในช่องด้านล่าง" : nextNumberQuery.isError ? "\u0e42\u0e2b\u0e25\u0e14\u0e44\u0e21\u0e48\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08" : nextNumber ?? "\u0e01\u0e33\u0e25\u0e31\u0e07\u0e42\u0e2b\u0e25\u0e14..."}</b>
          </div>
          <div
            className="form-grid compact-form"
            onKeyDownCapture={event => formEnterNav(event, submitRegister)}
          >
            <label className="wide">
              สแกนหรือกรอกรหัสบัตร *
              <input
                autoFocus
                type="text"
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
                title="ใช้บัตรที่พร้อมใช้งานจากทะเบียนบัตร"
              />
            </label>
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
                onBlur={() => void checkMemberOnBlur()}
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
                onBlur={() => void checkMemberOnBlur()}
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
            <label>เบอร์โทรศัพท์ (ถ้ามี)<input type="tel" value={registerForm.phone} onBlur={() => void checkMemberOnBlur()} onChange={event => setRegisterForm({ ...registerForm, phone: event.target.value })} /></label>
            <label>เลขที่บัตรประชาชน (ถ้ามี)<input type="text" inputMode="numeric" value={registerForm.idCard} onBlur={() => void checkMemberOnBlur()} onChange={event => setRegisterForm({ ...registerForm, idCard: event.target.value })} /></label>
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



            {numberMode === "manual" && (
              <label className="wide">
                หมายเลขสมาชิกที่ต้องการใช้ *
                <input
                  name="memberNumber"
                  value={registerForm.memberNumber}
                  onChange={event =>
                    setRegisterForm({
                      ...registerForm,
                      memberNumber: event.target.value,
                    })
                  }
                  placeholder="เช่น VIP-001 หรือเลขจากระบบเดิม"
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
            <div className="notice-bar warning">
              <CircleAlert size={16} /> {error}
              <button onClick={() => setError("")}>
                <X size={14} />
              </button>
            </div>
          )}
          </div>
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
              disabled={registerMutation.isPending || checkingExisting || !settingsQuery.data}
              onClick={() => void submitRegister()}
            >
              <IdCard size={16} />{" "}
              {registerMutation.isPending
                ? "กำลังบันทึก…"
                : "บันทึกสมาชิก"}
            </button>
          </div>
          {duplicateOpen && <WorkflowDialog title="พบข้อมูลสมาชิกเดิม" onClose={() => { ++checkSequence.current; setDuplicateOpen(false); }} busy={openingMember !== null || checkingExisting || registerMutation.isPending} className="form-modal member-duplicate-dialog" backdropClassName="member-duplicate-backdrop">
          <DialogHeader>
            <DialogTitle>พบข้อมูลสมาชิกเดิม</DialogTitle>
            <DialogDescription>ตรวจสอบชื่อและเลขสมาชิกก่อนเลือก ระบบจะใช้บัญชี ยอดเงิน และประวัติเดิม หากยังไม่มีบัตร จะไปขั้นตอนจ่ายบัตร โดยไม่สมัครซ้ำและไม่เติมเงินเริ่มต้นจากฟอร์มนี้</DialogDescription>
          </DialogHeader>
          <div className="member-duplicate-list">
            {existingMembers.map(member => <div className="existing-member-match" key={member.memberNumber}>
              <strong>{member.name}</strong>
              <p>เลขสมาชิก {member.memberNumber} · {member.status === "active" ? "ใช้งาน" : "ระงับการใช้งาน"}</p>
              <small>{member.reason === "citizenId" ? "เลขบัตรประชาชนตรงกับสมาชิกนี้ จึงไม่สามารถสมัครซ้ำได้" : member.reason === "phone" ? "เบอร์โทรศัพท์ที่กรอกตรงกับสมาชิกนี้ หากใช้เบอร์ร่วมกันและเป็นคนละคน สามารถยืนยันสมัครใหม่ได้" : member.reason === "card" ? "รหัสบัตรซ้ำกับสมาชิกที่ลงทะเบียนไว้แล้ว กรุณาใช้บัญชีเดิม" : "ชื่อและนามสกุลที่กรอกตรงกับสมาชิกนี้ หากเป็นคนละคนที่ชื่อเหมือนกัน สามารถยืนยันสมัครใหม่ได้"}</small>
              <div className="existing-member-actions">
                <button type="button" className="primary-button" disabled={openingMember !== null || checkingExisting || registerMutation.isPending} onClick={() => void useExisting(member.memberNumber, member.status !== "active")}>{openingMember === member.memberNumber ? "กำลังเปิดข้อมูล…" : member.status === "active" ? "เลือกสมาชิกเดิม · ทำต่อ" : "เปิดข้อมูลสมาชิกที่ถูกระงับ"}</button>
                {member.status === "active" && <button type="button" className="outline-button" disabled={openingMember !== null || checkingExisting || registerMutation.isPending} onClick={() => void useExisting(member.memberNumber, true)}>ดูข้อมูลสมาชิก</button>}
              </div>
            </div>)}
          </div>
          {existingError && <p role="alert" className="notice-bar">{existingError}</p>}
          <DialogFooter>
            <button type="button" className="outline-button" disabled={openingMember !== null || checkingExisting || registerMutation.isPending} onClick={() => setDuplicateOpen(false)}>กลับไปแก้ข้อมูล</button>
            {!existingMembers.some(member => ["citizenId", "card"].includes(member.reason)) && <button type="button" className="outline-button" disabled={openingMember !== null || checkingExisting || registerMutation.isPending} onClick={() => void submitRegister(true)}>เป็นคนละคน — สมัครใหม่</button>}
          </DialogFooter>
          </WorkflowDialog>}
        </WorkflowDialog>
    </>
  );
}
