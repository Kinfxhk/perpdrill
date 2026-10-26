# perpsdrill

本機優先的教育用模擬／回放練習台骨架，用來對照加密永續合約、類 prop 規則做練習。這不是交易所客戶端，也不會下真單。

**狀態：0.1.0 練習台。** 可以安裝、檢查，並在本機或 Pages 上下市價單、看持倉與損益。強平是隔離教學近似，不是交易所公式，也不是官方評測結果。

儲存庫：<https://github.com/Kinfxhk/perpdrill>

線上版面（GitHub Pages，與本機同一張 0.1 練習台：可下市價單、看持倉與損益；強平是教學近似）：<https://kinfxhk.github.io/perpdrill/>。由 `main` 的 Pages workflow 部署，內容安全政策仍是 `default-src 'self'`。

## 這是什麼

perpdrill 想成為一個開源、在瀏覽器裡就能用的永續合約練習台：歷史 K 線逐根前進、用保證金／槓桿／資金費或廠商 swap／強平來記帳，並套上可匯出的規則集。概念上承接 [CandleDrill](https://github.com/Kinfxhk/candledrill)（AGPL-3.0-or-later）的回放、OHLC 成交與規則評估想法。介面、色盤與期貨合約模型不沿用 CandleDrill。歸屬寫在 `NOTICE`。

練習台可以逐步播放合成 1 小時樣本、用 Trading Power 的 25%／50%／75%／100% 下市價單、看持倉與損益、預估強平價（標記）與 Liq Risk，並在圖上畫進場線與強平線。滑點上限預設 75 bps（可調 50–100），模擬衝擊預設 25 bps，超過上限就拒絕。維持保證金是初始保證金的一半。Fail／回撤線不跟強平線共用。

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
- 成交是教學近似。OHLC／標記模型有先天限制。
- 不保證任何人通過任何評測。
- 永續與槓桿可以虧光保證金。介面上的強平價是估計，不是交易所的封閉公式。
- perpsdrill 與任何交易場所、prop 廠商沒有附屬、背書或客戶關係。請勿把本專案當成他們的官方軟體。
- 專案方向是不加廣告、不收集遙測、不以付費牆當作使用條件。

## 預設來源

`presets/` 有兩份非官方社群 JSON。數字與網址寫在檔案裡，並標明請對照該站現行文件。模擬結果不是官方評測。產品程式碼（`packages/`）不寫廠商名稱。沒有核到的規則不要補數字。

| 來源                   | 網址                                                            | 說明                                                                                                      |
| ---------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Vest Capital 規則筆記  | https://docs.vestmarkets.com/vest-capital/overview.md           | 非官方社群 JSON，見 `presets/`。虧損上限筆記：https://docs.vestmarkets.com/vest-capital/loss-limits.md    |
| MyFundedPerps 挑戰筆記 | https://docs.myfundedperpetuals.com/guides/challenges-and-rules | 非官方社群 JSON，見 `presets/`。費用筆記：https://docs.myfundedperpetuals.com/guides/commissions-and-fees |
| Tradeify Perps         | https://tradeifyperps.co/                                       | 2026-10-26 未能核實公開規則（僅見 waitlist）。不要編造數字。                                              |

細節與「強平線 ≠ prop 回撤線」見 [docs/DESIGN-MVP.md](docs/DESIGN-MVP.md)。

## 授權

[GNU AGPL-3.0-or-later](LICENSE)。若你改過程式並讓別人透過網路使用，必須提供對應原始碼（AGPL 第 13 條）。線框頁尾的來源連結指向 <https://github.com/Kinfxhk/perpdrill>。

---

# English

Local-first educational simulator and replay desk for crypto perpetuals and prop-style rules. It is not an exchange client and it does not send live orders.

**Status: 0.1.0 practice desk.** Install, check, and place simulated market orders with a position and PnL. Liquidation is an isolated teaching approximation, not an exchange formula and not an official evaluation result.

Repository: <https://github.com/Kinfxhk/perpdrill>

Online desk (GitHub Pages, the same 0.1 practice desk: market orders, position, and PnL; liquidation is a teaching approximation): <https://kinfxhk.github.io/perpdrill/>. The Pages workflow on `main` deploys it. The page policy stays `default-src 'self'`.

## What it is

perpdrill aims to be an open-source browser desk: step historical bars, account with margin, leverage, funding or a firm swap, and liquidation, then evaluate an exportable rule set. Replay, OHLC-style fills, and rule evaluation are conceptual lineage from [CandleDrill](https://github.com/Kinfxhk/candledrill) (AGPL-3.0-or-later). The interface, palette, and futures contract model are not taken from CandleDrill. See `NOTICE`.

The desk steps a synthetic 1 hour sample, sizes market orders at 25% / 50% / 75% / 100% of Trading Power, and shows the position, PnL, Est. Liq. Price (Mark), and Liq Risk. The chart draws Entry and Liquidation; Fail / drawdown stays on its own line. Max slip defaults to 75 bps (adjustable 50–100). Realized impact defaults to 25 bps and a larger impact is rejected. Maintenance is half of initial margin.

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
- Fills are a teaching approximation. An OHLC / mark model is still an approximation.
- Nothing here promises a passing evaluation.
- Perps and leverage can consume the whole margin balance. The liquidation price on screen is an estimate, not an exchange's closed form.
- perpsdrill is not affiliated with, endorsed by, or a client of any trading venue or prop firm. Do not treat it as their software.
- The project commits to no ads, no telemetry, and no paywall as a condition of use.

## Preset sources

`presets/` ships two unofficial community JSON files. The numbers and URLs live in those files, with a line telling the reader to check the firm's current documents. A simulated result is not an official evaluation. Product code under `packages/` does not name firms. Do not invent numbers for a rule that was not verified.

| Source                        | URL                                                             | Note                                                                                                           |
| ----------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Vest Capital rule notes       | https://docs.vestmarkets.com/vest-capital/overview.md           | Unofficial community JSON in `presets/`. Loss limits: https://docs.vestmarkets.com/vest-capital/loss-limits.md |
| MyFundedPerps challenge notes | https://docs.myfundedperpetuals.com/guides/challenges-and-rules | Unofficial community JSON in `presets/`. Fees: https://docs.myfundedperpetuals.com/guides/commissions-and-fees |
| Tradeify Perps                | https://tradeifyperps.co/                                       | Unverified on 2026-10-26 (waitlist only). Do not invent numbers.                                               |

See [docs/DESIGN-MVP.md](docs/DESIGN-MVP.md) for liquidation versus prop drawdown lines and the percent-sizing note.

## License

[GNU AGPL-3.0-or-later](LICENSE). If you modify the program and let users interact with it over a network, you must offer the corresponding source (AGPL section 13). The wireframe footer links <https://github.com/Kinfxhk/perpdrill>.

## Packages

| Package             | Role                                                                              |
| ------------------- | --------------------------------------------------------------------------------- |
| `@perpdrill/core`   | Teaching margin, slippage gate, sizing, carry, replay, and the preset parser.     |
| `@perpdrill/web`    | Practice desk. Content-Security-Policy `default-src 'self'`.                      |
| `@perpdrill/server` | Prints `perpdrill 0.1.0 (teaching)`. Optional localhost listener. No trading API. |
