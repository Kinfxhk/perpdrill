import {
  PROP_RULE_PRESET_FORMAT,
  PROP_RULE_PRESET_SCHEMA_VERSION,
  type PracticePreset,
} from "@perpdrill/core";

/**
 * The one-week campaign exam. Rules are frozen here, not in a preset file, so the
 * whole feature is two modules plus one button and can be deleted in one commit.
 */
export const EXAM_ID = "exam-50k";
export const EXAM_VERSION = "exam-v1";
export const EXAM_ENDS_AT = Date.parse("2026-11-05T23:59:59+08:00");
export const EXAM_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSdM3UNvQ1_4iEuUCvARbI5aKzycAU1r3MFD58pVvuA_BeDeoQ/viewform";

/** Prefilled answer ids from that form. Change the form, change these. */
const ENTRY = {
  tool: "entry.1388880711",
  tier: "entry.281015303",
  net: "entry.92678115",
  maxDd: "entry.3454493",
  trades: "entry.816234682",
  winRate: "entry.542397379",
  rrr: "entry.85917777",
  lots: "entry.652454272",
  code: "entry.973341008",
} as const;

/** Must equal the option text in the campaign form, or the prefill is dropped. */
export const EXAM_TIER_LABEL = {
  pass: "Pass 合格",
  distinction: "Distinction 優異（回撤 ≤ 1,000 且 ≥ 10 筆交易）",
} as const;

export type ExamTier = keyof typeof EXAM_TIER_LABEL;

export function examOpen(now: number = Date.now()): boolean {
  return now <= EXAM_ENDS_AT;
}

export function examPreset(): PracticePreset {
  return {
    format: PROP_RULE_PRESET_FORMAT,
    version: PROP_RULE_PRESET_SCHEMA_VERSION,
    id: EXAM_ID,
    displayName: "Exam · 50K",
    disclaimer: "Campaign exam rules set by this project. Simulated, not an official evaluation.",
    sourceUrls: [],
    profitTargetPct: 6,
    maxDrawdownPct: 4,
    maxDrawdownUsd: 2_000,
    drawdownMode: "static",
    maxLeverage: 5,
    dailyLossLimitPct: null,
    dailyReset: null,
    equityIncludesUPnL: true,
    costModel: "off",
    takerBps: 1,
    makerBps: null,
    swapDailyRatePct: null,
    fundingRatePerHour: null,
    fundingIntervalHours: null,
    venueFundingChangesBalance: false,
    startingBalanceUsd: 50_000,
    markets: ["SYNTH-NQ"],
    note: "50,000 account. +3,000 target, 2,000 static max drawdown, 5x leverage cap, no daily limit.",
    dailyBase: "equity",
    group: "Exam",
    choices: { profitTargetPct: null, dailyLossLimitPct: null },
  };
}

