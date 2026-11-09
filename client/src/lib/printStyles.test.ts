import { describe, expect, it } from "vitest";
import { capturePrintStyles } from "./printStyles";
function documentWith(...nodes: unknown[]) {
  return { querySelectorAll: () => nodes } as unknown as Document;
}
const sheet = (...rules: string[]) => ({
  cssRules: rules.map(cssText => ({ cssText })),
  media: { mediaText: "" },
  disabled: false,
});
describe("print stylesheet snapshots", () => {
  it("keeps loaded receipt styles when a previous deployment CSS URL no longer exists", () => {
    const html = capturePrintStyles(
      documentWith({
        outerHTML: '<link rel="stylesheet" href="/assets/old-release.css">',
        sheet: sheet(
          ".receipt-brand { display: flex; }",
          ".receipt-line { display: flex; justify-content: space-between; }"
        ),
      })
    );
    expect(html).toContain(".receipt-brand { display: flex; }");
    expect(html).toContain("justify-content: space-between");
    expect(html).not.toContain("/assets/old-release.css");
    expect(html).toContain("<style");
  });
  it("preserves media restrictions, live CSSOM changes and rule ordering", () => {
    const print = sheet(".receipt-paper { color: black; }");
    print.media.mediaText = "print";
    const html = capturePrintStyles(
      documentWith(
        {
          outerHTML: "<style>old text</style>",
          sheet: sheet(":root { --font-scale: 1.2; }"),
        },
        { outerHTML: '<link media="print" href="print.css">', sheet: print }
      )
    );
    expect(html).toContain("--font-scale: 1.2");
    expect(html).not.toContain("old text");
    expect(html).toContain('media="print"');
    expect(html.indexOf("--font-scale")).toBeLessThan(
      html.indexOf(".receipt-paper")
    );
  });
  it("retains the original link when browser security prevents CSSOM access, and skips disabled sheets", () => {
    const blocked = {
      get cssRules() {
        throw Error("SecurityError");
      },
    };
    const html = capturePrintStyles(
      documentWith(
        {
          outerHTML:
            '<link rel="stylesheet" href="https://fonts.example/font.css" crossorigin>',
          sheet: blocked,
        },
        {
          outerHTML: "<style>disabled</style>",
          sheet: { ...sheet("disabled"), disabled: true },
        }
      )
    );
    expect(html).toContain("https://fonts.example/font.css");
    expect(html).not.toContain("disabled");
  });
});

it("waits for the cloned document fonts after restoring its styles", async () => {
  const { applyPrintStylesSnapshot } = await import("./printStyles");
  let ready!: () => void;
  const fonts = new Promise<void>(resolve => {
    ready = resolve;
  });
  const inserted: string[] = [];
  const doc = {
    head: {
      insertAdjacentHTML: (_position: string, html: string) =>
        inserted.push(html),
    },
    getElementById: () => ({ getBoundingClientRect: () => ({ width: 204 }) }),
    fonts: { ready: fonts },
  } as unknown as Document;
  let finished = false;
  const task = applyPrintStylesSnapshot(
    doc,
    "<style>.receipt-brand{display:flex}</style>",
    "receipt-paper"
  ).then(() => {
    finished = true;
  });
  await Promise.resolve();
  expect(inserted).toEqual(["<style>.receipt-brand{display:flex}</style>"]);
  expect(finished).toBe(false);
  ready();
  await task;
  expect(finished).toBe(true);
});
