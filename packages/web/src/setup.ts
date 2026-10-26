import {
  DEFAULT_SYNTHETIC_BARS,
  MAX_SYNTHETIC_BARS,
  MIN_SYNTHETIC_BARS,
  PRACTICE_STARTING_BALANCE_USD,
  PROP_RULE_PRESET_FORMAT,
  PROP_RULE_PRESET_SCHEMA_VERSION,
  SAMPLE_MARKETS,
  TEACHING_MAX_LEVERAGE,
  isMarketId,
  isSyntheticTimeframe,
  randomSeed,
  type DrawdownMode,
  type MarketId,
  type PracticePreset,
  type SyntheticTimeframe,
} from "@perpdrill/core";

/** Above this the static floor sits under every liquidation, so the rule never trips. */
export const MAX_RULE_DRAWDOWN_PCT = 50;

export type RulesMode = "none" | "preset" | "custom";

export type CustomRules = {
  startingBalanceUsd: number;
  profitTargetPct: number;
  maxDrawdownPct: number;
  drawdownMode: DrawdownMode;
  dailyLossLimitPct: number;
  maxLeverage: number;
  takerBps: number;
  swapDailyRatePct: number;
};

export type SessionSetup = {
  market: MarketId;
  timeframeMin: SyntheticTimeframe;
  bars: number;
  seed: number;
  rulesMode: RulesMode;
  presetId: string | null;
  /** Buyer options picked for the preset; `undefined` keeps the preset default. */
  presetTargetPct?: number | null | undefined;
  presetDailyPct?: number | null | undefined;
  custom: CustomRules;
};

export const DEFAULT_CUSTOM_RULES: CustomRules = {
  startingBalanceUsd: 10_000,
  profitTargetPct: 8,
  maxDrawdownPct: 6,
  drawdownMode: "static",
  dailyLossLimitPct: 3,
  maxLeverage: 10,
  takerBps: 5,
  swapDailyRatePct: 0,
};

export function defaultSetup(): SessionSetup {
  return {
    market: SAMPLE_MARKETS[0],
    timeframeMin: 15,
    bars: DEFAULT_SYNTHETIC_BARS,
    seed: randomSeed(),
    rulesMode: "custom",
    presetId: null,
    custom: { ...DEFAULT_CUSTOM_RULES },
  };
}

/** Bars already on the chart when the session starts, so indicators have history. */
export function warmupBars(bars: number): number {
  return Math.min(60, Math.floor(bars / 4));
}