/** Distinction needs half the drawdown budget left over and a real sample of trades. */
export function examTier(maxDrawdownUsd: number, trades: number): ExamTier {
  return maxDrawdownUsd <= 1_000 && trades >= 10 ? "distinction" : "pass";
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export type ExamResult = {
  readonly tier: ExamTier;
  readonly net: number;
  readonly maxDrawdownUsd: number;
  readonly trades: number;
  readonly winRatePct: number | null;
  readonly rrr: number | null;
  readonly lots: string;
  readonly code: string;
};

/** Share of the account one position ever reached, so a heavy run is visible. */
export function maxLeverage(
  fills: readonly { qty: number; price: number; kind: string }[],
  startingBalance: number,
): number | null {
  if (startingBalance <= 0) return null;
  let open = 0;
  let peak = 0;
  for (const fill of fills) {
    if (fill.kind === "open") open += fill.qty;
    else open = Math.max(0, open - fill.qty);
    peak = Math.max(peak, open * fill.price);
  }
  return peak > 0 ? Math.round((peak / startingBalance) * 100) / 100 : null;
}

/** Reward-to-risk shown as average win over average loss; null when either side is missing. */
export function rewardRisk(avgWin: number | null, avgLoss: number | null): number | null {
  if (avgWin === null || avgLoss === null || avgWin <= 0 || avgLoss <= 0) return null;
  return Math.round((avgWin / avgLoss) * 100) / 100;
}

export function examResult(input: {
  readonly net: number;
  readonly maxDrawdownUsd: number;
  readonly trades: number;
  readonly winRatePct?: number | null;
  readonly rrr?: number | null;
  readonly lots?: string;
}): ExamResult {
  const tier = examTier(input.maxDrawdownUsd, input.trades);
  const net = Math.round(input.net * 100) / 100;
  const maxDrawdownUsd = Math.round(input.maxDrawdownUsd * 100) / 100;
  const winRatePct = input.winRatePct ?? null;
  const rrr = input.rrr ?? null;
  const lots = input.lots ?? "—";
  const code = `EXAM-v1-${fnv1a(`${EXAM_ID}:${net}:${maxDrawdownUsd}:${input.trades}`)
    .toString(16)
    .padStart(8, "0")
    .slice(0, 8)
    .toUpperCase()}`;
  return { tier, net, maxDrawdownUsd, trades: input.trades, winRatePct, rrr, lots, code };
}

/** One prefilled link; the respondent only types their email. */
export function examSubmitUrl(result: ExamResult, tool: string): string {
  const params = new URLSearchParams({
    usp: "pp_url",
    [ENTRY.tool]: tool,
    [ENTRY.tier]: EXAM_TIER_LABEL[result.tier],
    [ENTRY.net]: String(result.net),
    [ENTRY.maxDd]: String(result.maxDrawdownUsd),
    [ENTRY.trades]: String(result.trades),
    [ENTRY.winRate]: result.winRatePct === null ? "—" : String(result.winRatePct),
    [ENTRY.rrr]: result.rrr === null ? "—" : String(result.rrr),
    [ENTRY.lots]: result.lots,
    [ENTRY.code]: result.code,
  });
  return `${EXAM_FORM_URL}?${params.toString()}`;
}

const SUBMITTED_KEY = "perpdrill.exam.submitted.v1";
const BEST_KEY = "perpdrill.exam.best.v1";

export type Submitted = { readonly at: number; readonly tier: ExamTier; readonly code: string };

export function readSubmitted(): Submitted | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SUBMITTED_KEY) ?? "null");
    if (typeof raw !== "object" || raw === null) return null;
    const value = raw as Record<string, unknown>;
    if (typeof value.at !== "number" || typeof value.code !== "string") return null;
    const tier: ExamTier = value.tier === "distinction" ? "distinction" : "pass";
    return { at: value.at, tier, code: value.code };
  } catch {
    return null;
  }
}

export function markSubmitted(result: ExamResult): Submitted {
  const submitted: Submitted = { at: Date.now(), tier: result.tier, code: result.code };
  try {
    localStorage.setItem(SUBMITTED_KEY, JSON.stringify(submitted));
  } catch {
    // Storage is optional; the card still shows the result.
  }
  return submitted;
}

/** Best run on this browser, so the card can say what a submission would give up. */
export function readBest(): ExamResult | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(BEST_KEY) ?? "null");
    if (typeof raw !== "object" || raw === null) return null;
    const value = raw as Record<string, unknown>;
    if (typeof value.net !== "number" || typeof value.code !== "string") return null;
    return examResult({
      net: value.net,
      maxDrawdownUsd: typeof value.maxDrawdownUsd === "number" ? value.maxDrawdownUsd : 0,
      trades: typeof value.trades === "number" ? value.trades : 0,
    });
  } catch {
    return null;
  }
}

export function recordBest(result: ExamResult): void {
  const best = readBest();
  const better =
    best === null || result.tier !== best.tier
      ? result.tier === "distinction"
      : result.maxDrawdownUsd < best.maxDrawdownUsd ||
        (result.maxDrawdownUsd === best.maxDrawdownUsd && result.net > best.net);
  if (!better) return;
  try {
    localStorage.setItem(
      BEST_KEY,
      JSON.stringify({
        net: result.net,
        maxDrawdownUsd: result.maxDrawdownUsd,
        trades: result.trades,
      }),
    );
  } catch {
    // Storage is optional.
  }
}
