import { describe, expect, it } from "vitest";
import { replaySession, type Bar, type SessionAction } from "./index.ts";

const HOUR = 3_600_000;

function bar(index: number, close = 100): Bar {
  return { timeMs: index * HOUR, open: close, high: close, low: close, close };
}

const series: readonly Bar[] = [bar(0), bar(1, 100), bar(2, 102), bar(3, 103)];

function open(
  barIndex: number,
  side: "long" | "short" = "long",
  powerPct: 25 | 50 | 75 | 100 = 25,
): SessionAction {
  return {
    kind: "open",
    barIndex,
    side,
    leverage: 10,
    powerPct,
    slipToleranceBps: 75,
    realizedImpactBps: 25,
  };
}

function close(barIndex: number, powerPct?: 25 | 50 | 75 | 100): SessionAction {
  return {
    kind: "close",
    barIndex,
    ...(powerPct === undefined ? {} : { powerPct }),
    slipToleranceBps: 75,
    realizedImpactBps: 25,
  };
}

const run = (actions: readonly SessionAction[], cursor: number) =>
  replaySession({ market: "SYNTH-NQ", series, preset: null, actions, cursor });

describe("adding, reducing and reversing", () => {
  it("adds a same-side market entry to the position", () => {
    const frame = run([open(0), open(1)], 1);
    expect(frame.position).not.toBeNull();
    expect(frame.fills).toHaveLength(2);
    const first = frame.fills[0];
    const second = frame.fills[1];
    expect(second?.kind).toBe("open");
    expect(frame.position?.qty).toBeCloseTo((first?.qty ?? 0) + (second?.qty ?? 0), 6);
    // Weighted average entry: fills are 100 and 100.25 (25bps impact).
    const expected =
      ((first?.qty ?? 0) * (first?.price ?? 0) + (second?.qty ?? 0) * (second?.price ?? 0)) /
      ((first?.qty ?? 0) + (second?.qty ?? 0));
    expect(frame.position?.entry).toBeCloseTo(expected, 6);
  });

  it("reverses when the market entry switches side", () => {
    const frame = run([open(0), open(1, "short")], 1);
    expect(frame.position?.side).toBe("short");
    expect(frame.fills.map((fill) => fill.kind)).toEqual(["open", "close", "open"]);
  });

  it("closes half the position and keeps the rest", () => {
    const frame = run([open(0), close(1, 50)], 1);
    expect(frame.position).not.toBeNull();
    const full = run([open(0)], 0);
    expect(frame.position?.qty).toBeCloseTo((full.position?.qty ?? 0) / 2, 6);
    expect(frame.fills[1]?.kind).toBe("close");
    expect(frame.fills[1]?.qty).toBeCloseTo((full.position?.qty ?? 0) / 2, 6);
  });

  it("closes everything at 100%", () => {
    const frame = run([open(0), close(1, 100)], 1);
    expect(frame.position).toBeNull();
  });

  it("rejects an add the cash cannot cover", () => {
    const frame = run([open(0, "long", 100), open(1, "long", 25)], 1);
    expect(frame.rejects).toContainEqual({ barIndex: 1, reason: "insufficient-cash" });
    expect(frame.fills).toHaveLength(1);
  });
});
