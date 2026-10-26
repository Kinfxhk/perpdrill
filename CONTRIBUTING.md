# Contributing to perpsdrill

perpdrill is AGPL-3.0-or-later. Contributions are accepted under that
license. The intended public repository is
https://github.com/Kinfxhk/perpdrill.

## What M0 accepts

Bug fixes to the scaffold, docs, and checks. Do not add fill, margin,
liquidation, funding, or replay behavior under the label of a drive-by
improvement. Those belong to a later milestone with tests that state the
formula.

## AI-assisted changes

Agents and other generators may draft a diff. The person who commits must:

1. Read the whole diff.
2. Be able to explain what it does.
3. Drop code they do not understand.
4. Keep secrets, telemetry, and unrelated refactors out.

Generated text does not get a pass on the clean-room rules below.

## Clean room

Do not copy source, stylesheets, assets, tests, or markup from
CandleDrill or from any commercial trading interface. CandleDrill is
conceptual lineage only (see NOTICE): replay, OHLC fill, and
rule-evaluation ideas. The perps ticket, liquidation labels, and this
palette are original.

You may read public documentation when a later change adds a preset.
Do not invent unpublished rule numbers. Do not put venue or firm names,
logos, or brand colors in `packages/`. Names belong in `docs/` or the
README, and only as a preset source with a URL and a non-official
disclaimer.

## Checks

Node.js 22 or newer.

```bash
npm ci
npm run check
```

`npm run check` runs lint, format, typecheck, unit tests, license,
hygiene, and secret scans. Hygiene rejects competitor names and the
forbidden amber slate colors inside `packages/`.

## Secrets

Do not commit credentials, `.env` files, or live tokens. The listen stub
binds to localhost and does not authenticate.
