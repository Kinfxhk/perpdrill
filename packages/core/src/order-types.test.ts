import { describe, expect, it } from "vitest";
import { replaySession, type Bar, type SessionAction } from "./index.ts";

function bar(timeMs: number, open: number, high: number, low: number, close: number): Bar {
  return { timeMs, open, high, low, close };
}

// One calm bar, one wide bar, two trending bars.
const series: readonly Bar[] = [
  bar(0, 100, 105, 95, 100),
  bar(1, 101, 110, 99, 104),
  bar(2, 105, 115, 90, 108),
  bar(3, 109, 120, 100, 112),
];

function limit(barIndex: number, price: number, side: "long" | "short" = "long"): SessionAction {
  return {
    kind: "limit",
    barIndex,
    side,
    leverage: 10,
    powerPct: 25,
    price,
    slipToleranceBps: 75,
    realizedImpactBps: 25,
  };
}

function stop(barIndex: number, price: number, side: "long" | "short" = "long"): SessionAction {
  return {
    kind: "stop",
    barIndex,
    side,
    leverage: 10,
    powerPct: 25,
    price,
    slipToleranceBps: 75,
    realizedImpactBps: 25,
  };
}

function open(barIndex: number): SessionAction {
  return {
    kind: "open",
    barIndex,
    side: "long",
    leverage: 10,
    powerPct: 25,
    slipToleranceBps: 75,
    realizedImpactBps: 25,
  };
}

const run = (actions: readonly SessionAction[], cursor: number) =>
  replaySession({ market: "SYNTH-IDX1", series, preset: null, actions, cursor });

describe("limit and stop orders", () => {
  it("fills a buy limit intrabar at the limit price", () => {
    const frame = run([limit(0, 101)], 1);
    expect(frame.position).not.toBeNull();
    expect(frame.position?.entry).toBe(101);
    expect(frame.fills[0]?.kind).toBe("limit");
    expect(frame.fills[0]?.barIndex).toBe(1);
    expect(frame.pendingOrders).toHaveLength(0);
    expect(frame.fills[0]?.qty).toBeGreaterThan(0);
  });

  it("does not fill a limit on its placement bar", () => {
    // Bar 0 low is 95, so a 96 limit is already marketable at placement time,
    // but the order is placed at the bar close and cannot fill on bar 0.
    const atPlacement = run([limit(0, 96)], 0);
    expect(atPlacement.position).toBeNull();
    expect(atPlacement.pendingOrders).toHaveLength(1);
    // Bar 1 low is 99, bar 2 low is 90: the fill happens on bar 2.
    const later = run([limit(0, 96)], 2);
    expect(later.fills[0]?.kind).toBe("limit");
    expect(later.fills[0]?.barIndex).toBe(2);
    expect(later.fills[0]?.price).toBe(96);
  });

  it("keeps an untouched limit working", () => {
    const frame = run([limit(0, 50)], 3);
    expect(frame.position).toBeNull();
    expect(frame.pendingOrders).toHaveLength(1);
    expect(frame.pendingOrders[0]).toMatchObject({ kind: "limit", price: 50, placedAtBar: 0 });
  });

  it("triggers a buy stop on the high and fills with impact", () => {
    const frame = run([stop(0, 108)], 1);
    expect(frame.position).not.toBeNull();
    expect(frame.position?.entry).toBeCloseTo(108 * 1.0025, 6);
    expect(frame.fills[0]?.kind).toBe("stop-entry");
    expect(frame.fills[0]?.barIndex).toBe(1);
  });

  it("fills a gapped stop at the open", () => {
    // Bar 1 high is 110, bar 2 opens at 105 with high 115: a 112 stop gaps
    // through bar 2's open and fills there.
    const frame = run([stop(0, 112)], 2);
    expect(frame.fills[0]?.kind).toBe("stop-entry");
    expect(frame.position?.entry).toBeCloseTo(112 * 1.0025, 6);
  });

  it("keeps an untriggered stop working", () => {
    const frame = run([stop(0, 130)], 3);
    expect(frame.position).toBeNull();
    expect(frame.pendingOrders).toHaveLength(1);
    expect(frame.pendingOrders[0]?.kind).toBe("stop");
  });

  it("rejects an invalid price", () => {
    const frame = run([limit(0, 0)], 3);
    expect(frame.pendingOrders).toHaveLength(0);
    expect(frame.rejects).toContainEqual({ barIndex: 0, reason: "invalid-price" });
  });

  it("rejects an order while a position is open", () => {
    const frame = run([open(0), limit(1, 100)], 2);
    expect(frame.pendingOrders).toHaveLength(0);
    expect(frame.rejects).toContainEqual({ barIndex: 1, reason: "position-open" });
  });

  it("cancels working orders when a market entry opens", () => {
    const frame = run([limit(0, 50), open(1)], 1);
    expect(frame.pendingOrders).toHaveLength(0);
    expect(frame.position).not.toBeNull();
  });

  it("cancels one working order without touching the other", () => {
    const both = run([limit(0, 50), stop(0, 130)], 3);
    expect(both.pendingOrders).toHaveLength(2);
    const one = run([stop(0, 130)], 3);
    expect(one.pendingOrders).toHaveLength(1);
    expect(one.pendingOrders[0]?.kind).toBe("stop");
  });

  it("fills a sell limit on the high at the limit price", () => {
    // Bar 1 high is 110, bar 2 high is 115: a 112 sell limit fills on bar 2.
    const frame = run([limit(0, 112, "short")], 2);
    expect(frame.position).not.toBeNull();
    expect(frame.position?.side).toBe("short");
    expect(frame.position?.entry).toBe(112);
    expect(frame.fills[0]?.kind).toBe("limit");
  });
});
