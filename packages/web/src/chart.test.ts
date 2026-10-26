import { describe, expect, it } from "vitest";
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
});
