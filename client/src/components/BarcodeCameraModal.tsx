import { WorkflowDialog } from "./WorkflowDialog";
import { useEffect, useRef, useState } from "react";
import { Camera, CircleAlert, ScanLine, X, Zap, ZapOff } from "@/lib/icons";

/**
 * ROUND 55 (user) — สแกนบาร์โค้ดด้วยกล้อง (มือถือ/เว็บแคม)
 * สำหรับเครื่องที่ไม่มีปืนสแกน: เปิดกล้องหลังเครื่อง เล็งบาร์โค้ด
 * ให้อยู่ในกรอบ แล้วระบบอ่านค่าให้เอง (สินค้า EAN/UPC/ITF · บัตรสมาชิก
 * Code128 · คิวอาร์โค้ด) แล้วส่งรหัสเข้าช่องค้นหา/ฟอร์มนั้นทันที
 *
 * หมายเหตุสำคัญ: เบราว์เซอร์อนุญาตให้เปิดกล้องเฉพาะ HTTPS หรือ localhost
 * — ถ้าเข้าผ่าน IP ในวงแลน (เช่น http://192.168.x.x:3001) จะเปิดไม่ได้
 * โมดัลนี้จะขึ้นคำแนะนำให้ผู้ใช้ทราบแทนการพังเงียบ ๆ
 */
