import type { Bar } from "@perpdrill/core";

/**
 * Live public market data fetched straight into the browser from Binance's
 * public data mirror. No API key, nothing bundled or redistributed; the
 * desk downloads on demand and attributes the source.
 */
export const LIVE_PAIRS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"] as const;

export type LivePair = (typeof LIVE_PAIRS)[number];

export function isLivePair(value: string): value is LivePair {
  return (LIVE_PAIRS as readonly string[]).includes(value);
}

const BINANCE_DATA_HOST = "https://data-api.binance.vision";

function intervalFor(timeframeMin: number): string {
  switch (timeframeMin) {
    case 3:
      return "3m";
    case 5:
      return "5m";
    case 15:
      return "15m";
    case 60:
      return "1h";
    case 240:
      return "4h";
    default:
      return "1m";
  }
}

export async function fetchLiveKlines(
  pair: LivePair,
  timeframeMin: number,
  limit: number,
): Promise<readonly Bar[]> {
  const url = `${BINANCE_DATA_HOST}/api/v3/klines?symbol=${pair}&interval=${intervalFor(timeframeMin)}&limit=${limit}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`live data fetch failed: ${response.status}`);
  }
  const raw: unknown = await response.json();
  if (!Array.isArray(raw)) {
    throw new Error("live data fetch failed: malformed payload");
  }
  const bars: Bar[] = [];
  for (const row of raw) {
    if (!Array.isArray(row)) {
      throw new Error("live data fetch failed: malformed row");
    }
    const [openTime, open, high, low, close, volume] = row as unknown[];
    if (
      typeof openTime !== "number" ||
      typeof open !== "string" ||
      typeof high !== "string" ||
      typeof low !== "string" ||
      typeof close !== "string"
    ) {
      throw new Error("live data fetch failed: malformed row");
    }
    const size = typeof volume === "string" ? Number(volume) : Number.NaN;
    bars.push({
      timeMs: openTime,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      ...(Number.isFinite(size) ? { volume: size } : {}),
    });
  }
  return bars;
}
