import { expect, test } from "@playwright/test";

const languages = ["zh-Hant", "en", "zh-Hans", "ja", "ko"] as const;
const widths = [320, 375, 393, 430] as const;

test.use({ isMobile: true, hasTouch: true });

for (const language of languages) {
  for (const width of widths) {
    test(`setup header keeps ${language} labels horizontal at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 852 });
      await page.addInitScript((lang) => {
        if (localStorage.getItem("perpdrill.lang") === null) {
          localStorage.setItem("perpdrill.lang", lang);
        }
      }, language);
      await page.goto("/");
      const header = page.locator(".topnav");
      const layout = await header.evaluate((element) => {
        const buttons = [...element.querySelectorAll("nav button")].map((button) => {
          const range = document.createRange();
          range.selectNodeContents(button);
          const rect = button.getBoundingClientRect();
          const textRects = [...range.getClientRects()];
          return {
            lines: textRects.length,
            textFits: textRects.every((text) => text.left >= rect.left && text.right <= rect.right),
            top: rect.top,
            height: rect.height,
          };
        });
        const selects = [...element.querySelectorAll("select")].map((select) => {
          const rect = select.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, height: rect.height };
        });
        return {
          buttons,
          selects,
          height: element.getBoundingClientRect().height,
          documentWidth: document.documentElement.scrollWidth,
        };
      });
      expect(layout.buttons.map((button) => button.lines)).toEqual([1, 1, 1]);
      expect(layout.buttons.every((button) => button.textFits)).toBe(true);
      expect(new Set(layout.buttons.map((button) => button.top)).size).toBe(1);
      expect(new Set(layout.selects.map((select) => select.top)).size).toBe(1);
      expect(layout.height).toBeLessThanOrEqual(150);
      expect(layout.documentWidth).toBeLessThanOrEqual(width);
      for (const control of [...layout.buttons, ...layout.selects]) {
        expect(control.height).toBeGreaterThanOrEqual(44);
      }
      for (const select of layout.selects) {
        expect(select.left).toBeGreaterThanOrEqual(0);
        expect(select.right).toBeLessThanOrEqual(width);
      }
      await page.locator("#theme").selectOption("daylight");
      await expect(page.locator("html")).toHaveAttribute("data-theme", "daylight");
      await page.locator("#lang").selectOption(language === "en" ? "zh-Hant" : "en");
      await page.reload();
      await expect(page.locator("#lang")).toHaveValue(language === "en" ? "zh-Hant" : "en");
      await expect(page.locator("#theme")).toHaveValue("daylight");
    });
  }
}
