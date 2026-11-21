import { describe, expect, it } from "vitest";
import {
  PRACTICE_STARTING_BALANCE_USD,
  pairTrades,
  replaySession,
  reviewMetrics,
  sessionStats,
  type Bar,
  type SessionAction,
} from "./index.ts";

const HOUR = 3_600_000;

function bar(index: number, open: number, high: number, low: number, close: number): Bar {
  return { timeMs: index * HOUR, open, high, low, close };
}

function flatBar(index: number, price: number): Bar {
  return bar(index, price, price, price, price);
}

const SLIP = { slipToleranceBps: 75, realizedImpactBps: 25 } as const;

describe("pairTrades & sessionStats", () => {
  it("pairs a limit entry closed by take-profit", () => {
    const series: readonly Bar[] = [
      bar(0, 100, 102, 99, 100),
      bar(1, 100, 101, 95, 98),
      bar(2, 98, 112, 97, 110),
    ];
    const actions: readonly SessionAction[] = [
      {
        kind: "limit",
        barIndex: 0,
        side: "long",
        leverage: 10,
        powerPct: 25,
        price: 96,
        takeProfit: 110,
        ...SLIP,
      },
    ];
    const frame = replaySession({
      market: "SYNTH-IDX1",
      series,
      preset: null,
      actions,
      cursor: 2,
    });
    const trades = pairTrades(frame.fills);
    expect(trades).toHaveLength(1);
    expect(trades[0]?.entry).toBe(96);
    expect(trades[0]?.exit).toBe(110);
    expect(trades[0]?.exitKind).toBe("take-profit");
    expect(trades[0]?.netPnl).toBeCloseTo(frame.equity - PRACTICE_STARTING_BALANCE_USD, 6);

    const stats = sessionStats({
      fills: frame.fills,
      equityCurve: frame.equityCurve,
      startingBalance: PRACTICE_STARTING_BALANCE_USD,
    });
    expect(stats.trades).toBe(1);
    expect(stats.wins).toBe(1);
    expect(stats.netPnl).toBeCloseTo(frame.equity - PRACTICE_STARTING_BALANCE_USD, 6);
  });

  it("pairs a stop-entry closed by stop-loss", () => {
    const series: readonly Bar[] = [
      bar(0, 100, 102, 99, 100),
      bar(1, 101, 106, 100, 105),
      bar(2, 105, 106, 98, 99),
    ];
    const actions: readonly SessionAction[] = [
      {
        kind: "stop",
        barIndex: 0,
        side: "long",
        leverage: 10,
        powerPct: 25,
        price: 104,
        stopLoss: 100,
        ...SLIP,
      },
    ];
    const frame = replaySession({
      market: "SYNTH-IDX1",
      series,
      preset: null,
      actions,
      cursor: 2,
    });
    const trades = pairTrades(frame.fills);
    expect(trades).toHaveLength(1);
    expect(trades[0]?.exitKind).toBe("stop");
    expect(trades[0]?.netPnl).toBeLessThan(0);
    expect(trades[0]?.netPnl).toBeCloseTo(frame.equity - PRACTICE_STARTING_BALANCE_USD, 6);
  });

  it("aggregates fractional closes into one complete trade with exact netPnl", () => {
    const series: readonly Bar[] = [
      flatBar(0, 100),
      flatBar(1, 104),
      flatBar(2, 108),
      flatBar(3, 112),
    ];
    const actions: readonly SessionAction[] = [
      { kind: "open", barIndex: 0, side: "long", leverage: 10, powerPct: 50, ...SLIP },
      { kind: "close", barIndex: 1, powerPct: 25, ...SLIP },
      { kind: "close", barIndex: 2, powerPct: 50, ...SLIP },
      { kind: "close", barIndex: 3, powerPct: 100, ...SLIP },
    ];
    const frame = replaySession({
      market: "SYNTH-IDX1",
      series,
      preset: null,
      actions,
      cursor: 3,
    });
    expect(frame.position).toBeNull();
    const trades = pairTrades(frame.fills);
    expect(trades).toHaveLength(1);
    expect(trades[0]?.openBar).toBe(0);
    expect(trades[0]?.closeBar).toBe(3);
    expect(trades[0]?.netPnl).toBeCloseTo(frame.equity - PRACTICE_STARTING_BALANCE_USD, 6);
  });

  it("does not emit a completed trade while a partially closed position is still open", () => {
    const series: readonly Bar[] = [flatBar(0, 100), flatBar(1, 105)];
    const actions: readonly SessionAction[] = [
      { kind: "open", barIndex: 0, side: "long", leverage: 10, powerPct: 50, ...SLIP },
      { kind: "close", barIndex: 1, powerPct: 50, ...SLIP },
    ];
    const frame = replaySession({
      market: "SYNTH-IDX1",
      series,
      preset: null,
      actions,
      cursor: 1,
    });
    expect(frame.position).not.toBeNull();
    expect(pairTrades(frame.fills)).toHaveLength(0);
  });

  it("aggregates same-side stacking and pairs reversals accurately", () => {
    const series: readonly Bar[] = [
      flatBar(0, 100),
      flatBar(1, 102),
      flatBar(2, 106),
      flatBar(3, 101),
    ];
    const actions: readonly SessionAction[] = [
      { kind: "open", barIndex: 0, side: "long", leverage: 10, powerPct: 25, ...SLIP },
      { kind: "open", barIndex: 1, side: "long", leverage: 10, powerPct: 25, ...SLIP },
      // Reverse to short at bar 2, then close short at bar 3.
      { kind: "open", barIndex: 2, side: "short", leverage: 10, powerPct: 25, ...SLIP },
      { kind: "close", barIndex: 3, ...SLIP },
    ];
    const frame = replaySession({
      market: "SYNTH-IDX1",
      series,
      preset: null,
      actions,
      cursor: 3,
    });
    const trades = pairTrades(frame.fills);
    expect(trades).toHaveLength(2);
    expect(trades[0]?.side).toBe("long");
    expect(trades[1]?.side).toBe("short");
    const totalNet = trades.reduce((sum, trade) => sum + trade.netPnl, 0);
    expect(totalNet).toBeCloseTo(frame.equity - PRACTICE_STARTING_BALANCE_USD, 6);
  });
});

