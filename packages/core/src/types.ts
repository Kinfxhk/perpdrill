export const BUYING_POWER_PCTS = [25, 50, 75, 100] as const;

export type BuyingPowerPct = (typeof BUYING_POWER_PCTS)[number];

/** Ticket multiple. M0 does not convert this into margin or quantity. */
export type LeverageLabel = {
  readonly multiple: number;
};

/** Visible ticket strings. M0 does not compute the values beside them. */
export const TRADING_POWER_LABEL = "Trading Power" as const;
export const LIQ_PRICE_MARK_LABEL = "Liq. Price (Mark)" as const;
export const ACCOUNT_HEALTH_LABEL = "Account Health" as const;

/** Mark liquidation slot. The price stays null until a later milestone. */
export type LiquidationLabels = {
  readonly liqPriceMark: null;
};

export const LIQUIDATION_LABELS = {
  liqPriceMark: null,
} as const satisfies LiquidationLabels;

export const SETTLEMENT_POLICIES = ["funding", "swap", "off"] as const;

export type SettlementPolicy = (typeof SETTLEMENT_POLICIES)[number];

export const SETTLEMENT_POLICY_LABELS = {
  funding: "Venue funding",
  swap: "Firm swap",
  off: "Off",
} as const satisfies Record<SettlementPolicy, string>;

export const PROP_RULE_PRESET_FORMAT = "perps-prop-profile" as const;

export const PROP_RULE_PRESET_SCHEMA_VERSION = 1 as const;

/** Shape only. M0 does not ship preset documents. */
export type PropRulePresetStub = {
  readonly format: typeof PROP_RULE_PRESET_FORMAT;
  readonly version: typeof PROP_RULE_PRESET_SCHEMA_VERSION;
  readonly id: string;
  readonly displayName: string;
  readonly disclaimer: string;
  readonly sourceUrls: readonly string[];
};

export function isBuyingPowerPct(value: number): value is BuyingPowerPct {
  return (BUYING_POWER_PCTS as readonly number[]).includes(value);
}
