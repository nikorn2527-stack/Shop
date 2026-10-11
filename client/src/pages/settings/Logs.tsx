import { useEffect, useState } from "react";
import {
  Activity,
  CalendarDays,
  Check,
  ChevronDown,
  Download,
  ReceiptText,
  Search,
  ShieldCheck,
  X,
} from "@/lib/icons";
import { trpc } from "@/lib/trpc";
import { downloadCsvFile } from "@/exportUtils";
import { ThaiDatePicker } from "@/components/ThaiDatePicker";
import {
  formatLogDateTime,
  getErrorMessage,
  isSameDay,
  parseStoreDate,
} from "../viewFormat";
import { SectionHeader } from "../PagePrimitives";

/**
 * Logs — ประวัติระบบ (audit log view). Lists system audit logs with search,
 * date-range filter, summary chips, CSV export, and paginated "show more".
 *
 * Extracted from Home.tsx (V2-C1). Reads `trpc.logs.list` (200 latest) and
 * filters client-side. The "ประวัติระบบ" tab is admin-only (enforced by
 * AppShell's `safeView === "logs" && isAdminRole(role)`).
 */
export function Logs() {
  const logsQuery = trpc.logs.list.useQuery({ limit: 200 });
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  // Render cap (round 15): 30 rows up front, +30 per show-more click.
  const [visible, setVisible] = useState(30);
  // Real date-range filter (round 15) — replaces the dead "ช่วงเวลา" button.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const logs = logsQuery.data ?? [];
  const filtered = logs.filter(log => {
    const term = query.trim().toLowerCase();
    const matchesTerm =
      !term ||
      `${log.action} ${log.actor} ${log.detail} ${log.actorRole ?? ""}`
        .toLowerCase()
        .includes(term);
    const logDate = log.createdAt.slice(0, 10);
    const matchesFrom = !dateFrom || logDate >= dateFrom;
    const matchesTo = !dateTo || logDate <= dateTo;
    return matchesTerm && matchesFrom && matchesTo;
  });
  // Changing any filter returns to the first page of results.
  useEffect(() => {
    setVisible(30);
  }, [query, dateFrom, dateTo]);
  const todayCount = logs.filter(log =>
    isSameDay(parseStoreDate(log.createdAt), new Date())
  ).length;
  const actorCount = new Set(logs.map(log => log.actor)).size;
  const downloadLogsCsv = () => {
    downloadCsvFile("activity-logs", [
      ["วันและเวลา", "ผู้ทำรายการ", "กิจกรรม", "รายละเอียด", "ระดับสิทธิ์"],
      ...filtered.map(log => [
        formatLogDateTime(log.createdAt),
        log.actor,
        log.action,
        log.detail,
        log.actorRole ?? "",
      ]),
    ]);
    setNotice(`ดาวน์โหลดรายการ Log แล้ว · ${filtered.length} รายการ`);
  };
  return (
    <>
      <SectionHeader
        eyebrow="ตรวจสอบย้อนหลังและความโปร่งใส"
        title="ประวัติระบบ"
        description="บันทึกทุกกิจกรรมสำคัญของผู้ใช้งานและธุรกรรมในระบบ"
        action={
          <button className="outline-button" onClick={downloadLogsCsv}>
            <Download size={16} /> ส่งออก Log
          </button>
        }
      />
      <div className="log-summary">
        <div>
          <Activity size={18} />
          <span>
            รายการวันนี้<strong>{todayCount}</strong>
          </span>
        </div>
        <div>
          <ShieldCheck size={18} />
          <span>
            ผู้ใช้งานในระบบ<strong>{actorCount}</strong>
          </span>
        </div>
        <div>
          <ReceiptText size={18} />
          <span>
            ธุรกรรมที่บันทึก<strong>100%</strong>
          </span>
        </div>
      </div>
      <section className="panel table-panel">
        <div className="table-toolbar">
          <div>
            <h2>กิจกรรมทั้งหมด</h2>
            <p>ข้อมูลสำหรับตรวจสอบย้อนหลังของเจ้าหน้าที่และผู้บริหาร</p>
          </div>
          <div className="toolbar-actions">
            <div className="search-field">
              <Search size={16} />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="ค้นหากิจกรรม หรือผู้ใช้งาน"
              />
            </div>
            <div className="date-range-filter">
              <ThaiDatePicker value={dateFrom} onChange={setDateFrom} max={dateTo || undefined} ariaLabel="กรองตั้งแต่วันที่" placeholder="ตั้งแต่วันที่" />
              <span className="date-range-sep">→</span>
              <ThaiDatePicker value={dateTo} onChange={setDateTo} min={dateFrom || undefined} ariaLabel="กรองถึงวันที่" placeholder="ถึงวันที่" />
              {(dateFrom || dateTo) && (
                <button
                  type="button"
                  className="date-range-clear"
                  aria-label="ล้างตัวกรองช่วงเวลา"
                  title="ล้างตัวกรองช่วงเวลา"
                  onClick={() => {
                    setDateFrom("");
                    setDateTo("");
                  }}
                >
                  <X size={15} />
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="table-filter-summary">
          <span>
            <Search size={13} />{" "}
            {query || dateFrom || dateTo ? (
              <>
                กรองตามเงื่อนไข
                {dateFrom || dateTo
                  ? ` · ${dateFrom || "เริ่มต้น"} ถึง ${dateTo || "ปัจจุบัน"}`
                  : ""}
              </>
            ) : (
              "กิจกรรมทั้งหมด"
            )}
          </span>
          <span>
            แสดง <b>{Math.min(visible, filtered.length)}</b> จาก{" "}
            <b>{filtered.length}</b> รายการ
          </span>
        </div>
        <div className="table-wrap">
          {logsQuery.isLoading ? (
            <div className="table-loading">
              <Activity size={22} />
              <b>กำลังโหลดรายการ Log</b>
              <span>ดึง 200 รายการล่าสุดจากระบบ</span>
            </div>
          ) : logsQuery.isError ? (
            <div className="entity-state error" role="alert">
              <ShieldCheck size={22} />
              <b>โหลดรายการ Log ไม่สำเร็จ</b>
              <span>{getErrorMessage(logsQuery.error)}</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="entity-state">
              <Activity size={22} />
              <b>ไม่พบกิจกรรมตามเงื่อนไข</b>
              <span>ลองเปลี่ยนคำค้นหาหรือช่วงวันที่</span>
            </div>
          ) : (
            <table className="log-table" aria-label="รายการกิจกรรม">
              <thead>
                <tr>
                  <th aria-label="ระดับกิจกรรม" />
                  <th>วันที่ · เวลา</th>
                  <th>ผู้ทำรายการ</th>
                  <th>กิจกรรม</th>
                  <th>รายละเอียด</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, visible).map(log => (
                  <tr key={log.id}>
                    <td className="log-tone-cell">
                      <i
                        className={`log-dot-mini tone-${log.tone ?? "green"}`}
                        aria-hidden="true"
                      />
                    </td>
                    <td>
                      <small className="cell-mono">
                        {formatLogDateTime(log.createdAt)}
                      </small>
                    </td>
                    <td>
                      <b>{log.actor}</b>
                      {log.actorRole && <small>{log.actorRole}</small>}
                    </td>
                    <td>
                      <b>{log.action}</b>
                    </td>
                    <td>
                      <span className="log-detail-text" title={log.detail}>
                        {log.detail}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {visible < filtered.length ? (
          <button
            type="button"
            className="table-show-more"
            onClick={() => setVisible(current => current + 30)}
          >
            <ChevronDown size={15} /> แสดงรายการเพิ่มอีก{" "}
            <b>{filtered.length - visible}</b> รายการ
          </button>
        ) : (
          filtered.length > 30 && (
            <div className="table-show-more done">
              แสดงทั้งหมด {filtered.length} รายการแล้ว
            </div>
          )
        )}
        {notice && (
          <div className="notice-bar">
            <Check size={16} /> {notice}
            <button onClick={() => setNotice("")}>
              <X size={14} />
            </button>
          </div>
        )}
      </section>
    </>
  );
}
