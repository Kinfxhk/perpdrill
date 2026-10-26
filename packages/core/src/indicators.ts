export const DEFAULT_BOLLINGER_PERIOD = 20;

export const DEFAULT_BOLLINGER_DEVIATIONS = 2;

export type BollingerPoint = {
  readonly mid: number | null;
  readonly upper: number | null;
  readonly lower: number | null;
};

const EMPTY_BAND: BollingerPoint = { mid: null, upper: null, lower: null };

function invalidPeriod(period: number): boolean {
  return !Number.isInteger(period) || period < 1;
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
