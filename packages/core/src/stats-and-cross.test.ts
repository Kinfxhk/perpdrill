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

  // 20x, 50% power posts half the account. A drop to 93 loses more than that
  // margin but stays above the cross liquidation price (~92.5). Isolated, whose
  // liquidation price is ~97.5, is stopped out before the reverse.
  const EXACT = { slipToleranceBps: 50, realizedImpactBps: 0 } as const;

  function losingReverse(price: number, marginMode: "isolated" | "cross") {
    const actions: readonly SessionAction[] = [
      { kind: "open", barIndex: 0, side: "long", leverage: 20, powerPct: 50, ...EXACT },
      { kind: "open", barIndex: 1, side: "short", leverage: 20, powerPct: 100, ...EXACT },
    ];
    return replaySession({
      market: "SYNTH-IDX1",
      series: [flatBar(0, 100), flatBar(1, price)],
      preset: null,
      actions,
      cursor: 1,
      marginMode,
    });
  }

  it("sizes a losing cross-margin reverse from the cash left after the close", () => {
    const frame = losingReverse(93, "cross");
    expect(frame.liquidated).toBe(false);
    expect(frame.rejects).toEqual([]);
    expect(frame.fills.map((fill) => fill.kind)).toEqual(["open", "close", "open"]);
    const opened = frame.fills[0];
    const closed = frame.fills[1];
    const reversed = frame.fills[2];
    expect(opened).toBeDefined();
    expect(closed).toBeDefined();
    expect(reversed).toBeDefined();
    if (opened === undefined || closed === undefined || reversed === undefined) {
      return;
    }

    const longMargin = (opened.qty * opened.price) / 20;
    const preCloseCash = PRACTICE_STARTING_BALANCE_USD - opened.fee - longMargin;
    const equityAfterClose =
      PRACTICE_STARTING_BALANCE_USD - opened.fee + closed.pricePnl - closed.fee;
    // The close drew free cash, so a quote from the pre-close balance is too big.
    expect(closed.pricePnl).toBeLessThan(-longMargin);
    expect(equityAfterClose).toBeLessThan(preCloseCash);
    expect(equityAfterClose).toBeGreaterThan(0);

    expect(frame.position?.side).toBe("short");
    expect(frame.cash).toBeGreaterThanOrEqual(0);
    expect(frame.position?.initialMargin).toBeLessThan(preCloseCash);
    // 100% of the cash that survived the close, not 100% of the pre-close cash.
    expect((frame.position?.initialMargin ?? 0) + reversed.fee).toBeCloseTo(equityAfterClose, 6);
    expect(frame.cash).toBeCloseTo(
      equityAfterClose - (frame.position?.initialMargin ?? 0) - reversed.fee,
      6,
    );
    expect(frame.position?.qty).toBeCloseTo((equityAfterClose * 20) / 93, 4);
    expect(frame.equity).toBeCloseTo(equityAfterClose + frame.unrealizedPnl, 4);
  });

  it("keeps an isolated reverse inside the posted margin", () => {
    const wiped = losingReverse(93, "isolated");
    expect(wiped.liquidated).toBe(true);
    expect(wiped.position).toBeNull();
    expect(wiped.cash).toBeGreaterThanOrEqual(0);
    const opened = wiped.fills[0];
    const liquidation = wiped.fills.find((fill) => fill.kind === "liquidation");
    expect(opened).toBeDefined();
    expect(liquidation).toBeDefined();
    if (opened === undefined || liquidation === undefined) {
      return;
    }
    const longMargin = (opened.qty * opened.price) / 20;
    // Loss stops at the position margin. Free cash is not drawn, and the reverse
    // never opens on a frozen account.
    expect(liquidation.pricePnl).toBeCloseTo(-longMargin, 6);
    expect(liquidation.pricePnl).toBeGreaterThan(opened.qty * (93 - opened.price));
    expect(wiped.cash).toBeCloseTo(PRACTICE_STARTING_BALANCE_USD - opened.fee - longMargin, 6);
    expect(wiped.rejects).toContainEqual({ barIndex: 1, reason: "account-frozen" });
    expect(wiped.fills.some((fill) => fill.kind === "open" && fill.side === "short")).toBe(false);

    // Above the isolated liquidation price the reverse still fills, sized from
    // cash after the capped close, and does not spend free cash on the loss.
    const held = losingReverse(99, "isolated");
    expect(held.liquidated).toBe(false);
    expect(held.rejects).toEqual([]);
    expect(held.position?.side).toBe("short");
    expect(held.cash).toBeGreaterThanOrEqual(0);
    const heldOpen = held.fills[0];
    const heldClose = held.fills[1];
    const heldReverse = held.fills[2];
    expect(heldOpen).toBeDefined();
    expect(heldClose).toBeDefined();
    expect(heldReverse).toBeDefined();
    if (heldOpen === undefined || heldClose === undefined || heldReverse === undefined) {
      return;
    }
    const heldMargin = (heldOpen.qty * heldOpen.price) / 20;
    const equityAfterClose =
      PRACTICE_STARTING_BALANCE_USD - heldOpen.fee + heldClose.pricePnl - heldClose.fee;
    expect(heldClose.pricePnl).toBeGreaterThan(-heldMargin);
    expect(heldClose.pricePnl).toBeLessThan(0);
    expect((held.position?.initialMargin ?? 0) + heldReverse.fee).toBeCloseTo(equityAfterClose, 6);
    expect(held.cash).toBeCloseTo(
      equityAfterClose - (held.position?.initialMargin ?? 0) - heldReverse.fee,
      6,
    );
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
