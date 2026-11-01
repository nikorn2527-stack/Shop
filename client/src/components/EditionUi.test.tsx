import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DevKeygenTool, EditionCompareTable, EditionUpgradeModal, FeatureLockButton } from "./EditionUi";

describe("fixed-feature customer UI", () => {
  it("does not render commercial upgrades, keys, tier comparisons or feature locks through old callers", () => {
    expect(renderToStaticMarkup(createElement(EditionCompareTable, { current: "standard" }))).toBe("");
    expect(renderToStaticMarkup(createElement(FeatureLockButton, { feature: "stockCount", onClick() {} }))).toBe("");
    expect(renderToStaticMarkup(createElement(EditionUpgradeModal, { open: true, status: null, onClose() {} }))).toBe("");
    expect(renderToStaticMarkup(createElement(DevKeygenTool))).toBe("");
  });
});
