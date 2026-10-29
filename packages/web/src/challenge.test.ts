import { describe, expect, it } from "vitest";
import {
  challengeFor,
  challengeForDay,
  challengeFromSearch,
  challengeHref,
  challengeSetup,
  dailyStreak,
  matchesChallenge,
  readDailyResults,
  writeDailyResult,
  type ChallengeResult,
} from "./challenge.ts";
import { DEFAULT_CUSTOM_RULES, type SessionSetup } from "./setup.ts";

describe("round length", () => {
  it("gives every timeframe enough bars to trade back from a drawdown", () => {
    const days = [
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-11-01",
    ];
    for (const day of days) {
      const challenge = challengeForDay(day);
      if (challenge === null) throw new Error("unreachable day " + day);
      const expected = new Map<number, number>([
        [1, 5_000],
        [5, 2_880],
        [15, 960],
      ]).get(challenge.timeframeMin);
      if (expected !== undefined) expect(challenge.bars).toBe(expected);
    }
  });
});

function fakeStorage(): Storage {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  } as unknown as Storage;
}

const base: SessionSetup = {
  market: "SYNTH-NQ",
  timeframeMin: 15,
  bars: 600,
  seed: 1,
  stress: true,
  dataSource: "synthetic",
  rulesMode: "custom",
  presetId: null,
  custom: { ...DEFAULT_CUSTOM_RULES },
};

const pass: ChallengeResult = { outcome: "pass", maxDrawdownPct: 2.5, bars: 300 };

describe("daily challenge", () => {
  it("builds the same round from the same day", () => {
    const first = challengeForDay("2026-10-28");
    const second = challengeForDay("2026-10-28");
    expect(first).not.toBeNull();
    expect(first).toEqual(second);
    expect(first?.day).toBe("2026-10-28");
  });

  it("rejects a day that is not a real calendar date", () => {
    expect(challengeForDay("2026-02-30")).toBeNull();
    expect(challengeForDay("28-10-2026")).toBeNull();
    expect(challengeFromSearch("")).toBeNull();
    expect(challengeFromSearch("?c=2026-13-01")).toBeNull();
  });

  it("changes the seed from one day to the next", () => {
    const seeds = new Set<number>();
    for (let index = 0; index < 30; index += 1) {
      const day = new Date(Date.UTC(2026, 9, 1 + index)).toISOString().slice(0, 10);
      seeds.add(challengeForDay(day)?.seed ?? -1);
    }
    expect(seeds.size).toBe(30);
  });

  it("uses the UTC day of the clock it is given", () => {
    expect(challengeFor(new Date("2026-10-28T23:30:00.000Z")).day).toBe("2026-10-28");
    expect(challengeFor(new Date("2026-10-28T00:30:00.000Z")).day).toBe("2026-10-28");
  });

  it("round-trips the link and drops other query parameters", () => {
    const challenge = challengeForDay("2026-10-28");
    expect(challenge).not.toBeNull();
    if (challenge === null) {
      return;
    }
    const href = challengeHref(challenge, "https://example.test/perpdrill/?c=old#top");
    expect(challengeFromSearch(new URL(href).search)).toEqual(challenge);
    expect(href).not.toContain("old");
  });

  it("freezes the setup and notices when the player changes it", () => {
    const challenge = challengeForDay("2026-10-28");
    expect(challenge).not.toBeNull();
    if (challenge === null) {
      return;
    }
    const setup = challengeSetup(challenge, base);
    expect(setup.seed).toBe(challenge.seed);
    expect(setup.market).toBe(challenge.market);
    expect(setup.dataSource).toBe("synthetic");
    expect(setup.rulesMode).toBe("preset");
    expect(setup.presetId).toBe("exam-50k");
    expect(matchesChallenge(setup, challenge)).toBe(true);
    expect(matchesChallenge({ ...setup, seed: setup.seed + 1 }, challenge)).toBe(false);
    expect(matchesChallenge({ ...setup, dataSource: "imported" }, challenge)).toBe(false);
  });

  it("keeps the first attempt and counts the streak", () => {
    const storage = fakeStorage();
    writeDailyResult(storage, "2026-10-27", { ...pass, outcome: "fail" });
    writeDailyResult(storage, "2026-10-28", pass);
    const again = writeDailyResult(storage, "2026-10-28", {
      outcome: "fail",
      maxDrawdownPct: 9,
      bars: 600,
    });
    expect(again["2026-10-28"]?.outcome).toBe("pass");
    expect(dailyStreak(again, "2026-10-28")).toBe(2);
    expect(dailyStreak(again, "2026-10-29")).toBe(2);
    expect(readDailyResults(storage)["2026-10-27"]?.outcome).toBe("fail");
  });
});
