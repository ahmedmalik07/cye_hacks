import { describe, it, expect } from "vitest";
import { createSessionToken, readSessionToken } from "./auth";

describe("session tokens", () => {
  it("round-trips a staff id", () => {
    expect(readSessionToken(createSessionToken("staff_1"))).toBe("staff_1");
  });
  it("rejects a tampered id, a tampered expiry and garbage", () => {
    const t = createSessionToken("staff_1");
    const [, exp, mac] = t.split(".");
    expect(readSessionToken(`staff_2.${exp}.${mac}`)).toBeNull();
    expect(readSessionToken(`staff_1.${Number(exp) + 1}.${mac}`)).toBeNull();
    expect(readSessionToken("nope")).toBeNull();
    expect(readSessionToken(undefined)).toBeNull();
  });
  it("rejects an expired token", () => {
    const old = createSessionToken("staff_1", Date.now() - 15 * 86_400_000);
    expect(readSessionToken(old)).toBeNull();
  });
});
