import { describe, expect, it } from "vitest";
import {
  estimatedLiqPrice,
  initialMargin,
  isolatedShouldLiquidate,
  maintenanceMargin,
  priceForEquityFloor,
} from "./index.ts";

describe("isolated teaching liquidation", () => {
  it("sets maintenance to half of initial margin", () => {
    const notional = 20_000;
    const leverage = 8;
    const initial = initialMargin(notional, leverage);
    expect(initial).toBe(2_500);
    expect(maintenanceMargin(initial)).toBe(initial / 2);
  });

  it("matches the locked long and short estimates", () => {
    const entry = 100;
    const leverage = 10;
    const qty = 2;
    const initial = initialMargin(qty * entry, leverage);
    const maintenance = maintenanceMargin(initial);
    const long = entry - (initial - maintenance) / qty;
    const short = entry + (initial - maintenance) / qty;
    expect(estimatedLiqPrice(entry, leverage, "long")).toBeCloseTo(long);
    expect(estimatedLiqPrice(entry, leverage, "short")).toBeCloseTo(short);
    expect(estimatedLiqPrice(entry, leverage, "long")).toBeCloseTo(entry * (1 - 0.5 / leverage));
    expect(estimatedLiqPrice(entry, leverage, "short")).toBeCloseTo(entry * (1 + 0.5 / leverage));
    expect(estimatedLiqPrice(entry, leverage, "long")).toBeCloseTo(95);
    expect(estimatedLiqPrice(entry, leverage, "short")).toBeCloseTo(105);
  });

  it("triggers on mark through isolated equity, not through a prop floor", () => {
    const entry = 100;
    const leverage = 10;
    const qty = 1;
    const initial = initialMargin(qty * entry, leverage);
    const maintenance = maintenanceMargin(initial);
    const liq = estimatedLiqPrice(entry, leverage, "long");
    const upnlAtLiq = qty * (liq - entry);
    expect(isolatedShouldLiquidate(initial, upnlAtLiq, maintenance)).toBe(true);
    expect(isolatedShouldLiquidate(initial, qty * (liq + 0.01 - entry), maintenance)).toBe(false);

    const shortUpnl = -1 * qty * (105 - entry);
    expect(isolatedShouldLiquidate(initial, shortUpnl, maintenance)).toBe(true);

    const fail = priceForEquityFloor({
      floor: 9_500,
      cash: 0,
      isolatedMargin: 10_000,
      qty: 10,
      entry: 10_000,
      side: "long",
    });
    expect(fail).toBeCloseTo(9_950);
    expect(fail).not.toBeCloseTo(estimatedLiqPrice(10_000, 10, "long"));
  });
});
