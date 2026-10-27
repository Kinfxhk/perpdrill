export const DEFAULT_BOLLINGER_PERIOD = 20;

export const DEFAULT_BOLLINGER_DEVIATIONS = 2;

export const DEFAULT_TRUE_RANGE_PERIOD = 14;

export const DEFAULT_CHANNEL_PERIOD = 20;

export const DEFAULT_KELTNER_MULTIPLIER = 2;

export type BollingerPoint = {
  readonly mid: number | null;
  readonly upper: number | null;
  readonly lower: number | null;
};

/** Same shape as a Bollinger point: a mid line with an upper and lower edge. */
export type ChannelPoint = BollingerPoint;

/** Bar fields the price-scale studies read. Volume is optional, and a study that needs it says so. */
export type StudyBar = {
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume?: number;
};

const EMPTY_BAND: BollingerPoint = { mid: null, upper: null, lower: null };

function invalidPeriod(period: number): boolean {
  return !Number.isInteger(period) || period < 1;
}

function typicalPrice(bar: StudyBar): number {
  return (bar.high + bar.low + bar.close) / 3;
}

function trueRange(bar: StudyBar, previousClose: number | undefined): number {
  if (previousClose === undefined || !Number.isFinite(previousClose)) {
    return bar.high - bar.low;
  }
  return Math.max(bar.high, previousClose) - Math.min(bar.low, previousClose);
}

/**
 * Cumulative VWAP anchored at the first bar, weighted by typical price and volume.
 * Only bars with a finite positive volume add weight, so a series without volume stays
 * null instead of drawing a plain price average under a VWAP label.
 */
export function anchoredVwap(bars: readonly StudyBar[]): readonly (number | null)[] {
  const out: (number | null)[] = [];
  let weighted = 0;
  let volume = 0;
  for (const bar of bars) {
    const size = bar.volume;
    if (size !== undefined && Number.isFinite(size) && size > 0) {
      weighted += typicalPrice(bar) * size;
      volume += size;
    }
    out.push(volume > 0 ? weighted / volume : null);
  }
  return out;
}

/**
 * True range under Wilder smoothing. The first value is the simple mean of the first
 * `period` ranges, later ones weight the newest range 1 / period. Warmup indexes are null.
 */
export function averageTrueRange(
  bars: readonly StudyBar[],
  period: number = DEFAULT_TRUE_RANGE_PERIOD,
): readonly (number | null)[] {
  if (invalidPeriod(period)) {
    return bars.map(() => null);
  }
  const ranges = bars.map((bar, index) => {
    const range = trueRange(bar, bars[index - 1]?.close);
    return Number.isFinite(range) ? range : null;
  });
  const out: (number | null)[] = [];
  let seedSum = 0;
  let seedCount = 0;
  let previous: number | null = null;
  for (const range of ranges) {
    if (range === null) {
      seedSum = 0;
      seedCount = 0;
      previous = null;
      out.push(null);
      continue;
    }
    if (previous === null) {
      seedSum += range;
      seedCount += 1;
      if (seedCount === period) {
        previous = seedSum / period;
        out.push(previous);
      } else {
        out.push(null);
      }
      continue;
    }
    previous = (previous * (period - 1) + range) / period;
    out.push(previous);
  }
  return out;
}

/**
 * Rolling high and low over `period` bars including the current one. Warmup indexes are null.
 */
export function donchianChannels(
  bars: readonly StudyBar[],
  period: number = DEFAULT_CHANNEL_PERIOD,
): readonly ChannelPoint[] {
  if (invalidPeriod(period)) {
    return bars.map(() => EMPTY_BAND);
  }
  return bars.map((_, index) => {
    if (index + 1 < period) {
      return EMPTY_BAND;
    }
    let upper = -Infinity;
    let lower = Infinity;
    for (let offset = index - period + 1; offset <= index; offset += 1) {
      const bar = bars[offset];
      if (bar === undefined || !Number.isFinite(bar.high) || !Number.isFinite(bar.low)) {
        return EMPTY_BAND;
      }
      upper = Math.max(upper, bar.high);
      lower = Math.min(lower, bar.low);
    }
    return { mid: (upper + lower) / 2, upper, lower };
  });
}

/**
 * EMA of closes with bands `multiplier` average true ranges wide. Same window as
 * Bollinger, but the width follows volatility instead of standard deviation.
 */
