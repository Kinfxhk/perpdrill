# Changelog

## Unreleased

## 1.3.4 — 2026-10-29

- The certificate submission now also sends max leverage, win rate and
  reward-to-risk (average win over average loss), so a run that only passed by
  sizing up is visible in the collected scores.

## 1.3.3 — 2026-10-29

- The daily round rotates 1m, 5m and 15m only. An hourly round made a one-day
  challenge feel like watching paint dry.

## 1.3.2 — 2026-10-29

- The daily challenge now runs the campaign exam rules (50,000 account, +3,000
  target, 2,000 static max drawdown, 5x cap) as this period's special event,
  instead of a separate exam entry on the setup screen. The certificate still
  appears when the frozen daily round reaches the target.

## 1.3.1 — 2026-10-29

- A one-week campaign exam: one frozen round (SYNTH-NQ, 15m, 600 bars, fixed
  seed) with a 50,000 account, +3,000 target, 2,000 static max drawdown and a
  5x leverage cap. Reaching the target shows a simulated certificate; a
  Distinction needs half the drawdown budget left and at least 10 closed
  trades. One submission per person, prefilled into the campaign form, and the
  card counts down without ever navigating away. The entry disappears after
  2026-11-05, and the module is deleted with it.

- A daily challenge freezes one round per UTC day: everyone gets the same
  seeded bars and the same rule set, so two runs can be compared. The browser
  keeps one ranked attempt per day plus a day streak, and `?c=YYYY-MM-DD`
  opens that exact round for someone else. The result copies as one line with
  the drawdown and the bars used. Nothing leaves the browser: this is a local
  record, not a verified ranking.

## 1.3.0 — 2026-10-27

- The forming candle now prints four shapes instead of three: the open, the
  adverse wick, both wicks, then the real bar. Every shape is built from prices
  the bar already has, so the wick on the far side grows before the close lands
  instead of appearing in one jump. The full bar budget still splits evenly
  across the paints, and fills still happen only on a practice-bar close.

- A live price line marks the last bar: a dashed hairline in the bar's direction
  with a filled price tag on the axis, moving with each forming print.

## 1.2.0 — 2026-10-27

- The chart reads like a desk chart. A crosshair follows the pointer with a
  price tag on the axis and a time tag under the bar, and an O/H/L/C readout
  sits at the top of the pane, showing the bar under the pointer or the latest
  closed bar when the pointer is away. Time labels run along the bottom edge.

- Prices scale from the right axis: drag it to magnify, wheel over it for fine
  steps (about 7.5% per notch, finer for small trackpad deltas), double-click
  it to fit again, and double-click the plot to re-fit the time scale. The
  cursor turns into a resize arrow over the axis.

- The price scale fits the visible candles. Entry, liquidation, floor, stop and
  target drawings may stretch it by at most 15% of the candle range on each
  side and are clipped beyond that, instead of flattening the candles into a
  strip. Candle padding drops from 8% to 5% a side.

- Candle bodies and wicks render with crisp edges on the device pixel grid.

## 1.1.0 — 2026-10-27

- Wheel over the price axis scales prices vertically, the way a charting desk
  does it, while the plot keeps zooming time. Scrolling back returns to the
  fitted view. Replay now opens at 0.5× and offers 0.5× through 8×.

- The chart can draw VWAP, Keltner channels and Donchian channels beside the
  existing averages. VWAP is anchored at the first bar and weighted by volume,
  so synthetic bars now carry a fictional size from their own seeded stream:
  the pinned seeded price paths and stored sessions stay unchanged. Imported
  CSV rows and live Binance bars keep their real size. VWAP is left out of the
  price-scale fit, so a far-off anchored average cannot squash the candles.
  All five languages label the new studies.

- On phone setup screens, give the brand, navigation and preference controls
  their own rows so Chinese/Japanese/Korean labels stay horizontal. Keep theme
  and language selection visible together without squeezing the navigation.

- On short phone screens, scroll the entire order ticket instead of pinning its
  submit section over the controls. Landscape users can reveal full order-type
  buttons and price/leverage inputs, place/cancel a limit order, and still reach
  the source link and teaching notices. Taller phone and desktop layouts are unchanged.
- Add SYNTH-BTC as the fourth fictional generated market for custom rules and
  free practice. It uses only local seeded randomness, never exchange history.
  Existing market ids, parameters, seed outputs and plan market scopes stay
  unchanged. All five languages label the samples as fictional, not exchange
  contract models; NOTICE documents the data/source-code licensing boundary.
- Slate is the default theme on first use and when preference storage is unavailable;
  existing saved themes are preserved. Theme labels in all five languages, the initial
  HTML colour, and the pictured guide match the new default.
- The desk keeps the chart as the dominant surface. The shell owns the viewport
  height, the market notice and rule disclaimer fold into a footer details
  popover, the indicator settings open from the chart toolbar as a popover, and
  the blotter bottom row is a fixed-height strip that yields to the chart. The
  review tab expands the bottom row only on desktop; the phone review stays in the drawer.
