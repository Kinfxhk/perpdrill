import { expect, test, type Locator } from "@playwright/test";

test.use({ isMobile: true, hasTouch: true });

/** A viewport-visible control can still be clipped by a nested scroll area. */
async function expectFullyReachable(control: Locator): Promise<void> {
  await control.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        let top = Math.max(0, rect.top);
        let bottom = Math.min(innerHeight, rect.bottom);
        for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
          if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) {
            const clip = parent.getBoundingClientRect();
            top = Math.max(top, clip.top);
            bottom = Math.min(bottom, clip.bottom);
          }
        }
        return Math.max(0, rect.height - Math.max(0, bottom - top));
      }),
    )
    .toBeLessThanOrEqual(1);
  await control.click({ trial: true });
}

for (const viewport of [
  { width: 844, height: 390 },
  { width: 667, height: 375 },
  { width: 568, height: 320 },
]) {
  test(`landscape ticket controls scroll fully into view at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      localStorage.setItem("perpdrill.lang", "en");
      localStorage.setItem("perpdrill.countdown", "0");
    });
    await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
    await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
    await page.goto("/");
    await page.locator("#setup-rules").selectOption("none");
    await page.getByRole("button", { name: "Start backtest", exact: true }).click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByRole("button", { name: "Panel", exact: true }).click();
    const ticket = page.getByRole("complementary", { name: "Order ticket" });
    const limit = ticket.getByRole("button", { name: "Limit", exact: true });
    await expectFullyReachable(limit);
    await limit.click();
    await expectFullyReachable(ticket.locator("#leverage"));
    const price = ticket.locator("#order-price");
    await expectFullyReachable(price);
    await price.fill("1");
    const submit = ticket.getByRole("button", { name: "Place order", exact: true });
    await expectFullyReachable(submit);
    await submit.click();
    await expect(ticket.locator(".orders")).toContainText("Limit");
    const cancel = ticket.getByRole("button", { name: "Cancel", exact: true });
    await expectFullyReachable(cancel);
    await cancel.click();
    await expect(ticket.locator(".orders")).toHaveCount(0);
    const source = page.locator(".colophon .source-link");
    await expect(source).toBeInViewport();
    await source.click({ trial: true });
    await page.locator(".desk-notices summary").click();
    await expect(page.locator(".notice-content .disclaimer")).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
      viewport.height + 1,
    );
  });
}
