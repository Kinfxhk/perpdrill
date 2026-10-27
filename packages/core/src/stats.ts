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

export type ReviewMetrics = SessionStats & {
  /** Per-session Sharpe over the bar returns (not annualized). */
  readonly sharpe: number | null;
  readonly sortino: number | null;
  readonly calmar: number | null;
  readonly avgHoldBars: number | null;
};

export function reviewMetrics(input: {
  readonly fills: readonly FillEvent[];
  readonly equityCurve: readonly number[];
  readonly startingBalance: number;
}): ReviewMetrics {
  const stats = sessionStats(input);
  const returns: number[] = [];
  for (let index = 1; index < input.equityCurve.length; index += 1) {
    const previous = input.equityCurve[index - 1] ?? input.startingBalance;
    const current = input.equityCurve[index] ?? previous;
    if (previous > 0) {
      returns.push((current - previous) / previous);
    }
  }
  const count = returns.length;
  const mean = count === 0 ? 0 : returns.reduce((sum, value) => sum + value, 0) / count;
  const variance =
    count === 0 ? 0 : returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / count;
  const std = Math.sqrt(variance);
  const downside = Math.sqrt(
    returns.filter((value) => value < 0).reduce((sum, value) => sum + value * value, 0) /
      Math.max(1, count),
  );
  const scale = Math.sqrt(count);
  const trades = pairTrades(input.fills);
  const holds = trades.map((trade) => trade.closeBar - trade.openBar);
  return {
    ...stats,
    sharpe: std > 0 && count > 1 ? (mean / std) * scale : null,
    sortino: downside > 0 && count > 1 ? (mean / downside) * scale : null,
    calmar: stats.maxDrawdownPct > 0 ? stats.returnPct / stats.maxDrawdownPct : null,
    avgHoldBars:
      holds.length === 0 ? null : holds.reduce((sum, value) => sum + value, 0) / holds.length,
  };
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
