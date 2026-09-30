/**
 * FIX-10 (user) — PrinterPicker: dropdown เลือกเครื่องพิมพ์
 *
 * owner อยากเลือกเครื่องพิมพ์จากรายการ ไม่ใช่แค่พิมพ์ชื่อ —
 * แต่ Web API ไม่อนุญาตให้เว็บ enumerate เครื่องพิมพ์ในระบบโดยตรง
 * (security restriction กันเว็บร้ายสั่งพิมพ์เงียบๆ ไปยังเครื่องผู้ใช้).
 *
 * ทางออก 2 ทาง:
 * 1) ลอง `navigator.printing.printers` API (Chrome ≥ 100 ที่เปิด enterprise policy
 *    "AllowPrinters" — ส่วนน้อยที่ใช้ได้ ถ้าได้จะ list เครื่องพิมพ์จริงในเครื่อง)
 * 2) Fallback: dropdown รายการเครื่องพิมพ์ที่นิยมในไทย แบ่งหมวด (thermal POS /
 *    เลเซอร์ / อิงค์เจ็ท) + ตัวเลือก "อื่นๆ (พิมพ์เอง)" ที่เปิด text input
 *
 * ค่าที่เลือกเก็บใน `defaultPrinterName` field ของ StoreSettings — แสดงเป็น hint
 * ข้างปุ่มพิมพ์ (badge 🖨) + tooltip ให้ผู้ใช้จำได้ตอนเลือกใน dialog ของ browser
 * (browser ยังถาม printer เองใน print dialog — security restriction)
 */
import { useEffect, useState } from "react";
import { Printer, RefreshCw, Search } from "@/lib/icons";

/** รายการเครื่องพิมพ์ที่นิยมในไทย แบ่งตามหมวด — ใช้ตอน browser ไม่ให้ enumerate จริง */
const COMMON_THAI_PRINTERS: { group: string; printers: string[] }[] = [
  {
    group: "เครื่องพิมพ์ใบเสร็จ thermal (POS)",
    printers: [
      "EPSON TM-T82II",
      "EPSON TM-T82",
      "EPSON TM-T88VI",
      "EPSON TM-T88V",
      "EPSON TM-T20III",
      "EPSON TM-T20II",
      "EPSON TM-U220",
      "Star TSP100III",
      "Star TSP143",
      "Bixolon SRP-350III",
      "Bixolon SRP-380",
      "Citizen CT-S310R",
      "Xprinter XP-58II",
      "Xprinter XP-80",
      "Zonerich AB-58K",
    ],
  },
  {
    group: "เครื่องพิมพ์เลเซอร์ (รายงาน A4)",
    printers: [
      "HP LaserJet Pro M404",
      "HP LaserJet Pro M15",
      "HP LaserJet 1020",
      "HP LaserJet P1102",
      "Brother HL-L2321D",
      "Brother HL-L2365DW",
      "Canon LBP6030",
      "Canon LBP2900",
      "Ricoh SP 230SF",
      "Samsung Xpress M2020",
    ],
  },
  {
    group: "เครื่องพิมพ์อิงค์เจ็ท",
    printers: [
      "HP DeskJet 2332",
      "HP DeskJet Plus Ink Advantage 4120",
      "Canon PIXMA E3370",
      "Canon PIXMA G2010",
      "Epson EcoTank L3210",
      "Epson EcoTank L3110",
      "Epson L360",
      "Brother DCP-T310",
    ],
  },
];

const OTHER_OPTION = "__other__";

type PrinterPickerProps = {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
};

