import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { getErrorMessage } from "@/pages/viewFormat";

const labels = {
  blank: "ว่าง",
  assigned: "ใช้งาน",
  returned_vacant: "คืนแล้ว · ว่าง",
  lost: "หาย",
  damaged: "ชำรุด",
};

export function CardInventory({ canManage }: { canManage: boolean }) {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [codes, setCodes] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const cards = trpc.card.list.useQuery({ search });
  const refresh = () => {
    setError("");
    setNotice("บันทึกแล้ว");
    void utils.card.list.invalidate();
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
  const mark = trpc.card.mark.useMutation({
    onSuccess: refresh,
    onError: e => setError(getErrorMessage(e)),
  });
  const pending = create.isPending || release.isPending || mark.isPending;
  return (
    <section className="panel" aria-label="จัดการบัตรเปล่า">
      <h2>บัตรเปล่า / บัตรหมุนเวียน</h2>
      <label>
        ค้นหารหัสบัตร / เลขสมาชิก
        <input value={search} onChange={e => setSearch(e.target.value)} />
      </label>
      {canManage && (
        <div className="form-grid">
          <button type="button" className="outline-button" disabled={pending} onClick={() => {
            const existing = new Set(cards.data?.map(card => card.cardNumber));
            const simulated: string[] = [];
            for (let sequence = 1; simulated.length < 20; sequence++) {
              const code = `DEMO-CARD-${String(sequence).padStart(5, "0")}`;
              if (!existing.has(code)) simulated.push(code);
            }
            setCodes(simulated.join("\n"));
          }}>เตรียมรหัสบัตรจำลอง 20 ใบ</button>
          <label>
            เพิ่มบัตรเปล่า · หนึ่งรหัสต่อบรรทัด
            <textarea value={codes} onChange={e => setCodes(e.target.value)} />
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
            เพิ่มบัตรเปล่า
          </button>
        </div>
      )}
      {(error || cards.error) && (
        <p role="alert" className="notice-bar error">
          {error || getErrorMessage(cards.error)}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {cards.isLoading ? (
        <p>กำลังโหลด…</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>รหัสบัตร</th>
                <th>สถานะ</th>
                <th>สมาชิก</th>
                <th>ผู้ทำรายการล่าสุด</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {cards.data?.map(card => (
                <tr key={card.cardNumber}>
                  <td>{card.cardNumber}</td>
                  <td>{labels[card.status]}</td>
                  <td>{card.assignedMemberNumber || "—"}</td>
                  <td>{card.updatedBy || "—"}</td>
                  <td>
                    {card.status === "assigned" && (
                      <button
                        className="outline-button"
                        disabled={pending}
                        onClick={() => {
                          if (
                            window.confirm(
                              `คืนบัตร ${card.cardNumber} จากสมาชิก ${card.assignedMemberNumber}? ยอดเงินสมาชิกจะไม่เปลี่ยน`
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {cards.data?.length === 0 && <p>ไม่พบบัตร</p>}
        </div>
      )}
    </section>
  );
}