export function BarcodeCameraModal({
  open,
  title,
  hint,
  onClose,
  onDetect,
}: {
  open: boolean;
  title: string;
  hint?: string;
  onClose: () => void;
  /** ได้รหัสที่อ่านได้แล้ว (โมดัลปิดตัวเองหลังเรียก) */
  onDetect: (code: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [phase, setPhase] = useState<"starting" | "live" | "error">("starting");
  const [errorMsg, setErrorMsg] = useState("");
  const [torchOn, setTorchOn] = useState(false);
  const [lastCode, setLastCode] = useState<string | null>(null);
  // กันปืนกล้องอ่านซ้ำเดิมรัว ๆ ใน 1.8 วิ (สแกนชิ้นเดิมซ้ำต้องรอสักครู่)
  const lastHitRef = useRef<{ code: string; at: number } | null>(null);
  const detectedRef = useRef(false);

  // เสียงบี๊ป + สั่น (ถ้าเครื่องรองรับ) ให้รู้ว่าอ่านได้แล้วไม่ต้องเพ่งจอ
  const feedback = () => {
    try { navigator.vibrate?.(70); } catch { /* บางเบราว์เซอร์/เดสก์ท็อปไม่มี vibration */ }
    try {
      const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return;
      const ctx = new AudioCtor();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 1230;
      gain.gain.value = 0.05;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.11);
      window.setTimeout(() => void ctx.close().catch(() => {}), 400);
    } catch { /* เสียงไม่ออกก็ไม่เป็นไร */ }
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let controls: { stop: () => void } | null = null;
    setPhase("starting");
    setErrorMsg("");
    setLastCode(null);
    setTorchOn(false);
    lastHitRef.current = null;
    detectedRef.current = false;

    (async () => {
      if (typeof window !== "undefined" && !window.isSecureContext) {
        setPhase("error");
        setErrorMsg(
          "เบราว์เซอร์อนุญาตให้เปิดกล้องเฉพาะ HTTPS หรือ localhost เท่านั้น — " +
            "คุณกำลังเข้าด้วย http ผ่าน IP วงใน วิธีแก้: (1) เปิดโหมด HTTPS ที่เซิร์ฟเวอร์ " +
            "(เพิ่ม HTTPS=1 ในไฟล์ .env แล้วรีสตาร์ท แล้วเข้าด้วย https://... — ดูวิธีเต็มที่ ตั้งค่า → การเชื่อมต่อ) " +
            "หรือ (2) เปิดหน้านี้ที่เครื่องเซิร์ฟเวอร์ด้วย localhost"
        );
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setPhase("error");
        setErrorMsg("อุปกรณ์หรือเบราว์เซอร์นี้ไม่รองรับการเปิดกล้อง");
        return;
      }
      try {
        // โหลด ZXing เฉพาะตอนกดใช้ ไม่หน่วงหน้าเว็บตอนเปิดแอป
        const zxing = await import("@zxing/browser");
        const { BarcodeFormat, DecodeHintType } = await import("@zxing/library");
        if (cancelled || !videoRef.current) return;
        const hints = new Map<number, unknown>();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
          BarcodeFormat.CODE_128, BarcodeFormat.CODE_39,
          BarcodeFormat.ITF, BarcodeFormat.QR_CODE,
        ]);
        hints.set(DecodeHintType.TRY_HARDER, true);
        const reader = new zxing.BrowserMultiFormatReader(hints as never, { delayBetweenScanAttempts: 120 });
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } },
          videoRef.current,
          (result) => {
            if (!result || detectedRef.current) return;
            const code = result.getText();
            if (!code) return;
            const now = Date.now();
            if (lastHitRef.current && lastHitRef.current.code === code && now - lastHitRef.current.at < 1800) return;
            lastHitRef.current = { code, at: now };
            setLastCode(code);
            feedback();
            detectedRef.current = true;
            onDetect(code);
          },
        );
        if (!cancelled) setPhase("live");
      } catch (err) {
        if (cancelled) return;
        setPhase("error");
        const message = String((err as Error)?.message ?? err ?? "");
        if (/NotAllowed|Permission|denied/i.test(message)) setErrorMsg("ไม่ได้รับอนุญาตให้ใช้กล้อง — กดอนุญาตกล้องในเบราว์เซอร์ (ไอคอน 🔒 ในแถบที่อยู่) แล้วลองใหม่");
        else if (/NotFound|no camera|Requested device/i.test(message)) setErrorMsg("ไม่พบกล้องบนอุปกรณ์นี้ — ตรวจกล้อง/เว็บแคม หรือปิดแอปอื่นที่ใช้กล้องอยู่");
        else if (/NotReadable|Track start/i.test(message)) setErrorMsg("กล้องถูกแอปอื่นใช้อยู่ — ปิดโปรแกรมที่เปิดกล้างกล้องแล้วลองใหม่");
        else setErrorMsg(`เปิดกล้องไม่สำเร็จ: ${message.slice(0, 160)}`);
      }
    })();

    return () => {
      cancelled = true;
      try { controls?.stop(); } catch { /* กล้องปิดไปแล้ว */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggleTorch = async () => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    const track = stream?.getVideoTracks?.()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] } as unknown as MediaTrackConstraints);
      setTorchOn((on) => !on);
    } catch {
      setErrorMsg("เครื่องนี้ไม่รองรับไฟฉายกล้อง");
      setPhase("error");
      window.setTimeout(() => { if (!detectedRef.current) { setPhase("live"); setErrorMsg(""); } }, 1600);
    }
  };

  // Esc ปิดกล้อง (จับตั้งแต่ capture phase — ไม่ให้ Escape handler ของหน้า/โมดัลแม่
  // ทำงานพร้อมกัน เช่น ปิด wallet modal ที่กล้องเปิดอยู่ข้างใน)


  if (!open) return null;

  return (
    <WorkflowDialog title={title} onClose={onClose} className="form-modal barcode-camera-modal">
        <div className="modal-heading">
          <div>
            <span className="eyebrow">CAMERA SCANNER</span>
            <h2>{title}</h2>
            {hint ? <p>{hint}</p> : null}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="ปิดหน้าต่าง"><X size={17} /></button>
        </div>
        <div className={`camera-stage-wrap barcode-stage-wrap${phase === "live" ? "" : ` ${phase}`}`}>
          <div className="camera-stage barcode-stage">
            <video ref={videoRef} playsInline muted />
            {phase === "live" && (
              <div className="barcode-frame" aria-hidden="true">
                <i /><i /><i /><i />
                <span className="barcode-scanline" />
              </div>
            )}
            {phase === "starting" && (
              <div className="camera-overlay">
                <Camera size={30} />
                <b>กำลังเปิดกล้อง…</b>
                <small>ถ้าเบราว์เซอร์ถามสิทธิ์กล้อง ให้กดอนุญาต</small>
              </div>
            )}
            {phase === "error" && (
              <div className="camera-overlay error">
                <CircleAlert size={30} />
                <b>เปิดกล้องไม่ได้</b>
                <small>{errorMsg}</small>
                <button type="button" className="outline-button compact" onClick={onClose}>ปิดหน้าต่างนี้</button>
              </div>
            )}
          </div>
          {phase === "live" && (
            <div className="barcode-stage-foot">
              <span className="barcode-live-hint"><ScanLine size={14} /> เล็งบาร์โค้ดให้อยู่ในกรอบ — อ่านได้จะมีเสียงบี๊ปและปิดอัตโนมัติ</span>
              <button
                type="button"
                className={`mini-button torch-btn${torchOn ? " on" : ""}`}
                onClick={() => void toggleTorch()}
                aria-pressed={torchOn}
                aria-label={torchOn ? "ปิดไฟฉายกล้อง" : "เปิดไฟฉายกล้อง"}
                title={torchOn ? "ปิดไฟฉาย (ถ่ายบาร์โค้ดในที่มืด)" : "เปิดไฟฉาย (ถ่ายบาร์โค้ดในที่มืด)"}
              >
                {torchOn ? <ZapOff size={13} /> : <Zap size={13} />} {torchOn ? "ปิดไฟ" : "ไฟฉาย"}
              </button>
            </div>
          )}
        </div>
        {lastCode && (
          <div className="barcode-last-code" role="status" aria-live="polite">
            <ScanLine size={14} /> อ่านล่าสุด: <b>{lastCode}</b>
          </div>
        )}
      </WorkflowDialog>
  );
}