export function PrinterPicker({ value, onChange, disabled = false }: PrinterPickerProps) {
  // printers: null = ยังไม่ได้ตรวจสอบ, string[] = รายการเครื่องพิมพ์ที่ enumerate ได้จากระบบ, [] = ตรวจแล้วแต่ไม่ได้รับอนุญาต
  const [systemPrinters, setSystemPrinters] = useState<string[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [detectSource, setDetectSource] = useState<string>(""); // "helper" | "browser API" | "fallback"

  // ลอง enumerate เครื่องพิมพ์จริงในระบบ 3 ทางตามลำดับ:
  // 1) mini-service printer-helper (port 3031) — รัน OS commands (wmic/lpstat) → list จริง
  // 2) navigator.printing.printers API (Chrome enterprise เท่านั้น — ส่วนน้อย)
  // 3) fallback รายการเครื่องพิมพ์นิยม 33 รุ่น
  const detectPrinters = async () => {
    setChecking(true);
    try {
      // 1) ลอง fetch จาก printer-helper mini-service (port 3031)
      // gateway pattern: relative URL + ?XTransformPort=3031
      // on-premise: web app → http://localhost:3031/printers (same machine)
      const res = await fetch("/printers?XTransformPort=3031", { signal: AbortSignal.timeout(2500) });
      if (res.ok) {
        const data = (await res.json()) as { printers?: string[]; source?: string };
        if (Array.isArray(data.printers) && data.printers.length > 0) {
          setSystemPrinters(data.printers);
          setDetectSource(`helper (${data.source ?? "unknown"})`);
          setChecking(false);
          return;
        }
        // helper ตอบกลับมาแต่ list ว่าง (browser/OS ไม่มีเครื่องพิมพ์ติดตั้ง)
        setSystemPrinters([]);
        setDetectSource(`helper (${data.source ?? "unknown"}) — ไม่พบเครื่องพิมพ์`);
        setChecking(false);
        return;
      }
    } catch {
      // helper ไม่ได้รันอยู่ หรือ fetch ล้มเหลว → ลอง navigator.printing ต่อ
    }
    try {
      // 2) ลอง navigator.printing.printers (Chrome enterprise เท่านั้น)
      const printing = (navigator as unknown as { printing?: { printers?: Promise<Array<{ name: string }>> | Array<{ name: string }> } }).printing;
      if (printing && typeof printing.printers !== "undefined") {
        const printersResult = await Promise.resolve(printing.printers);
        if (Array.isArray(printersResult) && printersResult.length > 0) {
          setSystemPrinters(printersResult.map((p) => p.name));
          setDetectSource("browser API (navigator.printing)");
          setChecking(false);
          return;
        }
      }
    } catch {
      // navigator.printing ไม่ได้รับอนุญาต → ใช้ fallback list
    }
    // 3) fallback รายการเครื่องพิมพ์นิยม
    setSystemPrinters([]);
    setDetectSource("fallback รายการนิยม");
    setChecking(false);
  };

  useEffect(() => {
    // ตรวจทันทีตอน mount — ถ้า browser ไม่มี API จะได้ใช้ fallback ทันที
    void detectPrinters();
  }, []);

  // กำหนดค่า dropdown current selection
  const valueIsCustom = value !== "" && !systemPrinters?.includes(value) && !COMMON_THAI_PRINTERS.some(group => group.printers.includes(value));
  const effectiveCustomMode = customMode || valueIsCustom;
  const selectedValue = effectiveCustomMode ? OTHER_OPTION : value || "";

  // รายการ options ที่จะแสดง — ใช้ system ถ้ามี ไม่งั้นใช้ common list
  const options: { group: string; printers: string[] }[] = systemPrinters && systemPrinters.length > 0
    ? [{ group: "เครื่องพิมพ์ในระบบนี้", printers: systemPrinters }]
    : COMMON_THAI_PRINTERS;

  const hasSystemPrinters = !!(systemPrinters && systemPrinters.length > 0);
  const apiAvailable = systemPrinters !== null && systemPrinters.length > 0;

  return (
    <div className="printer-picker">
      <div className="printer-picker-row">
        <select
          className="printer-picker-select"
          value={selectedValue}
          onChange={(event) => {
            const v = event.target.value;
            if (v === OTHER_OPTION) {
              setCustomMode(true);
              onChange("");
            } else {
              setCustomMode(false);
              onChange(v);
            }
          }}
          disabled={disabled}
          aria-label="เลือกเครื่องพิมพ์"
          title="เลือกเครื่องพิมพ์จากรายการ — ถ้าของคุณไม่อยู่ในรายการ เลือก 'อื่นๆ' แล้วพิมพ์ชื่อเอง"
        >
          <option value="">— ยังไม่เลือกเครื่องพิมพ์ —</option>
          {options.map(group => (
            <optgroup key={group.group} label={group.group}>
              {group.printers.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </optgroup>
          ))}
          <optgroup label="อื่นๆ">
            <option value={OTHER_OPTION}>อื่นๆ (พิมพ์ชื่อเอง)</option>
          </optgroup>
        </select>
        <button
          type="button"
          className="outline-button compact printer-detect-btn"
          onClick={() => void detectPrinters()}
          disabled={disabled || checking}
          title="ค้นหาเครื่องพิมพ์ในเครื่องนี้ (browser อาจไม่อนุญาต — ส่วนใหญ่ใช้รายการนิยมแทน)"
          aria-label="ค้นหาเครื่องพิมพ์ในระบบ"
        >
          <Search size={14} />
          {checking ? "กำลังค้นหา..." : "ค้นหาในเครื่อง"}
        </button>
      </div>
      {effectiveCustomMode && (
        <input
          type="text"
          className="printer-picker-custom-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="พิมพ์ชื่อเครื่องพิมพ์ของคุณ (เช่น Canon G2010)"
          disabled={disabled}
          maxLength={80}
          aria-label="ชื่อเครื่องพิมพ์ที่กำหนดเอง"
        />
      )}
      <div className={`printer-picker-status${hasSystemPrinters ? " ok" : apiAvailable === false ? " fallback" : ""}`}>
        <Printer size={14} />
        {checking ? (
          <span>กำลังตรวจสอบเครื่องพิมพ์ในระบบ...</span>
        ) : hasSystemPrinters ? (
          <span>พบ <b>{systemPrinters!.length}</b> เครื่องพิมพ์ในเครื่องนี้ · แหล่งข้อมูล: {detectSource} — เลือกได้จาก dropdown ด้านบน</span>
        ) : apiAvailable === false ? (
          <span>
            ไม่พบเครื่องพิมพ์ในระบบ (หรือ helper ไม่ได้รัน) — แหล่งข้อมูล: {detectSource}
            <br />
            <small>ติดตั้ง/รัน <b>printer-helper</b> (port 3031) เพื่อ enumerate เครื่องพิมพ์จริงในเครื่อง → รัน <code>cd mini-services/printer-helper && bun run dev</code> แล้ว refresh หน้านี้</small>
            <br />
            <small>ถ้าไม่รัน helper หรือ browser ไม่อนุญาต → ใช้รายการนิยมด้านบน หรือกด <RefreshCw size={12} /> "ค้นหาในเครื่อง" เพื่อลองใหม่ · ตอนกดปุ่มพิมพ์ browser จะเปิด dialog ให้เลือกเครื่องพิมพ์จริงเองอยู่ดี</small>
          </span>
        ) : (
          <span>ใช้รายการเครื่องพิมพ์ที่นิยม — กด "ค้นหาในเครื่อง" เพื่อลอง enumerate เครื่องพิมพ์จริง (ต้องรัน printer-helper)</span>
        )}
      </div>
    </div>
  );
}
