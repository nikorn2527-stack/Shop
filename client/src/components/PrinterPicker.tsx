/**
 * PrinterPicker — dropdown เลือกเครื่องพิมพ์จากรายการนิยม
 * ไม่มีการค้นหา/ตรวจสอบเครื่องพิมพ์จริงในเครื่อง
 * ไม่มีข้อความสถานะ/คำอธิบาย — มีแค่ dropdown + ช่องพิมพ์เอง
 */
import { useState } from "react";

const COMMON_PRINTERS: { group: string; printers: string[] }[] = [
  {
    group: "เครื่องพิมพ์ใบเสร็จ thermal (POS)",
    printers: [
      "EPSON TM-T82II", "EPSON TM-T82", "EPSON TM-T88VI", "EPSON TM-T88V",
      "EPSON TM-T20III", "EPSON TM-T20II", "EPSON TM-U220",
      "Star TSP100III", "Star TSP143",
      "Bixolon SRP-350III", "Bixolon SRP-380",
      "Citizen CT-S310R", "Xprinter XP-58II", "Xprinter XP-80", "Zonerich AB-58K",
    ],
  },
  {
    group: "เครื่องพิมพ์เลเซอร์ (รายงาน A4)",
    printers: [
      "HP LaserJet Pro M404", "HP LaserJet Pro M15", "HP LaserJet 1020", "HP LaserJet P1102",
      "Brother HL-L2321D", "Brother HL-L2365DW",
      "Canon LBP6030", "Canon LBP2900", "Ricoh SP 230SF", "Samsung Xpress M2020",
    ],
  },
  {
    group: "เครื่องพิมพ์อิงค์เจ็ท",
    printers: [
      "HP DeskJet 2332", "HP DeskJet Plus Ink Advantage 4120",
      "Canon PIXMA E3370", "Canon PIXMA G2010",
      "Epson EcoTank L3210", "Epson EcoTank L3110", "Epson L360", "Brother DCP-T310",
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
  const [customMode, setCustomMode] = useState(false);

  const valueIsCustom = value !== "" && !COMMON_PRINTERS.some(g => g.printers.includes(value));
  const effectiveCustomMode = customMode || valueIsCustom;
  const selectedValue = effectiveCustomMode ? OTHER_OPTION : value || "";

  return (
    <div className="printer-picker">
      <select
        className="printer-picker-select"
        value={selectedValue}
        onChange={(event) => {
          const v = event.target.value;
          if (v === OTHER_OPTION) { setCustomMode(true); onChange(""); }
          else { setCustomMode(false); onChange(v); }
        }}
        disabled={disabled}
        aria-label="เลือกเครื่องพิมพ์"
      >
        <option value="">— เลือกเครื่องพิมพ์ —</option>
        {COMMON_PRINTERS.map(group => (
          <optgroup key={group.group} label={group.group}>
            {group.printers.map(name => <option key={name} value={name}>{name}</option>)}
          </optgroup>
        ))}
        <optgroup label="อื่นๆ">
          <option value={OTHER_OPTION}>อื่นๆ (พิมพ์ชื่อเอง)</option>
        </optgroup>
      </select>
      {effectiveCustomMode && (
        <input
          type="text"
          className="printer-picker-custom-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="พิมพ์ชื่อเครื่องพิมพ์ของคุณ"
          disabled={disabled}
          maxLength={80}
        />
      )}
    </div>
  );
}
