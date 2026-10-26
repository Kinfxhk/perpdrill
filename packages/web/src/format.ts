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

export function signedNumber(value: number, locale: string, digits = 2): string {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatNumber(value, locale, digits)}`;
}
