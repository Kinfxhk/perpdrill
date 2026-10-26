import { describe, expect, it } from "vitest";
import { layoutCandles, type Candle } from "./chart.ts";
import {
  FORMING_PARTS,
  FORMING_STEP_BUDGET_MS,
  formingBudgetMs,
  formingCancel,
  formingGapMs,
  formingPaintTimes,
  formingRequestStep,
  formingSnapshot,
  formingStart,
  formingStep,
  type FormingBar,
  type FormingState,
} from "./forming.ts";

const up: FormingBar = { open: 10, high: 14, low: 9, close: 13 };
const down: FormingBar = { open: 13, high: 13.5, low: 8, close: 9 };
const doji: FormingBar = { open: 9, high: 11, low: 7, close: 9 };

function idle(cursor: number, playing = false): FormingState {
  return { cursor, part: null, playing };
}

describe("forming paints", () => {
  it("divides a practice candle into 3 prints and finishes on the real bar", () => {
    expect(FORMING_PARTS).toBe(3);
    expect(formingSnapshot(up, 1)).toEqual({ open: 10, high: 10, low: 10, close: 10 });
    expect(formingSnapshot(up, 2)).toEqual({ open: 10, high: 10, low: 9, close: 9 });
    expect(formingSnapshot(up, 3)).toEqual(up);

    expect(formingSnapshot(down, 1)).toEqual({ open: 13, high: 13, low: 13, close: 13 });
    expect(formingSnapshot(down, 2)).toEqual({ open: 13, high: 13.5, low: 13, close: 13.5 });
    expect(formingSnapshot(down, 3)).toEqual(down);

    expect(formingSnapshot(doji, 2)).toEqual({ open: 9, high: 9, low: 7, close: 7 });
    expect(formingSnapshot(doji, 3)).toEqual(doji);
  });

  it("paints the open as a one-pixel doji before the bar has a body", () => {
    const preview = formingSnapshot(up, 1) satisfies Candle;
    const laid = layoutCandles({
      candles: [preview],
      width: 320,
      height: 200,
      padLeft: 12,
      padRight: 72,
      pixelRatio: 1,
    });
    expect(laid.candles[0]?.body.height).toBe(1);
    expect(laid.candles[0]?.direction).toBe("up");
  });

  it("rejects a paint outside the three parts", () => {
    expect(() => formingSnapshot(up, 0)).toThrow(RangeError);
    expect(() => formingSnapshot(up, 4)).toThrow(RangeError);
  });
});

describe("forming gap", () => {
  it("spaces paints across the whole budget with no 140ms cap and no 16ms floor", () => {
    expect(formingBudgetMs(true, 800)).toBe(800);
    expect(formingBudgetMs(false, 800)).toBe(FORMING_STEP_BUDGET_MS);

    expect(formingGapMs(1600, 3)).toBe(800);
    expect(formingGapMs(1000, 3)).toBe(500);
    expect(formingGapMs(500, 3)).toBe(250);
    expect(formingGapMs(800, 3)).toBe(400);
    expect(formingGapMs(420, 3)).toBe(210);
    expect(formingGapMs(100, 3)).toBe(50);
    expect(formingGapMs(30, 3)).toBe(15);

    // Six paints at a 1000ms budget used to clamp each gap at 140ms (span 700).
    expect(formingGapMs(1000, 6)).toBe(200);
    expect(formingPaintTimes(1000, 6)).toEqual([0, 200, 400, 600, 800, 1000]);
    expect(formingPaintTimes(800)).toEqual([0, 400, 800]);
    expect(formingPaintTimes(420)).toEqual([0, 210, 420]);
    expect(formingPaintTimes(1600)).toEqual([0, 800, 1600]);
  });
});

describe("forming playback", () => {
  it("keeps the closed cursor until the last paint, then play starts the next bar", () => {
    const last = 20;
    let state = formingStart(idle(5), last, true);
    expect(state).toEqual({ cursor: 5, part: 1, playing: true });
    state = formingStep(state, last);
    expect(state).toEqual({ cursor: 5, part: 2, playing: true });
    state = formingStep(state, last);
    expect(state).toEqual({ cursor: 6, part: 1, playing: true });
  });

  it("closes one manual bar and does not chain", () => {
    const last = 20;
    let state = formingRequestStep(idle(5, true), last);
    expect(state).toEqual({ cursor: 5, part: 1, playing: false });
    state = formingStep(state, last);
    state = formingStep(state, last);
    expect(state).toEqual({ cursor: 6, part: null, playing: false });
  });

  it("a forward press during a preview only stops the chain", () => {
    const state = formingRequestStep({ cursor: 5, part: 1, playing: true }, 20);
    expect(state).toEqual({ cursor: 5, part: 1, playing: false });
    expect(formingStep(formingStep(state, 20), 20)).toEqual({
      cursor: 6,
      part: null,
      playing: false,
    });
  });

  it("drops an unclosed preview on cancel and stops at the last bar", () => {
    expect(formingCancel({ cursor: 5, part: 2, playing: true })).toEqual({
      cursor: 5,
      part: null,
      playing: false,
    });
    const last = formingStart(idle(4), 4, true);
    expect(last).toEqual({ cursor: 4, part: null, playing: false });
    expect(formingStep({ cursor: 3, part: 2, playing: true }, 4)).toEqual({
      cursor: 4,
      part: null,
      playing: false,
    });
  });
});
