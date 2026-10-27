import { MAX_SYNTHETIC_BARS, MIN_SYNTHETIC_BARS } from "./synthetic.ts";
import type { Bar } from "./series.ts";

/**
 * Strict OHLCV CSV import. Columns: time, open, high, low, close, volume (the volume
 * column is optional and kept only when it parses). Time is a Unix epoch in
 * milliseconds or an ISO date string. Teaching-grade: prices must be positive, OHLC
 * consistent, times strictly increasing, and the row count inside the synthetic bounds.
 */
export type CsvImportError = "empty" | "columns" | "times" | "prices" | "count";

export type CsvImportResult =
  | { readonly ok: true; readonly bars: readonly Bar[] }
  | { readonly ok: false; readonly error: CsvImportError };

const HEADER_RE = /^(time|timestamp|ts|date|datetime|open_time|opentime)\b/i;

function parseTime(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  const epoch = Number(trimmed);
  if (Number.isFinite(epoch) && trimmed.match(/^\d{10,13}(\.\d+)?$/)) {
    // 10-digit epochs are seconds.
    return epoch < 10_000_000_000 ? epoch * 1000 : epoch;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePrice(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Optional size column. A blank or unparsable value leaves the bar without volume. */
function parseVolume(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function parseOhlcCsv(text: string): CsvImportResult {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    return { ok: false, error: "empty" };
  }
  let rows = lines;
  if (HEADER_RE.test(lines[0] ?? "")) {
    rows = lines.slice(1);
  }
  if (rows.length === 0) {
    return { ok: false, error: "empty" };
  }
  if (rows.length < MIN_SYNTHETIC_BARS) {
    return { ok: false, error: "count" };
  }
  if (rows.length > MAX_SYNTHETIC_BARS) {
    return { ok: false, error: "count" };
  }
  const bars: Bar[] = [];
  for (const line of rows) {
    const parts = line.split(",");
    if (parts.length < 5) {
      return { ok: false, error: "columns" };
    }
    const timeMs = parseTime(parts[0] ?? "");
    const open = parsePrice(parts[1] ?? "");
    const high = parsePrice(parts[2] ?? "");
    const low = parsePrice(parts[3] ?? "");
    const close = parsePrice(parts[4] ?? "");
    if (timeMs === null || open === null || high === null || low === null || close === null) {
      return { ok: false, error: "prices" };
    }
    if (high < Math.max(open, close) || low > Math.min(open, close) || low > high) {
      return { ok: false, error: "prices" };
    }
    const previous = bars[bars.length - 1];
    if (previous !== undefined && timeMs <= previous.timeMs) {
      return { ok: false, error: "times" };
    }
    const volume = parseVolume(parts[5]);
    bars.push({ timeMs, open, high, low, close, ...(volume === undefined ? {} : { volume }) });
  }
  return { ok: true, bars };
}
