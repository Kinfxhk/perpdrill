import { PRACTICE_STARTING_BALANCE_USD, SAMPLE_BAR_MS, type MarketId } from "./constants.ts";
import { quoteClose, quoteOpen, type RejectReason, type SlipSettings } from "./fill.ts";
import {
  isolatedShouldLiquidate,
  liqDistance,
  maintenanceMargin,
  unrealizedPnl,
  type Side,
} from "./liq.ts";
import { includeUnrealized, resolvedTakerBps, type PracticePreset } from "./preset.ts";
import {
  logicalDayKey,
  priceForEquityFloor,
  profitTargetEquity,
  propEquity,
  staticFloor,
  type PropBreach,
} from "./prop.ts";
import { markPrice, type Bar } from "./series.ts";
import type { BuyingPowerPct } from "./types.ts";

export type SessionAction =
  | (SlipSettings & {
      readonly kind: "open";
      readonly barIndex: number;
      readonly side: Side;
      readonly leverage: number;
      readonly powerPct: BuyingPowerPct;
    })
  | (SlipSettings & {
      readonly kind: "close";
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
  readonly openedAtMs: number;
};

export type FillKind = "open" | "close" | "liquidation";

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
  openedAtMs: number;
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

export function replaySession(input: SessionInput): Frame {
  if (input.series.length === 0) {
    throw new Error("series is empty");
  }
  const cursor = Math.min(Math.max(input.cursor, 0), input.series.length - 1);
  const starting = input.preset?.startingBalanceUsd ?? PRACTICE_STARTING_BALANCE_USD;
  const takerBps = resolvedTakerBps(input.preset);
  const useUPnL = includeUnrealized(input.preset);
  const maxDrawdownFloor =
    input.preset === null ? null : staticFloor(starting, input.preset.maxDrawdownPct);
  const profitTarget =
    input.preset === null ? null : profitTargetEquity(starting, input.preset.profitTargetPct);

  let cash = starting;
  let position: WorkingPosition | null = null;
  let feesPaid = 0;
  let carryPaid = 0;
  let liquidated = false;
  let propBreach: PropBreach | null = null;
  let targetHit = false;
  let dayKey: string | null = null;
  let dayStart = starting;
  const fills: FillEvent[] = [];
  const rejects: RejectEvent[] = [];

  const equityNow = (
    mark: number,
  ): { equity: number; upnl: number; positionEquity: number | null } => {
    if (position === null) {
      return { equity: cash, upnl: 0, positionEquity: null };
    }
    const upnl = unrealizedPnl(position.side, position.qty, position.entry, mark);
    const positionEquity = position.isolatedMargin + upnl;
    return { equity: cash + positionEquity, upnl, positionEquity };
  };

  const pushReject = (barIndex: number, reason: RejectReason): void => {
    rejects.push({ barIndex, reason });
  };

  for (let index = 0; index <= cursor; index += 1) {
    const bar = input.series[index];
    if (bar === undefined) {
      break;
    }
    const mark = markPrice(bar);
    const previous = index === 0 ? undefined : input.series[index - 1];

    if (position !== null && previous !== undefined) {
      const hours = (bar.timeMs - previous.timeMs) / SAMPLE_BAR_MS;
      const cost = carryCost(input.preset, position.qty * mark, hours);
      if (cost > 0) {
        const fromCash = Math.min(cash, cost);
        cash -= fromCash;
        const rest = cost - fromCash;
        if (rest > 0) {
          position.isolatedMargin -= rest;
        }
        carryPaid += cost;
      }
    }

    if (position !== null) {
      const marked = equityNow(mark);
      const maintenance = maintenanceMargin(position.initialMargin);
      if (
        marked.positionEquity !== null &&
        isolatedShouldLiquidate(position.isolatedMargin, marked.upnl, maintenance)
      ) {
        const residual = Math.max(0, marked.positionEquity);
        const pricePnl = marked.upnl;
        fills.push({
          barIndex: index,
          timeMs: bar.timeMs,
          market: position.market,
          side: position.side,
          kind: "liquidation",
          price: mark,
          qty: position.qty,
          fee: 0,
          pricePnl,
        });
        cash += residual;
        position = null;
        liquidated = true;
      }
    }

    if (input.preset?.dailyReset !== undefined && input.preset.dailyReset !== null) {
      const key = logicalDayKey(bar.timeMs, input.preset.dailyReset);
      if (key !== dayKey) {
        if (dayKey !== null) {
          dayStart = equityNow(mark).equity;
        }
        dayKey = key;
      }
    }

    const frozen = liquidated || propBreach !== null;
    const actions = input.actions.filter((action) => action.barIndex === index);
    for (const action of actions) {
      if (action.kind === "open") {
        if (frozen) {
          pushReject(index, "account-frozen");
          continue;
        }
        if (position !== null) {
          pushReject(index, "position-open");
          continue;
        }
        const allowed = input.preset?.markets;
        if (allowed !== null && allowed !== undefined && !allowed.includes(input.market)) {
          pushReject(index, "market-not-allowed");
          continue;
        }
        const quote = quoteOpen({
          side: action.side,
          leverage: action.leverage,
          powerPct: action.powerPct,
          cash,
          mark,
          takerBps,
          slipToleranceBps: action.slipToleranceBps,
          realizedImpactBps: action.realizedImpactBps,
        });
        if (!quote.ok) {
          pushReject(index, quote.reason);
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
          openedAtMs: bar.timeMs,
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
        continue;
      }

      if (position === null) {
        pushReject(index, "flat");
        continue;
      }
      const quote = quoteClose({
        side: position.side,
        qty: position.qty,
        entry: position.entry,
        mark,
        takerBps,
        slipToleranceBps: action.slipToleranceBps,
        realizedImpactBps: action.realizedImpactBps,
      });
      if (!quote.ok) {
        pushReject(index, quote.reason);
        continue;
      }
      cash += position.isolatedMargin + quote.pricePnl - quote.fee;
      feesPaid += quote.fee;
      fills.push({
        barIndex: index,
        timeMs: bar.timeMs,
        market: position.market,
        side: position.side,
        kind: "close",
        price: quote.fillPrice,
        qty: position.qty,
        fee: quote.fee,
        pricePnl: quote.pricePnl,
      });
      position = null;
    }

    const marked = equityNow(mark);
    const assessed = propEquity(marked.equity, marked.upnl, useUPnL);
    if (input.preset !== null && propBreach === null) {
      const dailyPct = input.preset.dailyLossLimitPct;
      if (dailyPct !== null && assessed <= dayStart * (1 - dailyPct / 100)) {
        propBreach = "daily";
      } else if (maxDrawdownFloor !== null && assessed <= maxDrawdownFloor) {
        propBreach = "max-dd";
      }
    }
    if (input.preset !== null && !targetHit && profitTarget !== null && assessed >= profitTarget) {
      targetHit = true;
    }
  }

  const lastBar = input.series[cursor];
  if (lastBar === undefined) {
    throw new Error("cursor is empty");
  }
  const mark = markPrice(lastBar);
  const marked = equityNow(mark);
  const maintenance = position === null ? 0 : maintenanceMargin(position.initialMargin);
  const dailyLossFloor =
    input.preset?.dailyLossLimitPct === undefined || input.preset.dailyLossLimitPct === null
      ? null
      : dayStart * (1 - input.preset.dailyLossLimitPct / 100);
  const failPrice =
    position === null || maxDrawdownFloor === null
      ? null
      : priceForEquityFloor({
          floor: maxDrawdownFloor,
          cash,
          isolatedMargin: position.isolatedMargin,
          qty: position.qty,
          entry: position.entry,
          side: position.side,
        });
  const dailyFailPrice =
    position === null || dailyLossFloor === null
      ? null
      : priceForEquityFloor({
          floor: dailyLossFloor,
          cash,
          isolatedMargin: position.isolatedMargin,
          qty: position.qty,
          entry: position.entry,
          side: position.side,
        });

  return {
    barIndex: cursor,
    timeMs: lastBar.timeMs,
    mark,
    cash,
    equity: marked.equity,
    available: cash,
    unrealizedPnl: marked.upnl,
    maintenance,
    positionEquity: marked.positionEquity,
    position: position === null ? null : { ...position },
    liqPrice: position?.liqPrice ?? null,
    liqDistance: position === null ? null : liqDistance(mark, position.liqPrice),
    failPrice,
    dailyFailPrice,
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
  };
}
