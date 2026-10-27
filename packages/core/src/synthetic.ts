import type { MarketId } from "./constants.ts";
import type { Bar } from "./series.ts";

/**
 * Seeded synthetic bars. Volatility clusters, trends drift and rare jumps
 * make the path look like a 24/7 market. It is not a model of any real venue
 * and it does not read a live feed. SYNTH-NQ and SYNTH-GC keep the two anchors
 * this desk already generated. All profiles are fictional teaching parameters,
 * not calibrated exchange history or contract specifications.
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
  /** Stress mode: triple volatility and far more frequent jumps. */
  readonly stress?: boolean;
};

const MARKET_PROFILE: Record<MarketId, { price: number; tick: number; annualVol: number }> = {
  "SYNTH-NQ": { price: 65_000, tick: 0.1, annualVol: 0.6 },
  "SYNTH-GC": { price: 3_200, tick: 0.01, annualVol: 0.75 },
  "SYNTH-ES": { price: 5_000, tick: 0.25, annualVol: 0.2 },
  "SYNTH-BTC": { price: 60_000, tick: 0.1, annualVol: 0.65 },
};

const START_MS = Date.parse("2026-01-05T00:00:00.000Z");

export function isSyntheticTimeframe(value: number): value is SyntheticTimeframe {
  return (SYNTHETIC_TIMEFRAMES_MIN as readonly number[]).includes(value);
}

/** Mulberry32. Not cryptographic; only for repeatable practice data. */
export function createRng(seed: number): { next: () => number; normal: () => number } {
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
  const stress = spec.stress === true;
  const sigma =
    profile.annualVol * Math.sqrt(spec.timeframeMin / (365 * 24 * 60)) * (stress ? 3 : 1);
  const longRun = sigma * sigma;
  let variance = longRun;
  let lastReturn = 0;
  let drift = 0;
  let close = roundTick(profile.price * (0.8 + rng.next() * 0.4), profile.tick);
  // Separate stream: adding a bar field must not shift the price path.
  const volumeRng = createRng(spec.seed ^ 0x27d4eb2f);
  const bars: Bar[] = [];
  for (let index = 0; index < spec.bars; index += 1) {
    // GARCH(1,1)-style clustering; weights sum to 1 so the long-run vol holds.
    variance = 0.05 * longRun + 0.85 * variance + 0.1 * lastReturn * lastReturn;
    if (rng.next() < (stress ? 0.06 : 0.02)) {
      drift = (rng.next() - 0.5) * 0.3 * sigma;
    }
    const vol = Math.sqrt(variance);
    let move = drift + vol * rng.normal();
    if (rng.next() < (stress ? 0.015 : 0.003)) {
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
    const barHigh = Math.max(high, open, next);
    const barLow = Math.min(low, open, next);
    // Fictional size, wider when the bar travelled further. Not exchange volume.
    const span = next > 0 ? (barHigh - barLow) / next : 0;
    const volume = Math.max(
      1,
      Math.round(2_000 * Math.sqrt(spec.timeframeMin) * (0.5 + volumeRng.next()) * (1 + span * 40)),
    );
    bars.push({
      timeMs: START_MS + index * barMs,
      open,
      high: barHigh,
      low: barLow,
      close: next,
      volume,
    });
    close = next;
  }
  return bars;
}

/**
 * Synthetic funding sequence. The value sits only on the last bar of each
 * settlement window and is the signed per-window total (long pays short when
 * positive), scaled around the preset mean with occasional sign flips.
 */
export function syntheticFunding(input: {
  readonly seed: number;
  readonly bars: number;
  readonly timeframeMin: SyntheticTimeframe;
  readonly meanPerHour: number;
  readonly intervalHours: number;
}): readonly (number | null)[] {
  const rng = createRng(input.seed ^ 0x9e3779b9);
  const barMs = input.timeframeMin * 60_000;
  const barsPerWindow = Math.max(1, Math.round((input.intervalHours * 3_600_000) / barMs));
  const rates: (number | null)[] = Array.from({ length: input.bars }, () => null);
  for (let windowStart = 0; windowStart < input.bars; windowStart += barsPerWindow) {
    const settle = windowStart + barsPerWindow - 1;
    if (settle >= input.bars) {
      break;
    }
    const flip = rng.next() < 0.12 ? -1 : 1;
    const noise = 0.55 + 0.9 * rng.next();
    rates[settle] = input.meanPerHour * input.intervalHours * noise * flip;
  }
  return rates;
}

/** Synthetic index and mark. Index is a smoothed close; mark adds a small,
    persistent basis, so marks can diverge from the last price on wicks. */
export function syntheticMarks(input: {
  readonly seed: number;
  readonly closes: readonly number[];
}): { readonly index: readonly number[]; readonly mark: readonly number[] } {
  const rng = createRng(input.seed ^ 0x85ebca6b);
  const index: number[] = [];
  const mark: number[] = [];
  let smooth: number | null = null;
  let basis = 0;
  for (const close of input.closes) {
    smooth = smooth === null ? close : smooth * 0.95 + close * 0.05;
    basis = basis * 0.8 + (rng.next() - 0.5) * 0.0004;
    const basisBps = Math.max(-0.003, Math.min(0.003, basis));
    index.push(Number(smooth.toFixed(6)));
    mark.push(Number((smooth * (1 + basisBps)).toFixed(6)));
  }
  return { index, mark };
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}
