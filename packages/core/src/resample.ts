import type { Bar } from "./series.ts";

const MINUTE_MS = 60_000;

/** True when `targetMin` is an integer number of `sourceMin` bars, including the same size. */
export function timeframeSupported(sourceMin: number, targetMin: number): boolean {
  return (
    Number.isInteger(sourceMin) &&
    Number.isInteger(targetMin) &&
    sourceMin > 0 &&
    targetMin >= sourceMin &&
    targetMin % sourceMin === 0
  );
}

/** Constant bar spacing in minutes, or null when the series is not a single timeframe. */
export function seriesTimeframeMin(bars: readonly Bar[]): number | null {
  const first = bars[0];
  const second = bars[1];
  if (first === undefined || second === undefined) {
    return null;
  }
  const step = second.timeMs - first.timeMs;
  if (step <= 0 || step % MINUTE_MS !== 0) {
    return null;
  }
  for (let index = 2; index < bars.length; index += 1) {
    const previous = bars[index - 1];
    const bar = bars[index];
    if (previous === undefined || bar === undefined || bar.timeMs - previous.timeMs !== step) {
      return null;
    }
  }
  return step / MINUTE_MS;
}

/**
 * Next choice strictly coarser than `current` that `sourceMin` can build.
 * `choices` is walked in order, so pass it ascending.
 */
export function coarserTimeframe<T extends number>(
  choices: readonly T[],
  sourceMin: number,
  current: number,
): T | null {
  for (const minutes of choices) {
    if (minutes > current && timeframeSupported(sourceMin, minutes)) {
      return minutes;
    }
  }
  return null;
}

/**
 * Aggregate `bars` into clock-aligned `targetMin` candles.
 *
 * Returns null when the series is not uniformly `sourceMin`, or when `targetMin`
 * is not an integer multiple of that size. A finer timeframe is never invented.
 * A leading bucket that does not contain its own open is dropped. The last
 * bucket may still be forming: its open is real and its close is the latest
 * revealed bar.
 */
export function resampleBars(
  bars: readonly Bar[],
  sourceMin: number,
  targetMin: number,
): readonly Bar[] | null {
  if (!timeframeSupported(sourceMin, targetMin)) {
    return null;
  }
  if (bars.length === 0) {
    return [];
  }
  const sourceMs = sourceMin * MINUTE_MS;
  const first = bars[0];
  if (first === undefined || first.timeMs % sourceMs !== 0) {
    return null;
  }
  if (bars.length >= 2 && seriesTimeframeMin(bars) !== sourceMin) {
    return null;
  }
  if (targetMin === sourceMin) {
    return bars;
  }

  const targetMs = targetMin * MINUTE_MS;
  const buckets = new Map<number, Bar[]>();
  for (const bar of bars) {
    if (bar.timeMs % sourceMs !== 0) {
      return null;
    }
    const offset = bar.timeMs % targetMs;
    if (offset + sourceMs > targetMs) {
      return null;
    }
    const bucket = bar.timeMs - offset;
    const group = buckets.get(bucket);
    if (group === undefined) {
      buckets.set(bucket, [bar]);
    } else {
      group.push(bar);
    }
  }

  const out: Bar[] = [];
  let accepting = false;
  for (const [bucket, group] of buckets) {
    const openBar = group[0];
    const closeBar = group[group.length - 1];
    if (openBar === undefined || closeBar === undefined) {
      return null;
    }
    if (!accepting) {
      if (openBar.timeMs !== bucket) {
        continue;
      }
      accepting = true;
    }
    let high = openBar.high;
    let low = openBar.low;
    let volume = 0;
    let everyBarHasVolume = true;
    for (const bar of group) {
      high = Math.max(high, bar.high);
      low = Math.min(low, bar.low);
      if (bar.volume === undefined || !Number.isFinite(bar.volume)) {
        everyBarHasVolume = false;
      } else {
        volume += bar.volume;
      }
    }
    out.push({
      timeMs: bucket,
      open: openBar.open,
      high,
      low,
      close: closeBar.close,
      ...(everyBarHasVolume ? { volume } : {}),
    });
  }
  return out;
}
