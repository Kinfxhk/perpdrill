import { describe, expect, it } from "vitest";
import {
  replaySession,
  syntheticFunding,
  syntheticMarks,
  syntheticSeries,
  type PracticePreset,
  type SessionAction,
} from "./index.ts";

function preset(overrides: Partial<PracticePreset> = {}): PracticePreset {
  return {
    format: "perps-prop-profile",
    version: 1,
    id: "funding-eval",
    displayName: "Funding Eval (test)",
    disclaimer: "",
    sourceUrls: [],
    profitTargetPct: 100,
    maxDrawdownPct: 100,
    maxDrawdownUsd: null,
    drawdownMode: "static",
    maxLeverage: null,
    dailyBase: "equity",
    group: "",
    choices: { profitTargetPct: null, dailyLossLimitPct: null },
    dailyLossLimitPct: null,
    dailyReset: null,
    equityIncludesUPnL: true,
    costModel: "funding",
    takerBps: 0,
    makerBps: null,
    swapDailyRatePct: null,
    fundingRatePerHour: 0.01,
    fundingIntervalHours: 1,
    venueFundingChangesBalance: true,
    startingBalanceUsd: 10_000,
    markets: null,
    note: "",
    ...overrides,
  };
}

function open(barIndex: number): SessionAction {
  return {
    kind: "open",
    barIndex,
    side: "long",
    leverage: 10,
    powerPct: 25,
    slipToleranceBps: 75,
    realizedImpactBps: 25,
  };
}

function short(barIndex: number): SessionAction {
  return { ...open(barIndex), side: "short" } as SessionAction;
}

describe("synthetic funding sequence", () => {
  it("settles only on the last bar of each window and repeats for a seed", () => {
    const a = syntheticFunding({
      seed: 7,
      bars: 130,
      timeframeMin: 1,
      meanPerHour: 0.01,
      intervalHours: 1,
    });
    const b = syntheticFunding({
      seed: 7,
      bars: 130,
      timeframeMin: 1,
      meanPerHour: 0.01,
      intervalHours: 1,
    });
    expect(a).toEqual(b);
    expect(a).toHaveLength(130);
    const settled = a.flatMap((rate, index) => (rate === null ? [] : [index]));
    expect(settled).toEqual([59, 119]);
    for (const rate of a) {
      if (rate !== null) {
        expect(Math.abs(rate)).toBeGreaterThan(0);
      }
    }
  });
});

describe("synthetic marks", () => {
  it("tracks the closes with a small persistent basis", () => {
    const closes = [100, 100.2, 100.1, 100.3, 100.2];
    const { index, mark } = syntheticMarks({ seed: 7, closes });
    expect(index).toHaveLength(5);
    expect(mark).toHaveLength(5);
    for (let i = 0; i < closes.length; i += 1) {
      expect(Math.abs((mark[i] ?? 0) - (closes[i] ?? 0)) / (closes[i] ?? 1)).toBeLessThan(0.005);
    }
    // Deterministic for the same seed.
    const again = syntheticMarks({ seed: 7, closes });
    expect(again.mark).toEqual(mark);
  });
});

describe("funding settlement in the engine", () => {
  it("charges a long the positive window total at the settlement bar", () => {
    const series = syntheticSeries({ market: "SYNTH-IDX1", seed: 1, bars: 100, timeframeMin: 60 });
    const frame = replaySession({
      market: "SYNTH-IDX1",
      series,
      preset: preset(),
      actions: [open(0)],
      cursor: 1,
      funding: [null, 0.03, ...Array.from({ length: 98 }, () => null)],
    });
    expect(frame.position).not.toBeNull();
    // Carry notional uses the previous bar close, like the engine.
    const expected = (frame.position?.qty ?? 0) * (series[0]?.close ?? 0) * 0.03;
    expect(frame.fundingPaid).toBeCloseTo(expected, 6);
    expect(frame.fundingSettlement).toBe(0.03);
    expect(expected).toBeGreaterThan(0);
  });

  it("pays a short when the window total is positive", () => {
    const series = syntheticSeries({ market: "SYNTH-IDX1", seed: 1, bars: 100, timeframeMin: 60 });
    const frame = replaySession({
      market: "SYNTH-IDX1",
      series,
      preset: preset(),
      actions: [short(0)],
      cursor: 1,
      funding: [null, 0.03, ...Array.from({ length: 98 }, () => null)],
    });
    const expected = -(frame.position?.qty ?? 0) * (series[0]?.close ?? 0) * 0.03;
    expect(frame.fundingPaid).toBeCloseTo(expected, 6);
    expect(frame.fundingPaid).toBeLessThan(0);
  });

  it("is zero outside settlement bars", () => {
    const frame = replaySession({
      market: "SYNTH-IDX1",
      series: syntheticSeries({ market: "SYNTH-IDX1", seed: 1, bars: 100, timeframeMin: 60 }),
      preset: preset(),
      actions: [open(0)],
      cursor: 0,
      funding: [null, 0.03],
    });
    expect(frame.fundingPaid).toBe(0);
    expect(frame.fundingSettlement).toBeNull();
  });
});

describe("mark price in the engine", () => {
  it("marks equity and PnL on the mark, not the last price", () => {
    const series = syntheticSeries({ market: "SYNTH-IDX1", seed: 1, bars: 100, timeframeMin: 60 });
    const marks = series.map((bar) => bar.close);
    marks[1] = (marks[1] ?? 0) + 500;
    const frame = replaySession({
      market: "SYNTH-IDX1",
      series,
      preset: preset({ costModel: "off" }),
      actions: [open(0)],
      cursor: 1,
      marks,
    });
    expect(frame.position).not.toBeNull();
    expect(frame.mark).toBe(marks[1]);
    expect(frame.unrealizedPnl).toBeGreaterThan(0);
    expect(frame.equity).toBeGreaterThan(10_000);
    expect(frame.equityCurve[1]).toBeGreaterThan(10_000);
  });

  it("falls back to the bar close without a mark series", () => {
    const frame = replaySession({
      market: "SYNTH-IDX1",
      series: syntheticSeries({ market: "SYNTH-IDX1", seed: 1, bars: 100, timeframeMin: 60 }),
      preset: preset({ costModel: "off" }),
      actions: [open(0)],
      cursor: 1,
    });
    expect(frame.mark).toBe(
      syntheticSeries({ market: "SYNTH-IDX1", seed: 1, bars: 100, timeframeMin: 60 })[1]?.close,
    );
  });
});