- The replay bar moves to the desk bottom on every width, its speed chips
  become a compact select, and the phone keeps the same structure: the chart
  takes the space left by the header, the replay/trade bar, and the footer.
  The phone footer and source link live in the drawer; short portrait phones drop
  only the meters so the chart stays on screen.
- Re-shoot the five Slate guide images with prominent amber frames and matching
  numbered captions in both languages. Orders use a readable ticket close-up;
  the setup, desk, review and phone frames identify the exact taught regions.

## 1.0.0 — 2026-10-27

- Desk themes use original cool-green accents. Grove, Lagoon, and Iris
  replace the venue-like palettes. Daylight uses a darker green so accent
  text stays readable. The header theme menu still saves the choice.
- Three more desk themes complete the set of eight: Dusk (warm ember night),
  Dark (neutral near-black), and Slate (gray-blue stone). Each keeps the
  original cool-green accent and the saved header-menu choice.
- Generate data names the samples SYNTH-NQ, SYNTH-GC, and SYNTH-ES. The seeded
  generator is unchanged. SYNTH-NQ and SYNTH-GC keep the previous two price
  anchors. Plan leverage stays 25× and 15× on those two names. SYNTH-ES is a
  third anchor for custom rules and free practice.
- Cancel and New session during the 3-2-1 intro stop it without advancing bars.
  That data set still counts down on the next start. Skip starts playback.
  The New session control stays usable while the intro is up.
- Each new practice candle paints in 3 parts: the open, the adverse extreme,
  then the real bar. The gaps share the whole bar budget
  (`budget / (parts - 1)`), with no 140ms cap. Play spends the speed interval.
  One forward step spends 420ms. The cursor, and therefore the fill, still
  moves on the last paint — the same beat play used to step on.
- Practice chart timeframes are 1m, 3m, 5m, 15m, 1h, and 4h. 3m is a real
  synthetic interval. A coarser chart is an OHLC resample of the session
  bars, clock-aligned, including a still-forming last bar. A finer chart, or
  one the bar size does not divide, stays disabled instead of relabeling the
  same candles. Split opens a second pane on that same sample.
- The setup screen can trade real data: a strict CSV import
  (time,open,high,low,close) or live klines fetched in the browser from
  Binance's public data endpoint, attributed on the desk and never
  bundled. Funding on imported bars keeps the synthetic sequence.
- The review adds a Monte Carlo stability gauge: trades are shuffled and
  replayed (seeded, 1000 samples) to show how often the drawdown floor
  breaks and the 50/95th drawdown percentiles. Teaching gauge, not a
  prediction.
- The review adds session Sharpe and Sortino (per-bar returns, not
  annualized), Calmar, average hold in bars, and a split ledger of fees,
  carry, and funding.
- The ticket switches between isolated and cross margin. Cross counts the
  free cash toward the liquidation cushion, so its liquidation price sits
  farther away while cash remains.
- The setup screen can generate stress data: triple volatility and five
  times the jump rate for the same seed, clearly marked as synthetic.
- Market entries now stack and reverse: a same-side entry adds to the
  position at a weighted average entry, an opposite-side entry closes the
  held position first, and the close control takes a 25/50/75/100%
  fraction so a position can be reduced without flattening.
- The ticket places limit and stop orders beside market. A limit fills
  intrabar at its own price once a bar touches it; a stop triggers on the
  high or low and fills with the same impact as a market entry, gapped
  triggers filling at the open. Working orders list in the ticket with
  cancel, and a market entry cancels them. A single-position desk: orders
  are only accepted while flat.
- The desk is responsive across phone, tablet, and desktop. Under 900px the
  order ticket and blotter fold into an off-canvas drawer opened from the
  header, and the replay row becomes a fixed bottom trade bar with side,
  buying power, and submit controls. Touch targets stay at 44px on coarse
  pointers, inputs stay 16px so iOS does not zoom, and short landscape
  screens reclaim chart height. A Playwright device matrix checks the three
  layouts in Chromium and WebKit.
- The practice chart zooms and scrolls: wheel up/down changes
  bar spacing around the cursor, a horizontal wheel or drag pans, and a pinch
  zooms. The view opens on the recent bars (150, with a small right margin)
  inside the existing 140-bar window. Resizing the pane keeps that bar spacing,
  so a wider pane shows more bars. Each split pane keeps its own zoom.
- Plan presets keep their v0.3.0 ids. The desk shows teaching names only
  (`Teaching · Instant …`, `Teaching · Eval …`, `Teaching · 2-Step …`).
  `community-a` is removed; a stored `community-a` or `community-b` id is
  dropped. Source URLs stay in the JSON and are not used as link labels.
- Max drawdown on those presets is `maxDrawdownUsd`. The floor is the
  starting balance minus that amount, static, and it fails only once equity
  has lost the full amount. Instant 50k is $2,000. Eval Emerald is $3,000.
  Liquidation can still win if price gaps through it first.
- Custom max drawdown defaults to static. Trailing remains a choice.

## 0.3.0 — 2026-10-26

Plan presets and venue themes.

