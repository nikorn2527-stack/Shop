import { Camera, CameraOff, Check, RefreshCw, Video, X } from "@/lib/icons";
import { useEffect, useRef, useState } from "react";

/**
 * ROUND 38 (ข้อ 37) — โมดูลถ่ายรูปจากกล้อง (Webcam)
 * สำหรับเครื่องที่มีกล้อง: เปิดกล้อง → ดูภาพซ้อน (มิเรอร์แบบเซลฟี่) → กดถ่าย →
 * ยืนยันรูปก่อนใช้ · ภาพที่ได้เป็น data-URL JPEG 480px (สอดคล้องขนาดรูปสมาชิก
 * ที่ระบบย่อให้เหมือนการเลือกจากไฟล์) จึงต่อเข้าฟอร์มเดิมได้ทันที
 * ไม่มีกล้อง/ไม่ได้รับอนุญาต → ข้อความไทยชี้ทางแก้ + ใช้เลือกไฟล์แทนได้เสมอ
 *
 * ROUND 63 (user) — facing="environment" = ใช้กล้องหลัง (ถ่ายสลิป/สินค้าจากมือถือ)
 * · "user" (ค่าเริ่มต้น) = กล้องหน้า สำหรับถ่ายรูปคน
 */

export type CameraCaptureModalProps = {
  open: boolean;
  title: string;
  hint?: string;
  /** กล้องที่ใช้: "user" = กล้องหน้า (ถ่ายคน) · "environment" = กล้องหลัง (ถ่ายสลิป/เอกสาร) */
  facing?: "user" | "environment";
  onClose: () => void;
  onCapture: (dataUrl: string) => void;
};

const MAX_OUTPUT_DIM = 480;
const JPEG_QUALITY = 0.82;

export function CameraCaptureModal({ open, title, hint, facing = "user", onClose, onCapture }: CameraCaptureModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<"starting" | "live" | "error">("starting");
  const [errorMsg, setErrorMsg] = useState("");
  const [photo, setPhoto] = useState("");
  // ตัวนับรอบถ่ายใหม่ — เพิ่มค่าเพื่อให้ effect เปิดกล้องใหม่รอบที่ต้องการ
  const [attempt, setAttempt] = useState(0);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhoto("");
    setErrorMsg("");
    setPhase("starting");
    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setErrorMsg("เบราว์เซอร์นี้ไม่รองรับการใช้กล้อง — ใช้ Chrome หรือ Edge รุ่นใหม่ หรือเลือกรูปจากไฟล์แทน");
          setPhase("error");
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: facing === "environment" ? { ideal: "environment" } : "user" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          try { await video.play(); } catch { /* autoplay อาจถูกหน่วง — ภาพยังขึ้นเมื่อ metadata พร้อม */ }
        }
        setPhase("live");
      } catch (error) {
        if (cancelled) return;
        const name = error instanceof DOMException ? error.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setErrorMsg("ไม่ได้รับอนุญาตให้ใช้กล้อง — คลิกไอคอนกล้องที่แถบที่อยู่ของเบราว์เซอร์ อนุญาตกล้อง แล้วกด “ลองใหม่” หรือเลือกรูปจากไฟล์แทน");
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setErrorMsg("ไม่พบกล้องบนเครื่องนี้ — เสียบเว็บแคมก่อนใช้งาน หรือเลือกรูปจากไฟล์แทนได้");
        } else if (name === "NotReadableError") {
          setErrorMsg("กล้องถูกโปรแกรมอื่นใช้อยู่ — ปิดโปรแกรมนั้นก่อน แล้วกด “ลองใหม่”");
        } else {
          setErrorMsg("เปิดกล้องไม่สำเร็จ — ลองอีกครั้ง หรือเลือกรูปจากไฟล์แทน");
        }
        setPhase("error");
      }
    };
    void start();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [open, attempt, facing]);

  // ปิดกล้องทันทีเมื่อปิดโมดูล/ถอด component ค้างไว้
  useEffect(() => () => stopStream(), []);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const scale = Math.min(1, MAX_OUTPUT_DIM / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    setPhoto(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
    stopStream(); // ถ่ายแล้วหยุดกล้อง — ประหยัด/กันเขิน กดถ่ายใหม่ค่อยเปิดใหม่
  };

  const retake = () => {
    setPhoto("");
    setAttempt((current) => current + 1); // effect เปิดกล้องรอบใหม่
  };

  const usePhoto = () => {
    onCapture(photo);
    onClose();
  };

  const retry = () => {
    setPhoto("");
    setAttempt((current) => current + 1);
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="form-modal camera-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="modal-heading">
          <div>
            <span className="eyebrow">CAMERA CAPTURE · WEBCAM</span>
            <h2>{title}</h2>
            <p>{hint ?? "ภาพจะถูกย่อเหมาะสมก่อนใช้ — ตรวจสอบรูปที่ถ่ายแล้วกด “ใช้รูปนี้”"}</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="ปิดหน้าต่าง"><X size={17} /></button>
        </div>
        <div className="camera-stage-wrap">
          {photo ? (
            <div className="camera-preview">
              <img src={photo} alt="รูปที่ถ่ายได้" />
              <span className="camera-ready-flag"><Check size={13} /> ตรวจสอบรูปก่อนใช้</span>
            </div>
          ) : phase === "error" ? (
            <div className="camera-error" role="alert">
              <CameraOff size={30} />
              <b>เปิดกล้องไม่ได้</b>
              <span>{errorMsg}</span>
              <button type="button" className="outline-button" onClick={retry}><RefreshCw size={15} /> ลองใหม่</button>
            </div>
          ) : (
            <div className={`camera-stage${phase === "starting" ? " starting" : ""}`}>
              <video ref={videoRef} playsInline muted autoPlay aria-label="ภาพจากกล้อง" />
              {phase === "starting" && <div className="camera-starting"><Video size={26} /><b>กำลังเปิดกล้อง…</b><span>ขออนุญาตใช้กล้องตามที่เบราว์เซอร์ถาม</span></div>}
              <span className="camera-guide" aria-hidden="true" />
            </div>
          )}
        </div>
        <div className="modal-actions camera-actions">
          {photo ? (
            <>
              <button type="button" className="outline-button" onClick={retake}><RefreshCw size={15} /> ถ่ายใหม่</button>
              <button type="button" className="primary-button" onClick={usePhoto}><Check size={16} /> ใช้รูปนี้</button>
            </>
          ) : (
            <>
              <button type="button" className="outline-button" onClick={onClose}>เลือกรูปจากไฟล์แทน</button>
              <button type="button" className="primary-button camera-shutter" onClick={capture} disabled={phase !== "live"} aria-label="ถ่ายรูป">
                <Camera size={16} /> ถ่ายรูป
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
