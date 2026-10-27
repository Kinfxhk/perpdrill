import { PRACTICE_STARTING_BALANCE_USD, SAMPLE_BAR_MS, type MarketId } from "./constants.ts";
import {
  closePriceFromMark,
  quoteClose,
  quoteOpen,
  type RejectReason,
  type SlipSettings,
} from "./fill.ts";
import { liqDistance, maintenanceMargin, sideSign, unrealizedPnl, type Side } from "./liq.ts";
import { includeUnrealized, leverageCap, resolvedTakerBps, type PracticePreset } from "./preset.ts";
import {
  logicalDayKey,
  priceForEquityFloor,
  profitTargetEquity,
  propEquity,
  resolvedMaxDrawdownUsd,
  staticFloorUsd,
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
  | (SlipSettings &
      Bracket & {
        readonly kind: "limit";
        readonly barIndex: number;
        readonly side: Side;
        readonly leverage: number;
        readonly powerPct: BuyingPowerPct;
        readonly price: number;
      })
  | (SlipSettings &
      Bracket & {
        readonly kind: "stop";
        readonly barIndex: number;
        readonly side: Side;
        readonly leverage: number;
        readonly powerPct: BuyingPowerPct;
        readonly price: number;
      })
  | (SlipSettings & {
      readonly kind: "close";
      readonly barIndex: number;
      /** Fraction of the position to close; absent closes all of it. */
      readonly powerPct?: BuyingPowerPct;
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

export type FillKind =
  "open" | "close" | "stop" | "take-profit" | "breach" | "liquidation" | "limit" | "stop-entry";

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

/** A working limit/stop order the engine still holds at the cursor. */
export type PendingOrderInfo = {
  readonly kind: "limit" | "stop";
  readonly side: Side;
  readonly price: number;
  readonly leverage: number;
  readonly powerPct: BuyingPowerPct;
  readonly placedAtBar: number;
};

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
  /** Cumulative funding, signed: positive is paid, negative is received. */
  readonly fundingPaid: number;
  /** The window's funding total when the cursor sits on a settlement bar. */
  readonly fundingSettlement: number | null;
  readonly indexPrice: number | null;
  readonly fills: readonly FillEvent[];
  readonly rejects: readonly RejectEvent[];
  /** Working limit/stop orders, oldest first. */
  readonly pendingOrders: readonly PendingOrderInfo[];
  /** Equity at each bar close from bar 0 to the cursor. */
  readonly equityCurve: readonly number[];
};

export type MarginMode = "isolated" | "cross";

export type SessionInput = {
  readonly market: MarketId;
  readonly series: readonly Bar[];
  readonly preset: PracticePreset | null;
  readonly actions: readonly SessionAction[];
  readonly cursor: number;
  /** Cross margin counts the free cash toward the liquidation cushion. */
  readonly marginMode?: MarginMode;
  /** Per-window funding totals at their settlement bars (null elsewhere). */
  readonly funding?: readonly (number | null)[];
  /** Mark prices per bar; falls back to the bar close when absent. */
  readonly marks?: readonly number[];
  /** Index prices per bar; null in the frame when absent. */
  readonly index?: readonly number[];
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

/** A limit/stop order waiting for its price. Single-position desk: any market
    open cancels all of them; cancelling an order removes its action. */
type WorkingOrder = {
  kind: "limit" | "stop";
  side: Side;
  price: number;
  leverage: number;
  powerPct: BuyingPowerPct;
  slipToleranceBps: number;
  realizedImpactBps: number;
  stopLoss: number | null;
  takeProfit: number | null;
  placedAtBar: number;
};

function swapCost(preset: PracticePreset | null, notional: number, hours: number): number {
  if (preset === null || hours <= 0 || notional <= 0) {
    return 0;
  }
  if (preset.costModel !== "swap") {
    return 0;
  }
  const rate = preset.swapDailyRatePct;
  if (rate === null) {
    return 0;
  }
  return notional * (rate / 100) * (hours / 24);
}

/**
 * Funding settles at the window's last bar from the synthetic sequence.
 * Positive rate: longs pay shorts. Without a sequence the preset's flat
 * hourly stub keeps the original continuous behaviour.
 */
function fundingCost(
  preset: PracticePreset | null,
  notional: number,
  hours: number,
  side: Side,
  rate: number | null,
): number {
  if (preset === null || preset.costModel !== "funding" || !preset.venueFundingChangesBalance) {
    return 0;
  }
  if (rate !== null) {
    return sideSign(side) * notional * rate;
  }
  if (preset.fundingRatePerHour === null) {
    return 0;
  }
  return sideSign(side) * notional * preset.fundingRatePerHour * hours;
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

/** Mark where the position equity equals maintenance. Cross margin counts
    the free cash toward the cushion; isolated counts only the position. */
function actualLiqPrice(position: WorkingPosition, marginMode: MarginMode, cash: number): number {
  const cushion =
    marginMode === "cross"
      ? cash + position.isolatedMargin - maintenanceMargin(position.initialMargin)
      : position.isolatedMargin - maintenanceMargin(position.initialMargin);
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
  const marginMode: MarginMode = input.marginMode ?? "isolated";
  const starting = input.preset?.startingBalanceUsd ?? PRACTICE_STARTING_BALANCE_USD;
  const takerBps = resolvedTakerBps(input.preset);
  const useUPnL = includeUnrealized(input.preset);
  const drawdownAmount =
    input.preset === null
      ? null
      : resolvedMaxDrawdownUsd(starting, input.preset.maxDrawdownUsd, input.preset.maxDrawdownPct);
  const trailing = input.preset?.drawdownMode === "trailing";
  const profitTarget =
    input.preset === null || input.preset.profitTargetPct === null
      ? null
      : profitTargetEquity(starting, input.preset.profitTargetPct);
  const realizedDailyBase = input.preset?.dailyBase === "realized";
  const dailyPct = input.preset?.dailyLossLimitPct ?? null;

  let cash = starting;
  let position: WorkingPosition | null = null;
  let feesPaid = 0;
  let carryPaid = 0;
  let fundingPaid = 0;
  let liquidated = false;
  let propBreach: PropBreach | null = null;
  let targetHit = false;
  let dayKey: string | null = null;
  let dayStart = starting;
  let peak = starting;
  let lastCloseEquity = starting;
  let pending: WorkingOrder[] = [];
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
        : staticFloorUsd(starting, drawdownAmount);
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
    exitPart(index, bar, kind, price, 1);
  };

  /** Close a fraction of the position; the margin and PnL scale with it. */
  const exitPart = (
    index: number,
    bar: Bar,
    kind: FillKind,
    price: number,
    fraction: number,
  ): void => {
    if (position === null || fraction <= 0) {
      return;
    }
    const whole = fraction >= 1 - 1e-9;
    const qty = whole ? position.qty : position.qty * fraction;
    const rawPnl = unrealizedPnl(position.side, qty, position.entry, price);
    // Isolated: no exit (gap, slipped stop) can lose more than the position margin.
    const marginShare = whole ? position.isolatedMargin : position.isolatedMargin * fraction;
    const pricePnl = Math.max(rawPnl, -marginShare);
    const fee =
      kind === "liquidation"
        ? 0
        : Math.min(qty * price * (takerBps / 10_000), marginShare + pricePnl);
    const back = Math.max(0, marginShare + pricePnl - fee);
    cash += back;
    feesPaid += fee;
    fills.push({
      barIndex: index,
      timeMs: bar.timeMs,
      market: position.market,
      side: position.side,
      kind,
      price,
      qty,
      fee,
      pricePnl,
    });
    if (whole) {
      position = null;
    } else {
      position.qty -= qty;
      position.initialMargin *= 1 - fraction;
      position.isolatedMargin -= marginShare;
      position.liqPrice = actualLiqPrice(position, marginMode, cash);
    }
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
      const notional = position.qty * previous.close;
      const swap = swapCost(input.preset, notional, hours);
      const funding =
        input.preset?.costModel === "funding"
          ? fundingCost(
              input.preset,
              notional,
              hours,
              position.side,
              input.funding?.[index] ?? null,
            )
          : 0;
      const cost = swap + funding;
      if (cost > 0) {
        const fromCash = Math.max(0, Math.min(cash, cost));
        cash -= fromCash;
        position.isolatedMargin -= cost - fromCash;
        carryPaid += cost;
        fundingPaid += funding;
      } else if (cost < 0) {
        cash += -cost;
        carryPaid += cost;
        fundingPaid += funding;
      }
      position.liqPrice = actualLiqPrice(position, marginMode, cash);
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

    // Working limit/stop orders trigger intrabar while the desk is flat.
    if (position === null && !liquidated && propBreach === null && pending.length > 0) {
      for (const order of pending) {
        const long = order.side === "long";
        let fill: { price: number; impactBps: number } | null = null;
        if (order.kind === "limit") {
          if (long ? bar.low <= order.price : bar.high >= order.price) {
            fill = { price: order.price, impactBps: 0 };
          }
        } else if (long ? bar.high >= order.price : bar.low <= order.price) {
          // A gap through the trigger fills at the open, like the bracket stop.
          const level = long ? Math.max(order.price, bar.open) : Math.min(order.price, bar.open);
          fill = { price: level, impactBps: order.realizedImpactBps };
        }
        if (fill === null) {
          continue;
        }
        const quote = quoteOpen({
          side: order.side,
          leverage: order.leverage,
          powerPct: order.powerPct,
          cash,
          mark: fill.price,
          takerBps,
          slipToleranceBps: order.slipToleranceBps,
          realizedImpactBps: fill.impactBps,
        });
        if (!quote.ok) {
          continue;
        }
        cash -= quote.initialMargin + quote.fee;
        feesPaid += quote.fee;
        position = {
          market: input.market,
          side: order.side,
          qty: quote.qty,
          entry: quote.fillPrice,
          leverage: order.leverage,
          initialMargin: quote.initialMargin,
          isolatedMargin: quote.initialMargin,
          liqPrice: quote.liqPrice,
          stopLoss: order.stopLoss,
          takeProfit: order.takeProfit,
          impactBps: order.realizedImpactBps,
          openedAtMs: bar.timeMs,
          openedAtBar: index,
        };
        fills.push({
          barIndex: index,
          timeMs: bar.timeMs,
          market: input.market,
          side: order.side,
          kind: order.kind === "limit" ? "limit" : "stop-entry",
          price: quote.fillPrice,
          qty: quote.qty,
          fee: quote.fee,
          pricePnl: 0,
        });
        pending = pending.filter((item) => item !== order);
        break;
      }
    }

    const frozen = liquidated || propBreach !== null;
    const price = bar.close;
    const mark = input.marks?.[index] ?? price;
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
          const allowed = input.preset?.markets;
          if (allowed !== null && allowed !== undefined && !allowed.includes(input.market)) {
            rejects.push({ barIndex: index, reason: "market-not-allowed" });
            continue;
          }
          if (action.leverage > leverageCap(input.preset, input.market)) {
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
          // A market entry against the held side reverses: flat first, then open.
          if (position !== null && position.side !== action.side) {
            const close = quoteClose({
              side: position.side,
              qty: position.qty,
              entry: position.entry,
              mark: price,
              takerBps,
              slipToleranceBps: action.slipToleranceBps,
              realizedImpactBps: action.realizedImpactBps,
            });
            if (!close.ok) {
              rejects.push({ barIndex: index, reason: close.reason });
              continue;
            }
            exit(index, bar, "close", close.fillPrice);
          }
          cash -= quote.initialMargin + quote.fee;
          feesPaid += quote.fee;
          if (position !== null && position.side === action.side) {
            // Same side adds: average entry and stack the margin.
            const totalQty = position.qty + quote.qty;
            position.entry =
              (position.qty * position.entry + quote.qty * quote.fillPrice) / totalQty;
            position.qty = totalQty;
            position.initialMargin += quote.initialMargin;
            position.isolatedMargin += quote.initialMargin;
            position.leverage = action.leverage;
            position.impactBps = action.realizedImpactBps;
            position.liqPrice = actualLiqPrice(position, marginMode, cash);
          } else {
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
          }
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
          // A market entry cancels working orders.
          pending = [];
          break;
        }
        case "limit":
        case "stop": {
          const kind = action.kind;
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
          if (action.leverage > leverageCap(input.preset, input.market)) {
            rejects.push({ barIndex: index, reason: "invalid-leverage" });
            continue;
          }
          if (!Number.isFinite(action.price) || action.price <= 0) {
            rejects.push({ barIndex: index, reason: "invalid-price" });
            continue;
          }
          if (!bracketValid(action.side, action.price, action)) {
            rejects.push({ barIndex: index, reason: "invalid-bracket" });
            continue;
          }
          pending.push({
            kind,
            side: action.side,
            price: action.price,
            leverage: action.leverage,
            powerPct: action.powerPct,
            slipToleranceBps: action.slipToleranceBps,
            realizedImpactBps: action.realizedImpactBps,
            stopLoss: action.stopLoss ?? null,
            takeProfit: action.takeProfit ?? null,
            placedAtBar: index,
          });
          break;
        }
        case "close": {
          if (position === null) {
            rejects.push({ barIndex: index, reason: "flat" });
            continue;
          }
          const fraction = (action.powerPct ?? 100) / 100;
          if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
            rejects.push({ barIndex: index, reason: "invalid-power" });
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
          exitPart(index, bar, "close", quote.fillPrice, fraction);
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
      const closed = equityAt(mark);
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
    const settled = equityAt(mark);
    const settledAssessed = propEquity(settled.equity, settled.upnl, useUPnL);
    if (propBreach === null && !liquidated) {
      peak = Math.max(peak, settledAssessed);
      if (profitTarget !== null && !targetHit && settledAssessed >= profitTarget) {
        targetHit = true;
      }
    }
    // Realized base: balance plus reserved margin, without unrealized PnL.
    lastCloseEquity = realizedDailyBase
      ? cash + ((position as WorkingPosition | null)?.isolatedMargin ?? 0)
      : settledAssessed;
    equityCurve.push(settled.equity);
  }

  const lastBar = input.series[cursor];
  if (lastBar === undefined) {
    throw new Error("cursor is empty");
  }
  const mark = input.marks?.[cursor] ?? lastBar.close;
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
    fundingPaid,
    fundingSettlement: input.funding?.[cursor] ?? null,
    indexPrice: input.index?.[cursor] ?? null,
    fills,
    rejects,
    pendingOrders:
      liquidated || propBreach !== null
        ? []
        : pending.map((order) => ({
            kind: order.kind,
            side: order.side,
            price: order.price,
            leverage: order.leverage,
            powerPct: order.powerPct,
            placedAtBar: order.placedAtBar,
          })),
    equityCurve,
  };
}
