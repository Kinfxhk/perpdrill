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
  it("keeps the previous anchors under SYNTH-IDX1 and SYNTH-METAL1", () => {
    const spec = { seed: 42, bars: 120, timeframeMin: 15 } as const;
    const nq = syntheticSeries({ ...spec, market: "SYNTH-IDX1" });
    const gc = syntheticSeries({ ...spec, market: "SYNTH-METAL1" });
    expect(nq[0]).toMatchObject({
      timeMs: 1_767_571_200_000,
      open: 67628.7,
      high: 67649,
      low: 67493.3,
      close: 67572.6,
    });
    expect(nq[50]).toMatchObject({
      timeMs: 1_767_616_200_000,
      open: 67286.4,
      high: 67917.3,
      low: 67246.4,
      close: 67603.7,
    });
    expect(gc[0]?.close).toBe(3325.96);
    expect(gc[50]?.close).toBe(3327.86);
    const es = syntheticSeries({ ...spec, market: "SYNTH-IDX2" });
    expect(es[0]?.close).not.toBe(nq[0]?.close);
    expect(es[0]?.close).not.toBe(gc[0]?.close);
    expect(es[0]?.low).toBeLessThanOrEqual(Math.min(es[0]?.open ?? 0, es[0]?.close ?? 0));
    expect(es[0]?.high).toBeGreaterThanOrEqual(Math.max(es[0]?.open ?? 0, es[0]?.close ?? 0));
  });

  it("is deterministic per seed and keeps OHLC ordered", () => {
    const spec = { market: "SYNTH-IDX1", seed: 42, bars: 500, timeframeMin: 15 } as const;
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
      syntheticSeries({ market: "SYNTH-METAL1", seed: -1, bars: 500, timeframeMin: 5 }),
    ).toThrow();
    expect(() =>
      syntheticSeries({ market: "SYNTH-METAL1", seed: 1, bars: 10, timeframeMin: 5 }),
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
      market: "SYNTH-IDX1",
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
      market: "SYNTH-IDX1",
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
      market: "SYNTH-IDX1",
      series,
      preset: null,
      actions: [open({ stopLoss: 105 })],
      cursor: 0,
    });
    expect(wrong.rejects[0]?.reason).toBe("invalid-bracket");
    const capped = replaySession({
      market: "SYNTH-IDX1",
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
        market: "SYNTH-IDX1",
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
      market: "SYNTH-IDX1",
      series: [...series.slice(0, 2), ohlc(2, 110, 110, 99, 101)],
      preset: preset({ drawdownMode: "trailing", profitTargetPct: 50 }),
      actions: [open({ leverage: 1, powerPct: 100 })],
      cursor: 2,
    });
    expect(deeper.phase).toBe("drawdown");
    expect(deeper.fills.at(-1)?.price).toBeCloseTo(100);
  });

  it("caps a gapped liquidation loss at the isolated margin", () => {
    const series = [ohlc(0, 100, 100, 100, 100), ohlc(1, 50, 50, 40, 45)];
    const frame = replaySession({
      market: "SYNTH-IDX1",
      series,
      preset: null,
      actions: [open({ leverage: 10, powerPct: 50 })],
      cursor: 1,
    });
    const liq = frame.fills.at(-1);
    expect(liq?.kind).toBe("liquidation");
    expect(liq?.pricePnl).toBeCloseTo(-1_250);
    expect(frame.equity).toBeCloseTo(1_250);
    const stats = sessionStats({
      fills: frame.fills,
      equityCurve: frame.equityCurve,
      startingBalance: 2_500,
    });
    expect(stats.netPnl).toBeCloseTo(frame.equity - 2_500);
  });

  it("liquidates instead of stopping when a gap passes both levels", () => {
    const series = [ohlc(0, 100, 100, 100, 100), ohlc(1, 80, 82, 79, 81)];
    const frame = replaySession({
      market: "SYNTH-IDX1",
      series,
      preset: null,
      actions: [open({ leverage: 10, powerPct: 100, stopLoss: 96 })],
      cursor: 1,
    });
    expect(frame.fills.at(-1)?.kind).toBe("liquidation");
    expect(frame.cash).toBeGreaterThanOrEqual(0);
  });

  it("keeps a stop that slips past liquidation inside the margin", () => {
    const series = [ohlc(0, 100, 100, 100, 100), ohlc(1, 95.2, 95.2, 95.2, 95.2)];
    const frame = replaySession({
      market: "SYNTH-IDX1",
      series,
      preset: null,
      actions: [open({ leverage: 10, powerPct: 100, stopLoss: 95.5, realizedImpactBps: 75 })],
      cursor: 1,
    });
    expect(frame.cash).toBeGreaterThanOrEqual(0);
  });

  it("fills the target at the open when the bar gaps past it", () => {
    const series = [ohlc(0, 100, 100, 100, 100), ohlc(1, 112, 113, 97, 100)];
    const frame = replaySession({
      market: "SYNTH-IDX1",
      series,
      preset: null,
      actions: [open({ stopLoss: 98, takeProfit: 110 })],
      cursor: 1,
    });
    expect(frame.fills.at(-1)?.kind).toBe("take-profit");
    expect(frame.fills.at(-1)?.price).toBe(112);
  });

  it("starts the realized-equity day from realized equity", () => {
    const day = 24 * HOUR;
    const series: Bar[] = [
      { timeMs: day - HOUR, open: 100, high: 100, low: 100, close: 100 },
      { timeMs: day - 1, open: 103, high: 103, low: 103, close: 103 },
      { timeMs: day + HOUR, open: 103, high: 103, low: 103, close: 103 },
    ];
    const frame = replaySession({
      market: "SYNTH-IDX1",
      series,
      preset: preset({
        equityIncludesUPnL: false,
        dailyLossLimitPct: 5,
        dailyReset: { timeZone: "UTC", hour: 0, minute: 0 },
        profitTargetPct: 50,
      }),
      actions: [
        open({ leverage: 1, powerPct: 100 }),
        { kind: "close", barIndex: 2, slipToleranceBps: 75, realizedImpactBps: 0 },
      ],
      cursor: 2,
    });
    expect(frame.phase).toBe("practice");
    expect(frame.dailyLossFloor).toBeCloseTo(9_500);
  });

  it("counts breakeven apart and shows an all-win profit factor as infinite", () => {
    const stats = sessionStats({
      fills: [
        {
          barIndex: 0,
          timeMs: 0,
          market: "SYNTH-IDX1",
          side: "long",
          kind: "open",
          price: 1,
          qty: 1,
          fee: 0,
          pricePnl: 0,
        },
        {
          barIndex: 1,
          timeMs: 1,
          market: "SYNTH-IDX1",
          side: "long",
          kind: "close",
          price: 2,
          qty: 1,
          fee: 0,
          pricePnl: 1,
        },
        {
          barIndex: 2,
          timeMs: 2,
          market: "SYNTH-IDX1",
          side: "long",
          kind: "open",
          price: 2,
          qty: 1,
          fee: 0,
          pricePnl: 0,
        },
        {
          barIndex: 3,
          timeMs: 3,
          market: "SYNTH-IDX1",
          side: "long",
          kind: "close",
          price: 2,
          qty: 1,
          fee: 0,
          pricePnl: 0,
        },
      ],
      equityCurve: [10, 11, 11, 11],
      startingBalance: 10,
    });
    expect(stats.trades).toBe(2);
    expect(stats.wins).toBe(1);
    expect(stats.losses).toBe(0);
    expect(stats.profitFactor).toBe(Number.POSITIVE_INFINITY);
  });

  it("measures a realized daily base without unrealized PnL and allows no target", () => {
    const day = 24 * HOUR;
    const series: Bar[] = [
      { timeMs: day - HOUR, open: 100, high: 100, low: 100, close: 100 },
      { timeMs: day - 1, open: 110, high: 110, low: 110, close: 110 },
      { timeMs: day + HOUR, open: 107, high: 107, low: 107, close: 107 },
    ];
    const run = (dailyBase: "equity" | "realized") =>
      replaySession({
        market: "SYNTH-IDX1",
        series,
        preset: preset({
          dailyBase,
          dailyLossLimitPct: 3,
          dailyReset: { timeZone: "UTC", hour: 0, minute: 0 },
          profitTargetPct: null,
          maxDrawdownPct: 50,
        }),
        actions: [open({ leverage: 1, powerPct: 100 })],
        cursor: 2,
      });
    // Equity base: day starts at 11 000, floor 10 670, equity 10 700 survives barely.
    expect(run("equity").dailyLossFloor).toBeCloseTo(10_670);
    // Realized base: day starts at 10 000 (no closed PnL yet), floor 9 700.
    const realized = run("realized");
    expect(realized.dailyLossFloor).toBeCloseTo(9_700);
    expect(realized.profitTarget).toBeNull();
    expect(realized.phase).toBe("practice");
  });

  it("caps leverage per market", () => {
    const frame = replaySession({
      market: "SYNTH-METAL1",
      series: [ohlc(0, 100, 100, 100, 100)],
      preset: preset({ maxLeverage: { "SYNTH-IDX1": 25, "SYNTH-METAL1": 15 } }),
      actions: [open({ leverage: 20 })],
      cursor: 0,
    });
    expect(frame.rejects[0]?.reason).toBe("invalid-leverage");
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
      market: "SYNTH-IDX1",
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
    expect(stats.losses).toBe(0); // the short at 100 → 100 is breakeven
    expect(stats.winRate).toBe(50);
    expect(stats.netPnl).toBeCloseTo(250);
    expect(stats.returnPct).toBeCloseTo(10);
  });
});
