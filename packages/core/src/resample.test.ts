import { describe, expect, it } from "vitest";
import {
  SYNTHETIC_TIMEFRAMES_MIN,
  coarserTimeframe,
  resampleBars,
  sampleSeries,
  seriesTimeframeMin,
  syntheticSeries,
  timeframeSupported,
  type Bar,
} from "./index.ts";

function bar(timeMs: number, open: number, high: number, low: number, close: number): Bar {
  return { timeMs, open, high, low, close };
}

describe("chart resampling", () => {
  it("offers 1m, 3m, 5m, 15m, 1h, and 4h, including a real 3m series", () => {
    expect(SYNTHETIC_TIMEFRAMES_MIN).toEqual([1, 3, 5, 15, 60, 240]);
    const three = syntheticSeries({ market: "SYNTH-GC", seed: 4, bars: 120, timeframeMin: 3 });
    expect(seriesTimeframeMin(three)).toBe(3);
    expect(three[1]?.timeMs).toBe((three[0]?.timeMs ?? 0) + 3 * 60_000);
  });

  it("builds a 3m candle from three 1m bars and refuses a timeframe the bars cannot divide", () => {
    const bars = [
      bar(0, 10, 12, 9, 11),
      bar(60_000, 11, 14, 10, 13),
      bar(120_000, 13, 13, 8, 9),
      bar(180_000, 9, 10, 9, 10),
    ];
    expect(resampleBars(bars, 1, 3)).toEqual([bar(0, 10, 14, 8, 9), bar(180_000, 9, 10, 9, 10)]);
    expect(resampleBars(bars, 1, 5)).toEqual([bar(0, 10, 14, 8, 10)]);
    expect(resampleBars(bars, 5, 3)).toBeNull();
    expect(resampleBars(bars, 1, 1)).toBe(bars);
    expect(timeframeSupported(15, 3)).toBe(false);
    expect(timeframeSupported(15, 60)).toBe(true);
  });

  it("keeps a forming higher timeframe and drops a bucket whose open is missing", () => {
    const partial = [bar(0, 10, 11, 9, 10.5), bar(60_000, 10.5, 12, 10, 11)];
    expect(resampleBars(partial, 1, 3)).toEqual([bar(0, 10, 12, 9, 11)]);
    expect(resampleBars([bar(60_000, 1, 1, 1, 1), bar(120_000, 1, 2, 1, 2)], 1, 3)).toEqual([]);
  });

  it("refuses to relabel an irregular or mismatched series", () => {
    const gap = [bar(0, 1, 1, 1, 1), bar(60_000, 1, 2, 1, 2), bar(180_000, 2, 2, 2, 2)];
    expect(seriesTimeframeMin(gap)).toBeNull();
    expect(resampleBars(gap, 1, 3)).toBeNull();
    expect(resampleBars(gap, 15, 60)).toBeNull();
  });

  it("does not claim a timeframe the 1h sample cannot build, and clock-aligns 4h", () => {
    const sample = sampleSeries("SYNTH-NQ");
    expect(seriesTimeframeMin(sample)).toBe(60);
    expect(resampleBars(sample, 60, 1)).toBeNull();
    expect(resampleBars(sample, 60, 3)).toBeNull();
    expect(resampleBars(sample, 60, 5)).toBeNull();
    expect(resampleBars(sample, 60, 15)).toBeNull();
    expect(resampleBars(sample, 60, 60)).toEqual(sample);

    const four = resampleBars(sample, 60, 240);
    expect(four).not.toBeNull();
    expect(four?.[0]?.timeMs).toBe(Date.parse("2026-01-05T16:00:00.000Z"));
    expect(four).toHaveLength(6);
    const last = four?.[5];
    const tail = sample.slice(21);
    expect(last?.open).toBe(sample[21]?.open);
    expect(last?.close).toBe(sample[23]?.close);
    expect(last?.high).toBe(Math.max(...tail.map((item) => item.high)));
    expect(last?.low).toBe(Math.min(...tail.map((item) => item.low)));
  });

  it("resamples a 3m series into 15m candles from the same path", () => {
    const bars = syntheticSeries({ market: "SYNTH-NQ", seed: 11, bars: 121, timeframeMin: 3 });
    const quarter = resampleBars(bars, 3, 15);
    expect(quarter).toHaveLength(25);
    const group = bars.slice(0, 5);
    const open = group[0];
    const close = group[4];
    expect(open).toBeDefined();
    expect(close).toBeDefined();
    expect(quarter?.[0]).toEqual({
      timeMs: open?.timeMs,
      open: open?.open,
      high: Math.max(...group.map((item) => item.high)),
      low: Math.min(...group.map((item) => item.low)),
      close: close?.close,
    });
    expect(resampleBars(bars, 3, 5)).toBeNull();
    expect(resampleBars(bars, 3, 1)).toBeNull();
    expect(coarserTimeframe(SYNTHETIC_TIMEFRAMES_MIN, 15, 15)).toBe(60);
    expect(coarserTimeframe(SYNTHETIC_TIMEFRAMES_MIN, 15, 240)).toBeNull();
    expect(coarserTimeframe(SYNTHETIC_TIMEFRAMES_MIN, 3, 3)).toBe(15);
  });
});
