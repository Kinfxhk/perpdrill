import { describe, expect, it } from "vitest";
import { monteCarlo } from "./stats.ts";

const pnls = [120, -80, 60, -40, 90, -70, 150, -110, 40, -30, 80, -50];

describe("monteCarlo", () => {
  it("is deterministic for a seed and bounded", () => {
    const a = monteCarlo({ netPnls: pnls, startingBalance: 10_000, floor: 9_000, seed: 7 });
    const b = monteCarlo({ netPnls: pnls, startingBalance: 10_000, floor: 9_000, seed: 7 });
    expect(a).toEqual(b);
    expect(a.samples).toBe(1000);
    expect(a.breachProbability).not.toBeNull();
    if (a.breachProbability !== null) {
      expect(a.breachProbability).toBeGreaterThanOrEqual(0);
      expect(a.breachProbability).toBeLessThanOrEqual(1);
    }
    expect(a.maxDrawdownP50).not.toBeNull();
    expect(a.maxDrawdownP95).not.toBeNull();
    if (a.maxDrawdownP50 !== null && a.maxDrawdownP95 !== null) {
      expect(a.maxDrawdownP95).toBeGreaterThanOrEqual(a.maxDrawdownP50);
    }
  });

  it("returns nulls without trades", () => {
    const result = monteCarlo({ netPnls: [], startingBalance: 10_000, floor: 9_000, seed: 1 });
    expect(result.breachProbability).toBeNull();
    expect(result.maxDrawdownP50).toBeNull();
  });

  it("always breaches a floor at the starting balance when trades lose", () => {
    const result = monteCarlo({
      netPnls: [-10, -20, -30],
      startingBalance: 10_000,
      floor: 10_000,
      seed: 3,
    });
    expect(result.breachProbability).toBe(1);
  });

  it("gives a mixed breach probability in between", () => {
    const result = monteCarlo({
      netPnls: pnls,
      startingBalance: 10_000,
      floor: 9_700,
      seed: 3,
    });
    expect(result.breachProbability).not.toBeNull();
    if (result.breachProbability !== null) {
      expect(result.breachProbability).toBeGreaterThan(0);
      expect(result.breachProbability).toBeLessThan(1);
    }
  });
});
