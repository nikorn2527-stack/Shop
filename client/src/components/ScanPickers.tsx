import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, PackageSearch, ScanLine, X } from "@/lib/icons";
import { toast } from "sonner";
import { blocker } from "@/components/BlockerAlert";
import type { SqliteProduct } from "../../../server/sqliteStore";
import type { MemberLite } from "@/pages/pageData";
import { money, memberFullName, scanMatches, smartMatchScore } from "@/pages/pageData";
import { SCAN_LAYOUT_TOAST, useScanLayout } from "../scanLayout";
import { MemberAvatar } from "./MemberAvatar";
import { MemberCardModal } from "./MemberCardModal";
import { BarcodeCameraModal } from "./BarcodeCameraModal";
import { SharedSearch } from "./SharedSearch";

/**
 * Round 37 (req 36) — ปิดประวัติการคีย์/ยิงของช่องกรอกข้อมูลทุกช่อง:
 * เบราว์เซอร์ไม่ควรจำบาร์โค้ดที่เคยยิง (เดิมโผล่เป็น dropdown ประวัติ)
 * — autoComplete="off" + ชื่อช่องสุ่มต่อเซสชัน ทำให้ไม่มีรายการที่ match ได้เลย
 */
function useNoHistoryName(prefix: string) {
  const ref = useRef(`${prefix}-${Math.random().toString(36).slice(2, 10)}`);
  return ref.current;
}

/**
 * Scan-first member selector — the cashier keys the member number or fires a
 * barcode/QR gun into the box (scanners end with Enter, which commits).
 * Shows a short suggestion list while typing; exact code wins instantly.
 *
 * Round 44 (user) — รายการสมาชิกโชว์เฉพาะตอน "ค้นหา" เท่านั้น: โฟกัสช่องเปล่า ๆ
 * ไม่เด้ง dropdown — เริ่มพิมพ์หรือสแกน (มีตัวอักษร) จึงโชว์ตัวเลือกให้เลือก
 *
 * requireConfirm — after ANY pick (scan / key / click), a verification card
 * with the member's photo, name, number and balance shows up first. The
 * member only lands on the bill once the cashier presses ยืนยัน — protects
 * against deducting the wrong account when two cards scan similar.
 */
