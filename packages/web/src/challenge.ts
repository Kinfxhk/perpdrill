import { DEFAULT_SYNTHETIC_BARS, SAMPLE_MARKETS, type SyntheticTimeframe } from "@perpdrill/core";
import { EXAM_ID } from "./exam.ts";
import { type SessionSetup } from "./setup.ts";

/**
 * One frozen drill per UTC day. Everyone who opens that day gets the same bars,
 * the same rules and the same seed, so two players can compare one run without
 * a server: the day string alone rebuilds the whole setup.
 */
export type Challenge = {
  readonly day: string;
  readonly market: SessionSetup["market"];
  readonly timeframeMin: SyntheticTimeframe;
  readonly bars: number;
  readonly seed: number;
};

export const CHALLENGE_PARAM = "c";

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Rotation keeps the desk from being the same market every day. */
// Fast timeframes only: an hour bar makes a one-day round feel like waiting.
const TIMEFRAMES: readonly SyntheticTimeframe[] = [1, 5, 15];

/**
 * Bars per timeframe so a round lasts roughly the same market time (about ten days
 * at 5m). A short round ends before a player who is behind can trade back.
 */
const BARS_BY_TIMEFRAME: Partial<Record<SyntheticTimeframe, number>> = {
  1: 5_000, // the generator cap: ~3.5 days
  5: 2_880,
  15: 960,
};

/** FNV-1a. Stable across runs and browsers; the day string is the whole input. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function isChallengeDay(value: string): boolean {
  if (!DAY_PATTERN.test(value)) {
    return false;
  }
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

export function challengeForDay(day: string): Challenge | null {
  if (!isChallengeDay(day)) {
    return null;
  }
  const hash = fnv1a(`perpdrill-daily:${day}`);
  const timeframeMin = TIMEFRAMES[(hash >>> 8) % TIMEFRAMES.length] ?? 15;
  return {
    day,
    market: SAMPLE_MARKETS[hash % SAMPLE_MARKETS.length] ?? SAMPLE_MARKETS[0],
    timeframeMin,
    bars: BARS_BY_TIMEFRAME[timeframeMin] ?? DEFAULT_SYNTHETIC_BARS,
    seed: hash,
  };
}

/** UTC day, so one round is open at the same moment everywhere. */
export function challengeFor(now: Date = new Date()): Challenge {
  const day = now.toISOString().slice(0, 10);
  const challenge = challengeForDay(day);
  if (challenge === null) {
    throw new Error(`unreachable challenge day ${day}`);
  }
  return challenge;
}

export function challengeFromSearch(search: string): Challenge | null {
  const value = new URLSearchParams(search).get(CHALLENGE_PARAM);
  return value === null ? null : challengeForDay(value);
}

export function challengeSetup(challenge: Challenge, base: SessionSetup): SessionSetup {
  return {
    ...base,
    market: challenge.market,
    timeframeMin: challenge.timeframeMin,
    bars: challenge.bars,
    seed: challenge.seed,
    stress: false,
    dataSource: "synthetic",
    // This period's special event: the daily round runs the campaign exam rules.
    rulesMode: "preset",
    presetId: EXAM_ID,
    presetTargetPct: null,
    presetDailyPct: null,
  };
}

/** True when the desk is still running exactly the frozen round, not a tweak of it. */
export function matchesChallenge(setup: SessionSetup, challenge: Challenge): boolean {
  return (
    setup.dataSource === "synthetic" &&
    setup.market === challenge.market &&
    setup.timeframeMin === challenge.timeframeMin &&
    setup.bars === challenge.bars &&
    setup.seed === challenge.seed &&
    // Changing the rules mid-round must not count as the frozen round.
    setup.rulesMode === "preset" &&
    setup.presetId === EXAM_ID
  );
}

export function challengeHref(challenge: Challenge, baseUrl: string): string {
  const url = new URL(baseUrl);
  url.search = "";
  url.hash = "";
  url.searchParams.set(CHALLENGE_PARAM, challenge.day);
  return url.toString();
}

export type ChallengeOutcome = "pass" | "fail" | "unfinished";

export type ChallengeResult = {
  readonly outcome: ChallengeOutcome;
  readonly maxDrawdownPct: number;
  readonly bars: number;
};

export type DailyResults = Readonly<Record<string, ChallengeResult>>;

const RESULTS_KEY = "perpdrill.dailyResults";
/** Keeps local storage bounded; older days stop being listed, not deleted from history. */
const KEEP_DAYS = 30;

const OUTCOMES: readonly ChallengeOutcome[] = ["pass", "fail", "unfinished"];

function parseResult(value: unknown): ChallengeResult | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const outcome = record.outcome;
  const maxDrawdownPct = record.maxDrawdownPct;
  const bars = record.bars;
  if (typeof outcome !== "string" || !OUTCOMES.includes(outcome as ChallengeOutcome)) {
    return null;
  }
  if (typeof maxDrawdownPct !== "number" || !Number.isFinite(maxDrawdownPct)) {
    return null;
  }
  if (typeof bars !== "number" || !Number.isFinite(bars)) {
    return null;
  }
  return { outcome: outcome as ChallengeOutcome, maxDrawdownPct, bars };
}

export function readDailyResults(storage: Storage): DailyResults {
  try {
    const raw: unknown = JSON.parse(storage.getItem(RESULTS_KEY) ?? "{}");
    if (typeof raw !== "object" || raw === null) {
      return {};
    }
    const results: Record<string, ChallengeResult> = {};
    for (const [day, value] of Object.entries(raw)) {
      const result = isChallengeDay(day) ? parseResult(value) : null;
      if (result !== null) {
        results[day] = result;
      }
    }
    return results;
  } catch {
    return {};
  }
}

/** One ranked attempt per day: an existing result is never overwritten. */
export function writeDailyResult(
  storage: Storage,
  day: string,
  result: ChallengeResult,
): DailyResults {
  const results = { ...readDailyResults(storage) };
  if (results[day] === undefined) {
    results[day] = result;
  }
  const kept = Object.keys(results).sort().reverse().slice(0, KEEP_DAYS);
  const pruned: Record<string, ChallengeResult> = {};
  for (const key of kept) {
    const value = results[key];
    if (value !== undefined) {
      pruned[key] = value;
    }
  }
  try {
    storage.setItem(RESULTS_KEY, JSON.stringify(pruned));
  } catch {
    // Storage is optional; the desk still runs.
  }
  return pruned;
}

function shiftDay(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + delta * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Played days in a row, counting back from today (or yesterday if today is unplayed). */
export function dailyStreak(results: DailyResults, today: string): number {
  let day = results[today] === undefined ? shiftDay(today, -1) : today;
  let streak = 0;
  while (results[day] !== undefined) {
    streak += 1;
    day = shiftDay(day, -1);
  }
  return streak;
}
