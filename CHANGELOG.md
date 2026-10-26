# Changelog

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
