import { describe, expect, it } from "vitest";
import { replaySession, reviewMetrics, syntheticSeries, type SessionAction } from "./index.ts";

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

function close(barIndex: number): SessionAction {
  return {
    kind: "close",
    barIndex,
    slipToleranceBps: 75,
    realizedImpactBps: 25,
  };
}

describe("review metrics", () => {
  it("computes sharpe, sortino, calmar and average hold", () => {
    const series = syntheticSeries({ market: "SYNTH-NQ", seed: 5, bars: 100, timeframeMin: 60 });
    const frame = replaySession({
      market: "SYNTH-NQ",
      series,
      preset: null,
      actions: [open(0), close(20), open(40), close(60)],
      cursor: 99,
    });
    const metrics = reviewMetrics({
      fills: frame.fills,
      equityCurve: frame.equityCurve,
      startingBalance: 10_000,
    });
    expect(metrics.trades).toBe(2);
    expect(metrics.avgHoldBars).toBeCloseTo(20, 6);
    // A trending path with a drawdown must produce a finite Calmar.
    if (metrics.maxDrawdownPct > 0) {
      expect(metrics.calmar).not.toBeNull();
      expect(Number.isFinite(metrics.calmar)).toBe(true);
    }
    // Sharpe and Sortino are finite numbers when there is variance.
    if (metrics.sharpe !== null) {
      expect(Number.isFinite(metrics.sharpe)).toBe(true);
    }
    if (metrics.sortino !== null) {
      expect(Number.isFinite(metrics.sortino)).toBe(true);
    }
  });
});

describe("margin mode", () => {
  it("gives cross margin a wider liquidation cushion than isolated", () => {
    const series = syntheticSeries({ market: "SYNTH-NQ", seed: 5, bars: 100, timeframeMin: 60 });
    const input = {
      market: "SYNTH-NQ" as const,
      series,
      preset: null,
      actions: [open(0)],
      cursor: 5,
    };
    const isolated = replaySession({ ...input, marginMode: "isolated" });
    const cross = replaySession({ ...input, marginMode: "cross" });
    expect(isolated.position).not.toBeNull();
    expect(cross.position).not.toBeNull();
    expect(isolated.position?.liqPrice).not.toBe(cross.position?.liqPrice);
    // Long: cross margin sits farther below the entry.
    expect(cross.position?.liqPrice).toBeLessThan(isolated.position?.liqPrice ?? 0);
  });
});

describe("stress data", () => {
  it("moves more than the normal generator for the same seed", () => {
    const normal = syntheticSeries({ market: "SYNTH-NQ", seed: 9, bars: 400, timeframeMin: 15 });
    const stress = syntheticSeries({
      market: "SYNTH-NQ",
      seed: 9,
      bars: 400,
      timeframeMin: 15,
      stress: true,
    });
    const range = (bars: readonly { close: number }[]): number => {
      const closes = bars.map((bar) => bar.close);
      return (Math.max(...closes) - Math.min(...closes)) / Math.min(...closes);
    };
    expect(range(stress)).toBeGreaterThan(range(normal) * 1.5);
  });
});
