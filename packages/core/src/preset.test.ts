import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parsePracticePreset } from "./index.ts";

const unofficial = "Unofficial community preset — verify against current official docs.";

const presetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../presets");

/** Firm tokens split so this file itself does not contain them. */
function firmNamePattern(): RegExp {
  const head = "v" + "est";
  const my = "my";
  const funded = "funded";
  const markets = "markets";
  const trade = "trade";
  const ify = "ify";
  return new RegExp([my + funded, head + markets, trade + ify, `\\b${head}\\b`].join("|"), "i");
}

describe("practice preset parser", () => {
  it("parses the teaching plans shipped outside the packages tree", () => {
    const index = JSON.parse(readFileSync(path.join(presetsDir, "index.json"), "utf8")) as {
      files: string[];
    };
    expect(index.files).toHaveLength(13);
    expect(index.files.some((name) => name.startsWith("community-"))).toBe(false);
    for (const name of index.files) {
      const parsed = parsePracticePreset(
        JSON.parse(readFileSync(path.join(presetsDir, name), "utf8")),
      );
      expect(parsed.ok).toBe(true);
    }
  });

  it("keeps firm names out of preset strings shown in the desk", () => {
    const index = JSON.parse(readFileSync(path.join(presetsDir, "index.json"), "utf8")) as {
      files: string[];
    };
    const firm = firmNamePattern();
    const shown = ["displayName", "group", "disclaimer", "note"] as const;
    let brandHits = 0;
    for (const name of index.files) {
      const file = JSON.parse(readFileSync(path.join(presetsDir, name), "utf8")) as Record<
        string,
        unknown
      >;
      for (const field of shown) {
        const text = file[field];
        if (typeof text === "string" && firm.test(text)) {
          brandHits += 1;
        }
      }
    }
    expect(brandHits).toBe(0);
  });

  it("accepts an unofficial preset and refuses invented-looking holes", () => {
    const parsed = parsePracticePreset({
      format: "perps-prop-profile",
      version: 1,
      id: "example-eval",
      displayName: "Example Eval (community)",
      disclaimer: unofficial,
      sourceUrls: ["https://example.com/rules"],
      profitTargetPct: 12,
      maxDrawdownPct: 5,
      dailyLossLimitPct: 3,
      dailyReset: { timeZone: "America/New_York", hour: 0, minute: 0 },
      equityIncludesUPnL: true,
      costModel: "swap",
      takerBps: 30,
      makerBps: 30,
      swapDailyRatePct: 0.03,
      venueFundingChangesBalance: false,
      markets: ["SYNTH-IDX1"],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.preset.takerBps).toBe(30);
    expect(parsed.preset.startingBalanceUsd).toBeNull();
    expect(parsed.preset.maxDrawdownUsd).toBeNull();
    expect(parsed.preset.markets).toEqual(["SYNTH-IDX1"]);
  });

  it("canonicalizes a legacy sample alias in saved preset markets", () => {
    const parsed = parsePracticePreset({
      format: "perps-prop-profile",
      version: 1,
      id: "example-eval",
      displayName: "Example Eval (community)",
      disclaimer: unofficial,
      sourceUrls: ["https://example.com/rules"],
      profitTargetPct: 12,
      maxDrawdownPct: 5,
      costModel: "off",
      maxLeverage: { "SYNTH-NQ": 25, "SYNTH-GC": 15 },
      markets: ["SYNTH-NQ", "SYNTH-IDX1", "SYNTH-GC"],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.preset.markets).toEqual(["SYNTH-IDX1", "SYNTH-METAL1"]);
    expect(parsed.preset.maxLeverage).toEqual({ "SYNTH-IDX1": 25, "SYNTH-METAL1": 15 });
  });

  it("rejects a max drawdown amount that is not a positive loss under the starting balance", () => {
    const base = {
      format: "perps-prop-profile",
      version: 1,
      id: "example-eval",
      displayName: "Example",
      disclaimer: unofficial,
      sourceUrls: ["https://example.com/rules"],
      profitTargetPct: 10,
      maxDrawdownPct: 6,
      costModel: "off",
      startingBalanceUsd: 50_000,
    };
    expect(parsePracticePreset({ ...base, maxDrawdownUsd: 0 }).ok).toBe(false);
    expect(parsePracticePreset({ ...base, maxDrawdownUsd: 50_000 }).ok).toBe(false);
    const ok = parsePracticePreset({ ...base, maxDrawdownUsd: 2_000 });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.preset.maxDrawdownUsd).toBe(2_000);
    }
  });

  it("rejects a preset without the unofficial line or an https source", () => {
    const missingDisclaimer = parsePracticePreset({
      format: "perps-prop-profile",
      version: 1,
      id: "example-eval",
      displayName: "Example",
      disclaimer: "Official rules.",
      sourceUrls: ["https://example.com/rules"],
      profitTargetPct: 10,
      maxDrawdownPct: 6,
      costModel: "off",
    });
    expect(missingDisclaimer.ok).toBe(false);

    const missingSource = parsePracticePreset({
      format: "perps-prop-profile",
      version: 1,
      id: "example-eval",
      displayName: "Example",
      disclaimer: unofficial,
      sourceUrls: [],
      profitTargetPct: 10,
      maxDrawdownPct: 6,
      costModel: "funding",
      fundingRatePerHour: 0,
    });
    expect(missingSource.ok).toBe(false);
  });
});
