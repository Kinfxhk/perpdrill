import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { customPreset, dataKey, sanitizeSetup, takeFirstRun } from "./setup.ts";

describe("session setup", () => {
  it("clamps hostile stored values", () => {
    const setup = sanitizeSetup({
      market: "DOGE-PERP",
      timeframeMin: 7,
      bars: 99_999,
      seed: -5,
      rulesMode: "custom",
      custom: { maxDrawdownPct: 500, maxLeverage: 999, drawdownMode: "weird" },
    });
    expect(setup.market).toBe("BTC-PERP");
    expect(setup.timeframeMin).toBe(15);
    expect(setup.bars).toBe(5_000);
    expect(setup.seed).toBe(0);
    expect(setup.custom.maxDrawdownPct).toBe(100);
    expect(setup.custom.maxLeverage).toBe(20);
    expect(setup.custom.drawdownMode).toBe("trailing");
  });

  it("turns custom rules into an engine preset", () => {
    const preset = customPreset({
      ...sanitizeSetup(null).custom,
      dailyLossLimitPct: 0,
      swapDailyRatePct: 0.02,
    });
    expect(preset.dailyLossLimitPct).toBeNull();
    expect(preset.dailyReset).toBeNull();
    expect(preset.costModel).toBe("swap");
  });
});

describe("first-run countdown", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    vi.stubGlobal("navigator", { webdriver: false });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("counts down once per data set", () => {
    const key = dataKey(sanitizeSetup({ seed: 7 }));
    expect(takeFirstRun(key)).toBe(true);
    expect(takeFirstRun(key)).toBe(false);
    expect(takeFirstRun(dataKey(sanitizeSetup({ seed: 8 })))).toBe(true);
  });

  it("stays off for automated browsers unless forced", () => {
    vi.stubGlobal("navigator", { webdriver: true });
    expect(takeFirstRun("a")).toBe(false);
    store.set("perpdrill.countdown", "1");
    expect(takeFirstRun("a")).toBe(true);
  });
});
