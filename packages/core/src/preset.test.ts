import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parsePracticePreset } from "./index.ts";

const unofficial = "Unofficial community preset — verify against current official docs.";

describe("practice preset parser", () => {
  it("parses the community files shipped outside the packages tree", () => {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../presets");
    const index = JSON.parse(readFileSync(path.join(dir, "index.json"), "utf8")) as {
      files: string[];
    };
    expect(index.files.length).toBeGreaterThanOrEqual(14);
    for (const name of index.files) {
      const parsed = parsePracticePreset(JSON.parse(readFileSync(path.join(dir, name), "utf8")));
      expect(parsed.ok).toBe(true);
    }
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
      markets: ["BTC-PERP"],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.preset.takerBps).toBe(30);
    expect(parsed.preset.startingBalanceUsd).toBeNull();
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
