# perpsdrill

本機優先的教育用模擬／回放練習台骨架，用來對照加密永續合約、類 prop 規則做練習。這不是交易所客戶端，也不會下真單。

**狀態：M0 骨架。** 可以安裝、檢查、打開一張停用的版面。沒有成交、保證金、強平、資金費或回放引擎。

儲存庫：<https://github.com/Kinfxhk/perpdrill>

線上版面（GitHub Pages，與本機同一張停用的 M0 骨架）：<https://kinfxhk.github.io/perpdrill/>。由 `main` 的 Pages workflow 部署，內容安全政策仍是 `default-src 'self'`。

## 這是什麼

perpdrill 想成為一個開源、在瀏覽器裡就能用的永續合約練習台：歷史 K 線逐根前進、用保證金／槓桿／資金費或廠商 swap／強平來記帳，並套上可匯出的規則集。概念上承接 [CandleDrill](https://github.com/Kinfxhk/candledrill)（AGPL-3.0-or-later）的回放、OHLC 成交與規則評估想法。介面、色盤與期貨合約模型不沿用 CandleDrill。歸屬寫在 `NOTICE`。

M0 只放常數、型別，以及一張對齊常見永續下單台結構的線框：頂欄、行情列、圖區、下單票（Trading Power、25%／50%／75%／100% 按鈕停用）、持倉表、Account Health、回放列。Liq. Price (Mark) 顯示為「—」。M0 不另放 Liq Risk 標籤。

## 本地檢查

需要 Node.js 22 或更新（見 `.nvmrc`）。

```bash
npm ci
npm run check
```

`npm run check` 依序執行：

- `lint`
- `format:check`
- `typecheck`
- `test`
- `check:licenses`
- `check:hygiene`
- `check:secrets`

開啟線框（<http://127.0.0.1:43127>）：

```bash
npm run dev
```

伺服器只印版本，不會聽埠：

```bash
npm start
```

要在本機看那一行字，再執行 `npm run listen`（預設 `127.0.0.1:47221`）。

## 教育聲明與非附屬

- 教育與練習工具，不是投資建議。
- 模擬成績不等於真實成交，也不等於任何 prop 評測的官方結果。
- M0 連成交模型都還沒有。OHLC 模型以後也會有先天限制。
- 不保證任何人通過任何評測。
- 永續與槓桿可以虧光保證金。正式計算做完之後，介面才會示範強平；現在只有標籤。
- perpsdrill 與任何交易場所、prop 廠商沒有附屬、背書或客戶關係。請勿把本專案當成他們的官方軟體。
- 專案方向是不加廣告、不收集遙測、不以付費牆當作使用條件。

## 預設來源（M0 沒有數字）

之後若內建規則預設，每一份都必須附來源網址，並標明非官方、請對照該站現行文件。M0 只有 schema 版本，沒有預設檔。

| 來源                   | 網址                                                            | 說明                                                                                            |
| ---------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Vest Capital 規則筆記  | https://docs.vestmarkets.com/vest-capital/overview.md           | 非官方。日後預設候選。虧損上限筆記：https://docs.vestmarkets.com/vest-capital/loss-limits.md    |
| MyFundedPerps 挑戰筆記 | https://docs.myfundedperpetuals.com/guides/challenges-and-rules | 非官方。日後預設候選。費用筆記：https://docs.myfundedperpetuals.com/guides/commissions-and-fees |
| Tradeify Perps         | https://tradeifyperps.co/                                       | 2026-10-26 未能核實公開規則（僅見 waitlist）。不要編造數字。                                    |

細節與「強平線 ≠ prop 回撤線」見 [docs/DESIGN-MVP.md](docs/DESIGN-MVP.md)。

## 授權

[GNU AGPL-3.0-or-later](LICENSE)。若你改過程式並讓別人透過網路使用，必須提供對應原始碼（AGPL 第 13 條）。線框頁尾的來源連結指向 <https://github.com/Kinfxhk/perpdrill>。

---

# English

Local-first educational simulator and replay desk for crypto perpetuals and prop-style rules. It is not an exchange client and it does not send live orders.

**Status: M0 scaffold.** Install, check, and open a disabled layout. There is no fill, margin, liquidation, funding, or replay engine.

Repository: <https://github.com/Kinfxhk/perpdrill>

Online desk (GitHub Pages, the same disabled M0 scaffold): <https://kinfxhk.github.io/perpdrill/>. The Pages workflow on `main` deploys it. The page policy stays `default-src 'self'`.

## What it is

perpdrill aims to be an open-source browser desk: step historical bars, account with margin, leverage, funding or a firm swap, and liquidation, then evaluate an exportable rule set. Replay, OHLC-style fills, and rule evaluation are conceptual lineage from [CandleDrill](https://github.com/Kinfxhk/candledrill) (AGPL-3.0-or-later). The interface, palette, and futures contract model are not taken from CandleDrill. See `NOTICE`.

M0 ships constants, types, and a wireframe with the structure of a common perps ticket: header, market strip, chart, order ticket (Trading Power, 25% / 50% / 75% / 100% buttons disabled), positions table, Account Health, and a replay bar. Liq. Price (Mark) renders as an em dash. M0 does not add a separate Liq Risk label.

## Check locally

Node.js 22 or newer (see `.nvmrc`).

```bash
npm ci
npm run check
```

`npm run check` runs `lint`, `format:check`, `typecheck`, `test`, `check:licenses`, `check:hygiene`, and `check:secrets`.

Desk wireframe at <http://127.0.0.1:43127>:

```bash
npm run dev
```

The server stub prints the version and does not listen:

```bash
npm start
```

`npm run listen` serves that same line on `127.0.0.1:47221`.

## Educational disclaimer and non-affiliation

- Educational practice tool. Not investment advice.
- A simulated result is not a live fill and not an official prop-firm result.
- M0 has no fill model. A later OHLC model will still be an approximation.
- Nothing here promises a passing evaluation.
- Perps and leverage can consume the whole margin balance. Liquidation will be demonstrated only after the math exists. M0 has labels.
- perpsdrill is not affiliated with, endorsed by, or a client of any trading venue or prop firm. Do not treat it as their software.
- The project commits to no ads, no telemetry, and no paywall as a condition of use.

## Preset sources (no numbers in M0)

A future built-in preset must carry a source URL and an unofficial-status line telling the reader to check the firm's current documents. M0 has a schema version and no preset files.

| Source                        | URL                                                             | Note                                                                                                      |
| ----------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Vest Capital rule notes       | https://docs.vestmarkets.com/vest-capital/overview.md           | Unofficial. Later preset candidate. Loss limits: https://docs.vestmarkets.com/vest-capital/loss-limits.md |
| MyFundedPerps challenge notes | https://docs.myfundedperpetuals.com/guides/challenges-and-rules | Unofficial. Later preset candidate. Fees: https://docs.myfundedperpetuals.com/guides/commissions-and-fees |
| Tradeify Perps                | https://tradeifyperps.co/                                       | Unverified on 2026-10-26 (waitlist only). Do not invent numbers.                                          |

See [docs/DESIGN-MVP.md](docs/DESIGN-MVP.md) for liquidation versus prop drawdown lines and the percent-sizing note.

## License

[GNU AGPL-3.0-or-later](LICENSE). If you modify the program and let users interact with it over a network, you must offer the corresponding source (AGPL section 13). The wireframe footer links <https://github.com/Kinfxhk/perpdrill>.

## Packages

| Package             | Role in M0                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `@perpdrill/core`   | Product name, buying-power steps, liquidation label stubs, funding/swap/off labels, preset schema version. One Vitest file. |
| `@perpdrill/web`    | Disabled desk wireframe. Content-Security-Policy `default-src 'self'`.                                                      |
| `@perpdrill/server` | Prints `perpdrill 0.0.0 (not-implemented)`. Optional localhost listener.                                                    |
