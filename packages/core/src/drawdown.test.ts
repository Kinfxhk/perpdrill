import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parsePracticePreset,
  priceForEquityFloor,
  replaySession,
  staticFloorUsd,
  type Bar,
  type PracticePreset,
  type SessionAction,
} from "./index.ts";

const HOUR = 3_600_000;

function flat(index: number, close: number): Bar {
  return { timeMs: index * HOUR, open: close, high: close, low: close, close };
}

function loadPreset(name: string): PracticePreset {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../presets", name);
  const parsed = parsePracticePreset(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.preset;
}

function openAt(barIndex: number): SessionAction {
  return {
    kind: "open",
    barIndex,
    side: "long",
    leverage: 1,
    powerPct: 100,
    slipToleranceBps: 75,
    realizedImpactBps: 0,
  };
}

function replayAt(preset: PracticePreset, mark: number) {
  return replaySession({
    market: "SYNTH-IDX1",
    series: [flat(0, 100), flat(1, mark)],
    preset,
    actions: [openAt(0)],
    cursor: 1,
  });
}

/**
 * Mark where equity equals `floor` after the open fill, using the same
 * mapping the session uses for the prop line.
 */
function markForFloor(preset: PracticePreset, floor: number): number {
  const opened = replaySession({
    market: "SYNTH-IDX1",
    series: [flat(0, 100)],
    preset,
    actions: [openAt(0)],
    cursor: 0,
  });
  const position = opened.position;
  if (position === null) {
    throw new Error("position did not open");
  }
  const price = priceForEquityFloor({
    floor,
    cash: opened.cash,
    isolatedMargin: position.isolatedMargin,
    qty: position.qty,
    entry: position.entry,
    side: position.side,
  });
  if (price === null) {
    throw new Error("floor price missing");
  }
  return price;
}

function expectFullLoss(preset: PracticePreset, amount: number, floor: number): void {
  const starting = preset.startingBalanceUsd ?? 0;
  expect(staticFloorUsd(starting, amount)).toBe(floor);
  expect(preset.drawdownMode).toBe("static");
  expect(preset.maxDrawdownUsd).toBe(amount);

  const shy = replayAt(preset, markForFloor(preset, floor + 1));
  expect(shy.propBreach).toBeNull();
  expect(shy.liquidated).toBe(false);
  expect(shy.phase).toBe("practice");
  expect(starting - shy.equity).toBeLessThan(amount);
  expect(shy.maxDrawdownFloor).toBe(floor);

  const hit = replayAt(preset, markForFloor(preset, floor));
  expect(hit.propBreach).toBe("max-dd");
  expect(hit.liquidated).toBe(false);
  expect(hit.phase).toBe("drawdown");
  expect(hit.fills.at(-1)?.kind).toBe("breach");
  expect(hit.maxDrawdownFloor).toBe(floor);
}

describe("static USD max drawdown", () => {
  it("fails Instant 50k only after a true loss of 2000 USD", () => {
    const preset = loadPreset("plan-instant-50k.json");
    expect(preset.startingBalanceUsd).toBe(50_000);
    expect(preset.dailyLossLimitPct).toBeNull();
    expect(preset.profitTargetPct).toBeNull();
    expectFullLoss(preset, 2_000, 48_000);

    const opened = replaySession({
      market: "SYNTH-IDX1",
      series: [flat(0, 100)],
      preset,
      actions: [openAt(0)],
      cursor: 0,
    });
    const liq = opened.position?.liqPrice;
    expect(liq).not.toBeUndefined();
    if (liq === undefined) {
      return;
    }
    const gapped = replayAt(preset, liq * 0.5);
    expect(gapped.liquidated).toBe(true);
    expect(gapped.propBreach).toBeNull();
    expect(gapped.phase).toBe("liquidated");
  });

  it("fails Eval Emerald only after a true loss of 3000 USD", () => {
    const preset = loadPreset("plan-1step-emerald.json");
    expect(preset.id).toBe("plan-1step-emerald");
    expect(preset.startingBalanceUsd).toBe(50_000);
    expect(preset.profitTargetPct).toBe(10);
    expect(preset.dailyLossLimitPct).toBeNull();
    expectFullLoss(preset, 3_000, 47_000);
  });
});
