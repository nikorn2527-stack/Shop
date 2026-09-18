import { useState } from "react";
import {
  Check, CircleAlert, Crown, KeyRound, LockKeyhole, LogOut, MonitorSmartphone, Search, Settings2, ShieldCheck, UserPlus, UserRound, UsersRound, X,
} from "lucide-react";
import type { AppSessionSummary, AppUserSummary } from "../../../server/sqliteStore";
import { ConfirmDialog, SectionHeader, StatusPill } from "./PagePrimitives";
import { formatLogDateTime, getErrorMessage, parseStoreDate } from "./viewFormat";
import { trpc } from "@/lib/trpc";

const emptyCreateForm = { username: "", password: "", confirm: "", displayName: "", role: "staff" as "staff" | "admin" };
const emptyPasswordForm = { password: "", confirm: "" };
const userFilters = ["ทั้งหมด", "ผู้บริหาร", "เจ้าหน้าที่", "ระงับ"] as const;
type UserFilter = (typeof userFilters)[number];
const ROLE_LABEL: Record<"staff" | "admin", string> = { admin: "ผู้บริหาร", staff: "เจ้าหน้าที่" };

/** Human countdown until a session expires, e.g. "อีก 6 วัน 4 ชม.". */
function expiryLabel(expiresAt: string): string {
  const expiry = parseStoreDate(expiresAt);
  if (!expiry) return "—";
  const msLeft = expiry.getTime() - Date.now();
  if (msLeft <= 0) return "หมดอายุแล้ว";
  const days = Math.floor(msLeft / 86_400_000);
  const hours = Math.floor((msLeft % 86_400_000) / 3_600_000);
  if (days >= 1) return `อีก ${days} วัน ${hours} ชม.`;
  return `อีก ${hours} ชม.`;
}