- 13 plan presets copied from a perps prop plan page and its docs on
  2026-10-26, grouped in the picker:
  - 1-Step evaluation, $5k / $10k / $25k / $50k: static 6% max drawdown,
    profit target 10% or 20%, daily loss limit none, 3%, or 4%.
  - 2-Step evaluation, same sizes: 6% static drawdown, 3% daily limit, target
    10% for step 1 and 5% for step 2 (run step 2 as a new session).
  - Instant, $500 / $5k / $10k / $25k / $50k: static drawdown 2% on $500 and
    4% on the rest, no target, no daily limit.
  - All plans: daily reset 20:00 New York, measured from the realized
    balance plus reserved margin and checked against equity; taker 1 bp,
    maker 0; leverage caps BTC 25×, ETH 15×. Profit split and fees paid to
    the firm are not simulated.
- Presets may now offer buyer options (`choices`), a per-market
  `maxLeverage`, a `dailyBase` of `equity` or `realized`, a `group`, and a
  `profitTargetPct` of `null` for accounts with no target.
- Teaching leverage range is now 1–50.
- Themes: Teal (default), Midnight exchange, On-chain aqua, DeFi violet, and
  Daylight. The choice is saved in the browser.
- The old Gold-like community preset is replaced by the plan presets.

## 0.2.0 — 2026-10-26

Playable backtest loop: generate data, set rules, count down, play, review.

- Setup screen. Seeded synthetic perps bars for BTC-PERP or ETH-PERP:
  1m, 5m, 15m, 1h, or 4h, 100–5,000 bars, volatility clustering and rare
  jumps. The same seed always gives the same chart. It is not any real market.
- Rules: custom (starting balance, profit target, static or trailing max
  drawdown, daily loss limit at 00:00 UTC, max leverage, taker fee, daily
  swap), a community preset, or none.
- The first run of each data set counts down 3 → 2 → 1 before playback
  starts. Skip ends it early. A replay of the same data starts at once.
- Orders fill on the bar close. Stop loss and take profit can be set on the
  order or updated while the position is open. Intrabar checks assume the
  adverse extreme prints first: stop, liquidation, or a rule floor, whichever
  the price reaches first. A gap through a trigger fills at the open.
- A rule breach flattens the position at the floor price and ends the session.
  So does liquidation, the profit target, or the end of the data.
- Liquidation price now moves when carry is taken from isolated margin.
- Playback at 1×, 2×, 4×, or 8×, Space to play or pause, → to step. No rewind.
- The chart scrolls a 140-bar window and shows a price scale, entry,
  liquidation, rule floors, stop, and target lines.
- Review tab: verdict, return, net PnL, trades, win rate, profit factor,
  expectancy, average win and loss, best and worst trade, max drawdown,
  fees plus carry, an equity curve, and a trade list. Replay the same data or
  get new data from there.
- Feel: the countdown number pops with a ring, buttons give press feedback,
  fills and rejects show short toasts, equity flashes on a closed trade, and
  the review verdict pops in. Reduced-motion turns the animations off.
- Phone, tablet, and desktop layouts. On phones the header compacts so the
  chart is on the first screen, indicators scroll sideways, tap targets are at
  least 44px, and playback stays pinned to the bottom. Short desktop windows
  scroll instead of squeezing the chart.
- Presets accept optional `drawdownMode` (`static` or `trailing`) and
  `maxLeverage`. Old files still parse as static with no leverage cap.

## 0.1.1 — 2026-10-26

Layout already shipped as tag v0.1.1. Version strings now match that tag.

- The practice ticket stays full height beside the blotter. Positions, history, and playback stay under the chart.
- Below 860px the chart, ticket, and bottom band stack.
- Package versions and the desk colophon read 0.1.1.

## 0.1.0 — 2026-10-26

Playable practice desk. This note is not a GitHub Release.

- Isolated teaching liquidation. Maintenance is half of initial margin.
  A long estimate is entry × (1 − 0.5 / leverage). A short estimate is
  entry × (1 + 0.5 / leverage). The trigger uses mark, `(high + low) / 2`.
  Fail and drawdown prices stay off that line.
- Majors slippage tolerance defaults to 75 bps and can be set from 50 to 100. Realized impact defaults to 25 bps. The order is rejected when
  impact is above the tolerance.
- Trading power sizes 25%, 50%, 75%, and 100%. Taker bps are separate
  from slippage. Funding or swap can be a constant stub.
- The desk can submit market orders and show a position, PnL, estimated
  liquidation, liquidation distance, entry and liquidation lines, and
  account health.
- Interface copy is in English, Traditional Chinese, Simplified Chinese,
  Japanese, and Korean.
- Two unofficial community presets live in `presets/` with source URLs.
  Firm names stay outside `packages/`.

## 0.0.0 — 2026-10-26

M0 scaffold. No trading engine.

- Workspace packages for identity stubs, a disabled practice-desk
  wireframe, and a localhost version stub.
- AGPL-3.0-or-later, NOTICE, and third-party tooling notices.
- `npm run check` covers lint, format, types, tests, licenses, hygiene,
  and secrets.