describe("cross margin accounting", () => {
  it("computes cross-margin liqPrice immediately on the opening bar", () => {
    const series: readonly Bar[] = [flatBar(0, 100)];
    const actions: readonly SessionAction[] = [
      { kind: "open", barIndex: 0, side: "long", leverage: 10, powerPct: 25, ...SLIP },
    ];
    const isolated = replaySession({
      market: "SYNTH-IDX1",
      series,
      preset: null,
      actions,
      cursor: 0,
      marginMode: "isolated",
    });
    const cross = replaySession({
      market: "SYNTH-IDX1",
      series,
      preset: null,
      actions,
      cursor: 0,
      marginMode: "cross",
    });
    expect(cross.position?.liqPrice).toBeLessThan(isolated.position?.liqPrice ?? 0);
  });

  it("deducts cross-margin gap losses beyond initial margin from free cash", () => {
    // Open 10x long at 25% power (~625 margin, ~1875 free cash).
    // Bar 1 gaps down 25% to 75 -> loss exceeds isolatedMargin (~625) but stays within total cash.
    const series: readonly Bar[] = [flatBar(0, 100), bar(1, 75, 76, 74, 75)];
    const actions: readonly SessionAction[] = [
      {
        kind: "open",
        barIndex: 0,
        side: "long",
        leverage: 10,
        powerPct: 25,
        stopLoss: 80,
        ...SLIP,
      },
    ];
    const isolated = replaySession({
      market: "SYNTH-IDX1",
      series,
      preset: null,
      actions,
      cursor: 1,
      marginMode: "isolated",
    });
    const cross = replaySession({
      market: "SYNTH-IDX1",
      series,
      preset: null,
      actions,
      cursor: 1,
      marginMode: "cross",
    });
    // Isolated caps loss at the position margin, leaving ~75% of starting balance in cash.
    expect(isolated.liquidated).toBe(true);
    expect(isolated.cash).toBeGreaterThan(PRACTICE_STARTING_BALANCE_USD * 0.7);
    // Cross draws the excess loss from free cash, so ending cash is strictly lower than isolated.
    expect(cross.position).toBeNull();
    expect(cross.cash).toBeLessThan(isolated.cash);
    expect(cross.cash).toBeGreaterThanOrEqual(0);
    // Verify exact equity conservation on cross exit.
    const openFill = cross.fills[0];
    const exitFill = cross.fills[1];
    expect(openFill).toBeDefined();
    expect(exitFill).toBeDefined();
    const expectedCash =
      PRACTICE_STARTING_BALANCE_USD -
      (openFill?.fee ?? 0) -
      (exitFill?.fee ?? 0) +
      (exitFill?.pricePnl ?? 0);
    expect(cross.cash).toBeCloseTo(expectedCash, 6);
  });
});

describe("reviewMetrics sharpe/sortino scaling", () => {
  it("does not inflate Sharpe or Sortino when trailing flat bars are appended", () => {
    const baseCurve = [10_000, 10_200, 10_100, 10_400, 10_350, 10_600];
    const paddedCurve = [...baseCurve, ...Array.from({ length: 200 }, () => 10_600)];
    const base = reviewMetrics({ fills: [], equityCurve: baseCurve, startingBalance: 10_000 });
    const padded = reviewMetrics({ fills: [], equityCurve: paddedCurve, startingBalance: 10_000 });
    expect(base.sharpe).not.toBeNull();
    expect(padded.sharpe).not.toBeNull();
    expect(padded.sharpe!).toBeLessThanOrEqual(base.sharpe!);
    expect(base.sortino).not.toBeNull();
    expect(padded.sortino).not.toBeNull();
    expect(padded.sortino!).toBeLessThanOrEqual(base.sortino!);
  });
});
