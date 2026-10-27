/** Product practice default. Not a firm starting balance. */
export const PRACTICE_STARTING_BALANCE_USD = 2_500;

/** Teaching desk cap. Not a firm leverage limit. */
export const TEACHING_MIN_LEVERAGE = 1;
export const TEACHING_MAX_LEVERAGE = 50;

/** Majors max-slip gate. The 5% venue IOC cap is not this default. */
export const DEFAULT_SLIP_TOLERANCE_BPS = 75;
export const MIN_SLIP_TOLERANCE_BPS = 50;
export const MAX_SLIP_TOLERANCE_BPS = 100;

/** Simulated fill impact for majors. Independent of the tolerance gate. */
export const DEFAULT_REALIZED_IMPACT_BPS = 25;
export const MAX_REALIZED_IMPACT_BPS = 1_000;

export const MAINTENANCE_OF_INITIAL = 0.5;

/** Practice ids shown in the desk. Not exchange tickers. */
export const SAMPLE_MARKETS = ["SYNTH-NQ", "SYNTH-GC", "SYNTH-ES", "SYNTH-BTC"] as const;

export type MarketId = (typeof SAMPLE_MARKETS)[number];

export const SAMPLE_BAR_MS = 3_600_000;

export function isMarketId(value: string): value is MarketId {
  return (SAMPLE_MARKETS as readonly string[]).includes(value);
}
