import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUPPORTED_LANGS, translate } from "./i18n.ts";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const desk = readFileSync(new URL("./desk.ts", import.meta.url), "utf8");

const phone = css.slice(css.indexOf("@media (max-width: 899px)"));
const tablet = css.slice(css.indexOf("@media (min-width: 900px) and (max-width: 1199px)"));
const coarse = css.slice(css.indexOf("@media (pointer: coarse)"));
const short = css.slice(css.indexOf("@media (max-height: 520px)"));

describe("responsive desk layout", () => {
  it("keeps the desktop two-column grid with the 340px ticket", () => {
    expect(css).toMatch(
      /\.workspace \{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s*340px;/,
    );
  });

  it("narrows the ticket at the tablet band", () => {
    expect(tablet).toMatch(/\.workspace \{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*280px;/);
  });

  it("folds the ticket and blotter into a phone drawer", () => {
    expect(phone).toMatch(/\.workspace > \.ticket,[\s\S]*?position:\s*fixed;/);
    expect(phone).toMatch(/transform:\s*translateX\(105%\)/);
    expect(phone).toMatch(
      /\.shell\.drawer-open > \.workspace > \.ticket,[\s\S]*?transform:\s*none;/,
    );
    expect(phone).toMatch(/\.shell\.drawer-open \.drawer-overlay \{\s*display:\s*block;/);
  });

  it("pins the replay row as the phone trade bar", () => {
    expect(phone).toMatch(/\.replay \{\s*position:\s*fixed;/);
    expect(phone).toMatch(/padding-bottom:\s*calc\(240px \+ env\(safe-area-inset-bottom, 0px\)\)/);
  });

  it("shows the trade order row only on phones", () => {
    expect(css).toMatch(/\.panel-toggle,[\s\S]*?\.trade-order-row \{\s*display:\s*none;/);
    expect(phone).toMatch(/\.trade-order-row \{\s*display:\s*flex;/);
  });

  it("keeps coarse-pointer targets at 44px on touch tablets", () => {
    expect(coarse).toMatch(/min-height:\s*44px;/);
    expect(coarse).toMatch(/font-size:\s*16px;/);
  });

  it("reclaims chart height on short landscape screens", () => {
    expect(short).toMatch(/\.replay-meters \{\s*display:\s*none;/);
    expect(short).toMatch(/\.chart-stage \{\s*min-height:\s*120px;/);
  });

  it("builds the trade bar and drawer toggle in the desk", () => {
    expect(desk).toContain('className: "trade-order-row"');
    expect(desk).toContain('"panel-toggle"');
    expect(desk).toContain('"drawer-overlay"');
    expect(desk).toContain("drawerOpen: false");
    expect(desk).toContain('"data-testid": "trade-bar"');
  });

  it("labels the panel toggle in every language", () => {
    for (const lang of SUPPORTED_LANGS) {
      expect(translate(lang, "panel.label").length).toBeGreaterThan(0);
    }
  });
});
