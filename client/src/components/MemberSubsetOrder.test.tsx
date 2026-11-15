import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlobalSearch } from "./GlobalSearch";
import { MemberBarcodePrintModal } from "./MemberBarcodePrintModal";

const fixture = vi.hoisted(() => ({ search: "", member: { memberNumber: "000007", cardNumber: "000123", firstName: "สมชาย", lastName: "ทดสอบ", prename: "นาย", balance: 100, type: "สมาชิก", status: "active" as const } }));
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  return { ...actual, useState: (initial: unknown) => actual.useState(initial === "" && fixture.search ? fixture.search : initial) };
});
vi.mock("@/lib/trpc", () => ({ trpc: {
  settings: { get: { useQuery: () => ({ data: { appName: "ร้านทดสอบ" } }) } },
  product: { list: { useQuery: () => ({ data: [], isFetching: false }) } },
  member: { list: { useQuery: () => ({ data: [fixture.member], isFetching: false }) } },
  sales: { list: { useQuery: () => ({ data: [], isFetching: false }) } },
} }));
vi.mock("@/barcode", () => ({ code128DataUrl: () => "data:image/png;base64,AA==" }));
vi.mock("./WorkflowDialog", () => ({ WorkflowDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
afterEach(() => { fixture.search = ""; vi.unstubAllGlobals(); });
const noop = () => undefined;
function render(node: React.ReactNode) { vi.stubGlobal("React", React); return renderToStaticMarkup(node); }
function identityBeforeName(html: string, identifier: string) {
  const text = html.replace(/<[^>]*>/g, "");
  expect(text).toContain(identifier);
  expect(text).toContain("สมชาย ทดสอบ");
  expect(text.indexOf(identifier)).toBeLessThan(text.indexOf("สมชาย ทดสอบ"));
}

describe("member identity subsets", () => {
  it("shows the member number before the existing name in global search", () => {
    fixture.search = "สมชาย";
    const html = render(<GlobalSearch role="admin" open onClose={noop} onNavigate={noop} onOpenMember={noop} onOpenCards={noop} onOpenBill={noop} onOpenProduct={noop} />);
    identityBeforeName(html.slice(html.indexOf('class="command-item')), "000007");
  });
  it.each(["000123", null])("prints the existing identifier before the barcode label name (%s)", cardNumber => {
    const html = render(<MemberBarcodePrintModal members={[{ ...fixture.member, cardNumber }]} onClose={noop} />);
    identityBeforeName(html.slice(html.indexOf('class="member-barcode-label"')), cardNumber || "000007");
    expect(html).toContain("member-barcode-slip");
    expect(html).toContain("data:image/png;base64,AA==");
  });
});
