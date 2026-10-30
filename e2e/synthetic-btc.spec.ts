import { expect, test } from "@playwright/test";

test("generates and trades the fourth synthetic BTC market without exchange data", async ({
  page,
}) => {
  const exchangeRequests: string[] = [];
  page.on("request", (request) => {
    if (/binance|cmegroup/.test(request.url())) exchangeRequests.push(request.url());
  });
  await page.addInitScript(() => {
    localStorage.setItem("perpdrill.lang", "en");
    localStorage.setItem("perpdrill.countdown", "0");
  });
  await page.goto("/");
  await expect(page.locator("#setup-market option")).toHaveText([
    "SYNTH-IDX1",
    "SYNTH-METAL1",
    "SYNTH-IDX2",
    "SYNTH-BTC",
  ]);
  await page.locator("#setup-rules").selectOption({ label: "No rules (free practice)" });
  await page.locator("#setup-market").selectOption("SYNTH-BTC");
  await page.getByRole("button", { name: "Start backtest", exact: true }).click();
  await expect(page.locator(".market-select")).toHaveText("SYNTH-BTC");
  await expect(
    page.locator(".chart-svg .candle-up, .chart-svg .candle-down").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await page
    .locator(".workspace > .ticket")
    .getByRole("button", { name: "Buy / Long", exact: true })
    .click();
  await expect(
    page.locator(".workspace > .ticket").getByRole("button", { name: "Add", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".desk-bottom tbody tr")).toHaveCount(1);
  expect(exchangeRequests).toEqual([]);
  await page.getByRole("button", { name: "New session", exact: true }).click();
  await page.reload();
  await expect(page.locator("#setup-market")).toHaveValue("SYNTH-BTC");
});
