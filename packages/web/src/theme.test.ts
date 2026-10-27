import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SUPPORTED_LANGS,
  THEMES,
  catalogValue,
  readStoredTheme,
  type MessageKey,
  type Theme,
} from "./i18n.ts";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const desk = readFileSync(new URL("./desk.ts", import.meta.url), "utf8");

const BLOCKED_HEX = [
  "#0b0e11",
  "#181a20",
  "#1e2329",
  "#2b3139",
  "#0ecb81",
  "#f6465d",
  "#eaecef",
  "#f0b90b",
];

const BLOCKED_LABEL = /exchange|defi|on-?chain|交易所|鏈上|链上|オンチェーン|디파이|온체인/i;

const TEXT_SURFACES = [
  "bg",
  "bg-raised",
  "bg-inset",
  "bg-header",
  "banner-bg",
  "panel-deep",
] as const;

function themeLabelKey(theme: Theme): MessageKey {
  switch (theme) {
    case "teal":
      return "theme.teal";
    case "midnight":
      return "theme.midnight";
    case "aqua":
      return "theme.aqua";
    case "violet":
      return "theme.violet";
    case "daylight":
      return "theme.daylight";
    case "dusk":
      return "theme.dusk";
    case "dark":
      return "theme.dark";
    case "slate":
      return "theme.slate";
    default: {
      const unexpected: never = theme;
      return unexpected;
    }
  }
}

function parseBlocks(source: string): Map<string, Map<string, string>> {
  const blocks = new Map<string, Map<string, string>>();
  const re = /(?::root|\[data-theme="(?<theme>[a-z]+)"\])\s*\{(?<body>[^}]*)\}/g;
  for (const match of source.matchAll(re)) {
    const name = match.groups?.theme ?? "teal";
    const body = match.groups?.body ?? "";
    const vars = new Map<string, string>();
    for (const line of body.split("\n")) {
      const prop = /(?:--)?([a-z0-9-]+):\s*([^;]+);/i.exec(line);
      if (prop?.[1] !== undefined && prop[2] !== undefined) {
        vars.set(prop[1], prop[2].trim());
      }
    }
    blocks.set(name, vars);
  }
  return blocks;
}

function tokensFor(blocks: Map<string, Map<string, string>>, theme: Theme): Map<string, string> {
  const root = blocks.get("teal");
  if (root === undefined) {
    throw new Error("missing :root tokens");
  }
  const merged = new Map(root);
  if (theme !== "teal") {
    const over = blocks.get(theme);
    if (over === undefined) {
      throw new Error(`missing ${theme} tokens`);
    }
    for (const [key, value] of over) {
      merged.set(key, value);
    }
  }
  return merged;
}

function hex(tokens: Map<string, string>, name: string): string {
  const value = tokens.get(name) ?? "";
  if (!/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`${name} is not a 6-digit color`);
  }
  return value.toLowerCase();
}

function channels(value: string): readonly [number, number, number] {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

function luminance(value: string): number {
  const [red, green, blue] = channels(value);
  const channel = (component: number): number => {
    const unit = component / 255;
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function expectContrast(
  label: string,
  foreground: string,
  background: string,
  minimum: number,
): void {
  const ratio = contrast(foreground, background);
  if (ratio < minimum) {
    throw new Error(`${label} contrast ${ratio.toFixed(2)} is below ${minimum}`);
  }
}

describe("theme preference", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([null, "unknown"])("defaults to Slate for stored value %s", (stored) => {
    vi.stubGlobal("localStorage", { getItem: () => stored });
    expect(readStoredTheme()).toBe("slate");
  });

  it("defaults to Slate when preference storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("storage unavailable");
      },
    });
    expect(readStoredTheme()).toBe("slate");
  });

  it.each(THEMES)("preserves an existing %s preference", (theme) => {
    vi.stubGlobal("localStorage", { getItem: () => theme });
    expect(readStoredTheme()).toBe(theme);
  });

  it("paints Slate before JavaScript starts and labels it as the default", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    expect(html).toContain('<html lang="en" data-theme="slate">');
    expect(html).toContain('<meta name="theme-color" content="#171c22"');
    for (const lang of SUPPORTED_LANGS) {
      expect(catalogValue(lang, "theme.teal")).not.toMatch(/default|預設|默认|既定|기본/);
      expect(catalogValue(lang, "theme.slate")).toMatch(/default|預設|默认|既定|기본/);
    }
  });
});

