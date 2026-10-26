# Changelog

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
