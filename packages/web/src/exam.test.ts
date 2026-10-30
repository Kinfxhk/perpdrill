import { describe, expect, it } from "vitest";
import {
  EXAM_ENDS_AT,
  EXAM_FORM_URL,
  examOpen,
  examPreset,
  examResult,
  examSubmitUrl,
  examTier,
  examTokenValid,
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
    expect(preset.markets).toEqual(["SYNTH-IDX1"]);
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
  it("requires the target, then a real sample of trades", () => {
    expect(examTier(3_000)).toBe("pass");
    expect(examTier(9_999)).toBe("pass");
    expect(examTier(2_999)).toBeNull();
  });
});

describe("exam result", () => {
  it("is deterministic for the same run", () => {
    const a = examResult({ net: 3_120.5, maxDrawdownUsd: 640, trades: 14 });
    const b = examResult({ net: 3_120.5, maxDrawdownUsd: 640, trades: 14 });
    expect(a).toEqual(b);
    expect(a.tier).toBe("pass");
    expect(a.code).toMatch(/^EXAM-v1-[0-9A-F]{8}$/);
  });

  it("sends one checksummed code instead of editable numbers", () => {
    const result = examResult({
      net: 3_050,
      maxDrawdownUsd: 900,
      trades: 12,
      winRatePct: 58.3,
      rrr: 1.8,
      lots: "2.4×",
    });
    const url = new URL(examSubmitUrl(result));
    expect(url.origin + url.pathname).toBe(EXAM_FORM_URL);
    expect([...url.searchParams.keys()]).toEqual(["usp", "entry.1153110697"]);
    const token = url.searchParams.get("entry.1153110697") ?? "";
    expect(token.split("|").slice(0, 10)).toEqual([
      "KFX1",
      "PD",
      "PASS",
      "3050",
      "900",
      "12",
      "58.3",
      "1.8",
      "2.4",
      result.code,
    ]);
    expect(examTokenValid(token)).toBe(true);

    const fields = token.split("|");
    const tampered = [...fields.slice(0, 3), "99999", ...fields.slice(4)].join("|");
    expect(examTokenValid(tampered)).toBe(false);
    expect(examTokenValid("")).toBe(false);
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
