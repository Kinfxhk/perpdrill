import { PRACTICE_STARTING_BALANCE_USD, SAMPLE_BAR_MS, type MarketId } from "./constants.ts";
import {
  closePriceFromMark,
  quoteClose,
  quoteOpen,
  type RejectReason,
  type SlipSettings,
} from "./fill.ts";
import { liqDistance, maintenanceMargin, sideSign, unrealizedPnl, type Side } from "./liq.ts";
import { includeUnrealized, resolvedTakerBps, type PracticePreset } from "./preset.ts";
import {
  logicalDayKey,
  priceForEquityFloor,
  profitTargetEquity,
  propEquity,
  type PropBreach,
} from "./prop.ts";
import type { Bar } from "./series.ts";
import type { BuyingPowerPct } from "./types.ts";

/** Optional protective prices. `null` clears one; `undefined` leaves it. */
export type Bracket = {
  readonly stopLoss?: number | null;
  readonly takeProfit?: number | null;
};

export type SessionAction =
  | (SlipSettings &
      Bracket & {
        readonly kind: "open";
        readonly barIndex: number;
        readonly side: Side;
        readonly leverage: number;
        readonly powerPct: BuyingPowerPct;
      })
  | (SlipSettings & {
      readonly kind: "close";
      readonly barIndex: number;
    })
  | (Bracket & {
      readonly kind: "bracket";
      readonly barIndex: number;
    });

export type Position = {
  readonly market: MarketId;
  readonly side: Side;
  readonly qty: number;
  readonly entry: number;
  readonly leverage: number;
  readonly initialMargin: number;
  readonly isolatedMargin: number;
  readonly liqPrice: number;
  readonly stopLoss: number | null;
  readonly takeProfit: number | null;
  readonly openedAtMs: number;
  readonly openedAtBar: number;
};

export type FillKind = "open" | "close" | "stop" | "take-profit" | "breach" | "liquidation";

export type FillEvent = {
  readonly barIndex: number;
  readonly timeMs: number;
  readonly market: MarketId;
  readonly side: Side;
  readonly kind: FillKind;
  readonly price: number;
  readonly qty: number;
  readonly fee: number;
  readonly pricePnl: number;
};

export type RejectEvent = {
  readonly barIndex: number;
  readonly reason: RejectReason;
};

export type Phase = "practice" | "target" | "drawdown" | "daily" | "liquidated";

export type Frame = {
  readonly barIndex: number;
  readonly timeMs: number;
  /** Bar close. Orders fill on it; intrabar triggers use high/low. */
  readonly mark: number;
  readonly cash: number;
  readonly equity: number;
  readonly available: number;
  readonly unrealizedPnl: number;
  readonly maintenance: number;
  readonly positionEquity: number | null;
  readonly position: Position | null;
  readonly liqPrice: number | null;
  readonly liqDistance: number | null;
  readonly failPrice: number | null;
  readonly dailyFailPrice: number | null;
  readonly maxDrawdownFloor: number | null;
  readonly dailyLossFloor: number | null;
  readonly profitTarget: number | null;
  readonly phase: Phase;
  readonly propBreach: PropBreach | null;
  readonly targetHit: boolean;
  readonly liquidated: boolean;
  readonly feesPaid: number;
  readonly carryPaid: number;
  readonly fills: readonly FillEvent[];
  readonly rejects: readonly RejectEvent[];
  /** Equity at each bar close from bar 0 to the cursor. */
  readonly equityCurve: readonly number[];
};

export type SessionInput = {
  readonly market: MarketId;
  readonly series: readonly Bar[];
  readonly preset: PracticePreset | null;
  readonly actions: readonly SessionAction[];
  readonly cursor: number;
};

type WorkingPosition = {
  market: MarketId;
  side: Side;
  qty: number;
  entry: number;
  leverage: number;
  initialMargin: number;
  isolatedMargin: number;
  liqPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  impactBps: number;
  openedAtMs: number;
  openedAtBar: number;
};

function carryCost(preset: PracticePreset | null, notional: number, hours: number): number {
  if (preset === null || hours <= 0 || notional <= 0) {
    return 0;
  }
  switch (preset.costModel) {
    case "swap": {
      const rate = preset.swapDailyRatePct;
      if (rate === null) {
        return 0;
      }
      return notional * (rate / 100) * (hours / 24);
    }
    case "funding": {
      if (!preset.venueFundingChangesBalance || preset.fundingRatePerHour === null) {
        return 0;
      }
      return notional * preset.fundingRatePerHour * hours;
    }
    case "off":
      return 0;
    default: {
      const unexpected: never = preset.costModel;
      throw new Error(`unexpected cost model ${String(unexpected)}`);
    }
  }
}

