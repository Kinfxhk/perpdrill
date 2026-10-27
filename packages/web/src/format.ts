export function formatNumber(value: number, locale: string, digits = 2): string {
  return value.toLocaleString(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatQty(value: number, locale: string): string {
  return value.toLocaleString(locale, { maximumFractionDigits: 6 });
}

export function formatPct(value: number, locale: string): string {
  return `${formatNumber(value, locale, 2)}%`;
}

/** 15 → "15m", 60 → "1h". Minutes that are not a whole hour stay in minutes. */
export function formatTimeframe(minutes: number): string {
  if (minutes > 0 && minutes % 60 === 0) {
    return `${minutes / 60}h`;
  }
  return `${minutes}m`;
}

export function signedNumber(value: number, locale: string, digits = 2): string {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatNumber(value, locale, digits)}`;
}