export function MemberScanPicker({
  members,
  selectedNumber,
  onSelect,
  inputId,
  placeholder = "ค้นหาชื่อ เลขสมาชิก เลขบัตร หรือสแกน",
  emptyHint = "ยังไม่มีสมาชิกในระบบ · ลงทะเบียนก่อนใช้งาน",
  requireConfirm = false,
  confirmContext = "บิลนี้",
  allowGeneralCustomer = true,
  inputLabel = "เลขสมาชิกสำหรับบิลนี้ (คีย์หรือสแกน)",
  autoFocus = false,
}: {
  members: MemberLite[];
  selectedNumber: string | null;
  onSelect: (member: MemberLite | null) => void;
  inputId?: string;
  placeholder?: string;
  emptyHint?: string;
  requireConfirm?: boolean;
  confirmContext?: string;
  allowGeneralCustomer?: boolean;
  inputLabel?: string;
  autoFocus?: boolean;
}) {
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<MemberLite | null>(null);
  // ROUND 55 (user) — สแกนด้วยกล้องมือถือ (ไม่มีปืนสแกนก็ยิงได้)
  const [cameraOpen, setCameraOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputName = useNoHistoryName("pos-member-scan");
  // ROUND 80 — ยิงบาร์โค้ดตอนวินโดว์เป็นภาษาไทย: จับปุ่มจริง + จังหวะปืนสแกน
  // แล้วแปลงกลับเป็นเลข/อังกฤษให้เอง (เดิมต้องสลับ EN ก่อนทุกครั้ง)
  const scanLayout = useScanLayout();
  const selected = members.find((member) => member.memberNumber === selectedNumber) ?? null;

  // Round 32-19 — smart ranking: exact > prefix (เลขสมาชิกตัดหน้า) > contains >
  // digits-tail (3 ตัวท้าย) — ชื่อ-สกุลก็จับได้ แล้วเรียงคะแนนสูงขึ้นก่อน
  const suggestions = useMemo(() => {
    const q = term.trim();
    if (q === "") return members.slice(0, 6);
    return members
      .map((member) => ({
        member,
        score: Math.max(
          smartMatchScore(member.memberNumber, q),
          smartMatchScore(member.cardNumber, q),
          Math.max(
            smartMatchScore(memberFullName(member), q),
            smartMatchScore(member.firstName, q),
            smartMatchScore(member.lastName, q),
          ) * 0.9,
        ),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((entry) => entry.member);
  }, [members, term]);

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = (member: MemberLite | null) => {
    if (member && requireConfirm) {
      setPending(member);
      setTerm("");
      setOpen(false);
      return;
    }
    onSelect(member);
    setTerm("");
    setOpen(false);
    inputRef.current?.focus();
  };

  const confirmPending = () => {
    if (!pending) return;
    if (pending.status === "suspended") {
      // ROUND 78 — บัตรถูกระงับ: เด้งกลางจอให้ชัด (เดิม toast มุมขวาล่างมองไม่เห็น)
      blocker.warning("บัตรสมาชิกถูกระงับการใช้จ่าย", `${memberFullName(pending)} · ${pending.memberNumber}\nตรวจสอบกับผู้บริหารก่อนใช้รายการนี้`);
      return;
    }
    onSelect(pending);
    setPending(null);
    inputRef.current?.focus();
  };

  // codeArg = รหัสที่มาจากกล้อง (ROUND 55) — commit ให้เลยไม่ต้องรอ Enter
  const commit = (codeArg?: string) => {
    let value = (codeArg ?? term).trim();
    if (value === "") {
      setOpen(false);
      return;
    }
    // ROUND 80 — คีย์บอร์ดไทย: เลขสมาชิก/บาร์โค้ดที่ยิงมาเป็นอักขระไทย แปลงกลับให้อัตโนมัติ
    if (codeArg === undefined) {
      const fixed = scanLayout.normalize(value);
      if (fixed.convertedFrom !== undefined) {
        value = fixed.value;
        setTerm(fixed.value);
        toast.info(SCAN_LAYOUT_TOAST.message, { description: SCAN_LAYOUT_TOAST.description(fixed.convertedFrom, fixed.value), duration: 3200 });
      }
    }
    const exact =
      members.find((member) => scanMatches(member.memberNumber, value) || scanMatches(member.cardNumber, value)) ??
      (codeArg === undefined && suggestions.length === 1 && suggestions[0].status === "active" ? suggestions[0] : null);
    if (exact) pick(exact);
    else { setTerm(value); setOpen(true); }
  };

  return (
    <SharedSearch label="สมาชิก" priority={20} enabled={!selected && inputId !== "pos-member-input"}>
    <div className="member-scan-wrap" ref={wrapRef}>
      {selected ? (
        <div className="member-scan-chip">
          <div className="member-avatar">
            <MemberAvatar member={selected} size={30} rounded={false} />
          </div>
          <div className="member-scan-info">
            <b>
              {selected.memberNumber} · สมาชิก{memberFullName(selected)}
            </b>
            <small>ยอดคงเหลือ {money(selected.balance)}</small>
          </div>
          <button
            type="button"
            className="member-scan-clear"
            onClick={() => pick(null)}
            aria-label="ถอดสมาชิกออกจากบิลนี้"
            title="ถอดสมาชิกออกจากบิลนี้"
          >
            <X size={15} />
          </button>
        </div>
      ) : inputId === "pos-member-input" ? null : (
        <>
          <div className="member-scan-field">
            <ScanLine size={16} />
            <input
              ref={inputRef}
              id={inputId}
              name={inputName}
              type="text"
              inputMode="text"
              value={term}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              onKeyDownCapture={scanLayout.onKeyDownCapture}
              onChange={(event) => {
                setTerm(event.target.value);
                // Round 44 — เปิดรายการเฉพาะตอนมีคำค้นจริง (คีย์/สแกน)
                setOpen(event.target.value.trim() !== "");
              }}
              onFocus={() => {
                // Round 44 — ช่องเปล่าโฟกัสเฉย ๆ ไม่โชว์ dropdown จนกว่าจะเริ่มค้นหา
                if (term.trim() !== "") setOpen(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commit();
                }
              }}
              placeholder={placeholder}
              aria-label={inputLabel}
              autoFocus={autoFocus}
            />
            <button
              type="button"
              className="scan-camera-btn"
              onClick={() => setCameraOpen(true)}
              aria-label="สแกนบัตรสมาชิกด้วยกล้อง"
              title="สแกนด้วยกล้องโทรศัพท์/เว็บแคม — สำหรับเครื่องที่ไม่มีปืนสแกน อ่านบาร์โค้ด/QR บนบัตรได้เลย"
            >
              <Camera size={16} />
            </button>
            {term ? (
              <button
                type="button"
                className="scan-clear"
                onClick={() => {
                  // Round 44 — ล้างคำค้น = ปิดรายการด้วย (ช่องเปล่าต้องเงียบ)
                  setTerm("");
                  setOpen(false);
                  inputRef.current?.focus();
                }}
                aria-label="ล้างช่องค้นหาสมาชิก"
              >
                <X size={14} />
              </button>
            ) : (
              <kbd>Enter</kbd>
            )}
          </div>
        </>
      )}
      {open && !selected && !pending && (
        <div className="member-scan-list" role="listbox" aria-label="รายการสมาชิกที่ตรงกับที่คีย์">
          {allowGeneralCustomer && <button type="button" className="member-option" onClick={() => pick(null)}>
            <div>
              <b>บุคคลทั่วไป</b>
              <small>ชำระเงินสดหรือ QR</small>
            </div>
          </button>}
          {members.length === 0 ? (
            <div className="member-option disabled">
              <div>
                <b>ยังไม่มีสมาชิกในระบบ</b>
                <small>{emptyHint}</small>
              </div>
            </div>
          ) : suggestions.length === 0 ? (
            <div className="member-option disabled">
              <div>
                <b>ไม่พบเลขสมาชิกที่คีย์</b>
                <small>ลองคีย์เฉพาะตัวเลข (เช่น 092) หรือชื่อ · ลงทะเบียนใหม่ได้ที่ปุ่มสมาชิกใหม่บนแถบด้านซ้าย (F6)</small>
              </div>
            </div>
          ) : (
            suggestions.map((member) => (
              <button
                type="button"
                className="member-option"
                key={member.memberNumber}
                disabled={member.status === "suspended"}
                onClick={() => pick(member)}
              >
                <MemberAvatar member={member} size={34} />
                <div>
                  <b>
                    {member.memberNumber} · สมาชิก{memberFullName(member)}
                  </b>
                  <small>ยอดคงเหลือ {money(member.balance)}</small>
                </div>
                {member.status === "suspended" ? <span className="suspended-tag">ระงับ</span> : null}
              </button>
            ))
          )}
        </div>
      )}
      {/* ROUND 37 (req 36) — ยิงบัตรสมาชิกเข้าช่องเลือกสมาชิก → บัตรเด้งขึ้นมา
          เต็มรูปแบบ (รูป + บาร์โค้ด + QR + ยอดคงเหลือ) ให้ยืนยันก่อนใช้จริง */}
      {pending && createPortal(
        <MemberCardModal
          member={pending}
          confirmForBill
          confirmLabel={`ยืนยันใช้กับ${confirmContext}`}
          onClose={() => { setPending(null); inputRef.current?.focus(); }}
          onConfirm={confirmPending}
        />, document.body
      )}
      {cameraOpen && createPortal(
        <BarcodeCameraModal
          open
          title="สแกนบัตรสมาชิกด้วยกล้อง"
          hint="เล็งบาร์โค้ดหรือคิวอาร์โค้ดบนบัตรสมาชิก — อ่านได้แล้วระบบหาสมาชิกให้ทันที"
          onClose={() => setCameraOpen(false)}
          onDetect={(code) => {
            setCameraOpen(false);
            commit(code);
          }}
        />, document.body
      )}
    </div>
    </SharedSearch>
  );
}

/**
 * Scan-first product selector for the stock receive / count flows — the staff
 * fires the barcode on the physical item (or keys the SKU / name) and the
 * product lands in the form immediately.
 */
export function ProductScanPicker({
  products,
  selectedId,
  onSelect,
  autoFocus,
  compactSelected = false,
  local = false,
  onNotFound,
  placeholder = "ยิงบาร์โค้ดที่ตัวสินค้า หรือคีย์รหัส SKU / ชื่อสินค้า",
}: {
  products: SqliteProduct[];
  selectedId: number | null;
  onSelect: (product: SqliteProduct | null) => void;
  autoFocus?: boolean;
  compactSelected?: boolean;
  local?: boolean;
  onNotFound?: (code: string) => void;
  placeholder?: string;
}) {
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [missed, setMissed] = useState("");
  // ROUND 55 (user) — สแกนด้วยกล้องมือถือ: นับสต็อก/รับเข้าโดยไม่ต้องมีปืนสแกน
  const [cameraOpen, setCameraOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputName = useNoHistoryName("pos-product-scan");
  // ROUND 80 — ยิงบาร์โค้ดตอนวินโดว์เป็นภาษาไทย (เดียวกับช่องสมาชิก)
  const scanLayout = useScanLayout();
  const selected = products.find((product) => product.id === selectedId) ?? null;

  // Round 32-19 — smart ranking for products: barcode/SKU exact หรือท้ายรหัส
  // 3 ตัว (เช่น 017 → 8850000000017) + ชื่อ/คำ ก็จับได้
  const suggestions = useMemo(() => {
    const q = term.trim();
    if (q === "") return [];
    return products
      .map((product) => ({
        product,
        score: Math.max(
          smartMatchScore(product.barcode, q),
          smartMatchScore(product.sku, q),
          smartMatchScore(product.name, q) * 0.85,
        ),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((entry) => entry.product);
  }, [products, term]);

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (selectedId === null) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [selectedId]);

  const pick = (product: SqliteProduct | null) => {
    onSelect(product);
    setTerm("");
    setMissed("");
    setOpen(false);
  };

  // codeArg = รหัสที่มาจากกล้อง (ROUND 55) — บาร์โค้ดที่ยิงตรงเข้าเลือกสินค้าทันที
  const commit = (codeArg?: string) => {
    let value = (codeArg ?? term).trim();
    if (value === "") {
      setOpen(false);
      return;
    }
    // ROUND 80 — คีย์บอร์ดไทย: บาร์โค้ด/SKU ที่ยิงมาเป็นอักขระไทย แปลงกลับให้อัตโนมัติ
    if (codeArg === undefined) {
      const fixed = scanLayout.normalize(value);
      if (fixed.convertedFrom !== undefined) {
        value = fixed.value;
        setTerm(fixed.value);
        setMissed("");
        toast.info(SCAN_LAYOUT_TOAST.message, { description: SCAN_LAYOUT_TOAST.description(fixed.convertedFrom, fixed.value), duration: 3200 });
      }
    }
    const exact =
      products.find(
        (product) => scanMatches(product.barcode, value) || scanMatches(product.sku, value),
      ) ?? (codeArg === undefined && suggestions.length === 1 ? suggestions[0] : null);
    if (exact) pick(exact);
    else {
      setTerm(value);
      setMissed(value);
      setOpen(true);
      if (onNotFound && !suggestions.length) {
        setOpen(false);
        onNotFound(value);
      }
    }
  };

  return (
    <SharedSearch label="เลือกสินค้า · รับเข้า / นับสต็อก" priority={30} enabled={!selected && !local}>
    <div className="product-scan-wrap" ref={wrapRef}>
      {selected ? (
        <div className={`product-scan-chip${compactSelected ? " product-scan-chip-compact" : ""}`}>
          <div className="product-thumb">
            {selected.imageUrl ? <img src={selected.imageUrl} alt="" /> : <PackageSearch size={17} />}
          </div>
          <div className="member-scan-info">
            <b>
              {selected.sku} · {selected.name}
            </b>
            <small>
              {selected.size ? `${selected.size} · ` : ""}คงเหลือ {selected.stock} {selected.unit}
            </small>
          </div>
          <button
            type="button"
            className="member-scan-clear"
            onClick={() => pick(null)}
            aria-label="เปลี่ยนสินค้า"
            title="เปลี่ยนสินค้า"
          >
            <X size={15} />
            {compactSelected && <span>เปลี่ยนสินค้า</span>}
          </button>
        </div>
      ) : (
        <div className="member-scan-field">
          <ScanLine size={16} />
          <input
            ref={inputRef}
            name={inputName}
            type="text"
            inputMode="text"
            value={term}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus={autoFocus}
            onKeyDownCapture={scanLayout.onKeyDownCapture}
            onChange={(event) => {
              setTerm(event.target.value);
              setMissed("");
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              }
            }}
            placeholder={placeholder}
            aria-label="ค้นหาสินค้าด้วยบาร์โค้ด รหัส SKU หรือชื่อ"
          />
          <button
            type="button"
            className="scan-camera-btn"
            onClick={() => setCameraOpen(true)}
            aria-label="สแกนสินค้าด้วยกล้อง"
            title="สแกนด้วยกล้องโทรศัพท์/เว็บแคม — เหมาะกับงานนับสต็อกเดินนับรอบร้าน ไม่ต้องมีปืนสแกน"
          >
            <Camera size={16} />
          </button>
          {term ? (
            <button
              type="button"
              className="scan-clear"
              onClick={() => {
                setTerm("");
                inputRef.current?.focus();
              }}
              aria-label="ล้างช่องค้นหาสินค้า"
            >
              <X size={14} />
            </button>
          ) : (
            <kbd>Enter</kbd>
          )}
        </div>
      )}
      {open && !selected && term.trim() !== "" && (
        <div className="member-scan-list product-scan-list" role="listbox" aria-label="สินค้าที่ตรงกับที่คีย์">
          {missed ? (
            <div className="member-option disabled">
              <div>
                <b>ไม่พบรหัส “{missed}”</b>
                <small>ตรวจบาร์โค้ดอีกครั้ง หรือเลือกจากรายการด้านล่าง</small>
              </div>
            </div>
          ) : null}
          {suggestions.length === 0 ? (
            <div className="member-option disabled">
              <div>
                <b>ไม่พบสินค้าที่ตรงกับที่คีย์</b>
                <small>ลองยิงบาร์โค้ดเต็ม หรือคีย์ชื่อสินค้าแทน</small>
              </div>
            </div>
          ) : (
            suggestions.map((product) => (
              <button
                type="button"
                className="member-option"
                key={product.id}
                onClick={() => pick(product)}
              >
                <div className="product-scan-option">
                  <div className="product-thumb">
                    {product.imageUrl ? <img src={product.imageUrl} alt="" /> : <PackageSearch size={16} />}
                  </div>
                  <div>
                    <b>
                      {product.sku} · {product.name}
                    </b>
                    <small>
                      {product.size ? `${product.size} · ` : ""}คงเหลือ {product.stock} {product.unit} ·{" "}
                      {money(product.price)}
                    </small>
                  </div>
                </div>
                {product.active !== 1 ? <span className="suspended-tag">ปิดการขาย</span> : null}
              </button>
            ))
          )}
        </div>
      )}
      {cameraOpen && createPortal(
        <BarcodeCameraModal
          open
          title="สแกนสินค้าด้วยกล้อง"
          hint="เล็งบาร์โค้ดที่ตัวสินค้า — อ่านได้แล้วสินค้าเข้าฟอร์มให้ทันที ใช้นับสต็อกเดินรอบร้านได้เลย"
          onClose={() => setCameraOpen(false)}
          onDetect={(code) => {
            setCameraOpen(false);
            commit(code);
          }}
        />, document.body
      )}
    </div>
    </SharedSearch>
  );
}
