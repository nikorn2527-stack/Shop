// @vitest-environment jsdom
import { createEvent, fireEvent, render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@shared/storeTypes/inventory";
import type { MemberLite } from "@/pages/pageData";
import { MemberScanPicker, ProductScanPicker } from "./ScanPickers";

// Keep the real picker, search ranking, navigation and scanner-layout hook.
// Only peripheral camera/card rendering and notifications are replaced.
vi.mock("./BarcodeCameraModal", () => ({
  BarcodeCameraModal: ({ onDetect }: { onDetect: (code: string) => void }) =>
    <button onClick={() => onDetect("CARD-002")}>อ่านรหัสจากกล้อง</button>,
}));
vi.mock("./MemberCardModal", () => ({
  MemberCardModal: ({ onConfirm }: { onConfirm: () => void }) =>
    <div role="dialog"><button onClick={onConfirm}>ยืนยันสมาชิก</button></div>,
}));
vi.mock("./BlockerAlert", () => ({ blocker: { warning: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { info: vi.fn() } }));

const products: Product[] = [1, 2, 3].map(id => ({
  id, sku: `SKU-00${id}`, barcode: `885000000000${id}`, name: `ขนม ${id}`,
  category: "ขนม", emoji: null, color: null, unit: "ชิ้น", price: 10,
  size: null, imageUrl: null, quickPick: 0, sellMode: "unit", priceTiers: null,
  cost: 5, stock: 20, reorderPoint: 1, active: 1, createdAt: "2026-01-01",
}));
const members: MemberLite[] = [1, 2, 3].map(id => ({
  memberNumber: `00000${id}`, cardNumber: `CARD-00${id}`, firstName: `สมชาย ${id}`,
  lastName: "ทดสอบ", type: "member", balance: 100,
  status: id === 2 ? "suspended" : "active", lastTransactionAt: null,
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function setup(kind: "product" | "member", options: { requireConfirm?: boolean; general?: boolean } = {}) {
  const onSelect = vi.fn();
  render(<div onKeyDown={bubble}>
    <button>ก่อนช่องค้นหา</button>
    {kind === "product"
      ? <ProductScanPicker products={products} selectedId={null} onSelect={onSelect} local />
      : <MemberScanPicker members={members} selectedNumber={null} onSelect={onSelect} local
          allowGeneralCustomer={options.general ?? false} requireConfirm={options.requireConfirm} />}
    <button>หลังช่องค้นหา</button>
  </div>);
  const input = screen.getByRole("combobox") as HTMLInputElement;
  input.focus();
  return { input, onSelect, search: (value: string) => fireEvent.change(input, { target: { value } }) };
}
const bubble = vi.fn();
function key(input: HTMLInputElement, value: string, extra: KeyboardEventInit = {}) {
  return fireEvent.keyDown(input, { key: value, code: value, ...extra });
}
function active(input: HTMLInputElement) {
  const id = input.getAttribute("aria-activedescendant");
  return id ? document.getElementById(id) : null;
}
function timedKey(input: HTMLInputElement, value: string, timeStamp: number, extra: KeyboardEventInit = {}) {
  const nativeEvent = createEvent.keyDown(input, { key: value, code: value, ...extra });
  Object.defineProperty(nativeEvent, "timeStamp", { value: timeStamp });
  fireEvent(input, nativeEvent);
}

describe.each(["product", "member"] as const)("%s picker keyboard contract", kind => {
  const query = kind === "product" ? "ขนม" : "สมชาย";
  it("starts closed, exposes a labelled listbox and keeps focus on the combobox", () => {
    const { input, search } = setup(kind);
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.hasAttribute("aria-controls")).toBe(false);
    expect(screen.queryByRole("listbox")).toBeNull();
    search(query);
    const list = screen.getByRole("listbox");
    expect(list.getAttribute("aria-label")).toBeTruthy();
    expect(input.getAttribute("aria-label")).toBeTruthy();
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-controls")).toBe(list.id);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(active(input)).toBeNull();
    key(input, "ArrowDown");
    expect(active(input)).toBe(screen.getAllByRole("option")[0]);
    expect(active(input)?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(input);
    expect(bubble).not.toHaveBeenCalled();
  });
  it("moves both ways, skips suspended rows and clamps at list boundaries", () => {
    const { input, search, onSelect } = setup(kind);
    search(query);
    const selectable = screen.getAllByRole("option").filter(row => !(row as HTMLButtonElement).disabled);
    key(input, "ArrowUp");
    expect(active(input)).toBe(selectable.at(-1));
    key(input, "ArrowDown");
    expect(active(input)).toBe(selectable.at(-1));
    for (let i = 0; i < 5; i++) key(input, "ArrowUp");
    expect(active(input)).toBe(selectable[0]);
    key(input, "ArrowDown");
    expect(active(input)).toBe(selectable[1]);
    key(input, "Enter");
    expect(onSelect.mock.calls).toEqual([[kind === "product" ? products[1] : members[2]]]);
    expect(input.value).toBe("");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
  it("Escape closes without committing; reopening starts a new highlight", () => {
    const { input, search, onSelect } = setup(kind);
    search(query);
    key(input, "ArrowDown");
    expect(key(input, "Escape")).toBe(false);
    expect(input.value).toBe(query);
    expect(active(input)).toBeNull();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
    key(input, "ArrowUp");
    expect(active(input)?.textContent).toContain(kind === "product" ? products[2].sku : members[2].memberNumber);
    key(input, "Escape");
    bubble.mockClear();
    expect(key(input, "Escape")).toBe(true);
    expect(bubble).toHaveBeenCalledOnce();
  });
  it.each([false, true])("Tab closes without picking and preserves native focus (shift=%s)", async shift => {
    const user = userEvent.setup();
    const { input, search, onSelect } = setup(kind);
    search(query);
    key(input, "ArrowDown");
    expect(screen.getAllByRole("option").every(row => row.tabIndex === -1)).toBe(true);
    await user.tab({ shift });
    expect(document.activeElement).toBe(shift
      ? screen.getByRole("button", { name: "ก่อนช่องค้นหา" })
      : screen.getByRole("button", { name: kind === "product" ? "สแกนสินค้าด้วยกล้อง" : "สแกนบัตรสมาชิกด้วยกล้อง" }));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(active(input)).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });
  it("changing the query clears stale highlights so Enter commits the new exact code", () => {
    const { input, search, onSelect } = setup(kind);
    search(query);
    key(input, "ArrowDown");
    search(kind === "product" ? products[2].barcode! : members[2].cardNumber!);
    expect(active(input)).toBeNull();
    key(input, "Enter");
    expect(onSelect.mock.calls).toEqual([[kind === "product" ? products[2] : members[2]]]);
  });
  it.each(["ArrowUp", "ArrowDown", "Enter", "Escape", "Tab"])("leaves %s to the IME during composition", value => {
    const { input, search, onSelect } = setup(kind);
    search(query);
    expect(key(input, value, { isComposing: true })).toBe(true);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(active(input)).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
    expect(key(input, value, { keyCode: 229 })).toBe(true);
    expect(active(input)).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });
  it.each([true, false])("does not reinterpret a composed Thai name as a scanner burst (isComposing=%s)", isComposing => {
    const { input, search, onSelect } = setup(kind);
    const name = query;
    fireEvent.compositionStart(input);
    ["KeyA", "KeyB", "KeyC"].forEach((code, index) =>
      timedKey(input, "Process", 100 + index * 20, { code, isComposing, keyCode: 229 }));
    search(name);
    timedKey(input, "Enter", 160, { isComposing: true });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input, { data: name });
    timedKey(input, "Enter", 180);
    expect(onSelect).not.toHaveBeenCalled();
    expect(input.value).toBe(name);
  });
  it("keeps exact barcode, SKU/member-number and single-name Enter scanning", () => {
    const { input, search, onSelect } = setup(kind);
    const values = kind === "product"
      ? [products[0].barcode!, products[0].sku, products[0].name]
      : [members[0].cardNumber!, members[0].memberNumber, members[0].firstName];
    for (const value of values) {
      onSelect.mockClear();
      search(value);
      expect(key(input, "Enter")).toBe(false);
      expect(onSelect.mock.calls).toEqual([[kind === "product" ? products[0] : members[0]]]);
    }
  });
  it("preserves digit-row barcode scanning with a Thai keyboard layout", () => {
    const { input, search, onSelect } = setup(kind);
    // Kedmanee physical keys for the exact barcode/member number.
    search(kind === "product" ? "คคถจจจจจจจจจๅ" : "จจจจจๅ");
    key(input, "Enter");
    expect(onSelect.mock.calls).toEqual([[kind === "product" ? products[0] : members[0]]]);
  });
  it("does not pick an arbitrary row for ambiguous names or empty input", () => {
    const { input, search, onSelect } = setup(kind);
    key(input, "ArrowDown");
    key(input, "Enter");
    search(query);
    key(input, "Enter");
    expect(onSelect).not.toHaveBeenCalled();
    expect(active(input)).toBeNull();
    expect(screen.getByRole("listbox")).toBeTruthy();
  });
  it("outside pointerdown closes the list without selecting", () => {
    const { input, search, onSelect } = setup(kind);
    search(query);
    key(input, "ArrowDown");
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(active(input)).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("member safeguards and scanner integration", () => {
  it.each([false, true])("blocks exact suspended member/card codes (confirmation=%s)", requireConfirm => {
    const { input, search, onSelect } = setup("member", { requireConfirm });
    for (const value of [members[1].memberNumber, members[1].cardNumber!]) {
      search(value);
      expect((screen.getByRole("option") as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByRole("option").getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(screen.getByRole("option"));
      key(input, "ArrowDown");
      expect(active(input)).toBeNull();
      key(input, "Enter");
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(onSelect).not.toHaveBeenCalled();
    }
  });
  it("blocks a suspended card read by the camera", () => {
    const { onSelect } = setup("member");
    fireEvent.click(screen.getByRole("button", { name: "สแกนบัตรสมาชิกด้วยกล้อง" }));
    fireEvent.click(screen.getByRole("button", { name: "อ่านรหัสจากกล้อง" }));
    expect(onSelect).not.toHaveBeenCalled();
  });
  it("requires confirmation after a keyboard pick and retains input focus afterwards", () => {
    const { input, search, onSelect } = setup("member", { requireConfirm: true });
    search("สมชาย");
    key(input, "ArrowDown");
    key(input, "Enter");
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันสมาชิก" }));
    expect(onSelect.mock.calls).toEqual([[members[0]]]);
    expect(document.activeElement).toBe(input);
  });
  it("rechecks member status if a card is suspended while confirmation is open", () => {
    const onSelect = vi.fn();
    const view = render(<MemberScanPicker local members={members} selectedNumber={null}
      onSelect={onSelect} requireConfirm allowGeneralCustomer={false} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: members[0].cardNumber } });
    key(input, "Enter");
    expect(screen.getByRole("dialog")).toBeTruthy();
    view.rerender(<MemberScanPicker local
      members={members.map(member => ({ ...member, status: "suspended" }))}
      selectedNumber={null} onSelect={onSelect} requireConfirm allowGeneralCustomer={false} />);
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันสมาชิก" }));
    expect(onSelect).not.toHaveBeenCalled();
  });
  it("allows the general-customer option only when enabled", () => {
    const { input, search, onSelect } = setup("member", { general: true });
    search("สมชาย");
    key(input, "ArrowDown");
    expect(active(input)?.textContent).toContain("บุคคลทั่วไป");
    key(input, "Enter");
    expect(onSelect.mock.calls).toEqual([[null]]);
  });
  it("rebuilds a rapid alphanumeric Thai-layout scanner burst from physical key codes", () => {
    const onSelect = vi.fn();
    render(<MemberScanPicker local members={[{ ...members[0], cardNumber: "HH-001" }]}
      selectedNumber={null} onSelect={onSelect} allowGeneralCustomer={false} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    ["KeyH", "KeyH", "Minus", "Digit0", "Digit0", "Digit1"].forEach((code, index) =>
      timedKey(input, "้", 100 + index * 20, { code, shiftKey: code === "KeyH" }));
    fireEvent.change(input, { target: { value: "้้ขจจๅ" } });
    timedKey(input, "Enter", 220);
    expect(onSelect.mock.calls).toEqual([[expect.objectContaining({ cardNumber: "HH-001" })]]);
  });
});

it("product no-match Enter calls onNotFound once and exposes no dangling active option", () => {
  const onNotFound = vi.fn();
  const onSelect = vi.fn();
  render(<ProductScanPicker local products={products} selectedId={null} onSelect={onSelect} onNotFound={onNotFound} />);
  const input = screen.getByRole("combobox") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "UNKNOWN" } });
  key(input, "ArrowDown");
  expect(active(input)).toBeNull();
  key(input, "Enter");
  expect(onNotFound.mock.calls).toEqual([["UNKNOWN"]]);
  expect(onSelect).not.toHaveBeenCalled();
  expect(input.getAttribute("aria-expanded")).toBe("false");
});
