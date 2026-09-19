import { useEffect, useMemo, useRef, useState } from "react";
import { PackageSearch, ScanLine, X } from "lucide-react";
import { toast } from "sonner";
import type { SqliteProduct } from "../../../server/sqliteStore";
import type { MemberLite } from "@/pages/pageData";
import { money, scanMatches, smartMatchScore } from "@/pages/pageData";
import { MemberAvatar } from "./MemberAvatar";
import { MemberCardModal } from "./MemberCardModal";

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
  placeholder = "คีย์เลขสมาชิก หรือยิงบาร์โค้ด / คิวอาร์โค้ด",
  emptyHint = "ยังไม่มีสมาชิกในระบบ · ลงทะเบียนก่อนใช้งาน",
  requireConfirm = false,
  confirmContext = "บิลนี้",
}: {
  members: MemberLite[];
  selectedNumber: string | null;
  onSelect: (member: MemberLite | null) => void;
  inputId?: string;
  placeholder?: string;
  emptyHint?: string;
  requireConfirm?: boolean;
  confirmContext?: string;
}) {
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<MemberLite | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputName = useNoHistoryName("pos-member-scan");
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
          Math.max(
            smartMatchScore(`${member.firstName} ${member.lastName}`, q),
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
      toast.error("บัตรนี้ถูกระงับการใช้จ่าย", { description: `${pending.firstName} ${pending.lastName} · ${pending.memberNumber} — ตรวจสอบกับผู้บริหารก่อนใช้รายการนี้` });
      return;
    }
    onSelect(pending);
    setPending(null);
    inputRef.current?.focus();
  };

  const commit = () => {
    if (term.trim() === "") {
      setOpen(false);
      return;
    }
    const exact =
      members.find((member) => scanMatches(member.memberNumber, term)) ??
      (suggestions.length === 1 && suggestions[0].status === "active" ? suggestions[0] : null);
    if (exact) pick(exact);
    else setOpen(true);
  };

  return (
    <div className="member-scan-wrap" ref={wrapRef}>
      {selected ? (
        <div className="member-scan-chip">
          <div className="member-avatar">
            <MemberAvatar member={selected} size={30} rounded={false} />
          </div>
          <div className="member-scan-info">
            <b>
              {selected.memberNumber} · สมาชิก{selected.firstName} {selected.lastName}
            </b>
            <small>ยอดคงเหลือ {money(selected.balance)}{selected.creditLimit != null ? ` · วงเงิน/วัน ${money(selected.creditLimit)}` : ""}</small>
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
      ) : (
        <>
          <div className="member-scan-field">
            <ScanLine size={16} />
            <input
              ref={inputRef}
              id={inputId}
              name={inputName}
              value={term}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(event) => {
                setTerm(event.target.value);
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
              aria-label="เลขสมาชิกสำหรับบิลนี้ (คีย์หรือสแกน)"
            />
            {term ? (
              <button
                type="button"
                className="scan-clear"
                onClick={() => {
                  setTerm("");
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
          <button type="button" className="member-option" onClick={() => pick(null)}>
            <div>
              <b>บุคคลทั่วไป</b>
              <small>ชำระเงินสดหรือ QR</small>
            </div>
          </button>
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
                    {member.memberNumber} · สมาชิก{member.firstName} {member.lastName}
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
      {pending && (
        <MemberCardModal
          member={pending}
          confirmForBill
          confirmLabel={`ยืนยันใช้กับ${confirmContext}`}
          onClose={() => { setPending(null); inputRef.current?.focus(); }}
          onConfirm={confirmPending}
        />
      )}
    </div>
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
  placeholder = "ยิงบาร์โค้ดที่ตัวสินค้า หรือคีย์รหัส SKU / ชื่อสินค้า",
}: {
  products: SqliteProduct[];
  selectedId: number | null;
  onSelect: (product: SqliteProduct | null) => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [missed, setMissed] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputName = useNoHistoryName("pos-product-scan");
  const selected = products.find((product) => product.id === selectedId) ?? null;

  // Round 32-19 — smart ranking for products: barcode/SKU exact หรือท้ายรหัส
  // 3 ตัว (เช่น 017 → 8850000000017) + ชื่อ/คำ ก็จับได้
  const suggestions = useMemo(() => {
    const q = term.trim();
    if (q === "") return products.slice(0, 6);
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

  const commit = () => {
    if (term.trim() === "") {
      setOpen(false);
      return;
    }
    const exact =
      products.find(
        (product) => scanMatches(product.barcode, term) || scanMatches(product.sku, term),
      ) ?? (suggestions.length === 1 ? suggestions[0] : null);
    if (exact) pick(exact);
    else {
      setMissed(term.trim());
      setOpen(true);
    }
  };

  return (
    <div className="product-scan-wrap" ref={wrapRef}>
      {selected ? (
        <div className="product-scan-chip">
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
          </button>
        </div>
      ) : (
        <div className="member-scan-field">
          <ScanLine size={16} />
          <input
            ref={inputRef}
            name={inputName}
            value={term}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus={autoFocus}
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
      {open && !selected && (
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
    </div>
  );
}
