import { describe, expect, it } from "vitest";
import {
  EXAM_ENDS_AT,
  EXAM_FORM_URL,
  examOpen,
  examPreset,
  examResult,
  examSubmitUrl,
  examTier,
  maxLeverage,
  rewardRisk,
} from "./exam.ts";
import { challengeFor, challengeSetup } from "./challenge.ts";
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
    expect(preset.markets).toEqual(["SYNTH-NQ"]);
  });

  it("is the rule set the daily round runs", () => {
    const setup = challengeSetup(challengeFor(new Date("2026-10-29T00:00:00Z")), defaultSetup());
    expect(setup.rulesMode).toBe("preset");
    expect(setup.presetId).toBe("exam-50k");
    expect(setup.presetTargetPct).toBeNull();
    expect(setup.presetDailyPct).toBeNull();
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
    const result = examResult({
      net: 3_050,
      maxDrawdownUsd: 900,
      trades: 12,
      winRatePct: 58.3,
      rrr: 1.8,
      lots: "2.4×",
    });
    const url = new URL(examSubmitUrl(result, "PerpDrill"));
    expect(url.origin + url.pathname).toBe(EXAM_FORM_URL);
    const values = [...url.searchParams.values()];
    expect(values).toContain("PerpDrill");
    expect(values).toContain("Distinction 優異（回撤 ≤ 1,000 且 ≥ 10 筆交易）");
    expect(values).toContain("3050");
    expect(values).toContain("900");
    expect(values).toContain("12");
    expect(values).toContain("58.3");
    expect(values).toContain("1.8");
    expect(values).toContain("2.4×");
    expect(values).toContain(result.code);
    expect(url.searchParams.has("entry.867628570")).toBe(false); // email stays manual
  });
});

describe("exposure and reward-to-risk", () => {
  it("takes the peak open notional as a multiple of the account", () => {
    const fills = [
      { qty: 1, price: 50_000, kind: "open" },
      { qty: 1, price: 50_000, kind: "open" },
      { qty: 2, price: 50_000, kind: "close" },
    ];
    expect(maxLeverage(fills, 50_000)).toBe(2);
    expect(maxLeverage([], 50_000)).toBeNull();
  });

  it("reports average win over average loss", () => {
    expect(rewardRisk(300, 150)).toBe(2);
    expect(rewardRisk(300, null)).toBeNull();
    expect(rewardRisk(0, 150)).toBeNull();
  });
});

describe("campaign window", () => {
  it("closes after the one-week window in HKT", () => {
    expect(examOpen(EXAM_ENDS_AT - 1)).toBe(true);
    expect(examOpen(EXAM_ENDS_AT + 1)).toBe(false);
  });
});
