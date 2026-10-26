# MVP design pointer

The practice desk computes an isolated teaching model. It is not an
exchange formula and not an official prop evaluation.

## Liquidation line versus prop drawdown lines

Keep the meanings apart:

- **Est. Liq. Price (Mark)** is the isolated teaching estimate. Maintenance
  is half of initial margin. With the position margin fully in that one
  position and no extra wallet buffer, long ≈ entry × (1 − 0.5 / leverage)
  and short ≈ entry × (1 + 0.5 / leverage). Mark is `(high + low) / 2`.
  The position liquidates when isolated equity is at or under maintenance.
- **Liq Risk** is `|mark − liq| / mark`, shown as a percent away from the
  estimate. The health meter is the remaining cushion above maintenance.
- **Max drawdown floor** and **daily loss floor** are prop-account equity
  floors. Their chart prices are solved from those floors. They are not
  the liquidation line. A session can fail a floor without being liquidated.

## Slippage

Majors tolerance defaults to 75 bps and the ticket allows 50–100. Realized
impact defaults to 25 bps and is what the fill uses. If impact is above
tolerance, the order is rejected. Taker bps are a separate fee.

## Percent sizing

Order size is a share of trading power: 25%, 50%, 75%, and 100%, plus a
slider kept in step with those four stops. The ticket label is
**Trading Power**. One hundred percent posts the free cash as initial
margin after the taker fee.

## Preset sources

Built-in teaching presets live in `presets/` as JSON. The desk shows the
teaching `displayName` and does not print a firm name. Each file carries
source URLs and states that it is an unofficial preset and that a simulated
result is not an official evaluation. Max drawdown is `maxDrawdownUsd`: a
static floor at the starting balance minus that amount. Firm names may
remain in source URLs, this document, and the README. They are not strings
inside `packages/` or in the preset strings the desk renders as text.

| Source                        | URL                                                             | Status                                                                                              |
| ----------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Vest Capital plans            | https://next.vestmarkets.com/vest-capital                       | 13 plan files in `presets/plan-*.json`, checked 2026-10-26.                                         |
| MyFundedPerps challenge notes | https://docs.myfundedperpetuals.com/guides/challenges-and-rules | Not shipped as a preset. Fee notes: https://docs.myfundedperpetuals.com/guides/commissions-and-fees |
| Tradeify Perps                | https://tradeifyperps.co/                                       | Unverified on 2026-10-26 (public waitlist, no rule table found). Do not invent numbers.             |

Firm names stay in this document and the README source table. They are not
product strings, logos, or palette tokens, and they are not preset labels.

## Desk chrome

The web package is a cool-teal dark desk: header, market strip, chart,
order ticket, positions, account health, and a replay bar that steps a
local sample. It is not a client of any venue. Amber slate (`#f2a93b` on
`#11151c`) is out of bounds for this product.
