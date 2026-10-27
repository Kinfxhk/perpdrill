import { expect, test } from "@playwright/test";

/** Pause playback and confirm it took: the button must flip back to Play. */
async function ensurePaused(page: import("@playwright/test").Page): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const pause = page.getByRole("button", { name: "Pause" });
    if (await pause.isVisible().catch(() => false)) {
      await pause.click();
      try {
        await page
          .getByRole("button", { name: "Play" })
          .waitFor({ state: "visible", timeout: 2000 });
        return;
      } catch {
        // The click was swallowed by a render; try again.
      }
    } else {
      await page.waitForTimeout(300);
    }
  }
}

/** Wait until the bar counter stops changing: the desk is no longer rendering. */
async function waitForQuietDesk(page: import("@playwright/test").Page): Promise<void> {
  const barStat = page.locator(".replay-meters .stat-value").last();
  const first = await barStat.textContent();
  await page.waitForTimeout(1300);
  const second = await barStat.textContent();
  if (first !== second) {
    await waitForQuietDesk(page);
  }
}

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

test.describe("theme preferences", () => {
  test("starts in Slate and preserves a theme chosen by the user after reload", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "slate");
    await expect(page.locator("#theme")).toHaveValue("slate");
    await expect(page.locator("#theme option:checked")).toHaveText("Slate (default)");
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#171c22");
    await page.locator("#theme").selectOption("teal");
    await page.reload();
    await expect(page.locator("#theme")).toHaveValue("teal");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme");
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0e1f24");
  });
});

test.describe("data sources", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("imports a CSV file and trades it", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("perpdrill.lang", "en");
      localStorage.setItem("perpdrill.countdown", "1");
    });
    await page.goto("/");
    await page.locator("#setup-rules").selectOption({ label: "No rules (free practice)" });
    const csv = [
      "time,open,high,low,close,volume",
      ...Array.from({ length: 200 }, (_, index) => {
        const time = 1_700_000_000_000 + index * 60_000;
        const close = 100 + Math.round(index * 0.1);
        return `${time},${close - 1},${close + 1},${close - 2},${close},0`;
      }),
    ].join("\n");
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: "practice.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(page.locator(".setup")).toContainText("practice.csv");
    await page.getByRole("button", { name: "Start backtest" }).click();
    try {
      await page.getByRole("button", { name: "Skip" }).waitFor({ state: "visible", timeout: 2000 });
      await page.getByRole("button", { name: "Skip" }).click();
    } catch {
      // Intro finished on its own.
    }
    await ensurePaused(page);
    await expect(page.locator(".chart-stage")).toBeVisible();
    // The market bar shows the imported label instead of a sample name.
    await expect(page.locator(".market-select")).toContainText("practice.csv");
  });
});

test.describe("chart controls", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("perpdrill.lang", "en");
      localStorage.setItem("perpdrill.countdown", "1");
    });
    await page.goto("/");
    await page.locator("#setup-rules").selectOption({ label: "No rules (free practice)" });
    await page.getByRole("button", { name: "Start backtest" }).click();
    try {
      await page.getByRole("button", { name: "Skip" }).waitFor({ state: "visible", timeout: 2000 });
      await page.getByRole("button", { name: "Skip" }).click();
    } catch {
      // Intro finished on its own.
    }
    await ensurePaused(page);
    await waitForQuietDesk(page);
    await expect(page.locator(".chart-stage")).toBeVisible();
  });

  test("keeps indicator settings optional without squeezing the chart", async ({ page }) => {
    const settings = page.locator(".indicator-settings");
    await expect(settings).not.toHaveAttribute("open", "");
    const stage = page.locator(".chart-stage").first();
    const before = await stage.boundingBox();
    await settings.locator("summary").click();
    await expect(settings).toHaveAttribute("open", "");
    await settings.getByRole("button", { name: "SMA 9", exact: true }).click();
    await expect(settings).toHaveAttribute("open", "");
    await expect(settings.getByRole("button", { name: "SMA 9", exact: true })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    const after = await stage.boundingBox();
    expect(after?.height).toBe(before?.height);
    await settings.locator("summary").click();
    await expect(settings).not.toHaveAttribute("open", "");
  });

  test("switches the timeframe chip on the primary pane", async ({ page }) => {
    // The default source is 15m, so finer chips stay disabled and 1h/4h work.
    const toolbar = page.locator(".pane-toolbar").first();
    await toolbar.getByRole("button", { name: "1h" }).click();
    await expect(toolbar.locator(".chip.is-current")).toHaveText("1h");
  });

  test("opens and closes the split pane", async ({ page }) => {
    await expect(page.locator(".chart-pane")).toHaveCount(1);
    await page.getByRole("button", { name: "Split" }).click();
    await expect(page.locator(".chart-pane")).toHaveCount(2);
    await page.getByRole("button", { name: "Split" }).click();
    await expect(page.locator(".chart-pane")).toHaveCount(1);
  });

  test("zooms the chart with the wheel", async ({ page }) => {
    // Zoom changes the bar spacing, so the candle width is the observable.
    const candle = page.locator(".chart-svg rect.candle-up, .chart-svg rect.candle-down").first();
    const before = (await candle.boundingBox())?.width ?? 0;
    const stage = page.locator(".chart-stage").first();
    await stage.hover();
    await page.mouse.wheel(0, -240);
    await expect(async () => {
      const width = (await candle.boundingBox())?.width ?? 0;
      expect(width).not.toBe(before);
    }).toPass({ timeout: 3000 });
    const after = (await candle.boundingBox())?.width ?? 0;
    expect(after).toBeGreaterThan(before);
  });
});

