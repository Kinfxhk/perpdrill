import { expect, test } from "@playwright/test";

/**
 * Device matrix: the same session flow at phone, tablet and desktop sizes.
 * Geometry comes from explicit viewports, not the device registry.
 */
const SIZES = [
  {
    name: "phone",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  {
    name: "tablet",
    viewport: { width: 1024, height: 768 },
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false,
  },
  {
    name: "desktop",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  },
] as const;

test.describe("working orders", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("places and cancels a working limit order", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("perpdrill.lang", "en"));
    await page.goto("/");
    await page.getByRole("button", { name: "Start backtest" }).click();
    const cancel = page.getByRole("button", { name: "Cancel" });
    if (await cancel.isVisible().catch(() => false)) {
      await cancel.click();
    }
    await expect(page.locator(".chart-stage")).toBeVisible();

    const ticket = page.locator(".workspace > .ticket");
    await ticket.getByRole("button", { name: "Limit", exact: true }).click();
    // The price field prefills with the current mark.
    const price = ticket.locator("#order-price");
    await expect(price).toHaveValue(/.+/);
    // A far-away price keeps the order working instead of filling.
    await price.fill("1");
    await ticket.getByRole("button", { name: "Place order" }).click();
    await expect(ticket.locator(".orders")).toContainText("Limit");
    await ticket.locator(".orders").getByRole("button", { name: "Cancel" }).click();
    await expect(ticket.locator(".orders")).toHaveCount(0);
  });
});

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({
      viewport: size.viewport,
      deviceScaleFactor: size.deviceScaleFactor,
      isMobile: size.isMobile,
      hasTouch: size.hasTouch,
    });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem("perpdrill.lang", "en"));
      await page.goto("/");
    });

    test("fits the setup screen without sideways scroll", async ({ page }) => {
      const widths = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        inner: window.innerWidth,
      }));
      expect(widths.document).toBeLessThanOrEqual(widths.inner);
      expect(widths.body).toBeLessThanOrEqual(widths.inner);
    });

    test("runs a session and places a market order", async ({ page }) => {
      await page.getByRole("button", { name: "Start backtest" }).click();
      // Cancel stops the intro without starting playback, so the desk stays
      // stable while the test trades. (Skip starts playback and re-renders.)
      const cancel = page.getByRole("button", { name: "Cancel" });
      if (await cancel.isVisible().catch(() => false)) {
        await cancel.click();
      }
      const pause = page.getByRole("button", { name: "Pause" });
      if (await pause.isVisible().catch(() => false)) {
        await pause.click();
      }
      await expect(page.locator(".chart-stage")).toBeVisible();

      const widths = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        inner: window.innerWidth,
      }));
      expect(widths.document).toBeLessThanOrEqual(widths.inner);
      expect(widths.body).toBeLessThanOrEqual(widths.inner);

      if (size.name === "phone") {
        // Bottom trade bar: replay controls plus the order row, 44px tap targets.
        const bar = page.locator('[data-testid="trade-bar"]');
        await expect(bar).toBeVisible();
        const box = await bar.boundingBox();
        expect(box).not.toBeNull();
        if (box !== null) {
          expect(box.width).toBeLessThanOrEqual(size.viewport.width);
        }
        for (const name of ["Long", "Short", "Buy / Long"]) {
          const button = bar.getByRole("button", { name, exact: true });
          const rect = await button.boundingBox();
          expect(rect).not.toBeNull();
          if (rect !== null) {
            expect(rect.height).toBeGreaterThanOrEqual(44);
          }
        }

        // Drawer: panel toggle opens it, an outside tap closes it.
        const toggle = page.getByRole("button", { name: "Panel" });
        await toggle.click();
        await expect(page.locator(".shell")).toHaveClass(/drawer-open/);
        await page.locator(".drawer-overlay").click({ position: { x: 20, y: 20 } });
        await expect(page.locator(".shell")).not.toHaveClass(/drawer-open/);

        // Order from the bar: 100% buying power, buy, then flatten.
        await bar.getByRole("button", { name: "100%" }).click();
        await bar.getByRole("button", { name: "Buy / Long", exact: true }).click();
        await expect(bar.getByRole("button", { name: "Close" })).toBeVisible();
        await bar.getByRole("button", { name: "Close" }).click();
        await expect(bar.getByRole("button", { name: "Buy / Long", exact: true })).toBeVisible();

        // The fixed bar never covers the last content in the flow.
        const clearance = await page.evaluate(() => {
          const barRect = document.querySelector(".replay")?.getBoundingClientRect();
          const colophonRect = document.querySelector(".colophon")?.getBoundingClientRect();
          if (barRect === undefined || colophonRect === undefined) {
            return 1;
          }
          return barRect.top - colophonRect.bottom;
        });
        expect(clearance).toBeGreaterThanOrEqual(0);
      } else {
        // Two-column desks keep the ticket in flow; the phone bar stays hidden.
        await expect(page.locator(".workspace > .ticket")).toBeVisible();
        await expect(page.locator('[data-testid="trade-bar"]')).toBeHidden();

        await page
          .locator(".workspace > .ticket")
          .getByRole("button", { name: "Buy / Long", exact: true })
          .click();
        await expect(
          page.locator(".workspace > .ticket").getByRole("button", { name: "Close" }),
        ).toBeVisible();
        await page.locator(".workspace > .ticket").getByRole("button", { name: "Close" }).click();
      }
    });
  });
}
