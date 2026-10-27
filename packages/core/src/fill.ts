import {
  DEFAULT_REALIZED_IMPACT_BPS,
  DEFAULT_SLIP_TOLERANCE_BPS,
  MAX_REALIZED_IMPACT_BPS,
  MAX_SLIP_TOLERANCE_BPS,
  MIN_SLIP_TOLERANCE_BPS,
  TEACHING_MAX_LEVERAGE,
  TEACHING_MIN_LEVERAGE,
} from "./constants.ts";
import { isBuyingPowerPct } from "./types.ts";
import {
  estimatedLiqPrice,
  initialMargin,
  liqDistance,
  maintenanceMargin,
  sideSign,
  type Side,
} from "./liq.ts";

export type RejectReason =
  | "impact-over-tolerance"
  | "tolerance-out-of-range"
  | "invalid-impact"
  | "invalid-leverage"
  | "invalid-power"
  | "insufficient-cash"
  | "position-open"
  | "account-frozen"
  | "flat"
  | "market-not-allowed"
  | "invalid-bracket"
  | "invalid-price";

export type SlipSettings = {
  readonly slipToleranceBps: number;
  readonly realizedImpactBps: number;
};

export type OpenQuoteInput = SlipSettings & {
  readonly side: Side;
  readonly leverage: number;
  readonly powerPct: number;
  readonly cash: number;
  readonly mark: number;
  readonly takerBps: number;
};

export type OpenQuote =
  | {
      readonly ok: true;
      readonly fillPrice: number;
      readonly qty: number;
      readonly notional: number;
      readonly fee: number;
      readonly initialMargin: number;
      readonly maintenance: number;
      readonly liqPrice: number;
      readonly liqDistance: number | null;
    }
  | { readonly ok: false; readonly reason: RejectReason };

export function fillPriceFromMark(mark: number, side: Side, realizedImpactBps: number): number {
  const impact = realizedImpactBps / 10_000;
  switch (side) {
    case "long":
      return mark * (1 + impact);
    case "short":
      return mark * (1 - impact);
    default: {
      const unexpected: never = side;
      throw new Error(`unexpected side ${String(unexpected)}`);
    }
  }
}

export function closePriceFromMark(mark: number, side: Side, realizedImpactBps: number): number {
  const impact = realizedImpactBps / 10_000;
  switch (side) {
    case "long":
      return mark * (1 - impact);
    case "short":
      return mark * (1 + impact);
    default: {
      const unexpected: never = side;
      throw new Error(`unexpected side ${String(unexpected)}`);
    }
  }
}

export function gateSlippage(settings: SlipSettings): RejectReason | null {
  const { slipToleranceBps, realizedImpactBps } = settings;
  if (
    !Number.isInteger(slipToleranceBps) ||
    slipToleranceBps < MIN_SLIP_TOLERANCE_BPS ||
    slipToleranceBps > MAX_SLIP_TOLERANCE_BPS
  ) {
    return "tolerance-out-of-range";
  }
  if (
    !Number.isInteger(realizedImpactBps) ||
    realizedImpactBps < 0 ||
    realizedImpactBps > MAX_REALIZED_IMPACT_BPS
  ) {
    return "invalid-impact";
  }
  if (realizedImpactBps > slipToleranceBps) {
    return "impact-over-tolerance";
  }
  return null;
}

export function quoteOpen(input: OpenQuoteInput): OpenQuote {
  const slip = gateSlippage(input);
  if (slip !== null) {
    return { ok: false, reason: slip };
  }
  if (
    !Number.isInteger(input.leverage) ||
    input.leverage < TEACHING_MIN_LEVERAGE ||
    input.leverage > TEACHING_MAX_LEVERAGE
  ) {
    return { ok: false, reason: "invalid-leverage" };
  }
  if (!isBuyingPowerPct(input.powerPct)) {
    return { ok: false, reason: "invalid-power" };
  }
  if (!Number.isFinite(input.mark) || input.mark <= 0 || !Number.isFinite(input.cash)) {
    return { ok: false, reason: "insufficient-cash" };
  }
  if (!Number.isFinite(input.takerBps) || input.takerBps < 0) {
    return { ok: false, reason: "insufficient-cash" };
  }

  const fillPrice = fillPriceFromMark(input.mark, input.side, input.realizedImpactBps);
  const spend = input.cash * (input.powerPct / 100);
  const feeRate = input.takerBps / 10_000;
  const denominator = 1 / input.leverage + feeRate;
  if (spend <= 0 || denominator <= 0 || !Number.isFinite(fillPrice) || fillPrice <= 0) {
    return { ok: false, reason: "insufficient-cash" };
  }
  const notional = spend / denominator;
  const qty = notional / fillPrice;
  const fee = notional * feeRate;
  const margin = initialMargin(notional, input.leverage);
  if (qty <= 0 || margin + fee > input.cash + 1e-8) {
    return { ok: false, reason: "insufficient-cash" };
  }
  const maintenance = maintenanceMargin(margin);
  const liqPrice = estimatedLiqPrice(fillPrice, input.leverage, input.side);
  return {
    ok: true,
    fillPrice,
    qty,
    notional,
    fee,
    initialMargin: margin,
    maintenance,
    liqPrice,
    liqDistance: liqDistance(input.mark, liqPrice),
  };
}

export type CloseQuote =
  | {
      readonly ok: true;
      readonly fillPrice: number;
      readonly fee: number;
      readonly pricePnl: number;
    }
  | { readonly ok: false; readonly reason: RejectReason };

export function quoteClose(input: {
  side: Side;
  qty: number;
  entry: number;
  mark: number;
  takerBps: number;
  slipToleranceBps: number;
  realizedImpactBps: number;
}): CloseQuote {
  const slip = gateSlippage(input);
  if (slip !== null) {
    return { ok: false, reason: slip };
  }
  const fillPrice = closePriceFromMark(input.mark, input.side, input.realizedImpactBps);
  const notional = input.qty * fillPrice;
  const fee = notional * (input.takerBps / 10_000);
  const pricePnl = sideSign(input.side) * input.qty * (fillPrice - input.entry);
  if (!Number.isFinite(fee) || !Number.isFinite(pricePnl)) {
    return { ok: false, reason: "insufficient-cash" };
  }
  return { ok: true, fillPrice, fee, pricePnl };
}

export const MAJOR_SLIP_DEFAULTS = {
  slipToleranceBps: DEFAULT_SLIP_TOLERANCE_BPS,
  realizedImpactBps: DEFAULT_REALIZED_IMPACT_BPS,
} as const;
