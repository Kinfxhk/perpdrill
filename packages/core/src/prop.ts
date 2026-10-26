import type { Side } from "./liq.ts";

export type DailyReset = {
  readonly timeZone: string;
  readonly hour: number;
  readonly minute: number;
};

export type PropBreach = "max-dd" | "daily";

export function staticFloor(startingBalance: number, limitPct: number): number {
  return startingBalance * (1 - limitPct / 100);
}

/**
 * Dollar loss that breaches max drawdown. A USD amount wins over the percent.
 */
export function resolvedMaxDrawdownUsd(
  startingBalance: number,
  maxDrawdownUsd: number | null,
  maxDrawdownPct: number,
): number {
  return maxDrawdownUsd ?? startingBalance * (maxDrawdownPct / 100);
}

/** Static, non-trailing equity floor: starting balance minus the USD max drawdown. */
export function staticFloorUsd(startingBalance: number, maxDrawdownUsd: number): number {
  return startingBalance - maxDrawdownUsd;
}

export function profitTargetEquity(startingBalance: number, targetPct: number): number {
  return startingBalance * (1 + targetPct / 100);
}

/**
 * Equity level mapped back to a mark. This is a prop floor, not a liquidation price.
 */
export function priceForEquityFloor(input: {
  readonly floor: number;
  readonly cash: number;
  readonly isolatedMargin: number;
  readonly qty: number;
  readonly entry: number;
  readonly side: Side;
}): number | null {
  const signed = input.side === "long" ? input.qty : -input.qty;
  if (signed === 0 || !Number.isFinite(signed)) {
    return null;
  }
  const mark = input.entry + (input.floor - input.cash - input.isolatedMargin) / signed;
  return Number.isFinite(mark) ? mark : null;
}

export function propEquity(equity: number, unrealized: number, includeUnrealized: boolean): number {
  return includeUnrealized ? equity : equity - unrealized;
}

type ZonedParts = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
};

function zonedParts(timeMs: number, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(new Date(timeMs));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value;
    return Number(value);
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
  };
}

function previousCalendarDay(year: number, month: number, day: number): ZonedParts {
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() - 1);
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
    hour: 0,
    minute: 0,
  };
}

function dateKey(year: number, month: number, day: number): string {
  const monthText = String(month).padStart(2, "0");
  const dayText = String(day).padStart(2, "0");
  return `${year}-${monthText}-${dayText}`;
}

/** Logical session day for a clock reset in a timezone. */
export function logicalDayKey(timeMs: number, reset: DailyReset): string {
  const parts = zonedParts(timeMs, reset.timeZone);
  const minutes = parts.hour * 60 + parts.minute;
  const cutoff = reset.hour * 60 + reset.minute;
  if (minutes < cutoff) {
    const previous = previousCalendarDay(parts.year, parts.month, parts.day);
    return dateKey(previous.year, previous.month, previous.day);
  }
  return dateKey(parts.year, parts.month, parts.day);
}
