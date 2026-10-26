import { describe, expect, it } from "vitest";
import {
  replaySession,
  sessionStats,
  syntheticSeries,
  type Bar,
  type PracticePreset,
  type SessionAction,
} from "./index.ts";

const HOUR = 3_600_000;

function ohlc(index: number, open: number, high: number, low: number, close: number): Bar {
  return { timeMs: index * HOUR, open, high, low, close };
}

function preset(overrides: Partial<PracticePreset> = {}): PracticePreset {
  return {
    format: "perps-prop-profile",
    version: 1,
    id: "custom",
    displayName: "Custom",
    disclaimer: "Unofficial community preset",
    sourceUrls: ["https://example.com/rules"],
    profitTargetPct: 10,
    maxDrawdownPct: 5,
    drawdownMode: "static",
    maxLeverage: null,
    dailyLossLimitPct: null,
    dailyReset: null,
    equityIncludesUPnL: true,
    costModel: "off",
    takerBps: 0,
    makerBps: null,
    swapDailyRatePct: null,
    fundingRatePerHour: null,
    venueFundingChangesBalance: false,
    startingBalanceUsd: 10_000,
    markets: null,
    note: "",
    ...overrides,
  };
}

function open(extra: Partial<Extract<SessionAction, { kind: "open" }>> = {}): SessionAction {
  return {
    kind: "open",
    barIndex: 0,
    side: "long",
    leverage: 2,
    powerPct: 50,
    slipToleranceBps: 75,
    realizedImpactBps: 0,
    ...extra,
  };
}

describe("synthetic series", () => {
  it("is deterministic per seed and keeps OHLC ordered", () => {
    const spec = { market: "BTC-PERP", seed: 42, bars: 500, timeframeMin: 15 } as const;
    const a = syntheticSeries(spec);
    const b = syntheticSeries(spec);
    expect(a).toEqual(b);
    expect(a).toHaveLength(500);
    expect(syntheticSeries({ ...spec, seed: 43 })[10]).not.toEqual(a[10]);
    for (const [index, bar] of a.entries()) {
      expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
      expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
      expect(bar.timeMs - (a[0]?.timeMs ?? 0)).toBe(index * 15 * 60_000);
      if (index > 0) {
        expect(bar.open).toBe(a[index - 1]?.close);
      }
    }
  });

  it("rejects bad specs", () => {
    expect(() =>
      syntheticSeries({ market: "ETH-PERP", seed: -1, bars: 500, timeframeMin: 5 }),
    ).toThrow();
    expect(() =>
      syntheticSeries({ market: "ETH-PERP", seed: 1, bars: 10, timeframeMin: 5 }),
    ).toThrow();
  });
});

describe("brackets and rules", () => {
  it("fills a stop intrabar and a take-profit on the next trade", () => {
    const series = [
      ohlc(0, 100, 100, 100, 100),
      ohlc(1, 100, 101, 94, 97),
      ohlc(2, 97, 97, 97, 97),
      ohlc(3, 97, 110, 96, 105),
    ];
    const frame = replaySession({
      market: "BTC-PERP",
      series,
      preset: null,
      actions: [open({ stopLoss: 95, takeProfit: 120 }), open({ barIndex: 2, takeProfit: 108 })],
      cursor: 3,
    });
    const kinds = frame.fills.map((fill) => fill.kind);
    expect(kinds).toEqual(["open", "stop", "open", "take-profit"]);
    expect(frame.fills[1]?.price).toBe(95);
    expect(frame.fills[3]?.price).toBe(108);
    expect(frame.position).toBeNull();
  });

  it("fills a gapped stop at the open and picks the stop over the target in one bar", () => {
    const series = [ohlc(0, 100, 100, 100, 100), ohlc(1, 90, 130, 88, 125)];
    const frame = replaySession({
      market: "BTC-PERP",
      series,
      preset: null,
      actions: [open({ stopLoss: 95, takeProfit: 120 })],
      cursor: 1,
    });
    expect(frame.fills[1]?.kind).toBe("stop");
    expect(frame.fills[1]?.price).toBe(90);
  });

  it("rejects a bracket on the wrong side and a leverage over the preset cap", () => {
    const series = [ohlc(0, 100, 100, 100, 100)];
    const wrong = replaySession({
      market: "BTC-PERP",
      series,
      preset: null,
      actions: [open({ stopLoss: 105 })],
      cursor: 0,
    });
    expect(wrong.rejects[0]?.reason).toBe("invalid-bracket");
    const capped = replaySession({
      market: "BTC-PERP",
      series,
      preset: preset({ maxLeverage: 1 }),
      actions: [open()],
      cursor: 0,
    });
    expect(capped.rejects[0]?.reason).toBe("invalid-leverage");
  });

  it("moves a trailing drawdown floor up with closing equity", () => {
    const series = [
      ohlc(0, 100, 100, 100, 100),
      ohlc(1, 100, 110, 100, 110),
      ohlc(2, 110, 110, 106, 107),
    ];
    const run = (mode: "static" | "trailing") =>
      replaySession({
        market: "BTC-PERP",
        series,
        preset: preset({ drawdownMode: mode, profitTargetPct: 50 }),
        actions: [open({ leverage: 1, powerPct: 100 })],
        cursor: 2,
      });
    const trailing = run("trailing");
    expect(trailing.maxDrawdownFloor).toBeCloseTo(10_000);
    expect(trailing.phase).toBe("practice");
    expect(run("static").maxDrawdownFloor).toBeCloseTo(9_500);
    const deeper = replaySession({
      market: "BTC-PERP",
      series: [...series.slice(0, 2), ohlc(2, 110, 110, 99, 101)],
      preset: preset({ drawdownMode: "trailing", profitTargetPct: 50 }),
      actions: [open({ leverage: 1, powerPct: 100 })],
      cursor: 2,
    });
    expect(deeper.phase).toBe("drawdown");
    expect(deeper.fills.at(-1)?.price).toBeCloseTo(100);
  });

  it("summarises trades and the equity curve", () => {
    const series = [
      ohlc(0, 100, 100, 100, 100),
      ohlc(1, 100, 110, 100, 110),
      ohlc(2, 110, 110, 100, 100),
      ohlc(3, 100, 100, 100, 100),
    ];
    const close = (barIndex: number): SessionAction => ({
      kind: "close",
      barIndex,
      slipToleranceBps: 75,
      realizedImpactBps: 0,
    });
    const frame = replaySession({
      market: "BTC-PERP",
      series,
      preset: null,
      actions: [
        open({ leverage: 1, powerPct: 100 }),
        close(1),
        open({ barIndex: 2, side: "short", leverage: 1, powerPct: 100 }),
        close(3),
      ],
      cursor: 3,
    });
    expect(frame.equityCurve).toHaveLength(4);
    const stats = sessionStats({
      fills: frame.fills,
      equityCurve: frame.equityCurve,
      startingBalance: 2_500,
    });
    expect(stats.trades).toBe(2);
    expect(stats.wins).toBe(1);
    expect(stats.losses).toBe(1);
    expect(stats.winRate).toBe(50);
    expect(stats.netPnl).toBeCloseTo(250);
    expect(stats.returnPct).toBeCloseTo(10);
  });
});
