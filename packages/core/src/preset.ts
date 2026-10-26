import { TEACHING_MAX_LEVERAGE, isMarketId, type MarketId } from "./constants.ts";
import type { DailyReset } from "./prop.ts";
import {
  PROP_RULE_PRESET_FORMAT,
  PROP_RULE_PRESET_SCHEMA_VERSION,
  SETTLEMENT_POLICIES,
  type SettlementPolicy,
} from "./types.ts";

export type PracticePreset = {
  readonly format: typeof PROP_RULE_PRESET_FORMAT;
  readonly version: typeof PROP_RULE_PRESET_SCHEMA_VERSION;
  readonly id: string;
  readonly displayName: string;
  readonly disclaimer: string;
  readonly sourceUrls: readonly string[];
  /** `null` = no profit target (an instant-style account). */
  readonly profitTargetPct: number | null;
  readonly maxDrawdownPct: number;
  /**
   * Dollar max drawdown. When set, the static floor is the starting balance
   * minus this amount and does not trail. Null uses maxDrawdownPct instead.
   */
  readonly maxDrawdownUsd: number | null;
  /** Static floor from the start, or trailing the closing high-water mark. */
  readonly drawdownMode: DrawdownMode;
  /** One cap for every market, or a cap per market. */
  readonly maxLeverage: number | Partial<Record<MarketId, number>> | null;
  /**
   * What the daily loss floor is measured from at each reset: total equity, or the
   * realized balance (margin included, unrealized PnL excluded). Equity is always checked.
   */
  readonly dailyBase: DailyBase;
  readonly dailyLossLimitPct: number | null;
  readonly dailyReset: DailyReset | null;
  readonly equityIncludesUPnL: boolean | null;
  readonly costModel: SettlementPolicy;
  readonly takerBps: number | null;
  readonly makerBps: number | null;
  readonly swapDailyRatePct: number | null;
  readonly fundingRatePerHour: number | null;
  readonly venueFundingChangesBalance: boolean;
  readonly startingBalanceUsd: number | null;
  readonly markets: readonly MarketId[] | null;
  readonly note: string;
  /** Plan family for grouping in the picker, e.g. "1-Step evaluation". */
  readonly group: string;
  /** Rules the plan lets the buyer pick at purchase. The preset values are the default. */
  readonly choices: PresetChoices;
};

export type PresetChoices = {
  readonly profitTargetPct: readonly (number | null)[] | null;
  readonly dailyLossLimitPct: readonly (number | null)[] | null;
};

export const DRAWDOWN_MODES = ["static", "trailing"] as const;

export type DrawdownMode = (typeof DRAWDOWN_MODES)[number];

export type DailyBase = "equity" | "realized";

export type PresetParseResult =
  | { readonly ok: true; readonly preset: PracticePreset }
  | { readonly ok: false; readonly error: string };

const UNOFFICIAL = "Unofficial community preset";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

function percent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    return null;
  }
  return value;
}

function optionalPercent(value: unknown): number | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }
  return percent(value);
}

function bps(value: unknown): number | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10_000) {
    return undefined;
  }
  return value;
}

function costModel(value: unknown): SettlementPolicy | null {
  if (typeof value !== "string") {
    return null;
  }
  for (const policy of SETTLEMENT_POLICIES) {
    if (policy === value) {
      return policy;
    }
  }
  return null;
}

function dailyReset(value: unknown): DailyReset | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const timeZone = value.timeZone;
  const hour = value.hour;
  const minute = value.minute;
  if (typeof timeZone !== "string" || timeZone.length < 3 || timeZone.length > 80) {
    return undefined;
  }
  if (typeof hour !== "number" || !Number.isInteger(hour) || hour < 0 || hour > 23) {
    return undefined;
  }
  if (typeof minute !== "number" || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return undefined;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
  } catch {
    return undefined;
  }
  return { timeZone, hour, minute };
}