describe("desk themes", () => {
  const blocks = parseBlocks(css);

  it("keeps the header theme menu and original token names", () => {
    expect(desk).toContain('className: "theme-select"');
    expect(desk).toContain("applyDocumentTheme");
    expect(css).toContain(".theme-select");
    expect(css).not.toContain("[data-theme] .chart-stage");
    expect(css).not.toContain("[data-theme] .chip.is-current");
    const lowered = css.toLowerCase();
    for (const blocked of BLOCKED_HEX) {
      if (lowered.includes(blocked)) {
        throw new Error(`styles.css contains ${blocked}`);
      }
    }
    for (const lang of SUPPORTED_LANGS) {
      for (const theme of THEMES) {
        expect(catalogValue(lang, themeLabelKey(theme))).not.toMatch(BLOCKED_LABEL);
      }
    }
  });

  it.each(THEMES)("%s uses a cool green accent with readable text", (theme) => {
    const tokens = tokensFor(blocks, theme);
    const accent = hex(tokens, "accent");
    const [red, green, blue] = channels(accent);
    expect(green).toBeGreaterThan(red);
    expect(green).toBeGreaterThan(blue);
    expect(tokens.get("accent-rgb")).toBe(`${red} ${green} ${blue}`);
    const background = hex(tokens, "bg");
    expect(tokens.get("bg-rgb")).toBe(channels(background).join(" "));
    expect(tokens.get("long-rgb")).toBe(channels(hex(tokens, "long")).join(" "));
    expect(tokens.get("short-rgb")).toBe(channels(hex(tokens, "short")).join(" "));
    expect(tokens.get("color-scheme")).toBe(theme === "daylight" ? "light" : "dark");
    expect(tokens.get("overlay")?.length ?? 0).toBeGreaterThan(0);

    for (const surface of TEXT_SURFACES) {
      const fill = hex(tokens, surface);
      expectContrast(`${theme} text/${surface}`, hex(tokens, "text"), fill, 4.5);
      expectContrast(`${theme} dim/${surface}`, hex(tokens, "text-dim"), fill, 4.5);
      expectContrast(`${theme} faint/${surface}`, hex(tokens, "text-faint"), fill, 4.5);
    }
    for (const surface of ["bg", "bg-raised", "bg-inset", "bg-header"] as const) {
      expectContrast(`${theme} accent/${surface}`, accent, hex(tokens, surface), 4.5);
    }
    expectContrast(`${theme} ink/accent`, hex(tokens, "accent-ink"), accent, 4.5);
    expectContrast(`${theme} long/long-bg`, hex(tokens, "long"), hex(tokens, "long-bg"), 4.5);
    expectContrast(`${theme} long/bg`, hex(tokens, "long"), background, 4.5);
    expectContrast(`${theme} short/short-bg`, hex(tokens, "short"), hex(tokens, "short-bg"), 4.5);
    expectContrast(`${theme} short/bg`, hex(tokens, "short"), background, 4.5);
    expectContrast(`${theme} danger/bg`, hex(tokens, "danger"), background, 4.5);
    expectContrast(`${theme} danger/panel`, hex(tokens, "danger"), hex(tokens, "panel-deep"), 4.5);
    expectContrast(`${theme} prop/bg`, hex(tokens, "prop"), background, 3);
    expectContrast(`${theme} prop/inset`, hex(tokens, "prop"), hex(tokens, "bg-inset"), 3);
  });
});
