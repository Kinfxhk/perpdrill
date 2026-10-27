import { describe, expect, it } from "vitest";
import { parseOhlcCsv } from "./csv.ts";

function line(timeMs: number, close: number): string {
  return `${timeMs},${close - 1},${close + 1},${close - 2},${close}`;
}

describe("parseOhlcCsv", () => {
  it("parses epoch-millisecond rows", () => {
    const rows = Array.from({ length: 120 }, (_, index) =>
      line(1_700_000_000_000 + index * 60_000, 100 + index),
    );
    const parsed = parseOhlcCsv(["time,open,high,low,close,volume", ...rows].join("\n"));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.bars).toHaveLength(120);
      expect(parsed.bars[0]?.timeMs).toBe(1_700_000_000_000);
      expect(parsed.bars[0]?.close).toBe(100);
    }
  });

  it("accepts ISO date strings and a headerless file", () => {
    const rows = Array.from({ length: 120 }, (_, index) => {
      const hour = String(Math.floor(index / 60)).padStart(2, "0");
      const minute = String(index % 60).padStart(2, "0");
      return `2026-01-05T${hour}:${minute}:00Z,100,101,99,100.5`;
    });
    const parsed = parseOhlcCsv(rows.join("\n"));
    expect(parsed.ok).toBe(true);
  });

  it("rejects rows that are too few", () => {
    const parsed = parseOhlcCsv(
      Array.from({ length: 10 }, (_, index) => line(index, 100)).join("\n"),
    );
    expect(parsed).toEqual({ ok: false, error: "count" });
  });

  it("rejects unsorted times", () => {
    const rows = Array.from({ length: 120 }, (_, index) =>
      line(1_700_000_000_000 + (119 - index) * 60_000, 100),
    );
    const parsed = parseOhlcCsv(rows.join("\n"));
    expect(parsed).toEqual({ ok: false, error: "times" });
  });

  it("rejects inconsistent OHLC prices", () => {
    const rows = Array.from({ length: 120 }, (_, index) => line(index * 60_000, 100));
    rows[5] = "300000,100,90,95,100"; // high below the close
    const parsed = parseOhlcCsv(rows.join("\n"));
    expect(parsed).toEqual({ ok: false, error: "prices" });
  });

  it("rejects missing columns", () => {
    const rows = Array.from({ length: 120 }, () => `1,2,3`);
    const parsed = parseOhlcCsv(rows.join("\n"));
    expect(parsed).toEqual({ ok: false, error: "columns" });
  });
});