function num(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

const RETIRED_PRESET_IDS = new Set(["community-a", "community-b"]);

function retiredPresetId(value: unknown): string | null {
  if (typeof value !== "string" || RETIRED_PRESET_IDS.has(value)) {
    return null;
  }
  return value;
}

function optionalPct(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : undefined;
}

/** Apply the buyer options, but only values the preset itself offers. */
export function applyPresetChoices(preset: PracticePreset, setup: SessionSetup): PracticePreset {
  const pick = (
    allowed: readonly (number | null)[] | null,
    wanted: number | null | undefined,
    fallback: number | null,
  ): number | null =>
    allowed !== null && wanted !== undefined && allowed.includes(wanted) ? wanted : fallback;
  return {
    ...preset,
    profitTargetPct: pick(
      preset.choices.profitTargetPct,
      setup.presetTargetPct,
      preset.profitTargetPct,
    ),
    dailyLossLimitPct: pick(
      preset.choices.dailyLossLimitPct,
      setup.presetDailyPct,
      preset.dailyLossLimitPct,
    ),
  };
}

/** Clamp every field so a hand-edited storage entry or form value cannot break the engine. */
export function sanitizeSetup(raw: unknown): SessionSetup {
  const base = defaultSetup();
  if (typeof raw !== "object" || raw === null) {
    return base;
  }
  const value = raw as Record<string, unknown>;
  const custom = (
    typeof value.custom === "object" && value.custom !== null ? value.custom : {}
  ) as Record<string, unknown>;
  const d = DEFAULT_CUSTOM_RULES;
  return {
    market:
      typeof value.market === "string" && isMarketId(value.market) ? value.market : base.market,
    timeframeMin:
      typeof value.timeframeMin === "number" && isSyntheticTimeframe(value.timeframeMin)
        ? value.timeframeMin
        : base.timeframeMin,
    bars: Math.round(num(value.bars, MIN_SYNTHETIC_BARS, MAX_SYNTHETIC_BARS, base.bars)),
    seed: Math.round(num(value.seed, 0, 0xffffffff, base.seed)),
    rulesMode:
      value.rulesMode === "none" || value.rulesMode === "preset" || value.rulesMode === "custom"
        ? value.rulesMode
        : base.rulesMode,
    presetId: retiredPresetId(value.presetId),
    presetTargetPct: optionalPct(value.presetTargetPct),
    presetDailyPct: optionalPct(value.presetDailyPct),
    custom: {
      startingBalanceUsd: num(custom.startingBalanceUsd, 100, 10_000_000, d.startingBalanceUsd),
      profitTargetPct: num(custom.profitTargetPct, 0.1, 100, d.profitTargetPct),
      maxDrawdownPct: num(custom.maxDrawdownPct, 0.1, MAX_RULE_DRAWDOWN_PCT, d.maxDrawdownPct),
      drawdownMode: custom.drawdownMode === "trailing" ? "trailing" : "static",
      dailyLossLimitPct: num(custom.dailyLossLimitPct, 0, 100, d.dailyLossLimitPct),
      maxLeverage: Math.round(num(custom.maxLeverage, 1, TEACHING_MAX_LEVERAGE, d.maxLeverage)),
      takerBps: num(custom.takerBps, 0, 100, d.takerBps),
      swapDailyRatePct: num(custom.swapDailyRatePct, 0, 5, d.swapDailyRatePct),
    },
  };
}

export function customPreset(rules: CustomRules): PracticePreset {
  return {
    format: PROP_RULE_PRESET_FORMAT,
    version: PROP_RULE_PRESET_SCHEMA_VERSION,
    id: "custom",
    displayName: "Custom",
    disclaimer: "",
    sourceUrls: [],
    profitTargetPct: rules.profitTargetPct,
    maxDrawdownPct: rules.maxDrawdownPct,
    maxDrawdownUsd: null,
    drawdownMode: rules.drawdownMode,
    maxLeverage: rules.maxLeverage,
    dailyLossLimitPct: rules.dailyLossLimitPct > 0 ? rules.dailyLossLimitPct : null,
    // Daily clock is UTC midnight for custom rules; synthetic data is 24/7.
    dailyReset: rules.dailyLossLimitPct > 0 ? { timeZone: "UTC", hour: 0, minute: 0 } : null,
    equityIncludesUPnL: true,
    costModel: rules.swapDailyRatePct > 0 ? "swap" : "off",
    takerBps: rules.takerBps,
    makerBps: null,
    swapDailyRatePct: rules.swapDailyRatePct > 0 ? rules.swapDailyRatePct : null,
    fundingRatePerHour: null,
    venueFundingChangesBalance: false,
    startingBalanceUsd: rules.startingBalanceUsd,
    markets: null,
    note: "",
    dailyBase: "equity",
    group: "",
    choices: { profitTargetPct: null, dailyLossLimitPct: null },
  };
}

export function setupMarkets(preset: PracticePreset | null): readonly MarketId[] {
  return preset?.markets ?? SAMPLE_MARKETS;
}

export function setupStartingBalance(preset: PracticePreset | null): number {
  return preset?.startingBalanceUsd ?? PRACTICE_STARTING_BALANCE_USD;
}

const SETUP_KEY = "perpdrill.setup";
const PLAYED_KEY = "perpdrill.playedData";
const MAX_PLAYED = 200;

export function readStoredSetup(): SessionSetup {
  try {
    return sanitizeSetup(JSON.parse(localStorage.getItem(SETUP_KEY) ?? "null"));
  } catch {
    return defaultSetup();
  }
}

export function writeStoredSetup(setup: SessionSetup): void {
  try {
    localStorage.setItem(SETUP_KEY, JSON.stringify(setup));
  } catch {
    // Storage is optional; the session still runs.
  }
}

export function dataKey(setup: SessionSetup): string {
  return `${setup.market}:${setup.timeframeMin}:${setup.bars}:${setup.seed}`;
}

/**
 * True the first time this exact data set starts on this browser; records it.
 * Automated browsers skip it unless storage `perpdrill.countdown` is "1".
 */
export function takeFirstRun(key: string): boolean {
  try {
    const flag = localStorage.getItem("perpdrill.countdown");
    if (flag === "0" || (flag !== "1" && navigator.webdriver)) {
      return false;
    }
    const raw: unknown = JSON.parse(localStorage.getItem(PLAYED_KEY) ?? "[]");
    const played = Array.isArray(raw) ? raw.filter((item) => typeof item === "string") : [];
    if (played.includes(key)) {
      return false;
    }
    localStorage.setItem(PLAYED_KEY, JSON.stringify([...played, key].slice(-MAX_PLAYED)));
    return true;
  } catch {
    return true;
  }
}
