import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  IdCard,
  Search,
  ShieldCheck,
  UsersRound,
  WalletCards,
  X,
} from "@/lib/icons";
import { trpc } from "@/lib/trpc";
import { HelpDisclosure } from "@/components/HelpDisclosure";
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
}: {
  role: Role;
  userName: string;
  focusMemberNumber: string | null;
  onFocusMemberConsumed: () => void;
}) {
  const [query, setQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ทั้งหมด");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  // Round 32-16 — ลงทะเบียนสมาชิกใหม่+พิมพ์บัตร อยู่ที่ POS จุดเดียว (F6) แล้ว
  // หน้านี้คงไว้เฉพาะการจัดการสมาชิกที่มีอยู่ (ดูรายละเอียด เติม/ถอน ระงับ พิมพ์บัตร)
  const [selectedMember, setSelectedMember] = useState<MemberLite | null>(null);
  const actor = userName || "ผู้ใช้ระบบ";
  const actorRole = roleThaiLabel(role);
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
        eyebrow="สมาชิกและบัญชีสวัสดิการ"
        title="จัดการสมาชิก"
        description="ดูรายละเอียด เติม/ถอนเงิน ระงับการใช้งาน และพิมพ์บัตรสมาชิกรายคน — ลงทะเบียนสมาชิกใหม่+พิมพ์บัตร ทำที่ POS · ขายสินค้า (F6) จุดเดียว"
      />
      <div className="member-scope-note compact" role="note">
        <span className="member-scope-icon">
          <IdCard size={16} />
        </span>
        <div>
          <b>ระบบสมาชิกแยกจากผู้ใช้ระบบ</b>
        </div>
        <HelpDisclosure id="members-scope-help" label="ดูรายละเอียด">
          <span>
            บัญชีสมาชิกสวัสดิการใช้เพื่อใช้จ่ายที่เคาน์เตอร์เท่านั้น —
            สมาชิกไม่มีบัญชีเข้าสู่ระบบแอปนี้ ·
            แอปนี้สำหรับเจ้าหน้าที่และผู้บริหารร้านค้า
            (จัดการบัญชีเข้าสู่ระบบที่เมนูผู้ใช้ระบบ)
          </span>
        </HelpDisclosure>
      </div>
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
            <p>ลงทะเบียนที่ POS (F6) · ดูยอดรวมได้ในรายงาน</p>
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
            <div className="search-field">
              <Search size={16} />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="ค้นหาชื่อ เลขสมาชิก หรือพิมพ์เลขบางส่วน/ท้ายเลข"
              />
            </div>
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
                  return (
                    <tr
                      className="clickable"
                      key={row.memberNumber}
                      onClick={() => setSelectedMember(row)}
                      title={`ดูรายละเอียด ${memberFullName(row)} — เติม/ถอนเงิน พิมพ์บัตรสมาชิก`}
                    >
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
