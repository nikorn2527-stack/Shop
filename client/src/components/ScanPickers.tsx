import { useEffect, useMemo, useRef, useState } from "react";
import { PackageSearch, Plus, ScanLine, UserCircle2, X } from "lucide-react";
import type { SqliteProduct } from "../../../server/sqliteStore";
import type { MemberLite } from "@/pages/pageData";
import { money, scanCandidates, scanMatches } from "@/pages/pageData";

/**
 * Scan-first member selector — the cashier keys the member number or fires a
 * barcode/QR gun into the box (scanners end with Enter, which commits).
 * Shows a short suggestion list while typing; exact code wins instantly.
 */
export function MemberScanPicker({
  members,
  selectedNumber,
  onSelect,
  onNewMember,
  inputId,
  placeholder = "คีย์เลขสมาชิก หรือยิงบาร์โค้ด / คิวอาร์โค้ด",
  emptyHint = "ยังไม่มีสมาชิกในระบบ · ลงทะเบียนก่อนใช้งาน",
}: {
  members: MemberLite[];
  selectedNumber: string | null;
  onSelect: (member: MemberLite | null) => void;
  onNewMember?: () => void;
  inputId?: string;
  placeholder?: string;
  emptyHint?: string;
}) {
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selected = members.find((member) => member.memberNumber === selectedNumber) ?? null;

  const suggestions = useMemo(() => {
    const q = term.trim();
    if (q === "") return members.slice(0, 6);
    const candidates = scanCandidates(q);
    const lowered = q.toLowerCase();
    return members
      .filter(
        (member) =>
          candidates.includes(member.memberNumber.toLowerCase()) ||
          `${member.firstName} ${member.lastName}`.toLowerCase().includes(lowered) ||
          member.firstName.toLowerCase().includes(lowered) ||
          member.lastName.toLowerCase().includes(lowered),
      )
      .slice(0, 6);
  }, [members, term]);

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = (member: MemberLite | null) => {
    onSelect(member);
    setTerm("");
    setOpen(false);
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
            <UserCircle2 size={18} />
          </div>
          <div className="member-scan-info">
            <b>
              {selected.memberNumber} · สมาชิก{selected.firstName} {selected.lastName}
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
      ) : (
        <>
          <div className="member-scan-field">
            <ScanLine size={16} />
            <input
              ref={inputRef}
              id={inputId}
              value={term}
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
          {onNewMember && (
            <button type="button" className="outline-button member-new-btn" onClick={onNewMember}>
              <Plus size={15} /> สมาชิกใหม่
            </button>
          )}
        </>
      )}
      {open && !selected && (
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
                <small>ตรวจอีกครั้ง หรือกดปุ่ม “สมาชิกใหม่” เพื่อลงทะเบียน</small>
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
  const selected = products.find((product) => product.id === selectedId) ?? null;

  const suggestions = useMemo(() => {
    const q = term.trim();
    if (q === "") return products.slice(0, 6);
    const candidates = scanCandidates(q);
    const lowered = q.toLowerCase();
    return products
      .filter(
        (product) =>
          candidates.includes(product.sku.toLowerCase()) ||
          (product.barcode ? candidates.includes(product.barcode.toLowerCase()) : false) ||
          product.name.toLowerCase().includes(lowered),
      )
      .slice(0, 6);
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
            value={term}
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
