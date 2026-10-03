/**
 * PrinterPicker — Task A2 v2: รายชื่อเครื่องพิมพ์จริงจาก Windows
 *
 * โครงสร้างใหม่ตามผู้ใช้ระบุ:
 * - สถานะ Helper แสดงครั้งเดียวด้านบน (ไม่ซ้ำในแต่ละแถว)
 * - แต่ละแถว: dropdown รายชื่อจริง + ปุ่มพิมพ์ทดสอบ
 * - บันทึกการตั้งค่าตามเครื่อง (localStorage) ไม่ใช่ server settings
 * - ถ้า Helper ไม่ทำงาน → แสดงครั้งเดียวด้านบน + ปุ่มเชื่อมต่อใหม่
 * - Fallback browser print เป็นทางเลือกสำรอง ไม่ใช่ระบบหลัก
 */
import { useCallback, useEffect, useState } from "react";
import { Check, CircleAlert, Printer, RefreshCw, X } from "@/lib/icons";

type PrinterInfo = {
  name: string;
  isDefault?: boolean;
  status?: string;
};

type HelperState = {
  printers: PrinterInfo[];
  loading: boolean;
  connected: boolean;
  source: string | null;
  error: string | null;
};

type PrinterPickerProps = {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  docType?: "receipt" | "report" | "card";
};

const DOC_LABELS: Record<string, string> = {
  receipt: "ใบเสร็จ",
  report: "รายงาน",
  card: "บัตรสมาชิก",
};

