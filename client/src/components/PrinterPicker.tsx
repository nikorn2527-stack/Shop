/**
 * PrinterPicker — Task A2: ดึงรายชื่อเครื่องพิมพ์ที่ติดตั้งจริงจาก Local Printer Helper
 *
 * ลบ hardcode list ออกหมด — ใช้รายชื่อจริงจาก GET /printers?XTransformPort=3031
 * ถ้า Helper ไม่ทำงาน → แสดงสถานะชัดเจน + ให้ใช้ browser print เป็น fallback
 * มีปุ่มรีเฟรช + ปุ่มพิมพ์ทดสอบ (POST /printers/test?XTransformPort=3031)
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
  error: string | null;
  connected: boolean;
  source: string | null;
};

type PrinterPickerProps = {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  /** ประเภทเอกสาร: ใบเสร็จ/รายงาน/บัตร (ใช้ในการพิมพ์ทดสอบ) */
  docType?: "receipt" | "report" | "card";
};

export function PrinterPicker({ value, onChange, disabled = false, docType = "receipt" }: PrinterPickerProps) {
  const [state, setState] = useState<HelperState>({
    printers: [],
    loading: true,
    error: null,
    connected: false,
    source: null,
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const fetchPrinters = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch("/printers?XTransformPort=3031");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setState({
        printers: data.printers ?? [],
        loading: false,
        error: data.error ?? null,
        connected: true,
        source: data.source ?? null,
      });
    } catch (err) {
      setState({
        printers: [],
        loading: false,
        error: err instanceof Error ? err.message : String(err),
        connected: false,
        source: null,
      });
    }
  }, []);

  // Fetch on mount
  useEffect(() => { fetchPrinters(); }, [fetchPrinters]);

  const handleTestPrint = async () => {
    if (!value || !state.connected) return;
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

  // Render states
  if (state.loading) {
    return (
      <div className="printer-picker-block">
        <div className="printer-picker-status loading">
          <RefreshCw size={14} className="spin" /> กำลังอ่านรายชื่อเครื่องพิมพ์...
        </div>
      </div>
    );
  }

  if (!state.connected) {
    // A5 — Fallback: Helper ไม่ทำงาน → แจ้งชัดเจน + ให้ใช้ browser print
    return (
      <div className="printer-picker-block">
        <div className="printer-picker-status error">
          <CircleAlert size={14} /> ยังไม่ได้เชื่อมต่อ Local Printer Helper — ใช้ Browser Print Dialog เป็น fallback
        </div>
        <div className="printer-picker-hint">
          <b>วิธีติดตั้ง:</b> เปิด Terminal แล้วรัน<br />
          <code>cd mini-services/printer-helper && bun run dev</code>
        </div>
        <button className="detect-btn" onClick={fetchPrinters} disabled={disabled}>
          <RefreshCw size={13} /> ลองเชื่อมต่อใหม่
        </button>
        <details className="printer-picker-fallback">
          <summary>ใช้ Browser Print Dialog (fallback)</summary>
          <input
            type="text"
            className="printer-picker-custom-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="ชื่อเครื่องพิมพ์ (ถ้ารู้) หรือเว้นว่างเพื่อใช้ default"
            disabled={disabled}
            maxLength={80}
          />
          <small>⚠️ ถ้าไม่ได้ติดตั้ง Helper ระบบจะใช้ window.print() ซึ่ง browser เป็นผู้เลือกเครื่องพิมพ์เอง</small>
        </details>
      </div>
    );
  }

  if (state.printers.length === 0) {
    return (
      <div className="printer-picker-block">
        <div className="printer-picker-status warning">
          <CircleAlert size={14} /> เชื่อมต่อ Helper แล้ว แต่ไม่พบเครื่องพิมพ์ในระบบ ({state.source})
        </div>
        <div className="printer-picker-hint">
          ติดตั้งเครื่องพิมพ์ใน Windows Settings → Printers & Scanners แล้วกดรีเฟรช
        </div>
        <button className="detect-btn" onClick={fetchPrinters} disabled={disabled}>
          <RefreshCw size={13} /> รีเฟรชรายชื่อ
        </button>
      </div>
    );
  }

  // Normal: show real printers from helper
  const selectedPrinter = state.printers.find((p) => p.name === value);
  const isOffline = selectedPrinter && selectedPrinter.status === "offline";

  return (
    <div className="printer-picker-block">
      <div className="printer-picker-header">
        <div className="printer-picker-status ok">
          <Check size={13} /> เชื่อมต่อ Helper แล้ว ({state.source}) · {state.printers.length} เครื่องพิมพ์
        </div>
        <button className="detect-btn" onClick={fetchPrinters} disabled={disabled} title="รีเฟรชรายชื่อเครื่องพิมพ์">
          <RefreshCw size={13} /> รีเฟรช
        </button>
      </div>
      <select
        className="printer-picker-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={`เลือกเครื่องพิมพ์${docType === "receipt" ? "ใบเสร็จ" : docType === "report" ? "รายงาน" : "บัตรสมาชิก"}`}
      >
        <option value="">— เลือกเครื่องพิมพ์ —</option>
        {state.printers.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}{p.isDefault ? " (ค่าเริ่มต้น)" : ""}{p.status === "offline" ? " [ออฟไลน์]" : ""}
          </option>
        ))}
      </select>
      {isOffline && (
        <div className="printer-picker-status warning">
          <CircleAlert size={13} /> ⚠️ เครื่องพิมพ์นี้ออฟไลน์อยู่ — อาจพิมพ์ไม่สำเร็จ
        </div>
      )}
      {value && (
        <button className="test-print-btn" onClick={handleTestPrint} disabled={disabled || testing}>
          <Printer size={14} /> {testing ? "กำลังพิมพ์ทดสอบ..." : "พิมพ์ทดสอบ"}
        </button>
      )}
      {testResult && (
        <div className={`test-print-result ${testResult.ok ? "ok" : "error"}`}>
          {testResult.ok ? <Check size={13} /> : <CircleAlert size={13} />}
          {testResult.message}
          <button className="test-print-dismiss" onClick={() => setTestResult(null)} aria-label="ปิด">
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
