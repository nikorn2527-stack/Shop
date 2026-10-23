import { trpc } from "@/lib/trpc";
import { formatLogDateTime } from "@/pages/viewFormat";
import { WorkflowDialog } from "./WorkflowDialog";

const amount = (value: number | null, digits = 2) => value === null ? "ไม่ทราบต้นทุน" : `฿${value.toLocaleString("th-TH", {minimumFractionDigits:digits,maximumFractionDigits:digits})}`;

export function StockReceiptSourceDialog({lotId,onClose}:{lotId:number;onClose:()=>void}) {
  const query = trpc.stock.receiptSource.useQuery({lotId});
  const receipt = query.data;
  return <WorkflowDialog title="รายการรับเข้าที่ใช้อ้างอิงต้นทุน" onClose={onClose} className="form-modal receive-source-dialog">
    <div className="modal-heading"><h2>รายการรับเข้าที่ใช้อ้างอิงต้นทุน</h2><button type="button" className="icon-button" aria-label="ปิดรายละเอียดรับเข้า" onClick={onClose}>×</button></div>
    {query.isLoading ? <p role="status">กำลังโหลดรายการรับเข้า…</p> : query.isError ? <div role="alert"><p>{query.error.message}</p><button type="button" className="outline-button" onClick={()=>void query.refetch()}>ลองใหม่</button></div> : receipt && <>
      <p className="receive-source-reference">{receipt.reference}</p>
      <p>{receipt.sku} · {receipt.name}</p>
      <dl className="receive-source-summary">
        <div><dt>วันที่รับเข้า</dt><dd>{formatLogDateTime(receipt.receivedAt)}</dd></div>
        <div><dt>ผู้บันทึก</dt><dd>{Array.from(new Set(receipt.lines.map(line=>line.actor ?? "ไม่ระบุ"))).join(" · ")}</dd></div>
        <div><dt>จำนวนรับรวมแถม</dt><dd>{receipt.quantity === null ? "ไม่ระบุ" : `${receipt.quantity} ${receipt.unit}`}</dd></div>
        <div><dt>ยอดจ่ายรอบนั้น</dt><dd>{amount(receipt.paidAmount)}</dd></div>
        <div><dt>ต้นทุนเฉลี่ย / {receipt.unit}</dt><dd>{amount(receipt.unitCost,4)}</dd></div>
      </dl>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Lot</th><th>จำนวนรับ</th><th>มูลค่าต้นทุน</th><th>หมดอายุ</th></tr></thead><tbody>{receipt.lines.map(line=><tr key={line.id}><td>{line.lot}</td><td>{line.receivedQty ?? "ไม่ระบุ"}</td><td>{amount(line.receivedValueSatang === null ? null : line.receivedValueSatang/100)}</td><td>{line.expiry ?? "ไม่ระบุ"}</td></tr>)}</tbody></table></div>
      <p className="receive-source-note">เลขอ้างอิงรายการรับเข้าในระบบ ไม่ใช่เลขใบเสร็จผู้ขาย · ต้นทุนคำนวณจากยอดจ่าย ÷ จำนวนรับรวมแถมในครั้งนั้น</p>
    </>}
    <div className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>กลับไปกรอกรับเข้า</button></div>
  </WorkflowDialog>;
}
