import { describe, it, expect } from "vitest";
import { priceOrder } from "./ordering";

const menu = [
  { id: "a", name: "Karahi", priceCents: 250000, available: true },
  { id: "b", name: "Naan", priceCents: 8000, available: true },
  { id: "c", name: "Kheer", priceCents: 40000, available: false },
];

describe("priceOrder", () => {
  it("totals from the menu's prices", () => {
    const r = priceOrder([{ id: "a", qty: 1 }, { id: "b", qty: 4 }], menu);
    expect(r).toMatchObject({ ok: true, totalCents: 250000 + 4 * 8000 });
  });
  it("refuses empty, unknown, sold-out, duplicate and silly quantities", () => {
    expect(priceOrder([], menu).ok).toBe(false);
    expect(priceOrder([{ id: "zzz", qty: 1 }], menu).ok).toBe(false);
    expect(priceOrder([{ id: "c", qty: 1 }], menu)).toMatchObject({ ok: false, error: expect.stringContaining("sold out") });
    expect(priceOrder([{ id: "a", qty: 1 }, { id: "a", qty: 1 }], menu).ok).toBe(false);
    expect(priceOrder([{ id: "a", qty: 0 }], menu).ok).toBe(false);
    expect(priceOrder([{ id: "a", qty: 999 }], menu).ok).toBe(false);
    expect(priceOrder([{ id: "a", qty: 1.5 }], menu).ok).toBe(false);
  });
});
