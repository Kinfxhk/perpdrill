# MVP design pointer

M0 is a scaffold. This page only points at decisions already made in the
2026-10-26 research note. It does not specify formulas, and the app does
not compute them.

## Liquidation line versus prop drawdown lines

Keep three meanings apart:

- **Liquidation** is an exchange-style margin close. M0 chart legend says
  Liquidation and does not draw the line. The ticket label is
  **Liq. Price (Mark)**, value not computed.
- **Liq Risk** is not an M0 label. Add it only after a later note defines
  the scale.
- **Max drawdown floor** is a prop-account line. It is not the same line
  as liquidation.
- **Daily loss floor** is a third line (timezone and reset rules belong
  to the preset).

M0 shows the words only. Prices stay em dashes. A session can fail a prop
floor without being liquidated; the copy for that lesson comes later.

## Percent sizing

Order size will be a share of trading power: 25%, 50%, 75%, and 100%,
plus a slider kept in step with those four stops. The ticket label is
**Trading Power**. M0 renders the four buttons and the slider disabled.
It does not multiply a balance. The core constant is still the four
percent stops.

## Preset sources (later, not shipped)

M0 has the preset schema version (`perps-prop-profile` v1) and no preset
documents. When presets are added, each one needs a source URL and this
unofficial disclaimer: results are not an official evaluation, and the
reader must check the firm's current documents.

| Source                        | URL                                                             | Status                                                                                                               |
| ----------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Vest Capital rule notes       | https://docs.vestmarkets.com/vest-capital/overview.md           | Unofficial. Candidate for a later preset. Loss-limit notes: https://docs.vestmarkets.com/vest-capital/loss-limits.md |
| MyFundedPerps challenge notes | https://docs.myfundedperpetuals.com/guides/challenges-and-rules | Unofficial. Candidate for a later preset. Fee notes: https://docs.myfundedperpetuals.com/guides/commissions-and-fees |
| Tradeify Perps                | https://tradeifyperps.co/                                       | Unverified on 2026-10-26 (public waitlist, no rule table found). Do not invent numbers.                              |

Firm names stay in this document and the README. They are not product
strings, logos, or palette tokens.

## Desk chrome

The web package is a cool-teal dark wireframe: header, market strip,
chart area, order ticket, positions table, account health, and a disabled
replay bar. It is not a client of any venue. Amber slate (`#f2a93b` on
`#11151c`) is out of bounds for this product.
