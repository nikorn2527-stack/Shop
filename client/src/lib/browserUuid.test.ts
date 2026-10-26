import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createBrowserUuid } from "./browserUuid";
afterEach(() => vi.unstubAllGlobals());
describe("browser request IDs", () => {
  it("uses the native implementation when available", () => {
    const uuid = "12345678-1234-4234-8234-123456789012";
    vi.stubGlobal("crypto", { randomUUID: () => uuid });
    expect(createBrowserUuid()).toBe(uuid);
  });
  it("produces API-compatible UUID v4 when HTTP LAN has no randomUUID", () => {
    const random = vi.fn((bytes: Uint8Array) => {
      bytes.fill(255);
      return bytes;
    });
    vi.stubGlobal("crypto", { getRandomValues: random });
    const id = createBrowserUuid();
    expect(z.string().uuid().parse(id)).toBe(id);
    expect(id).toMatch(
      /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/
    );
    expect(random).toHaveBeenCalledOnce();
  });
  it("fails explicitly if cryptographic randomness is unavailable", () => {
    vi.stubGlobal("crypto", undefined);
    expect(() => createBrowserUuid()).toThrow(/เบราว์เซอร์/);
  });
  it("does not generate weak IDs when the cryptographic provider fails", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: () => {
        throw new Error("randomness unavailable");
      },
    });
    expect(() => createBrowserUuid()).toThrow("randomness unavailable");
  });
});
