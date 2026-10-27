import { describe, expect, it } from "vitest";
import {
  ACCOUNT_HEALTH_LABEL,
  BUYING_POWER_PCTS,
  DEFAULT_REALIZED_IMPACT_BPS,
  DEFAULT_SLIP_TOLERANCE_BPS,
  ENGINE_STATUS,
  LIQ_PRICE_MARK_LABEL,
  LIQ_RISK_LABEL,
  LIQUIDATION_MODEL,
  MAX_SLIP_TOLERANCE_BPS,
  PRODUCT_NAME,
  PRODUCT_VERSION,
  PROP_RULE_PRESET_FORMAT,
  PROP_RULE_PRESET_SCHEMA_VERSION,
  SAMPLE_MARKETS,
  SETTLEMENT_POLICIES,
  SETTLEMENT_POLICY_LABELS,
  TRADING_POWER_LABEL,
  isBuyingPowerPct,
  isMarketId,
} from "./index.ts";

describe("perpdrill core identity", () => {
  it("names the teaching desk and keeps the ticket labels", () => {
    expect(PRODUCT_NAME).toBe("perpdrill");
    expect(PRODUCT_VERSION).toBe("1.3.0");
    expect(ENGINE_STATUS).toBe("teaching");
    expect(LIQUIDATION_MODEL).toBe("isolated-teaching");
    expect(TRADING_POWER_LABEL).toBe("Trading Power");
    expect(LIQ_PRICE_MARK_LABEL).toBe("Est. Liq. Price (Mark)");
    expect(LIQ_PRICE_MARK_LABEL).toContain("Liq. Price (Mark)");
    expect(LIQ_RISK_LABEL).toBe("Liq Risk");
    expect(ACCOUNT_HEALTH_LABEL).toBe("Account Health");
  });

  it("uses a majors slip gate in the 50–100 bps band, not a 5% default", () => {
    expect(DEFAULT_SLIP_TOLERANCE_BPS).toBe(75);
    expect(DEFAULT_SLIP_TOLERANCE_BPS).toBeGreaterThanOrEqual(50);
    expect(DEFAULT_SLIP_TOLERANCE_BPS).toBeLessThanOrEqual(100);
    expect(MAX_SLIP_TOLERANCE_BPS).toBe(100);
    expect(DEFAULT_REALIZED_IMPACT_BPS).toBe(25);
    expect(DEFAULT_REALIZED_IMPACT_BPS).toBeLessThan(DEFAULT_SLIP_TOLERANCE_BPS);
    expect(DEFAULT_SLIP_TOLERANCE_BPS).not.toBe(500);
    expect(DEFAULT_REALIZED_IMPACT_BPS).not.toBe(500);
  });

  it("lists buying-power steps, settlement labels, and the preset schema version", () => {
    expect(BUYING_POWER_PCTS).toEqual([25, 50, 75, 100]);
    expect(isBuyingPowerPct(25)).toBe(true);
    expect(isBuyingPowerPct(100)).toBe(true);
    expect(isBuyingPowerPct(10)).toBe(false);
    expect(SETTLEMENT_POLICIES).toEqual(["funding", "swap", "off"]);
    expect(SETTLEMENT_POLICY_LABELS).toEqual({
      funding: "Venue funding",
      swap: "Firm swap",
      off: "Off",
    });
    expect(PROP_RULE_PRESET_FORMAT).toBe("perps-prop-profile");
    expect(PROP_RULE_PRESET_SCHEMA_VERSION).toBe(1);
  });

  it("names sample markets SYNTH-* and refuses bare exchange symbols", () => {
    expect(SAMPLE_MARKETS).toEqual(["SYNTH-NQ", "SYNTH-GC", "SYNTH-ES", "SYNTH-BTC"]);
    for (const market of SAMPLE_MARKETS) {
      expect(market.startsWith("SYNTH-")).toBe(true);
      expect(isMarketId(market)).toBe(true);
    }
    for (const bare of ["NQ", "GC", "ES", "BTC", "ETH", "BTC-PERP", "ETH-PERP"]) {
      expect(isMarketId(bare)).toBe(false);
    }
  });
});
