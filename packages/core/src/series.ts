import { SAMPLE_BAR_MS, type MarketId } from "./constants.ts";

export type Bar = {
  readonly timeMs: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  /** Base-asset size when the source has one. Imported or synthetic bars may omit it. */
  readonly volume?: number;
};

/** Mark used by the teaching policy: (high + low) / 2. */
export function markPrice(bar: Bar): number {
  return (bar.high + bar.low) / 2;
}

export const SIMULATION_POLICY = {
  mark: "hl2",
  isolated: true,
  maintenance: "half-of-initial",
  linearQuote: "USDC",
  oneWay: true,
} as const;

const SAMPLE_START_MS = Date.parse("2026-01-05T15:00:00.000Z");

/**
 * Sample closes. High and low stay symmetric around the close so the teaching
 * mark equals the close. The open sits inside that wick when the close moved,
 * which gives the practice chart a real body. A flat close stays a doji.
 */
const SAMPLE_CLOSES = [
  10_000, 10_040, 10_080, 10_120, 10_060, 10_000, 9_920, 9_840, 9_760, 9_680, 9_600, 9_520, 9_440,
  9_360, 9_480, 9_700, 9_900, 10_100, 10_300, 10_440, 10_300, 10_100, 10_000, 10_000,
] as const;

function sampleScale(market: MarketId): number {
  switch (market) {
    case "SYNTH-NQ":
      return 1;
    case "SYNTH-GC":
      return 0.25;
    case "SYNTH-ES":
      return 0.5;
    case "SYNTH-BTC":
      return 6;
    default: {
      const unexpected: never = market;
      throw new Error(`unexpected market ${String(unexpected)}`);
    }
  }
}

export function sampleSeries(market: MarketId): readonly Bar[] {
  const scale = sampleScale(market);
  return SAMPLE_CLOSES.map((close, index) => {
    const price = close * scale;
    const wick = 15 * scale;
    const previous = index === 0 ? close : SAMPLE_CLOSES[index - 1];
    const moved = previous === undefined ? 0 : close - previous;
    return {
      timeMs: SAMPLE_START_MS + index * SAMPLE_BAR_MS,
      open: price - Math.sign(moved) * 10 * scale,
      high: price + wick,
      low: price - wick,
      close: price,
    };
  });
}
