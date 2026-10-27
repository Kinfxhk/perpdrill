import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_MARKETS, isMarketId } from "./constants.ts";
import { sampleSeries } from "./series.ts";
import { SYNTHETIC_TIMEFRAMES_MIN, syntheticSeries } from "./synthetic.ts";

const LEGACY_DIGESTS = {
  "SYNTH-NQ": "46e5072e77dd152ea42d579b4b141f76f12464074a7ab958dee57fe431e0af4d",
  "SYNTH-GC": "d40c92d9cd422dd1a2210c29b94d091b7d1c49ed7df77f1bb54483dd422aac54",
  "SYNTH-ES": "4ed6789f9e8286c3b793a587ccecaff72c6f2bae6b88f8cdb1cda5aa6ae08e5e",
} as const;

describe("synthetic markets", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("offers BTC as the fourth synthetic market", () => {
    expect(SAMPLE_MARKETS).toEqual(["SYNTH-NQ", "SYNTH-GC", "SYNTH-ES", "SYNTH-BTC"]);
  });

  it.each(SYNTHETIC_TIMEFRAMES_MIN)(
    "generates repeatable offline BTC bars at %sm",
    (timeframeMin) => {
      vi.stubGlobal("fetch", () => {
        throw new Error("synthetic markets must not fetch exchange data");
      });
      const market = "SYNTH-BTC";
      expect(isMarketId(market)).toBe(true);
      if (!isMarketId(market)) throw new Error("BTC market is missing");
      for (const stress of [false, true]) {
        const spec = { market, seed: 802840008, bars: 600, timeframeMin, stress } as const;
        const bars = syntheticSeries(spec);
        expect(bars).toEqual(syntheticSeries(spec));
        expect(bars).toHaveLength(600);
        expect(bars).not.toEqual(syntheticSeries({ ...spec, market: "SYNTH-NQ" }));
        for (const [index, bar] of bars.entries()) {
          expect(Object.values(bar).every(Number.isFinite)).toBe(true);
          expect(bar.low).toBeGreaterThan(0);
          expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
          expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
          if (index > 0) expect(bar.timeMs - bars[index - 1]!.timeMs).toBe(timeframeMin * 60_000);
        }
      }
      expect(sampleSeries(market)).toHaveLength(24);
    },
  );

  it.each(Object.entries(LEGACY_DIGESTS))(
    "keeps the existing %s seed output unchanged",
    (market, digest) => {
      if (!isMarketId(market)) throw new Error("legacy market is missing");
      const bars = syntheticSeries({ market, seed: 802840008, bars: 600, timeframeMin: 15 });
      expect(createHash("sha256").update(JSON.stringify(bars)).digest("hex")).toBe(digest);
    },
  );
});