export function parsePracticePreset(value: unknown): PresetParseResult {
  if (!isRecord(value)) {
    return { ok: false, error: "preset must be an object" };
  }
  if (
    value.format !== PROP_RULE_PRESET_FORMAT ||
    value.version !== PROP_RULE_PRESET_SCHEMA_VERSION
  ) {
    return { ok: false, error: "preset schema is not supported" };
  }
  if (typeof value.id !== "string" || !/^[a-z0-9-]{1,64}$/.test(value.id)) {
    return { ok: false, error: "preset id is invalid" };
  }
  if (typeof value.displayName !== "string" || value.displayName.trim().length === 0) {
    return { ok: false, error: "preset display name is missing" };
  }
  if (value.displayName.length > 160) {
    return { ok: false, error: "preset display name is too long" };
  }
  if (typeof value.disclaimer !== "string" || !value.disclaimer.includes(UNOFFICIAL)) {
    return { ok: false, error: "preset disclaimer must say it is unofficial" };
  }
  if (!Array.isArray(value.sourceUrls) || value.sourceUrls.length === 0) {
    return { ok: false, error: "preset needs source URLs" };
  }
  const sourceUrls: string[] = [];
  for (const entry of value.sourceUrls) {
    const url = httpsUrl(entry);
    if (url === null) {
      return { ok: false, error: "preset source URLs must be https" };
    }
    sourceUrls.push(url);
  }
  const profitTargetPct = value.profitTargetPct === null ? null : percent(value.profitTargetPct);
  const maxDrawdownPct = percent(value.maxDrawdownPct);
  if ((profitTargetPct === null && value.profitTargetPct !== null) || maxDrawdownPct === null) {
    return { ok: false, error: "preset percents are invalid" };
  }
  let drawdownMode: DrawdownMode = "static";
  if (value.drawdownMode !== undefined && value.drawdownMode !== null) {
    if (value.drawdownMode !== "static" && value.drawdownMode !== "trailing") {
      return { ok: false, error: "drawdown mode is invalid" };
    }
    drawdownMode = value.drawdownMode;
  }
  const leverageOk = (cap: unknown): cap is number =>
    typeof cap === "number" && Number.isInteger(cap) && cap >= 1 && cap <= TEACHING_MAX_LEVERAGE;
  let maxLeverage: PracticePreset["maxLeverage"] = null;
  if (value.maxLeverage !== undefined && value.maxLeverage !== null) {
    if (leverageOk(value.maxLeverage)) {
      maxLeverage = value.maxLeverage;
    } else if (isRecord(value.maxLeverage)) {
      const caps: Partial<Record<MarketId, number>> = {};
      for (const [market, cap] of Object.entries(value.maxLeverage)) {
        if (!isMarketId(market) || !leverageOk(cap)) {
          return { ok: false, error: "max leverage is invalid" };
        }
        caps[market] = cap;
      }
      maxLeverage = caps;
    } else {
      return { ok: false, error: "max leverage is invalid" };
    }
  }
  if (
    value.dailyBase !== undefined &&
    value.dailyBase !== null &&
    value.dailyBase !== "equity" &&
    value.dailyBase !== "realized"
  ) {
    return { ok: false, error: "daily base is invalid" };
  }
  const dailyBase: DailyBase = value.dailyBase === "realized" ? "realized" : "equity";
  const dailyLossLimitPct = optionalPercent(value.dailyLossLimitPct);
  if (dailyLossLimitPct === undefined) {
    return { ok: false, error: "daily loss limit is invalid" };
  }
  const reset = dailyReset(value.dailyReset);
  if (reset === undefined) {
    return { ok: false, error: "daily reset is invalid" };
  }
  if (dailyLossLimitPct !== null && reset === null) {
    return { ok: false, error: "daily loss limit needs a reset clock" };
  }
  let equityIncludesUPnL: boolean | null = null;
  if (value.equityIncludesUPnL !== undefined && value.equityIncludesUPnL !== null) {
    if (typeof value.equityIncludesUPnL !== "boolean") {
      return { ok: false, error: "equity flag is invalid" };
    }
    equityIncludesUPnL = value.equityIncludesUPnL;
  }
  const model = costModel(value.costModel);
  if (model === null) {
    return { ok: false, error: "cost model is invalid" };
  }
  const takerBps = bps(value.takerBps);
  const makerBps = bps(value.makerBps);
  if (takerBps === undefined || makerBps === undefined) {
    return { ok: false, error: "fee bps are invalid" };
  }
  const swapDailyRatePct = optionalPercent(value.swapDailyRatePct);
  if (swapDailyRatePct === undefined) {
    return { ok: false, error: "swap rate is invalid" };
  }
  let fundingRatePerHour: number | null = null;
  if (value.fundingRatePerHour !== undefined && value.fundingRatePerHour !== null) {
    if (
      typeof value.fundingRatePerHour !== "number" ||
      !Number.isFinite(value.fundingRatePerHour) ||
      value.fundingRatePerHour < -1 ||
      value.fundingRatePerHour > 1
    ) {
      return { ok: false, error: "funding stub rate is invalid" };
    }
    fundingRatePerHour = value.fundingRatePerHour;
  }
  const venueFundingChangesBalance = value.venueFundingChangesBalance === true;
  let startingBalanceUsd: number | null = null;
  if (value.startingBalanceUsd !== undefined && value.startingBalanceUsd !== null) {
    if (
      typeof value.startingBalanceUsd !== "number" ||
      !Number.isFinite(value.startingBalanceUsd) ||
      value.startingBalanceUsd <= 0
    ) {
      return { ok: false, error: "starting balance is invalid" };
    }
    startingBalanceUsd = value.startingBalanceUsd;
  }
  let maxDrawdownUsd: number | null = null;
  if (value.maxDrawdownUsd !== undefined && value.maxDrawdownUsd !== null) {
    if (
      typeof value.maxDrawdownUsd !== "number" ||
      !Number.isFinite(value.maxDrawdownUsd) ||
      value.maxDrawdownUsd <= 0 ||
      (startingBalanceUsd !== null && value.maxDrawdownUsd >= startingBalanceUsd)
    ) {
      return { ok: false, error: "max drawdown amount is invalid" };
    }
    maxDrawdownUsd = value.maxDrawdownUsd;
  }
  let markets: readonly MarketId[] | null = null;
  if (value.markets !== undefined && value.markets !== null) {
    if (!Array.isArray(value.markets) || value.markets.length === 0) {
      return { ok: false, error: "markets are invalid" };
    }
    const parsed: MarketId[] = [];
    for (const market of value.markets) {
      if (typeof market !== "string" || !isMarketId(market)) {
        return { ok: false, error: "markets are invalid" };
      }
      parsed.push(market);
    }
    markets = parsed;
  }
  const note = typeof value.note === "string" ? value.note.slice(0, 600) : "";
  const group = typeof value.group === "string" ? value.group.slice(0, 60) : "";
  const choiceList = (raw: unknown): readonly (number | null)[] | null | undefined => {
    if (raw === undefined || raw === null) {
      return null;
    }
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 8) {
      return undefined;
    }
    const out: (number | null)[] = [];
    for (const item of raw) {
      if (item !== null && percent(item) === null) {
        return undefined;
      }
      out.push(item === null ? null : (item as number));
    }
    return out;
  };
  const rawChoices = isRecord(value.choices) ? value.choices : {};
  const targetChoices = choiceList(rawChoices.profitTargetPct);
  const dailyChoices = choiceList(rawChoices.dailyLossLimitPct);
  if (targetChoices === undefined || dailyChoices === undefined) {
    return { ok: false, error: "preset choices are invalid" };
  }
  if (dailyChoices?.some((item) => item !== null) === true && reset === null) {
    return { ok: false, error: "daily loss choices need a reset clock" };
  }
  return {
    ok: true,
    preset: {
      format: PROP_RULE_PRESET_FORMAT,
      version: PROP_RULE_PRESET_SCHEMA_VERSION,
      id: value.id,
      displayName: value.displayName.trim(),
      disclaimer: value.disclaimer.trim(),
      sourceUrls,
      profitTargetPct,
      maxDrawdownPct,
      maxDrawdownUsd,
      drawdownMode,
      maxLeverage,
      dailyBase,
      dailyLossLimitPct,
      dailyReset: reset,
      equityIncludesUPnL,
      costModel: model,
      takerBps,
      makerBps,
      swapDailyRatePct,
      fundingRatePerHour,
      venueFundingChangesBalance,
      startingBalanceUsd,
      markets,
      note,
      group,
      choices: { profitTargetPct: targetChoices, dailyLossLimitPct: dailyChoices },
    },
  };
}

export function resolvedTakerBps(preset: PracticePreset | null): number {
  return preset?.takerBps ?? 0;
}

export function leverageCap(preset: PracticePreset | null, market: MarketId): number {
  const cap = preset?.maxLeverage ?? null;
  if (cap === null) {
    return TEACHING_MAX_LEVERAGE;
  }
  return typeof cap === "number" ? cap : (cap[market] ?? TEACHING_MAX_LEVERAGE);
}

export function includeUnrealized(preset: PracticePreset | null): boolean {
  return preset?.equityIncludesUPnL !== false;
}