/** Admin-only ผู้ใช้ระบบ view — lists app_accounts from user.list and manages them via user.create/user.update. */
export function Users({ selfUsername }: { selfUsername: string }) {
  const utils = trpc.useUtils();
  const listQuery = trpc.user.list.useQuery(undefined);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<UserFilter>("ทั้งหมด");
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [createError, setCreateError] = useState("");
  const [editTarget, setEditTarget] = useState<AppUserSummary | null>(null);
  const [editForm, setEditForm] = useState({ displayName: "", role: "staff" as "staff" | "admin" });
  const [editError, setEditError] = useState("");
  const [passwordTarget, setPasswordTarget] = useState<AppUserSummary | null>(null);
  const [passwordForm, setPasswordForm] = useState(emptyPasswordForm);
  const [passwordError, setPasswordError] = useState("");
  const [statusTarget, setStatusTarget] = useState<AppUserSummary | null>(null);
  const sessionsQuery = trpc.session.list.useQuery(undefined, { refetchInterval: 30_000 });
  const [sessionNotice, setSessionNotice] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [revokeTarget, setRevokeTarget] = useState<(AppSessionSummary & { current: boolean }) | null>(null);
  const [revokeOthersOpen, setRevokeOthersOpen] = useState(false);
  const sessions = sessionsQuery.data ?? [];
  const otherSessions = sessions.filter((session) => !session.current);
  const users = listQuery.data ?? [];
  const adminCount = users.filter((user) => user.role === "admin").length;
  const staffCount = users.filter((user) => user.role === "staff").length;
  const suspendedCount = users.filter((user) => user.active !== 1).length;
  const filterCounts: Record<UserFilter, number> = { "ทั้งหมด": users.length, "ผู้บริหาร": adminCount, "เจ้าหน้าที่": staffCount, "ระงับ": suspendedCount };
  const term = search.trim().toLowerCase();
  const rows = users.filter((user) => {
    const matchesTerm = term === "" || user.username.toLowerCase().includes(term) || user.displayName.toLowerCase().includes(term);
    const matchesFilter = filter === "ทั้งหมด" || (filter === "ระงับ" ? user.active !== 1 : filter === "ผู้บริหาร" ? user.role === "admin" : user.role === "staff");
    return matchesTerm && matchesFilter;
  });
  const refresh = () => { void utils.user.list.invalidate(); };
  const createMutation = trpc.user.create.useMutation({
    onSuccess: (created) => {
      setCreateOpen(false);
      setCreateForm(emptyCreateForm);
      setCreateError("");
      setError("");
      setNotice(`เพิ่มผู้ใช้ ${created.username} เรียบร้อยแล้ว · ${created.displayName} · สิทธิ์ ${ROLE_LABEL[created.role]}`);
      refresh();
    },
    onError: (mutationError) => setCreateError(getErrorMessage(mutationError)),
  });
  const updateMutation = trpc.user.update.useMutation({
    onSuccess: (updated, variables) => {
      setEditTarget(null);
      setEditError("");
      setPasswordTarget(null);
      setPasswordForm(emptyPasswordForm);
      setPasswordError("");
      setStatusTarget(null);
      setError("");
      if (variables.password) setNotice(`ตั้งรหัสผ่านใหม่ให้ @${updated.username} เรียบร้อยแล้ว`);
      else if (variables.active === false) setNotice(`ระงับการใช้งาน @${updated.username} เรียบร้อยแล้ว · บัญชีนี้เข้าสู่ระบบไม่ได้จนกว่าจะเปิดใช้งานอีกครั้ง`);
      else if (variables.active === true) setNotice(`เปิดใช้งาน @${updated.username} อีกครั้งเรียบร้อยแล้ว`);
      else setNotice(`บันทึกข้อมูลผู้ใช้เรียบร้อยแล้ว · @${updated.username}`);
      refresh();
    },
    onError: (mutationError, variables) => {
      const message = getErrorMessage(mutationError);
      if (variables.password !== undefined) setPasswordError(message);
      else if (variables.active !== undefined) setError(message);
      else setEditError(message);
    },
  });
  const openCreate = () => { setCreateForm(emptyCreateForm); setCreateError(""); setCreateOpen(true); };
  const submitCreate = () => {
    const username = createForm.username.trim();
    if (!username) { setCreateError("กรุณาระบุชื่อผู้ใช้"); return; }
    if (createForm.password.length < 4) { setCreateError("รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร"); return; }
    if (createForm.password !== createForm.confirm) { setCreateError("รหัสผ่านไม่ตรงกัน"); return; }
    const displayName = createForm.displayName.trim();
    if (!displayName) { setCreateError("กรุณาระบุชื่อ-นามสกุลผู้ใช้"); return; }
    setCreateError("");
    createMutation.mutate({ username, password: createForm.password, displayName, role: createForm.role });
  };
  const openEdit = (user: AppUserSummary) => { setEditTarget(user); setEditForm({ displayName: user.displayName, role: user.role }); setEditError(""); };
  const submitEdit = () => {
    if (!editTarget) return;
    const displayName = editForm.displayName.trim();
    if (!displayName) { setEditError("กรุณาระบุชื่อ-นามสกุลผู้ใช้"); return; }
    const isSelf = editTarget.username === selfUsername;
    setEditError("");
    updateMutation.mutate(isSelf ? { userId: editTarget.id, displayName } : { userId: editTarget.id, displayName, role: editForm.role });
  };
  const openPassword = (user: AppUserSummary) => { setPasswordTarget(user); setPasswordForm(emptyPasswordForm); setPasswordError(""); };
  const submitPassword = () => {
    if (!passwordTarget) return;
    if (passwordForm.password.length < 4) { setPasswordError("รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร"); return; }
    if (passwordForm.password !== passwordForm.confirm) { setPasswordError("รหัสผ่านไม่ตรงกัน"); return; }
    setPasswordError("");
    updateMutation.mutate({ userId: passwordTarget.id, password: passwordForm.password });
  };
  const confirmStatus = () => {
    if (!statusTarget) return;
    const target = statusTarget;
    setStatusTarget(null);
    updateMutation.mutate({ userId: target.id, active: target.active !== 1 });
  };
  const refreshSessions = () => { void utils.session.list.invalidate(); };
  const revokeMutation = trpc.session.revoke.useMutation({
    onSuccess: (revoked) => {
      setRevokeTarget(null);
      setSessionError("");
      setSessionNotice(`ยกเลิกเซสชันของ @${revoked.username} เรียบร้อยแล้ว · อุปกรณ์นั้นต้องเข้าสู่ระบบใหม่`);
      refreshSessions();
    },
    onError: (mutationError) => { setRevokeTarget(null); setSessionError(getErrorMessage(mutationError)); refreshSessions(); },
  });
  const revokeOthersMutation = trpc.session.revokeOthers.useMutation({
    onSuccess: (result) => {
      setRevokeOthersOpen(false);
      setSessionError("");
      setSessionNotice(result.revoked === 0 ? "ไม่พบเซสชันอื่นที่ต้องยกเลิก" : `ยกเลิกเซสชันอื่นอีก ${result.revoked} รายการเรียบร้อยแล้ว · เหลือเฉพาะเซสชันที่คุณใช้อยู่`);
      refreshSessions();
    },
    onError: (mutationError) => { setRevokeOthersOpen(false); setSessionError(getErrorMessage(mutationError)); refreshSessions(); },
  });
  return <><SectionHeader eyebrow="ระบบและความปลอดภัย / USER MANAGEMENT" title="ผู้ใช้ระบบ" description="จัดการบัญชีเจ้าหน้าที่และผู้บริหาร กำหนดสิทธิ์การเข้าถึงเมนู ตั้งรหัสผ่านใหม่ และระงับการใช้งาน" action={<button className="primary-button" onClick={openCreate}><UserPlus size={16} /> เพิ่มผู้ใช้ใหม่</button>} /><div className="stock-overview"><div className="stock-stat"><span className="stat-icon blue"><UsersRound size={18} /></span><div><small>ผู้ใช้ทั้งหมด</small><strong>{users.length} <em>บัญชี</em></strong></div></div><div className="stock-stat"><span className="stat-icon amber"><Crown size={18} /></span><div><small>ผู้บริหาร</small><strong>{adminCount} <em>บัญชี</em></strong></div></div><div className="stock-stat"><span className="stat-icon green"><UserRound size={18} /></span><div><small>เจ้าหน้าที่</small><strong>{staffCount} <em>บัญชี</em></strong></div></div><div className="stock-stat"><span className="stat-icon red"><LockKeyhole size={18} /></span><div><small>ระงับการใช้งาน</small><strong className="red-text">{suspendedCount} <em>บัญชี</em></strong></div></div></div><section className="panel table-panel"><div className="table-toolbar"><div><h2>บัญชีผู้ใช้ทั้งหมด</h2><p>ค้นหาและกรองตามสิทธิ์หรือสถานะ · จัดการได้เฉพาะผู้บริหารระบบ</p></div><div className="toolbar-actions"><div className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาชื่อผู้ใช้ หรือชื่อ-นามสกุล" /></div><div className="filter-pills">{userFilters.map((item) => <button className={filter === item ? "active" : ""} key={item} onClick={() => setFilter(item)}>{item}{item !== "ทั้งหมด" && <span>{filterCounts[item]}</span>}</button>)}</div></div></div><div className="table-filter-summary"><span><Search size={13} /> {term === "" ? "ผู้ใช้ระบบทั้งหมด" : `ค้นหา “${search.trim()}”`}</span><span>แสดง {rows.length} จาก {users.length} บัญชี</span></div>{notice && <div className="notice-bar"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}{error && <div className="notice-bar error"><CircleAlert size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="table-wrap"><table><thead><tr><th>ผู้ใช้</th><th>สิทธิ์</th><th>สถานะ</th><th>วันที่สร้าง</th><th>การจัดการ</th></tr></thead><tbody>{listQuery.isLoading ? Array.from({ length: 4 }, (_, index) => <tr className="skeleton-row table-state-row" key={`user-skeleton-${index}`}><td><div className="member-cell"><span className="skeleton-avatar" /><span className="skeleton-cell-w" /></div></td><td><span className="skeleton-cell-n" /></td><td><span className="skeleton-cell-n" /></td><td><span className="skeleton-cell-n" /></td><td><span className="skeleton-cell-n" /></td></tr>) : listQuery.isError ? <tr className="table-state-row"><td colSpan={5}><div className="table-loading"><CircleAlert size={22} /><b>โหลดรายชื่อผู้ใช้ไม่สำเร็จ</b><span>{getErrorMessage(listQuery.error)}</span></div></td></tr> : rows.length === 0 ? <tr className="table-state-row"><td colSpan={5}><div className="table-loading"><UsersRound size={22} /><b>ไม่พบผู้ใช้ตามเงื่อนไข</b><span>ลองเปลี่ยนคำค้นหาหรือตัวกรองสิทธิ์การใช้งาน</span></div></td></tr> : rows.map((user) => { const isSelf = user.username === selfUsername; return <tr key={user.id} className={user.active === 1 ? "" : "archived-row"}><td><div className="member-cell"><span className={`user-avatar ${user.role}`}>{user.displayName.slice(0, 1)}</span><div><b>{user.displayName}{isSelf && <span className="user-self-tag">บัญชีของคุณ</span>}</b><small>@{user.username}</small></div></div></td><td><span className={`user-role-badge ${user.role}`}>{user.role === "admin" ? <Crown size={13} /> : <ShieldCheck size={13} />} {ROLE_LABEL[user.role]}</span></td><td className="status-cell">{user.active === 1 ? <StatusPill tone="green">ใช้งานปกติ</StatusPill> : <StatusPill tone="red">ระงับการใช้งาน</StatusPill>}</td><td>{formatLogDateTime(user.createdAt)}</td><td><div className="product-actions"><button className="mini-button" onClick={() => openEdit(user)}><Settings2 size={13} /> แก้ไขข้อมูล</button><button className="mini-button" onClick={() => openPassword(user)}><KeyRound size={13} /> ตั้งรหัสผ่าน</button>{!isSelf && (user.active === 1 ? <button className="mini-button danger" disabled={updateMutation.isPending} onClick={() => setStatusTarget(user)}><LockKeyhole size={13} /> ระงับ</button> : <button className="mini-button success" disabled={updateMutation.isPending} onClick={() => setStatusTarget(user)}><Check size={13} /> เปิดใช้งาน</button>)}</div></td></tr>; })}</tbody></table></div></section><section className="panel table-panel session-panel" aria-label="เซสชันที่ใช้งานอยู่"><div className="table-toolbar"><div><h2><MonitorSmartphone size={17} className="toolbar-icon" /> เซสชันที่ใช้งานอยู่</h2><p>อุปกรณ์ที่เข้าสู่ระบบค้างไว้ · ตรวจสอบและยกเลิกได้ทันทีเพื่อความปลอดภัย</p></div><div className="toolbar-actions"><button className="mini-button danger" disabled={revokeOthersMutation.isPending || otherSessions.length === 0} onClick={() => setRevokeOthersOpen(true)}><LogOut size={13} /> ยกเลิกเซสชันอื่นทั้งหมด{otherSessions.length > 0 && ` (${otherSessions.length})`}</button></div></div><div className="table-filter-summary"><span><MonitorSmartphone size={13} /> เซสชันหมดอายุอัตโนมัติใน 7 วันหลังเข้าสู่ระบบ</span><span>อัปเดตล่าสุดอัตโนมัติทุก 30 วินาที</span></div>{sessionNotice && <div className="notice-bar"><Check size={16} /> {sessionNotice}<button onClick={() => setSessionNotice("")}><X size={14} /></button></div>}{sessionError && <div className="notice-bar error"><CircleAlert size={16} /> {sessionError}<button onClick={() => setSessionError("")}><X size={14} /></button></div>}{sessionsQuery.isLoading ? <div className="session-list" aria-busy="true">{Array.from({ length: 2 }, (_, index) => <div className="session-row session-skeleton" key={`session-skeleton-${index}`}><span className="skeleton-avatar" /><div className="session-main"><span className="skeleton-cell-w" /><span className="skeleton-cell-n" /></div><span className="skeleton-cell-n" /></div>)}</div> : sessionsQuery.isError ? <div className="table-loading"><CircleAlert size={22} /><b>โหลดเซสชันไม่สำเร็จ</b><span>{getErrorMessage(sessionsQuery.error)}</span></div> : sessions.length === 0 ? <div className="table-loading"><MonitorSmartphone size={22} /><b>ไม่พบเซสชันที่ใช้งานอยู่</b><span>ล็อกอินใหม่แล้วลองอีกครั้ง</span></div> : <div className="session-list">{sessions.map((session) => <div className={`session-row${session.current ? " current" : ""}`} key={session.sessionId}><span className={`session-avatar ${session.role}`}>{session.displayName.slice(0, 1)}</span><div className="session-main"><b>{session.displayName}{session.current && <span className="session-current-tag"><i /> เซสชันนี้</span>}</b><small>@{session.username} · <span className={`user-role-badge ${session.role}`}>{session.role === "admin" ? <Crown size={11} /> : <ShieldCheck size={11} />} {ROLE_LABEL[session.role]}</span>{session.active !== 1 && <span className="session-suspended-tag">บัญชีระงับ</span>}</small></div><div className="session-meta"><small><b>เข้าสู่ระบบ</b> {formatLogDateTime(session.createdAt)}</small><small>หมดอายุ {expiryLabel(session.expiresAt)}</small><code className="session-id" title={session.sessionId}>{session.sessionId.slice(0, 8)}…</code></div>{session.current ? <span className="session-current-badge"><Check size={13} /> ใช้งานอยู่</span> : <button className="mini-button danger" disabled={revokeMutation.isPending} onClick={() => setRevokeTarget(session)}><LogOut size={13} /> ยกเลิกเซสชัน</button>}</div>)}</div>}</section>{createOpen && <div className="modal-backdrop" onClick={() => setCreateOpen(false)}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">NEW USER ACCOUNT</span><h2>เพิ่มผู้ใช้ใหม่</h2><p>สร้างบัญชีสำหรับเจ้าหน้าที่ร้านค้าหรือผู้บริหารระบบ</p></div><button className="icon-button" onClick={() => setCreateOpen(false)}><X size={17} /></button></div><div className="form-grid compact-form"><label className="wide">ชื่อผู้ใช้ *<input autoFocus value={createForm.username} onChange={(event) => setCreateForm({ ...createForm, username: event.target.value })} placeholder="เช่น somsri.k" /></label><label>รหัสผ่าน *<input type="password" value={createForm.password} onChange={(event) => setCreateForm({ ...createForm, password: event.target.value })} placeholder="อย่างน้อย 4 ตัวอักษร" /></label><label>ยืนยันรหัสผ่าน *<input type="password" value={createForm.confirm} onChange={(event) => setCreateForm({ ...createForm, confirm: event.target.value })} placeholder="พิมพ์รหัสผ่านซ้ำอีกครั้ง" /></label><label>ชื่อ-นามสกุล *<input value={createForm.displayName} onChange={(event) => setCreateForm({ ...createForm, displayName: event.target.value })} placeholder="เช่น สมศรี ใจดี" /></label><label>สิทธิ์การใช้งาน<select value={createForm.role} onChange={(event) => setCreateForm({ ...createForm, role: event.target.value as "staff" | "admin" })}><option value="staff">เจ้าหน้าที่ร้านค้า</option><option value="admin">ผู้บริหารระบบ</option></select></label></div><div className="initial-balance-note"><ShieldCheck size={15} /> ชื่อผู้ใช้เป็นตัวอักษรอังกฤษ ตัวเลข จุด หรือขีดล่าง ความยาว 3-30 ตัวอักษร · รหัสผ่านอย่างน้อย 4 ตัวอักษร</div>{createError && <div className="notice-bar error"><CircleAlert size={16} /> {createError}<button onClick={() => setCreateError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={() => setCreateOpen(false)}>ยกเลิก</button><button className="primary-button" disabled={createMutation.isPending} onClick={submitCreate}><UserPlus size={16} /> {createMutation.isPending ? "กำลังบันทึก…" : "เพิ่มผู้ใช้"}</button></div></div></div>}{editTarget && <div className="modal-backdrop" onClick={() => setEditTarget(null)}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">EDIT USER</span><h2>แก้ไขข้อมูลผู้ใช้</h2><p>@{editTarget.username} · {editTarget.displayName}<StatusPill tone={editTarget.active === 1 ? "green" : "red"}>{editTarget.active === 1 ? "ใช้งานปกติ" : "ระงับการใช้งาน"}</StatusPill></p></div><button className="icon-button" onClick={() => setEditTarget(null)}><X size={17} /></button></div><div className="form-grid compact-form"><label className="wide">ชื่อ-นามสกุล *<input autoFocus value={editForm.displayName} onChange={(event) => setEditForm({ ...editForm, displayName: event.target.value })} placeholder="ชื่อที่แสดงในระบบ" /></label><label>สิทธิ์การใช้งาน<select disabled={editTarget.username === selfUsername} value={editForm.role} onChange={(event) => setEditForm({ ...editForm, role: event.target.value as "staff" | "admin" })}><option value="staff">เจ้าหน้าที่ร้านค้า</option><option value="admin">ผู้บริหารระบบ</option></select>{editTarget.username === selfUsername && <small className="field-hint">ไม่สามารถเปลี่ยนสิทธิ์ของบัญชีตัวเองได้</small>}</label></div><div className="initial-balance-note"><ShieldCheck size={15} /> การแก้ไขบันทึกลงระบบทันทีและปรากฏในระบบ Log</div>{editError && <div className="notice-bar error"><CircleAlert size={16} /> {editError}<button onClick={() => setEditError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={() => setEditTarget(null)}>ยกเลิก</button><button className="primary-button" disabled={updateMutation.isPending || editForm.displayName.trim() === ""} onClick={submitEdit}><Settings2 size={16} /> {updateMutation.isPending ? "กำลังบันทึก…" : "บันทึกการแก้ไข"}</button></div></div></div>}{passwordTarget && <div className="modal-backdrop" onClick={() => setPasswordTarget(null)}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">PASSWORD RESET</span><h2>ตั้งรหัสผ่านใหม่</h2><p>@{passwordTarget.username} · {passwordTarget.displayName} · สิทธิ์ {ROLE_LABEL[passwordTarget.role]}</p></div><button className="icon-button" onClick={() => setPasswordTarget(null)}><X size={17} /></button></div><div className="form-grid compact-form"><label>รหัสผ่านใหม่ *<input autoFocus type="password" value={passwordForm.password} onChange={(event) => setPasswordForm({ ...passwordForm, password: event.target.value })} placeholder="อย่างน้อย 4 ตัวอักษร" /></label><label>ยืนยันรหัสผ่าน *<input type="password" value={passwordForm.confirm} onChange={(event) => setPasswordForm({ ...passwordForm, confirm: event.target.value })} placeholder="พิมพ์รหัสผ่านใหม่ซ้ำ" /></label></div><div className="initial-balance-note"><ShieldCheck size={15} /> ระบบบันทึก “ตั้งรหัสผ่านใหม่” ลงระบบ Log · ไม่แสดงรหัสผ่านที่ตั้งไว้ที่ใดทั้งสิ้น</div>{passwordError && <div className="notice-bar error"><CircleAlert size={16} /> {passwordError}<button onClick={() => setPasswordError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={() => setPasswordTarget(null)}>ยกเลิก</button><button className="primary-button" disabled={updateMutation.isPending} onClick={submitPassword}><KeyRound size={16} /> {updateMutation.isPending ? "กำลังบันทึก…" : "ตั้งรหัสผ่านใหม่"}</button></div></div></div>}<ConfirmDialog open={statusTarget !== null} title={statusTarget && statusTarget.active !== 1 ? "ยืนยันการเปิดใช้งานผู้ใช้?" : "ยืนยันการระงับผู้ใช้?"} description={statusTarget ? (statusTarget.active !== 1 ? `บัญชี @${statusTarget.username} (${statusTarget.displayName}) จะกลับมาเข้าสู่ระบบได้ตามปกติ` : `ผู้ใช้ ${statusTarget.displayName} (@${statusTarget.username}) จะไม่สามารถเข้าสู่ระบบได้จนกว่าจะเปิดใช้งานอีกครั้ง · ระบบจะปฏิเสธหากเป็นการระงับผู้บริหารรายสุดท้ายของระบบ`) : ""} confirmLabel={statusTarget && statusTarget.active !== 1 ? "ยืนยันเปิดใช้งาน" : "ยืนยันระงับการใช้งาน"} onCancel={() => setStatusTarget(null)} onConfirm={confirmStatus} /><ConfirmDialog open={revokeTarget !== null} title="ยืนยันการยกเลิกเซสชัน?" description={revokeTarget ? `อุปกรณ์ที่เข้าสู่ระบบด้วยบัญชี @${revokeTarget.username} (${revokeTarget.displayName}) เมื่อ ${formatLogDateTime(revokeTarget.createdAt)} จะถูกออกจากระบบทันที · ผู้ใช้ต้องเข้าสู่ระบบใหม่เพื่อใช้งานต่อ` : ""} confirmLabel="ยืนยันยกเลิกเซสชัน" onCancel={() => setRevokeTarget(null)} onConfirm={() => { if (revokeTarget) revokeMutation.mutate({ sessionId: revokeTarget.sessionId }); }} /><ConfirmDialog open={revokeOthersOpen} title="ยกเลิกเซสชันอื่นทั้งหมด?" description={`ยกเลิกเซสชันอื่นอีก ${otherSessions.length} รายการทั้งหมด · เหลือเฉพาะเซสชันที่คุณใช้อยู่ในขณะนี้ · ผู้ใช้ที่ถูกยกเลิกต้องเข้าสู่ระบบใหม่`} confirmLabel={`ยืนยันยกเลิก ${otherSessions.length} เซสชัน`} onCancel={() => setRevokeOthersOpen(false)} onConfirm={() => revokeOthersMutation.mutate(undefined)} /></>;
}