export function PrinterPicker({ value, onChange, disabled = false, docType = "receipt" }: PrinterPickerProps) {
  const [state, setHelperState] = useState<HelperState>({
    printers: [],
    loading: true,
    connected: false,
    source: null,
    error: null,
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const fetchPrinters = useCallback(async () => {
    setHelperState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch("/printers?XTransformPort=3031");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setHelperState({
        printers: data.printers ?? [],
        loading: false,
        connected: true,
        source: data.source ?? null,
        error: data.error ?? null,
      });
    } catch (err) {
      setHelperState({
        printers: [],
        loading: false,
        connected: false,
        source: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  useEffect(() => { fetchPrinters(); }, [fetchPrinters]);

  const handleTestPrint = async () => {
    if (!value) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/printers/test?XTransformPort=3031", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ printerName: value }),
      });
      const data = await res.json();
      setTestResult({ ok: data.ok, message: data.message ?? (data.ok ? "ส่งงานพิมพ์แล้ว" : "ไม่สำเร็จ") });
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  // ถ้า Helper ไม่ทำงาน → ไม่แสดง dropdown ใบ้้ แสดงเฉพาะสถานะ + ปุ่มเชื่อมต่อใหม่
  if (state.loading) {
    return (
      <div className="printer-picker-row">
        <div className="printer-picker-loading">
          <RefreshCw size={13} className="spin" /> กำลังอ่านรายชื่อเครื่องพิมพ์...
        </div>
      </div>
    );
  }

  if (!state.connected) {
    // แสดงครั้งเดียว: "ยังไม่เชื่อมต่อ Helper" + ปุ่มเชื่อมต่อใหม่ (ไม่ซ้ำ)
    return (
      <div className="printer-picker-row">
        <div className="printer-picker-no-helper">
          <CircleAlert size={14} />
          <span>ยังไม่เชื่อมต่อ Local Printer Helper — ไม่สามารถเลือกเครื่องพิมพ์จริงได้</span>
          <button className="detect-btn" onClick={fetchPrinters} disabled={disabled}>
            <RefreshCw size={13} /> เชื่อมต่อใหม่
          </button>
        </div>
        <details className="printer-fallback-details">
          <summary>ใช้ Browser Print Dialog (สำรอง)</summary>
          <small>⚠️ ไม่แนะนำ — browser เป็นผู้เลือกเครื่องพิมพ์เอง ไม่ใช่ระบบ</small>
        </details>
      </div>
    );
  }

  // กรณีเชื่อมต่อได้แต่ไม่มี printer ในระบบ
  if (state.printers.length === 0) {
    return (
      <div className="printer-picker-row">
        <div className="printer-picker-no-printer">
          <CircleAlert size={14} />
          <span>เชื่อมต่อ Helper แล้ว แต่ไม่พบเครื่องพิมพ์ในเครื่อง ({state.source})</span>
          <button className="detect-btn" onClick={fetchPrinters} disabled={disabled}>
            <RefreshCw size={13} /> รีเฟรช
          </button>
        </div>
      </div>
    );
  }

  // กรณีปกติ: มีรายชื่อ printer จริง → แสดง dropdown + ปุ่มพิมพ์ทดสอบ
  const selectedPrinter = state.printers.find((p) => p.name === value);
  const isOffline = selectedPrinter?.status === "offline";

  return (
    <div className="printer-picker-row">
      <select
        className="printer-picker-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={`เลือกเครื่องพิมพ์${DOC_LABELS[docType] ?? ""}`}
      >
        <option value="">— เลือกเครื่องพิมพ์ —</option>
        {state.printers.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}{p.isDefault ? " (ค่าเริ่มต้น)" : ""}{p.status === "offline" ? " [ออฟไลน์]" : ""}
          </option>
        ))}
      </select>
      {isOffline && (
        <span className="printer-offline-warning">⚠️ ออฟไลน์</span>
      )}
      <button
        className="test-print-btn"
        onClick={handleTestPrint}
        disabled={disabled || testing || !value}
        title={value ? `พิมพ์ทดสอบไปยัง ${value}` : "เลือกเครื่องพิมพ์ก่อน"}
      >
        <Printer size={14} /> {testing ? "กำลังพิมพ์..." : "พิมพ์ทดสอบ"}
      </button>
      {testResult && (
        <span className={`test-print-result ${testResult.ok ? "ok" : "error"}`}>
          {testResult.ok ? <Check size={12} /> : <CircleAlert size={12} />}
          {testResult.message}
          <button className="test-print-dismiss" onClick={() => setTestResult(null)}>
            <X size={11} />
          </button>
        </span>
      )}
    </div>
  );
}

/**
 * PrinterHelperStatus — แสดงสถานะ Helper ครั้งเดียวด้านบนหน้า
 * (ไม่ซ้ำในแต่ละแถวประเภทเอกสาร)
 */
export function PrinterHelperStatus() {
  const [status, setStatus] = useState<"loading" | "connected" | "disconnected">("loading");
  const [info, setInfo] = useState<{ count: number; source: string | null } | null>(null);

  const check = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch("/printers?XTransformPort=3031");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setStatus("connected");
      setInfo({ count: data.printers?.length ?? 0, source: data.source ?? null });
    } catch {
      setStatus("disconnected");
      setInfo(null);
    }
  }, []);

  useEffect(() => { check(); }, [check]);

  return (
    <div className={`printer-helper-status ${status}`}>
      {status === "loading" && (<><RefreshCw size={14} className="spin" /> กำลังตรวจสอบ...</>)}
      {status === "connected" && info && (
        <>
          <Check size={14} /> <b>เชื่อมต่อ Local Printer Helper แล้ว</b> · {info.count} เครื่องพิมพ์ ({info.source})
          <button className="detect-btn" onClick={check}><RefreshCw size={12} /> รีเฟรช</button>
        </>
      )}
      {status === "disconnected" && (
        <>
          <CircleAlert size={14} /> <b>ยังไม่เชื่อมต่อ Local Printer Helper</b>
          <button className="detect-btn" onClick={check}><RefreshCw size={12} /> เชื่อมต่อใหม่</button>
          <details className="printer-install-hint">
            <summary>วิธีติดตั้ง</summary>
            <small>เปิด Terminal รัน: <code>cd mini-services/printer-helper && bun run dev</code></small>
          </details>
        </>
      )}
    </div>
  );
}
