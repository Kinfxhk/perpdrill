import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { leverageCap, parsePracticePreset } from "@perpdrill/core";
import {
  applyPresetChoices,
  countdownPending,
  customPreset,
  dataKey,
  markCountdownPlayed,
  sanitizeSetup,
  takeFirstRun,
} from "./setup.ts";

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
    expect(setup.market).toBe("SYNTH-NQ");
    expect(setup.timeframeMin).toBe(15);
    expect(sanitizeSetup({ timeframeMin: 3 }).timeframeMin).toBe(3);
    expect(setup.bars).toBe(5_000);
    expect(setup.seed).toBe(0);
    expect(setup.custom.maxDrawdownPct).toBe(50);
    expect(setup.custom.maxLeverage).toBe(50);
    expect(setup.custom.drawdownMode).toBe("static");
  });

  it("defaults custom max drawdown to static and keeps an explicit trailing choice", () => {
    expect(sanitizeSetup(null).custom.drawdownMode).toBe("static");
    expect(sanitizeSetup({ custom: { drawdownMode: "trailing" } }).custom.drawdownMode).toBe(
      "trailing",
    );
  });

  it("drops retired community preset ids", () => {
    expect(sanitizeSetup({ rulesMode: "preset", presetId: "community-a" }).presetId).toBeNull();
    expect(sanitizeSetup({ presetId: "community-b" }).presetId).toBeNull();
    expect(sanitizeSetup({ presetId: "plan-instant-50k" }).presetId).toBe("plan-instant-50k");
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

describe("plan presets", () => {
  it("only applies buyer options the plan offers", () => {
    const raw: unknown = JSON.parse(
      readFileSync(new URL("../../../presets/plan-1step-gold.json", import.meta.url), "utf8"),
    );
    const parsed = parsePracticePreset(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const base = sanitizeSetup({ rulesMode: "preset", presetId: "plan-1step-gold" });
    expect(applyPresetChoices(parsed.preset, base).dailyLossLimitPct).toBeNull();
    const picked = applyPresetChoices(parsed.preset, {
      ...base,
      presetTargetPct: 20,
      presetDailyPct: 4,
    });
    expect(picked.profitTargetPct).toBe(20);
    expect(picked.dailyLossLimitPct).toBe(4);
    const bogus = applyPresetChoices(parsed.preset, { ...base, presetDailyPct: 7 });
    expect(bogus.dailyLossLimitPct).toBeNull();
    expect(leverageCap(parsed.preset, "SYNTH-NQ")).toBe(25);
    expect(leverageCap(parsed.preset, "SYNTH-GC")).toBe(15);
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

  it("stays pending until playback actually starts", () => {
    expect(countdownPending("btc")).toBe(true);
    expect(countdownPending("btc")).toBe(true);
    markCountdownPlayed("btc");
    expect(countdownPending("btc")).toBe(false);
    expect(countdownPending("eth")).toBe(true);
  });
});
