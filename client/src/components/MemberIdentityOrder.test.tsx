import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemberLite } from "@/pages/pageData";
import { Members } from "@/pages/members/Members";
import { MemberDetail } from "@/pages/members/MemberDetail";
import { MemberRegistrationModal } from "./MemberRegistrationModal";
import { MemberCardActionsModal } from "./MemberCardActionsModal";
import { ReturnCardModal } from "./ReturnCardModal";

const fixture = vi.hoisted(() => ({
  mode: "manual",
  member: { id: 1, memberNumber: "000007", cardNumber: "000123", firstName: "สมชาย", lastName: "ทดสอบ", prename: "นาย", type: "สมาชิก", status: "active", balance: 100, createdAt: "2026-11-13 08:00:00", cardUsable: true, lastTransactionAt: null },
}));

// Supply read-side query results; no network or financial mutation runs in this test.
vi.mock("@/lib/trpc", () => {
  const query = (data: unknown) => ({ useQuery: () => ({ data, isLoading: false, isSuccess: true }), useMutation: () => ({ isPending: false }) });
  return { trpc: {
    useUtils: () => ({}),
    member: { list: query([fixture.member]), detail: query({ member: fixture.member, transactions: [] }), stats: query(undefined), nextNumber: query({ memberNumber: "000008" }), register: query(undefined), wallet: query(undefined), setStatus: query(undefined), update: query(undefined), delete: query(undefined) },
    settings: { get: { useQuery: () => ({ data: { memberNumberMode: fixture.mode } }) } },
    card: { list: query([]), history: query({ sessions: [{ id: 1, memberNumber: fixture.member.memberNumber, endedAt: null }] }), return: query(undefined), assign: query(undefined), closeAccount: query(undefined), release: query(undefined) },
    printing: { issue: query(undefined) },
  } };
});
vi.mock("./WorkflowDialog", () => ({ WorkflowDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, FeedbackDialog: () => null }));
vi.mock("react-dom", async importOriginal => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (children: React.ReactNode) => children }));

const noop = () => undefined;
function expectOrder(html: string, values: string[]) {
  const offsets = values.map(value => html.indexOf(value));
  expect(offsets.every(offset => offset >= 0)).toBe(true);
  expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
}
afterEach(() => { vi.unstubAllGlobals(); });
function render(element: React.ReactNode) {
  vi.stubGlobal("React", React);
  vi.stubGlobal("document", { body: {} });
  return renderToStaticMarkup(element);
}

describe("member identity field order", () => {
  it("lists card, member number and full name in that order", () => {
    const html = render(<Members role="admin" userName="ผู้ทดสอบ" focusMemberNumber={null} onFocusMemberConsumed={noop} />);
    const body = html.slice(html.indexOf("<tbody>"));
    expectOrder(body.replace(/<[^>]*>/g, ""), ["000123", "000007", "นาย สมชาย ทดสอบ"]);
  });
  it("shows profile identifiers before the member name", () => {
    const html = render(<MemberDetail member={fixture.member as MemberLite} role="admin" userName="ผู้ทดสอบ" onBack={noop} onDeleted={noop} />);
    const profile = html.slice(html.indexOf('class="member-detail-profile"'), html.indexOf('class="member-detail-actions"'));
    expectOrder(profile, ["000123", "000007", "นาย สมชาย ทดสอบ"]);
  });
  it.each(["manual", "running"])("places card and member-number controls before name inputs (%s)", mode => {
    fixture.mode = mode;
    const html = render(<MemberRegistrationModal actor="ผู้ทดสอบ" actorRole="ผู้บริหาร" onClose={noop} onRegistered={noop} onUseExisting={noop} />);
    expectOrder(html, ['name="cardNumber"', mode === "manual" ? 'name="memberNumber"' : "000008", 'placeholder="ชื่อ"']);
  });
  it("orders the existing card-action metadata without changing the completed slip", () => {
    const html = render(<MemberCardActionsModal memberNumber="000007" onClose={noop} onSuccess={noop} />);
    expectOrder(html, ["000123", "000007", "นาย สมชาย ทดสอบ"]);
  });
  it("orders the return review identity before any confirmation", () => {
    const html = render(<ReturnCardModal members={[fixture.member as MemberLite]} initialMember={fixture.member as MemberLite} onClose={noop} onReturned={noop} />);
    const section = html.slice(html.indexOf('class="card-return-member"'));
    expectOrder(section, ["000123", "000007", "นาย สมชาย ทดสอบ"]);
  });
});
