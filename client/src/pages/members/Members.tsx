import { SharedSearch } from "@/components/SharedSearch";
import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  IdCard,
  Printer,
  Search,
  ShieldCheck,
  UsersRound,
  WalletCards,
  X,
} from "@/lib/icons";
import { trpc } from "@/lib/trpc";
import { HelpDisclosure } from "@/components/HelpDisclosure";
import { MemberCardBatchModal, type MemberCardData } from "@/components/MemberCardModal";
import type { MemberLite, Role } from "../pageData";
import {
  memberFullName,
  money,
  roleThaiLabel,
  scanCandidates,
} from "../pageData";
import {
  MEMBER_STATUS_META,
  formatLastActivity,
  getErrorMessage,
  isSameMonth,
  parseStoreDate,
} from "../viewFormat";
import { SectionHeader, StatusPill } from "../PagePrimitives";
// V2-C2 — MemberDetail now lives in its own file next to Members.
// The old circular ESM via "../Home" is gone; MemberDetail is now imported
// directly from "./MemberDetail". Safe at module-eval time and render time.
import { MemberDetail } from "./MemberDetail";
import { MemberRegistrationModal } from "@/components/MemberRegistrationModal";
import { CardInventory } from "@/components/CardInventory";
import { isAdminRole } from "../pageData";

/**
 * Members — list view with search + status filter + per-row drilldown to
 * MemberDetail. Extracted from Home.tsx (V2-C1).
 *
 * "ลงทะเบียนสมาชิกใหม่+พิมพ์บัตร" อยู่ที่ POS (F6) อย่างเดียวตั้งแต่ Round 32-16 —
 * หน้านี้เหลือเฉพาะการจัดการสมาชิกที่มีอยู่ (ดูรายละเอียด เติม/ถอน ระงับ พิมพ์บัตร).
 */
