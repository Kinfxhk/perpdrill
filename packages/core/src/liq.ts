import { MAINTENANCE_OF_INITIAL } from "./constants.ts";

export type Side = "long" | "short";

export function sideSign(side: Side): 1 | -1 {
  switch (side) {
    case "long":
      return 1;
    case "short":
      return -1;
    default: {
      const unexpected: never = side;
      throw new Error(`unexpected side ${String(unexpected)}`);
    }
  }
}

export function initialMargin(notional: number, leverage: number): number {
  return notional / leverage;
}

export function maintenanceMargin(initial: number): number {
  return initial * MAINTENANCE_OF_INITIAL;
}

/**
 * Isolated teaching estimate when the position margin is the initial margin
 * and there is no extra wallet buffer.
 * long ≈ entry × (1 − 0.5 / leverage)
 * short ≈ entry × (1 + 0.5 / leverage)
 */
export function estimatedLiqPrice(entry: number, leverage: number, side: Side): number {
  switch (side) {
    case "long":
      return entry * (1 - MAINTENANCE_OF_INITIAL / leverage);
    case "short":
      return entry * (1 + MAINTENANCE_OF_INITIAL / leverage);
    default: {
      const unexpected: never = side;
      throw new Error(`unexpected side ${String(unexpected)}`);
    }
  }
}

export function liqDistance(mark: number, liqPrice: number): number | null {
  if (!Number.isFinite(mark) || mark <= 0 || !Number.isFinite(liqPrice)) {
    return null;
  }
  return Math.abs(mark - liqPrice) / mark;
}

export function unrealizedPnl(side: Side, qty: number, entry: number, mark: number): number {
  return sideSign(side) * qty * (mark - entry);
}

/** True when isolated equity is at or under maintenance. Mark is the price input. */
export function isolatedShouldLiquidate(
  isolatedMargin: number,
  upnl: number,
  maintenance: number,
): boolean {
  return isolatedMargin + upnl <= maintenance;
}