function phaseOf(input: {
  liquidated: boolean;
  propBreach: PropBreach | null;
  targetHit: boolean;
}): Phase {
  if (input.liquidated) {
    return "liquidated";
  }
  switch (input.propBreach) {
    case "daily":
      return "daily";
    case "max-dd":
      return "drawdown";
    case null:
      return input.targetHit ? "target" : "practice";
    default: {
      const unexpected: never = input.propBreach;
      throw new Error(`unexpected breach ${String(unexpected)}`);
    }
  }
}

/** Mark where isolated equity equals maintenance, after any carry taken from margin. */
function actualLiqPrice(position: WorkingPosition): number {
  const cushion = position.isolatedMargin - maintenanceMargin(position.initialMargin);
  return position.entry - (sideSign(position.side) * cushion) / position.qty;
}

/** True when each bracket price sits on its protective side of the reference. */
export function bracketValid(side: Side, reference: number, bracket: Bracket): boolean {
  const sign = sideSign(side);
  const { stopLoss, takeProfit } = bracket;
  if (stopLoss !== undefined && stopLoss !== null) {
    if (!Number.isFinite(stopLoss) || stopLoss <= 0 || sign * (reference - stopLoss) <= 0) {
      return false;
    }
  }
  if (takeProfit !== undefined && takeProfit !== null) {
    if (!Number.isFinite(takeProfit) || takeProfit <= 0 || sign * (takeProfit - reference) <= 0) {
      return false;
    }
  }
  return true;
}

type Trigger = { readonly price: number; readonly kind: "stop" | "liquidation" | PropBreach };

