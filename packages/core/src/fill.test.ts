import { describe, expect, it } from "vitest";
import {
  DEFAULT_REALIZED_IMPACT_BPS,
  DEFAULT_SLIP_TOLERANCE_BPS,
  quoteClose,
  quoteOpen,
} from "./index.ts";

describe("slippage gate and trading-power sizing", () => {
  it("rejects when realized impact is above the majors tolerance", () => {
    const rejected = quoteOpen({
      side: "long",
      leverage: 10,
      powerPct: 50,
      cash: 2_500,
      mark: 10_000,
      takerBps: 0,
      slipToleranceBps: DEFAULT_SLIP_TOLERANCE_BPS,
      realizedImpactBps: 80,
    });
    expect(rejected).toEqual({ ok: false, reason: "impact-over-tolerance" });
  });

  it("rejects a 5% tolerance because majors stay inside 50–100 bps", () => {
    const rejected = quoteOpen({
      side: "long",
      leverage: 5,
      powerPct: 25,
      cash: 2_500,
      mark: 10_000,
      takerBps: 0,
      slipToleranceBps: 500,
      realizedImpactBps: DEFAULT_REALIZED_IMPACT_BPS,
    });
    expect(rejected).toEqual({ ok: false, reason: "tolerance-out-of-range" });
  });

  it("sizes 25/50/75/100 percent of free cash and prices the adverse fill", () => {
    for (const powerPct of [25, 50, 75, 100] as const) {
      const quote = quoteOpen({
        side: "long",
        leverage: 10,
        powerPct,
        cash: 2_000,
        mark: 100,
        takerBps: 0,
        slipToleranceBps: 75,
        realizedImpactBps: 0,
      });
      expect(quote.ok).toBe(true);
      if (!quote.ok) {
        continue;
      }
      expect(quote.initialMargin).toBeCloseTo(2_000 * (powerPct / 100));
      expect(quote.notional).toBeCloseTo(quote.initialMargin * 10);
      expect(quote.fillPrice).toBeCloseTo(100);
      expect(quote.maintenance).toBeCloseTo(quote.initialMargin / 2);
    }
  });

  it("keeps taker bps out of the slippage fields", () => {
    const quote = quoteOpen({
      side: "short",
      leverage: 10,
      powerPct: 100,
      cash: 2_500,
      mark: 10_000,
      takerBps: 30,
      slipToleranceBps: 75,
      realizedImpactBps: 25,
    });
    expect(quote.ok).toBe(true);
    if (!quote.ok) {
      return;
    }
    expect(quote.fillPrice).toBeCloseTo(10_000 * (1 - 25 / 10_000));
    expect(quote.fee + quote.initialMargin).toBeCloseTo(2_500);
    expect(quote.fee).toBeCloseTo(quote.notional * 0.003);
    expect(quote.liqPrice).toBeCloseTo(quote.fillPrice * (1 + 0.5 / 10));
  });

  it("charges close slippage in the adverse direction", () => {
    const quote = quoteClose({
      side: "long",
      qty: 2,
      entry: 100,
      mark: 110,
      takerBps: 30,
      slipToleranceBps: 75,
      realizedImpactBps: 25,
    });
    expect(quote.ok).toBe(true);
    if (!quote.ok) {
      return;
    }
    expect(quote.fillPrice).toBeCloseTo(110 * (1 - 25 / 10_000));
    expect(quote.fee).toBeGreaterThan(0);
  });
});
