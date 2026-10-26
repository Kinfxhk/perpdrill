import { isMarketId, type MarketId } from "./constants.ts";
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
  readonly profitTargetPct: number;
  readonly maxDrawdownPct: number;
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
};

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
  const profitTargetPct = percent(value.profitTargetPct);
  const maxDrawdownPct = percent(value.maxDrawdownPct);
  if (profitTargetPct === null || maxDrawdownPct === null) {
    return { ok: false, error: "preset percents are invalid" };
  }
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
    },
  };
}

export function resolvedTakerBps(preset: PracticePreset | null): number {
  return preset?.takerBps ?? 0;
}

export function includeUnrealized(preset: PracticePreset | null): boolean {
  return preset?.equityIncludesUPnL !== false;
}