export function Members({
  role,
  userName,
  focusMemberNumber,
  onFocusMemberConsumed,
  initialSection = "members",
}: {
  role: Role;
  userName: string;
  focusMemberNumber: string | null;
  onFocusMemberConsumed: () => void;
  initialSection?: "members" | "cards";
}) {
  const [activeSection, setActiveSection] = useState<"members" | "cards">(initialSection);
  const [query, setQuery] = useState("");
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ทั้งหมด");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  // FIX-4 issue 4 — batch member-card print: a Set of memberNumber strings
  // so the user can tick many rows and send them all to the printer at once.
  const [selectedForPrint, setSelectedForPrint] = useState<Set<string>>(new Set());
  const [batchCardOpen, setBatchCardOpen] = useState(false);
  // Round 32-16 — ลงทะเบียนสมาชิกใหม่+พิมพ์บัตร อยู่ที่ POS จุดเดียว (F6) แล้ว
  // หน้านี้คงไว้เฉพาะการจัดการสมาชิกที่มีอยู่ (ดูรายละเอียด เติม/ถอน ระงับ พิมพ์บัตร)
  const [selectedMember, setSelectedMember] = useState<MemberLite | null>(null);
  const actor = userName || "ผู้ใช้ระบบ";
  const actorRole = roleThaiLabel(role);
  useEffect(() => setActiveSection(initialSection), [initialSection]);
  useEffect(() => {
    if (focusMemberNumber) setActiveSection("members");
  }, [focusMemberNumber]);
  useEffect(() => {
    const timer = setTimeout(
      () =>
        setDebouncedSearch(scanCandidates(query.trim()).pop() ?? query.trim()),
      350
    );
    return () => clearTimeout(timer);
  }, [query]);
  const allMembersQuery = trpc.member.list.useQuery();
  const statusParam =
    statusFilter === "ใช้งาน"
      ? "active"
      : statusFilter === "ระงับ"
        ? "suspended"
        : undefined;
  const hasFilter = Boolean(debouncedSearch) || statusParam !== undefined;
  const filteredQuery = trpc.member.list.useQuery(
    hasFilter
      ? { search: debouncedSearch || undefined, status: statusParam }
      : undefined,
    { placeholderData: previous => previous }
  );
  const allMembers = allMembersQuery.data ?? [];
  useEffect(() => {
    if (
      !focusMemberNumber ||
      allMembersQuery.isLoading ||
      !allMembersQuery.isSuccess
    )
      return;
    const match = allMembers.find(
      row => row.memberNumber === focusMemberNumber
    );
    if (match) setSelectedMember(match);
    onFocusMemberConsumed();
  }, [
    focusMemberNumber,
    allMembersQuery.isLoading,
    allMembersQuery.isSuccess,
    allMembers,
    onFocusMemberConsumed,
  ]);
  // Round 31 — sidebar “เพิ่มสมาชิกใหม่” lands here: open the register modal once.
  const rows = hasFilter ? (filteredQuery.data ?? []) : allMembers;
  const walletTotal = allMembers.reduce(
    (sum, member) => sum + member.balance,
    0
  );
  const activeCount = allMembers.filter(
    member => member.status === "active"
  ).length;
  const suspendedCount = allMembers.length - activeCount;
  const newThisMonth = allMembers.filter(member =>
    isSameMonth(parseStoreDate(member.createdAt), new Date())
  ).length;
  // FIX-4 issue 4 — batch-print helpers (toggle / select-all on the visible rows).
  const visibleRows = rows;
  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every(row => selectedForPrint.has(row.memberNumber));
  const someVisibleSelected = visibleRows.some(row => selectedForPrint.has(row.memberNumber));
  const toggleRowForPrint = (memberNumber: string) => {
    setSelectedForPrint(prev => {
      const next = new Set(prev);
      if (next.has(memberNumber)) next.delete(memberNumber);
      else next.add(memberNumber);
      return next;
    });
  };
  const toggleAllVisibleForPrint = () => {
    if (allVisibleSelected) {
      // un-tick only the visible rows (keep hidden selections untouched)
      setSelectedForPrint(prev => {
        const next = new Set(prev);
        for (const row of visibleRows) next.delete(row.memberNumber);
        return next;
      });
    } else {
      setSelectedForPrint(prev => {
        const next = new Set(prev);
        for (const row of visibleRows) next.add(row.memberNumber);
        return next;
      });
    }
  };
  const clearPrintSelection = () => setSelectedForPrint(new Set());
  // The card modal takes full MemberCardData; we promote the MemberLite rows
  // (which carry all the same fields except cardNumber/patientCode which are
  // optional) to the card payload. Detail page already prints a fuller card;
  // the batch print is for the list view so members.list shape is enough.
  const batchCardMembers: MemberCardData[] = visibleRows
    .filter(row => selectedForPrint.has(row.memberNumber))
    .map(row => ({
      memberNumber: row.memberNumber,
      prename: row.prename ?? null,
      firstName: row.firstName,
      lastName: row.lastName,
      type: row.type,
      balance: row.balance,
      status: row.status,
      createdAt: row.createdAt,
      photoUrl: null,
      gender: null,
      cardNumber: row.cardNumber ?? null,
      patientCode: row.patientCode ?? null,
    }));
  if (selectedMember)
    return (
      <MemberDetail
        member={selectedMember}
        onBack={() => setSelectedMember(null)}
        role={role}
        userName={userName}
        onDeleted={message => {
          setSelectedMember(null);
          setNotice(message);
        }}
      />
    );
  return (
    <>
      <SectionHeader
        eyebrow="สมาชิก บัญชี และบัตรหมุนเวียน"
        title="สมาชิกและบัญชี"
        description="ดูแลข้อมูลสมาชิก ยอดคงเหลือ และบัตรสมาชิกได้ในที่เดียว"
      />
      <div className="dash-tabbar member-section-tabs" role="tablist" aria-label="ส่วนจัดการสมาชิกและบัตร">
        <button type="button" role="tab" aria-selected={activeSection === "members"} className={`dash-tab${activeSection === "members" ? " active" : ""}`} onClick={() => setActiveSection("members")}>
          <UsersRound size={16} /> รายชื่อสมาชิก
        </button>
        <button type="button" role="tab" aria-selected={activeSection === "cards"} className={`dash-tab${activeSection === "cards" ? " active" : ""}`} data-member-section="cards" onClick={() => setActiveSection("cards")}>
          <IdCard size={16} /> จัดการบัตรสมาชิก
        </button>
      </div>
      {activeSection === "cards" ? (
        <div className="card-management-page member-card-management" role="tabpanel">
          <CardInventory canManage={isAdminRole(role)} />
        </div>
      ) : <>
      <div className="member-top-grid">
        <div className="member-balance-card">
          <div>
            <span className="eyebrow">ยอดเงินในบัญชีสมาชิกทั้งหมด</span>
            <strong>{money(walletTotal)}</strong>
            <small>
              สมาชิกใช้งาน {activeCount} ราย · ระงับ {suspendedCount} ราย
            </small>
          </div>
          <div className="balance-orb">
            <WalletCards size={26} />
          </div>
        </div>
        <div className="member-mini-card">
          <span className="stat-icon green">
            <UsersRound size={18} />
          </span>
          <div>
            <small>สมาชิกทั้งหมด</small>
            <strong>
              {allMembers.length.toLocaleString("th-TH")} <em>ราย</em>
            </strong>
            <p>
              <span className="green-text">{activeCount} ใช้งาน</span> ·{" "}
              {suspendedCount} ระงับ
            </p>
          </div>
        </div>
        <div className="member-mini-card">
          <span className="stat-icon purple">
            <ArrowDownToLine size={18} />
          </span>
          <div>
            <small>ลงทะเบียนเดือนนี้</small>
            <strong>
              {newThisMonth} <em>ราย</em>
            </strong>
          </div>
        </div>
      </div>
      <section className="panel table-panel">
        <div className="table-toolbar">
          <div>
            <h2>สมาชิกทั้งหมด</h2>
            <p>ค้นหาและกรองตามสถานะการใช้งานได้ทันที</p>
          </div>
          <div className="toolbar-actions">
            <button type="button" className="primary-button" onClick={() => setRegistrationOpen(true)}>
              <UsersRound size={16} /> เพิ่มสมาชิก
            </button>
            <SharedSearch label="สมาชิก · ชื่อ / เลขสมาชิก">
            <div className="search-field">
              <Search size={16} />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="ค้นหาชื่อ เลขสมาชิก หรือพิมพ์เลขบางส่วน/ท้ายเลข"
              />
            </div>
            </SharedSearch>
            <div className="filter-pills">
              {["ทั้งหมด", "ใช้งาน", "ระงับ"].map(item => (
                <button
                  className={statusFilter === item ? "active" : ""}
                  key={item}
                  onClick={() => setStatusFilter(item)}
                >
                  {item}
                  {item === "ใช้งาน" && <span>{activeCount}</span>}
                  {item === "ระงับ" && <span>{suspendedCount}</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="table-filter-summary">
          <span>
            <Search size={13} />{" "}
            {query
              ? `ค้นหา “${query}”`
              : "สมาชิกทั้งหมด · กดแถวเพื่อดูรายละเอียด เติม/ถอนเงิน"}
          </span>
          <span>
            แสดง {rows.length} จาก {allMembers.length} รายการ
            {selectedForPrint.size > 0 && (
              <>
                {" · "}เลือกพิมพ์บัตร <b>{selectedForPrint.size}</b> ราย
                <button
                  type="button"
                  className="link-btn"
                  onClick={clearPrintSelection}
                  aria-label="ล้างรายการที่เลือกพิมพ์บัตร"
                >
                  <X size={12} /> ล้าง
                </button>
              </>
            )}
          </span>
        </div>
        <div className="table-wrap">
          {allMembersQuery.isLoading ? (
            <div className="table-loading">
              <UsersRound size={22} />
              <b>กำลังโหลดรายการสมาชิก</b>
              <span>ดึงข้อมูลจากระบบ</span>
            </div>
          ) : allMembersQuery.isError ? (
            <div className="entity-state error" role="alert">
              <ShieldCheck size={22} />
              <b>โหลดรายการสมาชิกไม่สำเร็จ</b>
              <span>{getErrorMessage(allMembersQuery.error)}</span>
            </div>
          ) : rows.length === 0 ? (
            <div className="entity-state">
              <UsersRound size={22} />
              <b>ไม่พบสมาชิกตามเงื่อนไข</b>
              <span>
                ลองเปลี่ยนคำค้นหาหรือสถานะ · ลงทะเบียนใหม่ที่ POS (F6)
              </span>
            </div>
          ) : (
            <table
              className="entity-table rows-members"
              aria-label="รายการสมาชิก"
            >
              <thead>
                <tr>
                  <th className="check-col">
                    <input
                      type="checkbox"
                      aria-label={allVisibleSelected ? "ยกเลิกเลือกทุกแถวที่แสดง" : "เลือกทุกแถวที่แสดงเพื่อพิมพ์บัตร"}
                      checked={allVisibleSelected}
                      ref={el => {
                        if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected;
                      }}
                      onChange={toggleAllVisibleForPrint}
                      title={allVisibleSelected ? "ยกเลิกเลือกทุกแถวที่แสดง" : "เลือกทุกแถวที่แสดงเพื่อพิมพ์บัตร"}
                    />
                  </th>
                  <th>หมายเลขสมาชิก</th>
                  <th>ชื่อ-นามสกุล</th>
                  <th>สถานะ</th>
                  <th className="num">ยอดเงินคงเหลือ</th>
                  <th className="hide-sm">รายการล่าสุด</th>
                  <th aria-label="เปิดรายละเอียด" />
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const statusMeta = MEMBER_STATUS_META[row.status];
                  const checked = selectedForPrint.has(row.memberNumber);
                  return (
                    <tr
                      className="clickable"
                      key={row.memberNumber}
                      onClick={() => setSelectedMember(row)}
                      title={`ดูรายละเอียด ${memberFullName(row)} — เติม/ถอนเงิน พิมพ์บัตรสมาชิก`}
                    >
                      <td className="check-col" onClick={event => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`เลือก ${memberFullName(row)} เพื่อพิมพ์บัตร`}
                          checked={checked}
                          onChange={() => toggleRowForPrint(row.memberNumber)}
                          title="เลือกเพื่อพิมพ์บัตรสมาชิกแบบหลายคนพร้อมกัน"
                        />
                      </td>
                      <td className="cell-mono">
                        {row.memberNumber}
                        {row.cardNumber && (
                          <small className="cell-sub cell-mono-line">{`บัตร ${row.cardNumber}`}</small>
                        )}
                      </td>
                      <td>
                        <span className="cell-strong">
                          {memberFullName(row)}
                        </span>
                        <small className="cell-sub">
                          {row.type}
                          {row.patientCode ? ` · HN ${row.patientCode}` : ""}
                        </small>
                      </td>
                      <td>
                        <StatusPill tone={statusMeta.tone}>
                          {statusMeta.label}
                        </StatusPill>
                      </td>
                      <td className="cell-num">
                        <span className={row.balance < 0 ? "negative" : ""}>
                          {money(row.balance)}
                        </span>
                      </td>
                      <td className="hide-sm">
                        <small className="cell-sub" style={{ marginTop: 0 }}>
                          {formatLastActivity(row.lastTransactionAt)}
                        </small>
                      </td>
                      <td>
                        <span className="row-chevron">
                          <ArrowRight size={15} />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {selectedForPrint.size > 0 && (
          <div className="batch-print-bar">
            <div>
              <b>เลือก {selectedForPrint.size} ราย</b>
              <small>ดูบัตรสมาชิกที่เลือกและดาวน์โหลด PDF</small>
            </div>
            <div className="batch-print-actions">
              <button className="outline-button" onClick={clearPrintSelection}>ล้างที่เลือก</button>
              <button className="primary-button" onClick={() => setBatchCardOpen(true)} disabled={batchCardMembers.length === 0}>
                <Printer size={15} /> บัตรสมาชิก {selectedForPrint.size} ใบ
              </button>
            </div>
          </div>
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
      {batchCardOpen && batchCardMembers.length > 0 && (
        <MemberCardBatchModal
          members={batchCardMembers}
          onClose={() => setBatchCardOpen(false)}
        />
      )}
      {registrationOpen && <MemberRegistrationModal actor={actor} actorRole={actorRole} onClose={() => setRegistrationOpen(false)} onUseExisting={member => {
        setRegistrationOpen(false);
        setQuery("");
        setStatusFilter("ทั้งหมด");
        setSelectedMember(member);
      }} onRegistered={member => {
        setRegistrationOpen(false);
        setQuery("");
        setStatusFilter("ทั้งหมด");
        setNotice(`เพิ่มสมาชิก ${member.firstName} ${member.lastName} · ${member.memberNumber} แล้ว`);
      }} />}
      </>}
    </>
  );
}
