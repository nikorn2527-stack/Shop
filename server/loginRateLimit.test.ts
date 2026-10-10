import { describe, expect, it } from "vitest";
import { LoginRateLimiter, loginRequestSource } from "./loginRateLimit";

describe("login request throttling", () => {
  it("limits the same account/source including case and whitespace variants", () => {
    const limiter = new LoginRateLimiter(1000, 20, 2);
    limiter.check("one", "User", 0);
    limiter.check("one", " user ", 1);
    expect(() => limiter.check("one", "USER", 2)).toThrow("เข้าสู่ระบบถี่เกินไป");
    expect(() => limiter.check("two", "User", 2)).not.toThrow();
    expect(() => limiter.check("one", "User", 1000)).not.toThrow();
  });
  it("limits attempts spread over unknown account names and does not extend the window when blocked", () => {
    const limiter = new LoginRateLimiter(1000, 2, 20);
    limiter.check("one", "missing1", 0);
    limiter.check("one", "missing2", 1);
    expect(() => limiter.check("one", "missing3", 500)).toThrow();
    expect(() => limiter.check("one", "missing4", 1000)).not.toThrow();
  });
  it("bounds memory and allows requests again when entries expire", () => {
    const limiter = new LoginRateLimiter(1000, 20, 20, 2);
    limiter.check("one", "user", 0);
    expect(() => limiter.check("two", "other", 1)).toThrow("จำนวนมาก");
    expect(() => limiter.check("two", "other", 1000)).not.toThrow();
  });
  it("uses the resolved connection address rather than an arbitrary forwarding header", () => {
    expect(loginRequestSource({ ip: "::ffff:127.0.0.1" })).toBe("127.0.0.1");
    expect(loginRequestSource({ socket: { remoteAddress: "10.0.0.2" } })).toBe("10.0.0.2");
  });
});