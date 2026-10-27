import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUPPORTED_LANGS, translate } from "./i18n.ts";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const desk = readFileSync(new URL("./desk.ts", import.meta.url), "utf8");

const tablet = css.slice(css.indexOf("@media (min-width: 900px) and (max-width: 1199px)"));
const coarse = css.slice(css.indexOf("@media (pointer: coarse)"));
const short = css.slice(css.indexOf("@media (max-width: 899px) and (max-height: 520px)"));
const shortPortrait = css.slice(css.indexOf("@media (max-width: 899px) and (max-height: 700px)"));
const phone = css.slice(css.indexOf("@media (max-width: 899px) {"));

describe("responsive desk layout", () => {
  it("keeps the desktop two-column grid with the 340px ticket", () => {
    expect(css).toMatch(
      /\.workspace \{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s*340px;/,
    );
  });

  it("narrows the ticket at the tablet band", () => {
    expect(tablet).toMatch(/\.workspace \{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*280px;/);
  });

  it("locks the desk to the viewport so the chart owns the leftover height", () => {
    expect(css).toMatch(/\.shell-desk \{[\s\S]*?height:\s*100dvh;[\s\S]*?overflow:\s*hidden;/);
  });

  it("keeps the indicator settings off the chart column", () => {
    expect(css).toMatch(/\.indicator-controls \{\s*position:\s*absolute;/);
    expect(desk).toContain('className: "indicator-settings"');
    expect(desk).toContain('className: "desk-notices"');
  });

  it("folds the ticket and blotter into a phone drawer", () => {
    expect(phone).toMatch(/\.workspace > \.ticket,[\s\S]*?position:\s*fixed;/);
    expect(phone).toMatch(/transform:\s*translateX\(105%\)/);
    expect(phone).toMatch(
      /\.shell\.drawer-open > \.workspace > \.ticket,[\s\S]*?transform:\s*none;/,
    );
    expect(phone).toMatch(/\.shell\.drawer-open \.drawer-overlay \{\s*display:\s*block;/);
  });

  it("keeps the trade bar in flow at the desk bottom on phones", () => {
    expect(phone).toMatch(/\.replay \{\s*flex-direction:\s*column;/);
    expect(phone).toMatch(/padding:\s*4px 8px calc\(4px \+ env\(safe-area-inset-bottom, 0px\)\)/);
  });

  it("shows the trade order row only on phones", () => {
    expect(css).toMatch(
      /\.panel-toggle,\n\s*\.trade-order-row,\n\s*\.drawer-overlay \{\s*display:\s*none;/,
    );
    expect(phone).toMatch(/\.trade-order-row \{\s*display:\s*flex;/);
  });

  it("keeps coarse-pointer targets at 44px on touch tablets and phones", () => {
    expect(coarse).toMatch(/min-height:\s*44px;/);
    expect(coarse).toMatch(/font-size:\s*16px;/);
  });

  it("reclaims chart height on short landscape screens", () => {
    expect(short).toMatch(/\.replay-meters \{\s*display:\s*none;/);
    expect(short).toMatch(/\.replay \{\s*flex-direction:\s*row;/);
  });

  it("drops only the meters on short portrait phones and retains source access in the drawer", () => {
    expect(shortPortrait).toMatch(/\.replay-meters \{\s*display:\s*none;/);
    expect(phone).toMatch(/\.shell\.drawer-open \.colophon \{[\s\S]*?visibility:\s*visible;/);
  });

  it("builds the trade bar and drawer toggle in the desk", () => {
    expect(desk).toContain('className: "trade-order-row"');
    expect(desk).toContain('"panel-toggle"');
    expect(desk).toContain('"drawer-overlay"');
    expect(desk).toContain("drawerOpen: false");
    expect(desk).toContain('"data-testid": "trade-bar"');
    expect(desk).toContain('className: "speed-select"');
    expect(desk).toContain("shell-desk");
  });

  it("labels the panel toggle in every language", () => {
    for (const lang of SUPPORTED_LANGS) {
      expect(translate(lang, "panel.label").length).toBeGreaterThan(0);
    }
  });
});
