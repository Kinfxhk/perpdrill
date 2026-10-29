import { describe, expect, it } from "vitest";
import {
  estimatedLiqPrice,
  logicalDayKey,
  markPrice,
  replaySession,
  sampleSeries,
  type Bar,
  type PracticePreset,
  type SessionAction,
} from "./index.ts";

function bar(timeMs: number, close: number): Bar {
  return { timeMs, open: close, high: close, low: close, close };
}

function preset(overrides: Partial<PracticePreset> = {}): PracticePreset {
  return {
    format: "perps-prop-profile",
    version: 1,
    id: "example-eval",
    displayName: "Example Eval (community)",
    disclaimer: "Unofficial community preset — verify against current official docs.",
    sourceUrls: ["https://example.com/rules"],
    profitTargetPct: 10,
    maxDrawdownPct: 5,
    maxDrawdownUsd: null,
    drawdownMode: "static",
    maxLeverage: null,
    dailyBase: "equity",
    group: "",
    choices: { profitTargetPct: null, dailyLossLimitPct: null },
    dailyLossLimitPct: null,
    dailyReset: null,
    equityIncludesUPnL: true,
    costModel: "off",
    takerBps: 0,
    makerBps: null,
    swapDailyRatePct: null,
    fundingRatePerHour: null,
    fundingIntervalHours: null,
    venueFundingChangesBalance: false,
    startingBalanceUsd: 10_000,
    markets: ["SYNTH-NQ", "SYNTH-GC"],
    note: "",
    ...overrides,
  };
}

function open(
  barIndex: number,
  powerPct: 25 | 50 | 75 | 100,
  side: "long" | "short" = "long",
): SessionAction {
  return {
    kind: "open",
    barIndex,
    side,
    leverage: 10,
    powerPct,
    slipToleranceBps: 75,
    realizedImpactBps: 0,
  };
}

