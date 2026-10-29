import { describe, expect, it } from "vitest";
import {
  EXAM,
  EXAM_ENDS_AT,
  EXAM_FORM_URL,
  examOpen,
  examPreset,
  examResult,
  examSetup,
  examSubmitUrl,
  examTier,
  isExamSetup,
} from "./exam.ts";
import { defaultSetup } from "./setup.ts";

describe("exam preset", () => {
  it("freezes the campaign rules", () => {
    const preset = examPreset();
    expect(preset.startingBalanceUsd).toBe(50_000);
    expect(preset.profitTargetPct).toBe(6);
    expect(preset.maxDrawdownUsd).toBe(2_000);
    expect(preset.drawdownMode).toBe("static");
    expect(preset.dailyLossLimitPct).toBeNull();
    expect(preset.maxLeverage).toBe(5);
    expect(preset.markets).toEqual([EXAM.market]);
  });

  it("pins market, timeframe, bars and seed so every entrant gets the same bars", () => {
    const setup = examSetup(defaultSetup());
    expect(setup).toMatchObject({
      market: EXAM.market,
      timeframeMin: EXAM.timeframeMin,
      bars: EXAM.bars,
      seed: EXAM.seed,
      dataSource: "synthetic",
      rulesMode: "preset",
      presetId: "exam-50k",
    });
    expect(isExamSetup(setup)).toBe(true);
    expect(isExamSetup(defaultSetup())).toBe(false);
  });
});

describe("exam tier", () => {
  it("needs both a small drawdown and a real sample of trades", () => {
    expect(examTier(1_000, 10)).toBe("distinction");
    expect(examTier(0, 25)).toBe("distinction");
    expect(examTier(1_001, 25)).toBe("pass");
    expect(examTier(200, 9)).toBe("pass");
  });
});

describe("exam result", () => {
  it("is deterministic for the same run", () => {
    const a = examResult({ net: 3_120.5, maxDrawdownUsd: 640, trades: 14 });
    const b = examResult({ net: 3_120.5, maxDrawdownUsd: 640, trades: 14 });
    expect(a).toEqual(b);
    expect(a.tier).toBe("distinction");
    expect(a.code).toMatch(/^EXAM-v1-[0-9A-F]{8}$/);
  });

  it("prefills every score field and leaves only the email to the respondent", () => {
    const result = examResult({ net: 3_050, maxDrawdownUsd: 900, trades: 12 });
    const url = new URL(examSubmitUrl(result, "PerpDrill"));
    expect(url.origin + url.pathname).toBe(EXAM_FORM_URL);
    const values = [...url.searchParams.values()];
    expect(values).toContain("PerpDrill");
    expect(values).toContain("Distinction 優異");
    expect(values).toContain("3050");
    expect(values).toContain("900");
    expect(values).toContain("12");
    expect(values).toContain(result.code);
    expect(url.searchParams.has("entry.867628570")).toBe(false); // email stays manual
  });
});

describe("campaign window", () => {
  it("closes after the one-week window in HKT", () => {
    expect(examOpen(EXAM_ENDS_AT - 1)).toBe(true);
    expect(examOpen(EXAM_ENDS_AT + 1)).toBe(false);
  });
});
