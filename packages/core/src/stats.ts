import type { FillEvent } from "./replay.ts";

export type Trade = {
  readonly side: FillEvent["side"];
  readonly openBar: number;
  readonly closeBar: number;
  readonly entry: number;
  readonly exit: number;
  readonly qty: number;
  readonly exitKind: FillEvent["kind"];
  /** Price PnL minus both fees. Carry is reported on the session, not per trade. */
  readonly netPnl: number;
};

export type SessionStats = {
  readonly trades: number;
  readonly wins: number;
  readonly losses: number;
  readonly winRate: number | null;
  readonly netPnl: number;
  readonly grossProfit: number;
  readonly grossLoss: number;
  readonly profitFactor: number | null;
  readonly avgWin: number | null;
  readonly avgLoss: number | null;
  readonly expectancy: number | null;
  readonly bestTrade: number | null;
  readonly worstTrade: number | null;
  /** Largest peak-to-trough drop on the closing equity curve, in percent of the peak. */
  readonly maxDrawdownPct: number;
  readonly returnPct: number;
};

export function pairTrades(fills: readonly FillEvent[]): readonly Trade[] {
  const trades: Trade[] = [];
  let open: FillEvent | null = null;
  for (const fill of fills) {
    if (fill.kind === "open") {
      open = fill;
      continue;
    }
    if (open === null) {
      continue;
    }
    trades.push({
      side: open.side,
      openBar: open.barIndex,
      closeBar: fill.barIndex,
      entry: open.price,
      exit: fill.price,
      qty: fill.qty,
      exitKind: fill.kind,
      netPnl: fill.pricePnl - fill.fee - open.fee,
    });
    open = null;
  }
  return trades;
}

export function sessionStats(input: {
  readonly fills: readonly FillEvent[];
  readonly equityCurve: readonly number[];
  readonly startingBalance: number;
}): SessionStats {
  const trades = pairTrades(input.fills);
  const pnls = trades.map((trade) => trade.netPnl);
  const winners = pnls.filter((pnl) => pnl > 0);
  // Breakeven trades count toward trades but neither wins nor losses.
  const losers = pnls.filter((pnl) => pnl < 0);
  const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);
  const grossProfit = sum(winners);
  const grossLoss = -sum(losers);
  let peak = input.startingBalance;
  let maxDrawdownPct = 0;
  for (const equity of input.equityCurve) {
    peak = Math.max(peak, equity);
    if (peak > 0) {
      maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - equity) / peak) * 100);
    }
  }
  const last = input.equityCurve[input.equityCurve.length - 1] ?? input.startingBalance;
  return {
    trades: trades.length,
    wins: winners.length,
    losses: losers.length,
    winRate: trades.length === 0 ? null : (winners.length / trades.length) * 100,
    netPnl: sum(pnls),
    grossProfit,
    grossLoss,
    profitFactor:
      grossLoss === 0
        ? grossProfit > 0
          ? Number.POSITIVE_INFINITY
          : null
        : grossProfit / grossLoss,
    avgWin: winners.length === 0 ? null : grossProfit / winners.length,
    avgLoss: losers.length === 0 ? null : -grossLoss / losers.length,
    expectancy: trades.length === 0 ? null : sum(pnls) / trades.length,
    bestTrade: pnls.length === 0 ? null : Math.max(...pnls),
    worstTrade: pnls.length === 0 ? null : Math.min(...pnls),
    maxDrawdownPct,
    returnPct:
      input.startingBalance <= 0
        ? 0
        : ((last - input.startingBalance) / input.startingBalance) * 100,
  };
}
