import { describe, expect, it } from "vitest";
import {
  anchoredVwap,
  averageTrueRange,
  bollingerBands,
  closesThrough,
  donchianChannels,
  exponentialMovingAverage,
  keltnerChannels,
  simpleMovingAverage,
} from "./index.ts";

describe("moving averages on a revealed prefix", () => {
  it("averages a filled window and leaves the warmup null", () => {
    expect(simpleMovingAverage([1, 2, 3, 6], 2)).toEqual([null, 1.5, 2.5, 4.5]);
    expect(simpleMovingAverage([4, 5, 6], 1)).toEqual([4, 5, 6]);
    expect(simpleMovingAverage([1, 2, 3], 4)).toEqual([null, null, null]);
    expect(simpleMovingAverage([1, 2, 3], 0)).toEqual([null, null, null]);
    expect(simpleMovingAverage([], 3)).toEqual([]);
  });

  it("seeds the exponential average with the first full simple window", () => {
    expect(exponentialMovingAverage([2, 4, 6, 10], 3)).toEqual([null, null, 4, 7]);
    expect(exponentialMovingAverage([8], 1)).toEqual([8]);
    expect(exponentialMovingAverage([1, 2], 1.5)).toEqual([null, null]);
  });

  it("keeps a flat series on the mid line when deviation is zero", () => {
    expect(bollingerBands([5, 5, 5, 5], 3, 0)).toEqual([
      { mid: null, upper: null, lower: null },
      { mid: null, upper: null, lower: null },
      { mid: 5, upper: 5, lower: 5 },
      { mid: 5, upper: 5, lower: 5 },
    ]);
  });

  it("places the band two population deviations from the simple average", () => {
    expect(bollingerBands([1, 2, 3, 4], 2, 2)).toEqual([
      { mid: null, upper: null, lower: null },
      { mid: 1.5, upper: 2.5, lower: 0.5 },
      { mid: 2.5, upper: 3.5, lower: 1.5 },
      { mid: 3.5, upper: 4.5, lower: 2.5 },
    ]);
  });

  it("does not let a later close change earlier values", () => {
    const bars = [
      { close: 10 },
      { close: 11 },
      { close: 12 },
      { close: 14 },
      { close: 13 },
      { close: 100 },
    ];
    const revealed = closesThrough(bars, 4);
    expect(revealed).toEqual([10, 11, 12, 14, 13]);
    expect(closesThrough(bars, -1)).toEqual([]);
    expect(closesThrough(bars, 99)).toEqual([10, 11, 12, 14, 13, 100]);

    const period = 3;
    const prefixSma = simpleMovingAverage(revealed, period);
    const fullSma = simpleMovingAverage(
      bars.map((bar) => bar.close),
      period,
    );
    expect(prefixSma).toEqual(fullSma.slice(0, revealed.length));

    const prefixEma = exponentialMovingAverage(revealed, period);
    const fullEma = exponentialMovingAverage(
      bars.map((bar) => bar.close),
      period,
    );
    expect(prefixEma).toEqual(fullEma.slice(0, revealed.length));

    const prefixBand = bollingerBands(revealed, period, 2);
    const fullBand = bollingerBands(
      bars.map((bar) => bar.close),
      period,
      2,
    );
    expect(prefixBand).toEqual(fullBand.slice(0, revealed.length));
    expect(prefixSma.at(-1)).not.toBe(fullSma.at(-1));
  });

  it("drops a window that contains a non-finite close without rewriting earlier points", () => {
    const values = [1, 2, 3, Number.NaN, 5];
    expect(simpleMovingAverage(values, 2)).toEqual([null, 1.5, 2.5, null, null]);
    expect(exponentialMovingAverage(values, 2)).toEqual([null, 1.5, 2.5, null, null]);
  });
});

describe("volume-anchored and volatility studies", () => {
  it("weights VWAP by volume and stays null without a usable size", () => {
    expect(
      anchoredVwap([
        { high: 12, low: 8, close: 10, volume: 1 },
        { high: 21, low: 15, close: 18, volume: 3 },
        { high: 30, low: 30, close: 30, volume: 0 },
      ]),
    ).toEqual([10, 16, 16]);
    expect(anchoredVwap([{ high: 2, low: 1, close: 1.5 }])).toEqual([null]);
    expect(anchoredVwap([])).toEqual([]);
  });

  it("seeds true range on the first bar and smooths with Wilder weights", () => {
    const bars = [
      { high: 10, low: 8, close: 9 },
      { high: 12, low: 9, close: 11 },
      { high: 11, low: 7, close: 8 },
    ];
    expect(averageTrueRange(bars, 2)).toEqual([null, 2.5, 3.25]);
    expect(averageTrueRange(bars, 0)).toEqual([null, null, null]);
  });

  it("takes the rolling high and low over the window including the current bar", () => {
    const bars = [
      { high: 10, low: 8, close: 9 },
      { high: 12, low: 9, close: 11 },
      { high: 11, low: 7, close: 8 },
    ];
    expect(donchianChannels(bars, 2)).toEqual([
      { mid: null, upper: null, lower: null },
      { mid: 10, upper: 12, lower: 8 },
      { mid: 9.5, upper: 12, lower: 7 },
    ]);
  });

  it("stretches Keltner bands by the average true range around the EMA", () => {
    const bars = [
      { high: 10, low: 8, close: 9 },
      { high: 12, low: 9, close: 11 },
      { high: 11, low: 7, close: 8 },
    ];
    const [, second, third] = keltnerChannels(bars, 2, 1);
    expect(second).toEqual({ mid: 10, upper: 12.5, lower: 7.5 });
    expect(third?.mid).toBeCloseTo(8.6667, 3);
    expect(third?.upper).toBeCloseTo(11.9167, 3);
    expect(third?.lower).toBeCloseTo(5.4167, 3);
    const flat = keltnerChannels(bars, 2, 0)[2];
    expect(flat?.upper).toBe(flat?.mid);
    expect(flat?.lower).toBe(flat?.mid);
  });
});