export function keltnerChannels(
  bars: readonly StudyBar[],
  period: number = DEFAULT_CHANNEL_PERIOD,
  multiplier: number = DEFAULT_KELTNER_MULTIPLIER,
): readonly ChannelPoint[] {
  if (invalidPeriod(period) || !Number.isFinite(multiplier) || multiplier < 0) {
    return bars.map(() => EMPTY_BAND);
  }
  const mids = exponentialMovingAverage(
    bars.map((bar) => bar.close),
    period,
  );
  const ranges = averageTrueRange(bars, period);
  return mids.map((mid, index) => {
    const range = ranges[index];
    if (mid === null || range === null || range === undefined) {
      return EMPTY_BAND;
    }
    const width = multiplier * range;
    return { mid, upper: mid + width, lower: mid - width };
  });
}

/** Closes from bar 0 through `cursor`, inclusive. Later bars are omitted. */
export function closesThrough(
  bars: readonly { readonly close: number }[],
  cursor: number,
): readonly number[] {
  if (!Number.isInteger(cursor) || cursor < 0 || bars.length === 0) {
    return [];
  }
  const last = Math.min(cursor, bars.length - 1);
  const closes: number[] = [];
  for (let index = 0; index <= last; index += 1) {
    const bar = bars[index];
    if (bar !== undefined) {
      closes.push(bar.close);
    }
  }
  return closes;
}

/**
 * Simple average of the previous `period` values.
 * Indexes before the window fills are null. Each point uses only values at or before that index.
 */
export function simpleMovingAverage(
  values: readonly number[],
  period: number,
): readonly (number | null)[] {
  if (invalidPeriod(period)) {
    return values.map(() => null);
  }
  const out: (number | null)[] = [];
  let sum = 0;
  let finite = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value !== undefined && Number.isFinite(value)) {
      sum += value;
      finite += 1;
    }
    if (index >= period) {
      const leaving = values[index - period];
      if (leaving !== undefined && Number.isFinite(leaving)) {
        sum -= leaving;
        finite -= 1;
      }
    }
    if (index >= period - 1 && finite === period) {
      out.push(sum / period);
    } else {
      out.push(null);
    }
  }
  return out;
}

/**
 * Recursive average. The first point is the simple average of the first `period` values.
 * Later points use smoothing 2 / (period + 1). A point depends only on values at or before it.
 */
export function exponentialMovingAverage(
  values: readonly number[],
  period: number,
): readonly (number | null)[] {
  if (invalidPeriod(period)) {
    return values.map(() => null);
  }
  const out: (number | null)[] = values.map(() => null);
  const alpha = 2 / (period + 1);
  let seedSum = 0;
  let seedCount = 0;
  let previous: number | null = null;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined || !Number.isFinite(value)) {
      previous = null;
      seedSum = 0;
      seedCount = 0;
      continue;
    }
    if (previous === null) {
      seedSum += value;
      seedCount += 1;
      if (seedCount === period) {
        previous = seedSum / period;
        out[index] = previous;
      }
      continue;
    }
    previous = alpha * value + (1 - alpha) * previous;
    out[index] = previous;
  }
  return out;
}

/**
 * Mid line is the simple average. Width is `deviations` times the population standard deviation
 * of that same window. Points before the window fills are null.
 */
export function bollingerBands(
  values: readonly number[],
  period: number = DEFAULT_BOLLINGER_PERIOD,
  deviations: number = DEFAULT_BOLLINGER_DEVIATIONS,
): readonly BollingerPoint[] {
  if (invalidPeriod(period) || !Number.isFinite(deviations) || deviations < 0) {
    return values.map(() => EMPTY_BAND);
  }
  const mids = simpleMovingAverage(values, period);
  return mids.map((mid, index) => {
    if (mid === null) {
      return EMPTY_BAND;
    }
    let square = 0;
    for (let offset = 0; offset < period; offset += 1) {
      const value = values[index - period + 1 + offset];
      if (value === undefined || !Number.isFinite(value)) {
        return EMPTY_BAND;
      }
      const delta = value - mid;
      square += delta * delta;
    }
    const width = deviations * Math.sqrt(square / period);
    return { mid, upper: mid + width, lower: mid - width };
  });
}
