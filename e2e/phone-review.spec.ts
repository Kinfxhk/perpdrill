import { expect, test } from "@playwright/test";

for (const viewport of [
  { width: 375, height: 667 },
  { width: 320, height: 568 },
]) {
  test.describe(`phone review ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem("perpdrill.lang", "en");
        localStorage.setItem("perpdrill.countdown", "1");
        localStorage.setItem("perpdrill.setup", JSON.stringify({ bars: 100, seed: 42 }));
      });
      // Keep the real countdown and playback callbacks, but stop renders racing taps.
      await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
      await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
      await page.goto("/");
      await page.locator("#setup-rules").selectOption("none");
      await expect(page.locator("#setup-rules")).toHaveValue("none");
      await page.getByRole("button", { name: "Start backtest", exact: true }).click();
      await page.getByTestId("countdown-skip").click();
      await expect(page.getByTestId("countdown")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    });

    for (const entry of ["manual end", "exhaustion", "primary navigation", "panel tab"]) {
      test(`shows Review through ${entry} and keeps source and notices reachable`, async ({
        page,
      }) => {
        const stage = page.locator(".chart-stage").first();
        const before = await stage.boundingBox();

        if (entry === "manual end") {
          await page.getByRole("button", { name: "End session", exact: true }).click();
          await expect(
            page.getByRole("button", { name: "End session", exact: true }),
          ).toBeDisabled();
        } else if (entry === "exhaustion") {
          await page.locator(".speed-select").selectOption("100");
          await page.clock.runFor(10_000);
          await expect(page.locator(".replay-meters .stat-value").last()).toHaveText("100/100");
          await expect(
            page.getByRole("button", { name: "End session", exact: true }),
          ).toBeDisabled();
        } else if (entry === "primary navigation") {
          await page.getByRole("button", { name: "Pause", exact: true }).click();
          await page.locator('[data-action="leave-practice"]').click();
          await page
            .getByRole("navigation", { name: "Primary" })
            .getByRole("button", { name: "Review", exact: true })
            .click();
        } else {
          await page.getByRole("button", { name: "Pause", exact: true }).click();
          await page.getByRole("button", { name: "Panel", exact: true }).click();
          await page.locator(".tabs").getByRole("button", { name: "Review", exact: true }).click();
        }

        await expect(page.locator(".shell")).toHaveClass(/drawer-open/, { timeout: 1500 });
        await expect(page.getByRole("button", { name: "Panel", exact: true })).toHaveAttribute(
          "aria-expanded",
          "true",
        );
        await expect(page.locator(".review")).toBeVisible();
        await expect(page.locator(".verdict")).toBeInViewport();
        const source = page.locator(".colophon .source-link");
        await expect(source).toHaveAttribute("href", "https://github.com/Kinfxhk/perpdrill");
        await expect(source).toBeInViewport();
        await source.click({ trial: true });
        await page.locator(".desk-notices summary").click();
        await expect(page.locator(".notice-content .banner")).toBeVisible();
        await expect(page.locator(".notice-content .banner")).toBeInViewport();
        await expect(page.locator(".notice-content .disclaimer")).toBeVisible();
        await expect(page.locator(".notice-content .disclaimer")).toBeInViewport();
        await page.locator(".desk-notices summary").click();
        await page.keyboard.press("Escape");
        await expect(page.locator(".shell")).not.toHaveClass(/drawer-open/);
        const after = await stage.boundingBox();
        expect(before).not.toBeNull();
        expect(after).not.toBeNull();
        expect(after!.height).toBe(before!.height);
        expect(after!.y + after!.height).toBeLessThanOrEqual(viewport.height);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          viewport.width,
        );
        expect(
          await page.evaluate(() => document.documentElement.scrollHeight),
        ).toBeLessThanOrEqual(viewport.height + 1);
      });
    }
  });
}