describe("replay", () => {
  it("fills a market order at the mark, so a fresh position starts at zero", () => {
    const series = [bar(0, 10_000), bar(3_600_000, 10_100)];
    // The desk marks the account on a smoothed index, which lags the close.
    const marks = [10_400, 10_400];
    const frame = replaySession({
      market: "SYNTH-NQ",
      series,
      marks,
      preset: preset({ maxDrawdownPct: 90, profitTargetPct: 50 }),
      actions: [open(0, 50)],
      cursor: 0,
    });
    expect(frame.fills[0]?.price).toBeCloseTo(10_400, 6);
    expect(frame.unrealizedPnl).toBeCloseTo(0, 6);
  });

  it("keeps the prop fail price off the liquidation line", () => {
    const series = [bar(0, 10_000), bar(3_600_000, 9_950)];
    const opened = replaySession({
      market: "SYNTH-NQ",
      series,
      preset: preset(),
      actions: [open(0, 100)],
      cursor: 0,
    });
    expect(opened.position).not.toBeNull();
    expect(opened.liqPrice).toBeCloseTo(9_500);
    expect(opened.failPrice).toBeCloseTo(9_950);
    expect(opened.failPrice).not.toBeCloseTo(opened.liqPrice ?? 0);
    expect(opened.phase).toBe("practice");

    const breached = replaySession({
      market: "SYNTH-NQ",
      series,
      preset: preset(),
      actions: [open(0, 100)],
      cursor: 1,
    });
    expect(breached.phase).toBe("drawdown");
    expect(breached.liquidated).toBe(false);
    // A rule breach flattens the account at the floor price.
    expect(breached.position).toBeNull();
    expect(breached.fills.at(-1)?.kind).toBe("breach");
    expect(breached.equity).toBeCloseTo(9_500);
  });

  it("liquidates a long when mark reaches the teaching price", () => {
    const entry = 10_000;
    const liq = estimatedLiqPrice(entry, 10, "long");
    const series = [bar(0, entry), bar(3_600_000, liq)];
    const frame = replaySession({
      market: "SYNTH-NQ",
      series,
      preset: preset({ maxDrawdownPct: 90, profitTargetPct: 50 }),
      actions: [open(0, 100)],
      cursor: 1,
    });
    expect(frame.liquidated).toBe(true);
    expect(frame.phase).toBe("liquidated");
    expect(frame.position).toBeNull();
    expect(frame.fills.some((fill) => fill.kind === "liquidation")).toBe(true);
    expect(frame.equity).toBeCloseTo(5_000);
  });

  it("rejects an over-tolerance market order without opening", () => {
    const frame = replaySession({
      market: "SYNTH-NQ",
      series: [bar(0, 10_000)],
      preset: null,
      actions: [
        {
          kind: "open",
          barIndex: 0,
          side: "long",
          leverage: 5,
          powerPct: 25,
          slipToleranceBps: 75,
          realizedImpactBps: 90,
        },
      ],
      cursor: 0,
    });
    expect(frame.position).toBeNull();
    expect(frame.rejects).toEqual([{ barIndex: 0, reason: "impact-over-tolerance" }]);
    expect(frame.equity).toBe(2_500);
  });

  it("charges the swap to both sides and leaves a zero funding stub unchanged", () => {
    const series = [bar(0, 10_000), bar(3_600_000, 10_000)];
    const swap = preset({
      costModel: "swap",
      swapDailyRatePct: 0.03,
      takerBps: 0,
      venueFundingChangesBalance: false,
    });
    const long = replaySession({
      market: "SYNTH-NQ",
      series,
      preset: swap,
      actions: [open(0, 25, "long")],
      cursor: 1,
    });
    const short = replaySession({
      market: "SYNTH-NQ",
      series,
      preset: swap,
      actions: [open(0, 25, "short")],
      cursor: 1,
    });
    expect(long.carryPaid).toBeCloseTo(0.3125);
    expect(short.carryPaid).toBeCloseTo(long.carryPaid);
    expect(long.cash).toBeLessThan(7_500);

    const funding = replaySession({
      market: "SYNTH-NQ",
      series,
      preset: preset({
        costModel: "funding",
        fundingRatePerHour: 0,
        venueFundingChangesBalance: true,
      }),
      actions: [open(0, 25, "long")],
      cursor: 1,
    });
    expect(funding.carryPaid).toBe(0);
    expect(funding.cash).toBeCloseTo(7_500);
  });

  it("rolls the daily loss clock at the preset reset", () => {
    expect(
      logicalDayKey(Date.parse("2026-01-05T04:30:00.000Z"), {
        timeZone: "America/New_York",
        hour: 0,
        minute: 0,
      }),
    ).toBe("2026-01-04");
    expect(
      logicalDayKey(Date.parse("2026-01-05T05:00:00.000Z"), {
        timeZone: "America/New_York",
        hour: 0,
        minute: 0,
      }),
    ).toBe("2026-01-05");
    expect(
      logicalDayKey(Date.parse("2026-01-05T00:30:00.000Z"), {
        timeZone: "America/New_York",
        hour: 20,
        minute: 0,
      }),
    ).toBe("2026-01-03");
    expect(
      logicalDayKey(Date.parse("2026-01-05T01:00:00.000Z"), {
        timeZone: "America/New_York",
        hour: 20,
        minute: 0,
      }),
    ).toBe("2026-01-04");
  });

  it("builds a deterministic synthetic sample whose mark is the close", () => {
    const series = sampleSeries("SYNTH-NQ");
    expect(series.length).toBeGreaterThan(12);
    expect(series[0]?.close).toBe(10_000);
    expect(series[1]?.timeMs).toBe((series[0]?.timeMs ?? 0) + 3_600_000);
    const eth = sampleSeries("SYNTH-GC");
    expect(eth[0]?.close).toBe(2_500);
    expect(sampleSeries("SYNTH-ES")[0]?.close).toBe(5_000);
    for (const bar of series) {
      expect(markPrice(bar)).toBe(bar.close);
      expect(bar.low).toBeLessThanOrEqual(bar.open);
      expect(bar.open).toBeLessThanOrEqual(bar.high);
    }
    expect(series[1]?.open).toBeLessThan(series[1]?.close ?? 0);
    expect(series[6]?.close).toBeLessThan(series[6]?.open ?? 0);
  });
});
