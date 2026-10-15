import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { getErrorMessage } from "@/pages/viewFormat";

const labels = {
  blank: "ว่าง",
  assigned: "ใช้งาน",
  returned_vacant: "คืนแล้ว · ว่าง",
  lost: "หาย",
  damaged: "ชำรุด",
};

function staffName(value: string | null | undefined) {
  return !value?.trim() || value === "เตรียมชุดเดโมตามคำสั่งเจ้าของระบบ" ? "Auto System" : value;
}

export function CardInventory({ canManage }: { canManage: boolean }) {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [codes, setCodes] = useState("");
  const [creationMode, setCreationMode] = useState<"auto" | "existing">("auto");
  const [prefix, setPrefix] = useState("CARD-");
  const [digits, setDigits] = useState(5);
  const [count, setCount] = useState(20);
  const [scanCode, setScanCode] = useState("");
  const preview = trpc.card.previewNumbers.useQuery({ prefix, digits, count }, { enabled: canManage && creationMode === "auto" && count >= 1 && count <= 500 });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [historyCard, setHistoryCard] = useState("");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const historyDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (historyCard && historyDialog.current && !historyDialog.current.open) {
      historyDialog.current.showModal();
    }
  }, [historyCard]);
  const history = trpc.card.history.useQuery({ cardNumber: historyCard }, { enabled: Boolean(historyCard) });
  const cards = trpc.card.list.useQuery(
    { search },
    { refetchOnMount: "always" }
  );
  const refresh = () => {
    setError("");
    setNotice("บันทึกแล้ว");
    void utils.card.list.invalidate();
    void utils.card.previewNumbers.invalidate();
    void utils.card.history.invalidate();
    void utils.member.list.invalidate();
    void utils.member.detail.invalidate();
    void utils.logs.list.invalidate();
  };
  const create = trpc.card.create.useMutation({
    onSuccess: () => {
      setCodes("");
      refresh();
    },
    onError: e => setError(getErrorMessage(e)),
  });
  const release = trpc.card.release.useMutation({
    onSuccess: refresh,
    onError: e => setError(getErrorMessage(e)),
  });
  const generate = trpc.card.generate.useMutation({
    onSuccess: result => {
      refresh();
      setNotice(`สร้าง ${result.count} ใบ · ${result.first} ถึง ${result.last}`);
    },
    onError: e => setError(getErrorMessage(e)),
  });
  const addScan = () => {
    const code = scanCode.trim();
    if (!code) return;
    const existing = codes.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (existing.includes(code)) { setError(`รหัส ${code} อยู่ในรายการแล้ว`); return; }
    setCodes([...existing, code].join("\n"));
    setScanCode("");
    setError("");
  };
  const mark = trpc.card.mark.useMutation({
    onSuccess: refresh,
    onError: e => setError(getErrorMessage(e)),
  });
  const pending = create.isPending || generate.isPending || release.isPending || mark.isPending;
  return (
    <section className="panel card-inventory" aria-label="จัดการบัตรเปล่า">
      <div className="card-inventory-toolbar">
      <h2>บัตรเปล่า / บัตรหมุนเวียน</h2>
      <label className="card-inventory-search">
        ค้นหารหัสบัตร / เลขสมาชิก
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="รหัสบัตร / เลขสมาชิก" />
      </label>
      {canManage && <button type="button" className="outline-button" aria-expanded={builderOpen} aria-controls="card-inventory-builder" disabled={pending} onClick={() => setBuilderOpen(open => !open)}>{builderOpen ? "ซ่อนส่วนเพิ่มบัตร" : "เพิ่มบัตรเปล่า"}</button>}
      </div>
      {canManage && builderOpen && (
        <div className="card-inventory-builder" id="card-inventory-builder">
          <div role="tablist" aria-label="วิธีเพิ่มบัตร">
            <button type="button" role="tab" aria-selected={creationMode === "auto"} disabled={pending} onClick={() => { setCreationMode("auto"); setError(""); }}>สร้างเลขอัตโนมัติ</button>
            <button type="button" role="tab" aria-selected={creationMode === "existing"} disabled={pending} onClick={() => { setCreationMode("existing"); setError(""); }}>ใช้รหัสบัตรเดิม</button>
          </div>
          {creationMode === "auto" ? <div role="tabpanel" aria-label="สร้างเลขอัตโนมัติ">
            <div className="card-number-fields">
              <label>คำนำหน้า<input value={prefix} maxLength={16} disabled={pending} onChange={e => setPrefix(e.target.value)} placeholder="CARD-" /></label>
              <label>จำนวนหลัก<select value={digits} disabled={pending} onChange={e => setDigits(Number(e.target.value))}>{[3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n} หลัก</option>)}</select></label>
              <label>จำนวนบัตร<input type="number" min={1} max={500} value={count} disabled={pending} onChange={e => setCount(Number(e.target.value))} /></label>
            <button type="button" className="primary-button" disabled={pending || preview.isFetching || !preview.data || !!preview.error || count < 1 || count > 500} onClick={() => { setError(""); generate.mutate({ prefix, digits, count }); }}>{generate.isPending ? "กำลังสร้าง…" : "สร้างบัตรเปล่า"}</button>
            </div>
            <p role="status">{preview.isFetching ? "กำลังตรวจเลขถัดไป…" : preview.error ? getErrorMessage(preview.error) : preview.data ? `เลขถัดไป ${preview.data.first} – ${preview.data.last}` : "ระบุจำนวน 1–500 ใบ"}</p>
          </div> : <div role="tabpanel" aria-label="ใช้รหัสบัตรเดิม">
            <div className="card-scan-entry"><label>สแกนบาร์โค้ด / QR บนบัตร<input value={scanCode} disabled={pending} maxLength={30} onChange={e => setScanCode(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addScan(); } }} /></label><button type="button" className="outline-button" disabled={pending || !scanCode.trim()} onClick={addScan}>เพิ่มลงรายการ</button></div>
          <label className="card-inventory-codes">
            รหัสที่จะลงทะเบียน · หนึ่งรหัสต่อบรรทัด
            <textarea rows={3} placeholder="DEMO-CARD-00001" value={codes} onChange={e => setCodes(e.target.value)} />
          </label>
          <button
            className="primary-button"
            disabled={pending || !codes.trim()}
            onClick={() =>
              create.mutate({
                cardNumbers: codes
                  .split(/\r?\n/)
                  .map(s => s.trim())
                  .filter(Boolean),
              })
            }
          >
            {create.isPending ? "กำลังบันทึก…" : "ลงทะเบียนบัตรเปล่า"}
          </button>
          <small>บัตรจะพร้อมใช้งานเมื่อจ่ายให้สมาชิก · ไม่เชื่อมยอดจากระบบเดิม</small>
          </div>}
        </div>
      )}
      {(error || cards.error) && (
        <p role="alert" className="notice-bar error">
          {error || getErrorMessage(cards.error)}
        </p>
      )}
      {notice && <p role="status" className="notice-bar success">{notice}</p>}
      {cards.isLoading ? (
        <p>กำลังโหลด…</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>รหัสบัตร</th>
                <th>สมาชิก</th>
                <th>เจ้าหน้าที่ลงทะเบียน / วันที่</th>
                <th>เจ้าหน้าที่ดำเนินการล่าสุด</th>
                <th>จัดการ</th>
                <th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {cards.data?.map(card => (
                <tr key={card.cardNumber}>
                  <td>{card.cardNumber}</td>
                  <td>{card.assignedMemberNumber || "—"}</td>
                  <td>{staffName(card.createdBy)}<br />{card.createdAt}</td>
                  <td>{staffName(card.updatedBy)}</td>
                  <td><div className="card-inventory-actions">
                    <button type="button" className="outline-button" onClick={() => { setHistoryCard(card.cardNumber); setSessionId(null); }}>ประวัติการใช้บัตร</button>
                    {card.status === "assigned" && (
                      <button
                        className="outline-button"
                        disabled={pending}
                        onClick={() => {
                          if (
                            window.confirm(
                              `คืนบัตร ${card.cardNumber} จากสมาชิก ${card.assignedMemberNumber}? คืนได้เมื่อยอดเงินเป็นศูนย์เท่านั้น`
                            )
                          )
                            release.mutate({ cardNumber: card.cardNumber });
                        }}
                      >
                        คืนบัตร
                      </button>
                    )}
                    {canManage &&
                      card.status !== "lost" &&
                      card.status !== "damaged" && (
                        <>
                          <button
                            className="outline-button"
                            disabled={pending}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `แจ้งบัตร ${card.cardNumber} หาย และยกเลิกการผูกสมาชิก?`
                                )
                              )
                                mark.mutate({
                                  cardNumber: card.cardNumber,
                                  status: "lost",
                                });
                            }}
                          >
                            แจ้งหาย
                          </button>
                          <button
                            className="outline-button"
                            disabled={pending}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `ระบุบัตร ${card.cardNumber} ชำรุด และยกเลิกการผูกสมาชิก?`
                                )
                              )
                                mark.mutate({
                                  cardNumber: card.cardNumber,
                                  status: "damaged",
                                });
                            }}
                          >
                            ชำรุด
                          </button>
                        </>
                      )}
                  </div></td>
                  <td><span className={`card-inventory-status is-${card.status}`}>{labels[card.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {cards.data?.length === 0 && <p>ไม่พบบัตร</p>}
        </div>
      )}
      {historyCard && <dialog ref={historyDialog} className="card-history-dialog" aria-labelledby="card-history-title" onCancel={() => { setHistoryCard(""); setSessionId(null); }}>
        <div className="card-history-heading">
        <h3 id="card-history-title">ประวัติการใช้บัตร · {historyCard}</h3>
        <button type="button" className="outline-button" autoFocus onClick={() => { setHistoryCard(""); setSessionId(null); }}>ปิดประวัติ</button>
        </div>
        <div className="card-history-content">
        {history.isLoading && <p role="status">กำลังโหลด…</p>}
        {history.error && <p role="alert" className="notice-bar error">{getErrorMessage(history.error)}</p>}
        <div className="table-wrap"><table><thead><tr>
          <th>รอบ / สมาชิก</th><th>เริ่ม / เจ้าหน้าที่</th><th>สิ้นสุด / เจ้าหน้าที่</th><th>ยอดเริ่ม</th><th>รับเข้า</th><th>หักออก</th><th>ยอดปิด</th><th>รายการ</th>
        </tr></thead><tbody>{history.data?.sessions.map(s => <tr key={s.id}>
          <td>#{s.id} · {s.memberNumber}<br />{s.memberName}{s.legacy ? " · ยกมาจากข้อมูลเดิม" : ""}</td>
          <td>{s.startedAt}<br />{staffName(s.openedBy)}</td>
          <td>{s.endedAt || "กำลังใช้งาน"}<br />{s.endedAt ? staffName(s.closedBy) : "—"}</td>
          <td>{s.openingBalance.toFixed(2)}</td><td>{s.incoming.toFixed(2)}</td><td>{s.outgoing.toFixed(2)}</td><td>{s.closingBalance == null ? "ยังไม่ปิดรอบ" : s.closingBalance.toFixed(2)}</td>
          <td><button type="button" className="outline-button" onClick={() => setSessionId(s.id)}>ดู {s.transactionCount} รายการ</button></td>
        </tr>)}</tbody></table></div>
        {history.data?.sessions.length === 0 && <p>ยังไม่มีประวัติการใช้บัตร</p>}
        {sessionId != null && <div className="table-wrap"><h4>ธุรกรรมรอบ #{sessionId}</h4><table><thead><tr><th>วันที่</th><th>รายละเอียด</th><th>จำนวนเงิน</th><th>ยอดหลังรายการ</th><th>เจ้าหน้าที่</th></tr></thead><tbody>
          {history.data?.transactions.filter(t => t.sessionId === sessionId).map(t => <tr key={t.id}><td>{t.createdAt}</td><td>{t.detail}</td><td>{t.amount.toFixed(2)}</td><td>{t.balanceAfter == null ? "—" : t.balanceAfter.toFixed(2)}</td><td>{staffName(t.actor)}</td></tr>)}
        </tbody></table></div>}
        </div>
      </dialog>}
    </section>
  );
}
