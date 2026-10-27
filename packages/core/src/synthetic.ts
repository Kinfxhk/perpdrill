import type { MarketId } from "./constants.ts";
import type { Bar } from "./series.ts";

/**
 * Seeded synthetic bars. Volatility clusters, trends drift and rare jumps
 * make the path look like a 24/7 market. It is not a model of any real venue
 * and it does not read a live feed. SYNTH-NQ and SYNTH-GC keep the two anchors
 * this desk already generated. SYNTH-ES is a third anchor in the same generator.
 */
/** Bar sizes the generator emits. 3m is its own series, not a relabeled 1m or 5m run. */
export const SYNTHETIC_TIMEFRAMES_MIN = [1, 3, 5, 15, 60, 240] as const;

export type SyntheticTimeframe = (typeof SYNTHETIC_TIMEFRAMES_MIN)[number];

export const MIN_SYNTHETIC_BARS = 100;
export const MAX_SYNTHETIC_BARS = 5_000;
export const DEFAULT_SYNTHETIC_BARS = 600;

export type SyntheticSpec = {
  readonly market: MarketId;
  readonly seed: number;
  readonly bars: number;
  readonly timeframeMin: SyntheticTimeframe;
};

const MARKET_PROFILE: Record<MarketId, { price: number; tick: number; annualVol: number }> = {
  "SYNTH-NQ": { price: 65_000, tick: 0.1, annualVol: 0.6 },
  "SYNTH-GC": { price: 3_200, tick: 0.01, annualVol: 0.75 },
  "SYNTH-ES": { price: 5_000, tick: 0.25, annualVol: 0.2 },
};

const START_MS = Date.parse("2026-01-05T00:00:00.000Z");

export function isSyntheticTimeframe(value: number): value is SyntheticTimeframe {
  return (SYNTHETIC_TIMEFRAMES_MIN as readonly number[]).includes(value);
}

/** Mulberry32. Not cryptographic; only for repeatable practice data. */
function createRng(seed: number): { next: () => number; normal: () => number } {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4_294_967_296;
  };
  const normal = (): number => {
    const u = Math.max(next(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };
  return { next, normal };
}

function roundTick(price: number, tick: number): number {
  return Number((Math.round(price / tick) * tick).toFixed(4));
}

export function syntheticSeries(spec: SyntheticSpec): readonly Bar[] {
  if (!Number.isInteger(spec.seed) || spec.seed < 0 || spec.seed > 0xffffffff) {
    throw new RangeError("seed must be an integer in [0, 2^32-1]");
  }
  if (
    !Number.isInteger(spec.bars) ||
    spec.bars < MIN_SYNTHETIC_BARS ||
    spec.bars > MAX_SYNTHETIC_BARS
  ) {
    throw new RangeError(`bars must be ${MIN_SYNTHETIC_BARS}–${MAX_SYNTHETIC_BARS}`);
  }
  if (!isSyntheticTimeframe(spec.timeframeMin)) {
    throw new RangeError("timeframe is not supported");
  }
  const profile = MARKET_PROFILE[spec.market];
  const rng = createRng(spec.seed);
  const barMs = spec.timeframeMin * 60_000;
  const sigma = profile.annualVol * Math.sqrt(spec.timeframeMin / (365 * 24 * 60));
  const longRun = sigma * sigma;
  let variance = longRun;
  let lastReturn = 0;
  let drift = 0;
  let close = roundTick(profile.price * (0.8 + rng.next() * 0.4), profile.tick);
  const bars: Bar[] = [];
  for (let index = 0; index < spec.bars; index += 1) {
    // GARCH(1,1)-style clustering; weights sum to 1 so the long-run vol holds.
    variance = 0.05 * longRun + 0.85 * variance + 0.1 * lastReturn * lastReturn;
    if (rng.next() < 0.02) {
      drift = (rng.next() - 0.5) * 0.3 * sigma;
    }
    const vol = Math.sqrt(variance);
    let move = drift + vol * rng.normal();
    if (rng.next() < 0.003) {
      move += (rng.next() < 0.5 ? -1 : 1) * 4 * vol;
    }
    lastReturn = move;
    const open = close;
    const next = roundTick(open * Math.exp(move), profile.tick);
    const high = roundTick(
      Math.max(open, next) * Math.exp(Math.abs(rng.normal()) * vol * 0.6),
      profile.tick,
    );
    const low = roundTick(
      Math.min(open, next) * Math.exp(-Math.abs(rng.normal()) * vol * 0.6),
      profile.tick,
    );
    bars.push({
      timeMs: START_MS + index * barMs,
      open,
      high: Math.max(high, open, next),
      low: Math.min(low, open, next),
      close: next,
    });
    close = next;
  }
  return bars;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}
