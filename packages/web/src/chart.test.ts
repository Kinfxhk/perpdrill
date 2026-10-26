import { describe, expect, it } from "vitest";
import {
  advanceViewport,
  coordinateToFloatIndex,
  lastBarVisible,
  logicalBorders,
  pinchZoomScale,
  showRecentViewport,
  viewportAfterWheel,
  wheelChartDeltas,
} from "./chart-scale.ts";
import {
  candleBodyDeviceWidth,
  candleDirection,
  candleWickDeviceWidth,
  layoutCandles,
  type Candle,
} from "./chart.ts";

const up: Candle = { open: 10, high: 14, low: 9, close: 13 };
const down: Candle = { open: 13, high: 13.5, low: 8, close: 9 };
const doji: Candle = { open: 9, high: 11, low: 7, close: 9 };

describe("practice candle geometry", () => {
  it("colors a candle from its own open and close, and treats a doji as up", () => {
    expect(candleDirection(up)).toBe("up");
    expect(candleDirection(down)).toBe("down");
    expect(candleDirection(doji)).toBe("up");
  });

  it("uses the slot width rule for the body and a one-pixel wick", () => {
    expect(candleBodyDeviceWidth(6, 1)).toBe(5);
    expect(candleBodyDeviceWidth(3, 1)).toBe(3);
    expect(candleBodyDeviceWidth(3, 2)).toBe(6);
    expect(candleBodyDeviceWidth(10, 1)).toBe(7);
    expect(candleWickDeviceWidth(6, 1, 5)).toBe(1);
    expect(candleWickDeviceWidth(29, 2, 46)).toBe(2);
  });

  it("paints a square body, a hairline wick outside that body, and a one-pixel doji", () => {
    const width = 640;
    const padLeft = 12;
    const padRight = 72;
    const plotWidth = width - padLeft - padRight;
    const laid = layoutCandles({
      candles: [up, down, doji],
      width,
      height: 360,
      padLeft,
      padRight,
      pixelRatio: 1,
    });
    const slot = plotWidth / 3;
    expect(laid.candles.map((candle) => candle.direction)).toEqual(["up", "down", "up"]);

    for (const candle of laid.candles) {
      expect(candle.body.width).toBeLessThan(slot);
      expect(candle.body.width).toBeGreaterThan(slot * 0.7);
      expect(candle.body.height).toBeGreaterThan(0);
      expect(candle.upperWick?.width).toBe(1);
      expect(candle.lowerWick?.width).toBe(1);
      if (candle.upperWick !== null) {
        expect(candle.upperWick.y + candle.upperWick.height).toBeCloseTo(candle.body.y, 5);
      }
      if (candle.lowerWick !== null) {
        expect(candle.lowerWick.y).toBeCloseTo(candle.body.y + candle.body.height, 5);
      }
    }

    const flat = laid.candles[2];
    expect(flat?.body.height).toBe(1);
    expect(flat?.body.width).toBeGreaterThan(1);
  });

  it("draws a zoomed range with wider bodies than a fit-all slot", () => {
    const width = 640;
    const padLeft = 12;
    const padRight = 72;
    const plotWidth = width - padLeft - padRight;
    const candles = Array.from({ length: 40 }, (_, index) => ({
      open: 100 + index,
      high: 104 + index,
      low: 98 + index,
      close: 102 + index,
    }));
    const timeScale = { barSpacing: 24, rightOffset: 2 };
    const laid = layoutCandles({
      candles,
      width,
      height: 360,
      padLeft,
      padRight,
      pixelRatio: 1,
      timeScale,
    });
    expect(laid.candles.length).toBeGreaterThan(0);
    expect(laid.candles.length).toBeLessThan(candles.length);
    for (const candle of laid.candles) {
      expect(candle.body.width).toBe(candleBodyDeviceWidth(timeScale.barSpacing, 1));
    }
    const fitted = plotWidth / candles.length;
    expect(timeScale.barSpacing).toBeGreaterThan(fitted);
  });
});

describe("practice time scale", () => {
  it("opens on the last 150 bars with five bars of right margin", () => {
    const width = 780;
    const count = 600;
    const view = showRecentViewport(width, count);
    const borders = logicalBorders(width, count, view);
    expect(borders.from).toBeCloseTo(count - 150, 5);
    expect(borders.to).toBeCloseTo(count + 5, 5);
    expect(lastBarVisible(width, count, view)).toBe(true);
  });

  it("zooms around the cursor and scrolls with the wheel coefficient", () => {
    const width = 640;
    const count = 140;
    const view = showRecentViewport(width, count);
    const x = 220;
    const before = coordinateToFloatIndex(width, count, view, x);
    const zoomed = viewportAfterWheel(
      width,
      count,
      view,
      x,
      wheelChartDeltas({
        deltaX: 0,
        deltaY: -100,
        deltaMode: 0,
        windowsChrome: false,
        devicePixelRatio: 1,
      }),
    );
    expect(zoomed.barSpacing).toBeGreaterThan(view.barSpacing);
    expect(coordinateToFloatIndex(width, count, zoomed, x)).toBeCloseTo(before, 4);

    const scrolled = viewportAfterWheel(width, count, view, x, { deltaX: 0.5, deltaY: 0 });
    expect(scrolled.rightOffset).toBeCloseTo(view.rightOffset + (0.5 * 80) / view.barSpacing, 5);
    expect(pinchZoomScale(1.2, 1)).toBeCloseTo(1);
  });

  it("follows a new bar when the last bar is visible, and holds still when it is not", () => {
    const width = 700;
    const followed = showRecentViewport(width, 80);
    expect(lastBarVisible(width, 80, followed)).toBe(true);
    expect(advanceViewport(width, 80, 81, 1, followed).rightOffset).toBeCloseTo(
      followed.rightOffset,
      5,
    );

    const held = { barSpacing: 30, rightOffset: -40 };
    expect(lastBarVisible(width, 80, held)).toBe(false);
    expect(advanceViewport(width, 80, 80, 1, held).rightOffset).toBeCloseTo(-41, 5);
  });

  it("corrects Windows Chromium wheel pixels by the device pixel ratio", () => {
    expect(
      wheelChartDeltas({
        deltaX: 0,
        deltaY: 100,
        deltaMode: 0,
        windowsChrome: true,
        devicePixelRatio: 2,
      }).deltaY,
    ).toBeCloseTo(-0.5, 5);
    expect(
      wheelChartDeltas({
        deltaX: 0,
        deltaY: 100,
        deltaMode: 1,
        windowsChrome: false,
        devicePixelRatio: 1,
      }).deltaY,
    ).toBeCloseTo(-32, 5);
  });
});