export function replaySession(input: SessionInput): Frame {
  if (input.series.length === 0) {
    throw new Error("series is empty");
  }
  const cursor = Math.min(Math.max(input.cursor, 0), input.series.length - 1);
  const starting = input.preset?.startingBalanceUsd ?? PRACTICE_STARTING_BALANCE_USD;
  const takerBps = resolvedTakerBps(input.preset);
  const useUPnL = includeUnrealized(input.preset);
  const drawdownAmount =
    input.preset === null ? null : starting * (input.preset.maxDrawdownPct / 100);
  const trailing = input.preset?.drawdownMode === "trailing";
  const profitTarget =
    input.preset === null ? null : profitTargetEquity(starting, input.preset.profitTargetPct);
  const dailyPct = input.preset?.dailyLossLimitPct ?? null;

  let cash = starting;
  let position: WorkingPosition | null = null;
  let feesPaid = 0;
  let carryPaid = 0;
  let liquidated = false;
  let propBreach: PropBreach | null = null;
  let targetHit = false;
  let dayKey: string | null = null;
  let dayStart = starting;
  let peak = starting;
  let lastCloseEquity = starting;
  const fills: FillEvent[] = [];
  const rejects: RejectEvent[] = [];
  const equityCurve: number[] = [];

  // shortcut: the trailing floor follows the closing high-water mark and locks at the
  // starting balance, like most evals; upgrade if a preset needs intrabar trailing.
  const maxFloor = (): number | null =>
    drawdownAmount === null
      ? null
      : trailing
        ? Math.min(starting, peak - drawdownAmount)
        : starting - drawdownAmount;
  const dailyFloor = (): number | null =>
    dailyPct === null ? null : dayStart * (1 - dailyPct / 100);

  const equityAt = (price: number): { equity: number; upnl: number } => {
    if (position === null) {
      return { equity: cash, upnl: 0 };
    }
    const upnl = unrealizedPnl(position.side, position.qty, position.entry, price);
    return { equity: cash + position.isolatedMargin + upnl, upnl };
  };

  const floorPrice = (floor: number | null): number | null =>
    position === null || floor === null || !useUPnL
      ? null
      : priceForEquityFloor({
          floor,
          cash,
          isolatedMargin: position.isolatedMargin,
          qty: position.qty,
          entry: position.entry,
          side: position.side,
        });

  const exit = (index: number, bar: Bar, kind: FillKind, price: number): void => {
    if (position === null) {
      return;
    }
    const rawPnl = unrealizedPnl(position.side, position.qty, position.entry, price);
    // Isolated: no exit (gap, slipped stop) can lose more than the position margin.
    const pricePnl = Math.max(rawPnl, -position.isolatedMargin);
    const fee =
      kind === "liquidation"
        ? 0
        : Math.min(position.qty * price * (takerBps / 10_000), position.isolatedMargin + pricePnl);
    const back = Math.max(0, position.isolatedMargin + pricePnl - fee);
    cash += back;
    feesPaid += fee;
    fills.push({
      barIndex: index,
      timeMs: bar.timeMs,
      market: position.market,
      side: position.side,
      kind,
      price,
      qty: position.qty,
      fee,
      pricePnl,
    });
    position = null;
  };

  for (let index = 0; index <= cursor; index += 1) {
    const bar = input.series[index];
    if (bar === undefined) {
      break;
    }
    const previous = index === 0 ? undefined : input.series[index - 1];

    if (input.preset?.dailyReset !== undefined && input.preset.dailyReset !== null) {
      const key = logicalDayKey(bar.timeMs, input.preset.dailyReset);
      if (key !== dayKey) {
        if (dayKey !== null) {
          dayStart = lastCloseEquity;
        }
        dayKey = key;
      }
    }

    if (position !== null && previous !== undefined) {
      const hours = (bar.timeMs - previous.timeMs) / SAMPLE_BAR_MS;
      const cost = carryCost(input.preset, position.qty * previous.close, hours);
      if (cost !== 0) {
        const fromCash = Math.max(0, Math.min(cash, cost));
        cash -= fromCash;
        position.isolatedMargin -= cost - fromCash;
        carryPaid += cost;
      }
      position.liqPrice = actualLiqPrice(position);
    }

    // Intrabar: assume the adverse extreme prints before the favourable one.
    if (position !== null && !liquidated && propBreach === null) {
      const long = position.side === "long";
      const worst = long ? bar.low : bar.high;
      const best = long ? bar.high : bar.low;
      const openedPastTarget =
        position.takeProfit !== null &&
        (long ? bar.open >= position.takeProfit : bar.open <= position.takeProfit);
      const candidates: Trigger[] = [{ price: position.liqPrice, kind: "liquidation" }];
      if (position.stopLoss !== null) {
        candidates.push({ price: position.stopLoss, kind: "stop" });
      }
      const dailyPrice = floorPrice(dailyFloor());
      if (dailyPrice !== null) {
        candidates.push({ price: dailyPrice, kind: "daily" });
      }
      const maxPrice = floorPrice(maxFloor());
      if (maxPrice !== null) {
        candidates.push({ price: maxPrice, kind: "max-dd" });
      }
      // The first level touched on the way to the worst print wins.
      const hit = candidates
        .filter(
          (item) =>
            Number.isFinite(item.price) && (long ? worst <= item.price : worst >= item.price),
        )
        .sort((a, b) => (long ? b.price - a.price : a.price - b.price))[0];
      if (openedPastTarget) {
        exit(index, bar, "take-profit", bar.open);
      } else if (hit !== undefined) {
        // A gap through the trigger fills at the open.
        const level = long ? Math.min(hit.price, bar.open) : Math.max(hit.price, bar.open);
        // If that gap also passes liquidation, the venue liquidates first.
        const kind = (long ? level <= position.liqPrice : level >= position.liqPrice)
          ? "liquidation"
          : hit.kind;
        switch (kind) {
          case "stop":
            exit(index, bar, "stop", closePriceFromMark(level, position.side, position.impactBps));
            break;
          case "liquidation":
            exit(index, bar, "liquidation", level);
            liquidated = true;
            break;
          case "daily":
          case "max-dd":
            exit(index, bar, "breach", level);
            propBreach = kind;
            break;
          default: {
            const unexpected: never = kind;
            throw new Error(`unexpected trigger ${String(unexpected)}`);
          }
        }
      } else if (
        position.takeProfit !== null &&
        (long ? best >= position.takeProfit : best <= position.takeProfit)
      ) {
        const level = long
          ? Math.max(position.takeProfit, bar.open)
          : Math.min(position.takeProfit, bar.open);
        exit(index, bar, "take-profit", level);
      }
    }

    const frozen = liquidated || propBreach !== null;
    const price = bar.close;
    for (const action of input.actions) {
      if (action.barIndex !== index) {
        continue;
      }
      switch (action.kind) {
        case "open": {
          if (frozen) {
            rejects.push({ barIndex: index, reason: "account-frozen" });
            continue;
          }
          if (position !== null) {
            rejects.push({ barIndex: index, reason: "position-open" });
            continue;
          }
          const allowed = input.preset?.markets;
          if (allowed !== null && allowed !== undefined && !allowed.includes(input.market)) {
            rejects.push({ barIndex: index, reason: "market-not-allowed" });
            continue;
          }
          const cap = input.preset?.maxLeverage ?? null;
          if (cap !== null && action.leverage > cap) {
            rejects.push({ barIndex: index, reason: "invalid-leverage" });
            continue;
          }
          const quote = quoteOpen({
            side: action.side,
            leverage: action.leverage,
            powerPct: action.powerPct,
            cash,
            mark: price,
            takerBps,
            slipToleranceBps: action.slipToleranceBps,
            realizedImpactBps: action.realizedImpactBps,
          });
          if (!quote.ok) {
            rejects.push({ barIndex: index, reason: quote.reason });
            continue;
          }
          if (!bracketValid(action.side, quote.fillPrice, action)) {
            rejects.push({ barIndex: index, reason: "invalid-bracket" });
            continue;
          }
          cash -= quote.initialMargin + quote.fee;
          feesPaid += quote.fee;
          position = {
            market: input.market,
            side: action.side,
            qty: quote.qty,
            entry: quote.fillPrice,
            leverage: action.leverage,
            initialMargin: quote.initialMargin,
            isolatedMargin: quote.initialMargin,
            liqPrice: quote.liqPrice,
            stopLoss: action.stopLoss ?? null,
            takeProfit: action.takeProfit ?? null,
            impactBps: action.realizedImpactBps,
            openedAtMs: bar.timeMs,
            openedAtBar: index,
          };
          fills.push({
            barIndex: index,
            timeMs: bar.timeMs,
            market: input.market,
            side: action.side,
            kind: "open",
            price: quote.fillPrice,
            qty: quote.qty,
            fee: quote.fee,
            pricePnl: 0,
          });
          break;
        }
        case "close": {
          if (position === null) {
            rejects.push({ barIndex: index, reason: "flat" });
            continue;
          }
          const quote = quoteClose({
            side: position.side,
            qty: position.qty,
            entry: position.entry,
            mark: price,
            takerBps,
            slipToleranceBps: action.slipToleranceBps,
            realizedImpactBps: action.realizedImpactBps,
          });
          if (!quote.ok) {
            rejects.push({ barIndex: index, reason: quote.reason });
            continue;
          }
          exit(index, bar, "close", quote.fillPrice);
          break;
        }
        case "bracket": {
          if (position === null) {
            rejects.push({ barIndex: index, reason: "flat" });
            continue;
          }
          if (!bracketValid(position.side, price, action)) {
            rejects.push({ barIndex: index, reason: "invalid-bracket" });
            continue;
          }
          if (action.stopLoss !== undefined) {
            position.stopLoss = action.stopLoss;
          }
          if (action.takeProfit !== undefined) {
            position.takeProfit = action.takeProfit;
          }
          break;
        }
        default: {
          const unexpected: never = action;
          throw new Error(`unexpected action ${String(unexpected)}`);
        }
      }
    }

    // Close check catches floors the intrabar solve skips (e.g. rules on realized equity).
    if (input.preset !== null && propBreach === null && !liquidated) {
      const closed = equityAt(price);
      const assessed = propEquity(closed.equity, closed.upnl, useUPnL);
      const daily = dailyFloor();
      const floor = maxFloor();
      const breach: PropBreach | null =
        daily !== null && assessed <= daily
          ? "daily"
          : floor !== null && assessed <= floor
            ? "max-dd"
            : null;
      if (breach !== null) {
        exit(index, bar, "breach", price);
        propBreach = breach;
      }
    }
    const settled = equityAt(price);
    const settledAssessed = propEquity(settled.equity, settled.upnl, useUPnL);
    if (propBreach === null && !liquidated) {
      peak = Math.max(peak, settledAssessed);
      if (profitTarget !== null && !targetHit && settledAssessed >= profitTarget) {
        targetHit = true;
      }
    }
    lastCloseEquity = settledAssessed;
    equityCurve.push(settled.equity);
  }

  const lastBar = input.series[cursor];
  if (lastBar === undefined) {
    throw new Error("cursor is empty");
  }
  const mark = lastBar.close;
  const marked = equityAt(mark);
  const pos = position as WorkingPosition | null;
  const maxDrawdownFloor = maxFloor();
  const dailyLossFloor = dailyFloor();

  return {
    barIndex: cursor,
    timeMs: lastBar.timeMs,
    mark,
    cash,
    equity: marked.equity,
    available: cash,
    unrealizedPnl: marked.upnl,
    maintenance: pos === null ? 0 : maintenanceMargin(pos.initialMargin),
    positionEquity: pos === null ? null : pos.isolatedMargin + marked.upnl,
    position:
      pos === null
        ? null
        : {
            market: pos.market,
            side: pos.side,
            qty: pos.qty,
            entry: pos.entry,
            leverage: pos.leverage,
            initialMargin: pos.initialMargin,
            isolatedMargin: pos.isolatedMargin,
            liqPrice: pos.liqPrice,
            stopLoss: pos.stopLoss,
            takeProfit: pos.takeProfit,
            openedAtMs: pos.openedAtMs,
            openedAtBar: pos.openedAtBar,
          },
    liqPrice: pos?.liqPrice ?? null,
    liqDistance: pos === null ? null : liqDistance(mark, pos.liqPrice),
    failPrice: floorPrice(maxDrawdownFloor),
    dailyFailPrice: floorPrice(dailyLossFloor),
    maxDrawdownFloor,
    dailyLossFloor,
    profitTarget,
    phase: phaseOf({ liquidated, propBreach, targetHit }),
    propBreach,
    targetHit,
    liquidated,
    feesPaid,
    carryPaid,
    fills,
    rejects,
    equityCurve,
  };
}