test.describe("chart-first workspace", () => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
    { width: 375, height: 667 },
  ]) {
    test(`reserves a visible chart at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(() => localStorage.setItem("perpdrill.lang", "en"));
      await page.goto("/");
      await page.getByRole("button", { name: "Start backtest" }).click();
      await ensurePaused(page);
      await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
      const stage = page.locator(".chart-stage").first();
      await expect(stage).toBeVisible();
      const geometry = await stage.evaluate((element) => {
        const plot = element.getBoundingClientRect();
        const pane = element.closest(".chart-pane")!.getBoundingClientRect();
        const chart = element.closest(".chart")!.getBoundingClientRect();
        const replay = document.querySelector(".replay")!.getBoundingClientRect();
        return {
          height: plot.height,
          top: plot.top,
          bottom: plot.bottom,
          paneBottom: pane.bottom,
          chartBottom: chart.bottom,
          replayTop: replay.top,
          documentWidth: document.documentElement.scrollWidth,
          documentHeight: document.documentElement.scrollHeight,
        };
      });
      expect(geometry.documentWidth).toBeLessThanOrEqual(viewport.width);
      expect(geometry.documentHeight).toBeLessThanOrEqual(viewport.height + 1);
      expect(geometry.height).toBeGreaterThanOrEqual(
        viewport.height * (viewport.width < 900 ? 0.4 : 0.5),
      );
      expect(geometry.top).toBeLessThan(viewport.height * 0.3);
      expect(geometry.bottom).toBeLessThanOrEqual(geometry.paneBottom + 1);
      expect(geometry.bottom).toBeLessThanOrEqual(geometry.chartBottom + 1);
      expect(geometry.bottom).toBeLessThanOrEqual(geometry.replayTop + 1);
      if (viewport.width < 900) {
        const before = await stage.boundingBox();
        await page.getByRole("button", { name: "Panel", exact: true }).click();
        await expect(page.locator(".source-link")).toBeVisible();
        await page.locator(".desk-notices summary").click();
        await expect(page.locator(".notice-content")).toBeVisible();
        await page.locator(".desk-notices summary").click();
        await page.locator(".tabs").getByRole("button", { name: "Review", exact: true }).click();
        await expect(page.locator(".review")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.locator(".shell")).not.toHaveClass(/drawer-open/);
        const after = await stage.boundingBox();
        expect(after?.height).toBe(before?.height);
        for (const control of await page
          .locator(".replay button:visible, .replay select:visible")
          .all()) {
          const box = await control.boundingBox();
          expect(box?.height).toBeGreaterThanOrEqual(44);
        }
      }
    });
  }
});

test.describe("working orders", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("places and cancels a working limit order", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("perpdrill.lang", "en");
      localStorage.setItem("perpdrill.countdown", "1");
    });
    await page.goto("/");
    // Free practice: no drawdown floors can end the session mid-test.
    await page.locator("#setup-rules").selectOption({ label: "No rules (free practice)" });
    await page.getByRole("button", { name: "Start backtest" }).click();
    try {
      await page.getByRole("button", { name: "Skip" }).waitFor({ state: "visible", timeout: 2000 });
      await page.getByRole("button", { name: "Skip" }).click();
    } catch {
      // The intro already finished on its own.
    }
    await ensurePaused(page);
    await waitForQuietDesk(page);
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
      await page.addInitScript(() => {
        localStorage.setItem("perpdrill.lang", "en");
        // The desk skips the 3-2-1 intro in automated browsers; force it so
        // the test drives the same path a player sees.
        localStorage.setItem("perpdrill.countdown", "1");
      });
      await page.goto("/");
      // Free practice: no drawdown floors can end the session mid-test.
      await page.locator("#setup-rules").selectOption({ label: "No rules (free practice)" });
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
      // Skip ends the intro and starts playback; pausing right after leaves
      // the desk still for the test. (Cancel leaves the practice screen.)
      try {
        await page
          .getByRole("button", { name: "Skip" })
          .waitFor({ state: "visible", timeout: 2000 });
        await page.getByRole("button", { name: "Skip" }).click();
      } catch {
        // The intro already finished on its own.
      }
      await ensurePaused(page);
      await waitForQuietDesk(page);
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

        // Order from the bar: 100% buying power, buy, then flatten from
        // the drawer's close row (the bar submit becomes Add while held).
        await bar.getByRole("button", { name: "100%" }).click();
        await bar.getByRole("button", { name: "Buy / Long", exact: true }).click();
        await expect(bar.getByRole("button", { name: "Add", exact: true })).toBeVisible();
        await toggle.click();
        await expect(page.locator(".shell")).toHaveClass(/drawer-open/);
        await page
          .locator(".workspace > .ticket")
          .getByRole("button", { name: "Close", exact: true })
          .click();
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
          page.locator(".workspace > .ticket").getByRole("button", { name: "Add", exact: true }),
        ).toBeVisible();
        await page
          .locator(".workspace > .ticket")
          .getByRole("button", { name: "Close", exact: true })
          .click();
      }
    });
  });
}
