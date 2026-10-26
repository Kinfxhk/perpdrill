import { describe, expect, it } from "vitest";
import {
  ACCOUNT_HEALTH_LABEL,
  BUYING_POWER_PCTS,
  ENGINE_STATUS,
  LIQ_PRICE_MARK_LABEL,
  LIQUIDATION_LABELS,
  PRODUCT_NAME,
  PRODUCT_VERSION,
  PROP_RULE_PRESET_FORMAT,
  PROP_RULE_PRESET_SCHEMA_VERSION,
  SETTLEMENT_POLICIES,
  SETTLEMENT_POLICY_LABELS,
  TRADING_POWER_LABEL,
  isBuyingPowerPct,
} from "./index.ts";

describe("perpdrill core identity", () => {
  it("names the product and stays a non-computing scaffold", () => {
    expect(PRODUCT_NAME).toBe("perpdrill");
    expect(PRODUCT_VERSION).toBe("0.0.0");
    expect(ENGINE_STATUS).toBe("not-implemented");
    expect(TRADING_POWER_LABEL).toBe("Trading Power");
    expect(LIQ_PRICE_MARK_LABEL).toBe("Liq. Price (Mark)");
    expect(ACCOUNT_HEALTH_LABEL).toBe("Account Health");
    expect(LIQUIDATION_LABELS).toEqual({ liqPriceMark: null });
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
});
