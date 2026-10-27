import { describe, expect, it } from "vitest";
import {
  ACCOUNT_HEALTH_LABEL,
  LIQ_PRICE_MARK_LABEL,
  LIQ_RISK_LABEL,
  SAMPLE_MARKETS,
  TRADING_POWER_LABEL,
} from "@perpdrill/core";
import { readFileSync } from "node:fs";
import {
  SUPPORTED_LANGS,
  THEMES,
  catalogKeys,
  catalogValue,
  isLang,
  sampleMarketLabel,
  translate,
} from "./i18n.ts";

describe("desk i18n", () => {
  it("ships the five languages with the same keys", () => {
    expect(SUPPORTED_LANGS).toEqual(["en", "zh-Hant", "zh-Hans", "ja", "ko"]);
    const english = catalogKeys("en");
    expect(english.length).toBeGreaterThan(20);
    for (const lang of SUPPORTED_LANGS) {
      expect(isLang(lang)).toBe(true);
      const keys = catalogKeys(lang);
      expect(keys).toEqual(english);
      for (const key of english) {
        expect(catalogValue(lang, key).trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the English ticket labels aligned with the engine constants", () => {
    expect(translate("en", "power.label")).toBe(TRADING_POWER_LABEL);
    expect(translate("en", "liq.price")).toBe(LIQ_PRICE_MARK_LABEL);
    expect(translate("en", "liq.risk")).toBe(LIQ_RISK_LABEL);
    expect(translate("en", "health.title")).toBe(ACCOUNT_HEALTH_LABEL);
    expect(translate("en", "legend.liquidation")).toBe("Liquidation");
    expect(translate("en", "footer.source")).toContain("AGPL");
  });

  it("labels every sample market SYNTH-* in every language", () => {
    const bare = ["NQ", "GC", "ES", "BTC", "ETH", "BTC-PERP", "ETH-PERP"];
    for (const lang of SUPPORTED_LANGS) {
      const labels = SAMPLE_MARKETS.map((market) => sampleMarketLabel(lang, market));
      expect(labels).toEqual(["SYNTH-NQ", "SYNTH-GC", "SYNTH-ES", "SYNTH-BTC"]);
      for (const label of labels) {
        expect(bare).not.toContain(label);
        expect(translate(lang, "setup.dataHint")).toContain(label);
      }
    }
  });

  it("names every theme and styles every non-default theme", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    for (const theme of THEMES) {
      expect(translate("zh-Hant", `theme.${theme}`).length).toBeGreaterThan(0);
      if (theme !== "teal") {
        expect(css).toContain(`[data-theme="${theme}"]`);
      }
    }
  });
});
