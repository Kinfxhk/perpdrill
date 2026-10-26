import {
  ACCOUNT_HEALTH_LABEL,
  BUYING_POWER_PCTS,
  ENGINE_STATUS,
  LIQ_PRICE_MARK_LABEL,
  PRODUCT_NAME,
  PRODUCT_VERSION,
  PROP_RULE_PRESET_SCHEMA_VERSION,
  SETTLEMENT_POLICY_LABELS,
  TRADING_POWER_LABEL,
} from "@perpdrill/core";

const SOURCE_URL = "https://github.com/Kinfxhk/perpdrill";
const NOT_COMPUTED = "—";

type Attrs = Record<string, string>;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: {
    className?: string;
    text?: string;
    attrs?: Attrs;
    disabled?: boolean;
  } = {},
  children: readonly Node[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className !== undefined) {
    node.className = options.className;
  }
  if (options.text !== undefined) {
    node.textContent = options.text;
  }
  if (options.attrs !== undefined) {
    for (const [key, value] of Object.entries(options.attrs)) {
      node.setAttribute(key, value);
    }
  }
  if (options.disabled === true) {
    node.setAttribute("aria-disabled", "true");
    if ("disabled" in node) {
      (node as HTMLButtonElement).disabled = true;
    }
  }
  for (const child of children) {
    node.append(child);
  }
  return node;
}

function button(text: string, className: string, current = false): HTMLButtonElement {
  const node = el("button", {
    className,
    text,
    disabled: true,
    attrs: { type: "button", title: "Disabled in M0" },
  });
  if (current) {
    node.setAttribute("aria-current", "page");
  }
  return node;
}

function stat(label: string, value: string): HTMLDivElement {
  return el("div", { className: "stat" }, [
    el("span", { className: "stat-label", text: label }),
    el("span", { className: "stat-value", text: value }),
  ]);
}

function quoteRow(label: string, value: string): HTMLDivElement {
  return el("div", { className: "quote-row" }, [
    el("span", { text: label }),
    el("span", { className: "mono", text: value }),
  ]);
}

function mountNav(): HTMLElement {
  const items: readonly { label: string; current: boolean }[] = [
    { label: "Practice", current: true },
    { label: "Markets", current: false },
    { label: "Review", current: false },
    { label: "Rules", current: false },
    { label: "Docs", current: false },
  ];
  return el("header", { className: "topnav" }, [
    el("div", { className: "brand" }, [
      el("p", { className: "brand-kicker", text: "Local practice desk" }),
      el("h1", { text: PRODUCT_NAME }),
    ]),
    el(
      "nav",
      { attrs: { "aria-label": "Primary" } },
      items.map((item) =>
        button(item.label, item.current ? "nav-btn is-current" : "nav-btn", item.current),
      ),
    ),
    el("div", { className: "top-actions" }, [
      button("Local session", "ghost"),
      button("Settings", "ghost"),
    ]),
  ]);
}

function mountMarket(): HTMLElement {
  return el("section", { className: "market", attrs: { "aria-label": "Market" } }, [
    el("div", { className: "symbol-block" }, [
      el("strong", { className: "symbol", text: "SAMPLE-PERP" }),
      button("Leverage", "lev"),
    ]),
    el("div", { className: "stats" }, [
      stat("Mid", NOT_COMPUTED),
      stat("Index", NOT_COMPUTED),
      stat("24h", NOT_COMPUTED),
      stat("1h Funding", NOT_COMPUTED),
      stat("OI", NOT_COMPUTED),
      stat("Vol", NOT_COMPUTED),
    ]),
  ]);
}

function mountChart(): HTMLElement {
  return el("section", { className: "chart", attrs: { "aria-label": "Chart" } }, [
    el("div", { className: "chart-toolbar" }, [
      button("1m", "chip"),
      button("5m", "chip"),
      button("15m", "chip"),
      button("1h", "chip"),
      el("span", { className: "toolbar-note", text: "No series loaded" }),
    ]),
    el("div", { className: "chart-stage" }, [
      el("p", { className: "chart-empty", text: "Chart area. Candles are not drawn in M0." }),
      el("ul", { className: "legend" }, [
        el("li", { className: "legend-entry", text: "Entry" }),
        el("li", { className: "legend-liq", text: "Liquidation" }),
        el("li", { className: "legend-prop", text: "Prop floor" }),
      ]),
    ]),
  ]);
}

function mountTicket(): HTMLElement {
  const percents = el(
    "div",
    { className: "pct-row", attrs: { role: "group", "aria-label": "Trading power percent" } },
    BUYING_POWER_PCTS.map((pct) => button(`${pct}%`, "pct")),
  );

  const slider = el("input", {
    className: "slider",
    disabled: true,
    attrs: {
      type: "range",
      min: "0",
      max: "100",
      step: "25",
      value: "0",
      "aria-label": "Trading power percent",
      "aria-valuetext": "not set",
    },
  });

  return el("aside", { className: "ticket", attrs: { "aria-label": "Order ticket" } }, [
    el("p", {
      className: "ticket-note",
      text: "Disabled in M0. Nothing here submits, sizes, or prices an order.",
    }),
    el("div", { className: "side-row" }, [
      button("Long", "side side-long"),
      button("Short", "side side-short"),
    ]),
    el("div", { className: "type-row" }, [
      button("Market", "chip is-current"),
      button("Limit", "chip"),
    ]),
    el("label", { className: "field" }, [
      el("span", { text: "Leverage" }),
      el("input", {
        disabled: true,
        attrs: { type: "text", value: NOT_COMPUTED, "aria-label": "Leverage" },
      }),
    ]),
    el("label", { className: "field" }, [
      el("span", { text: "Amount" }),
      el("input", {
        disabled: true,
        attrs: { type: "text", value: NOT_COMPUTED, "aria-label": "Amount" },
      }),
    ]),
    slider,
    percents,
    quoteRow(TRADING_POWER_LABEL, NOT_COMPUTED),
    el("div", { className: "type-row" }, [button("TIF", "chip"), button("TP / SL", "chip")]),
    quoteRow("Est. Fee", NOT_COMPUTED),
    quoteRow("Order Value", NOT_COMPUTED),
    quoteRow(LIQ_PRICE_MARK_LABEL, NOT_COMPUTED),
    quoteRow("Cost model", SETTLEMENT_POLICY_LABELS.off),
    el("div", { className: "submit-row" }, [
      button("Buy / Long", "submit submit-long"),
      button("Sell / Short", "submit submit-short"),
    ]),
    el("section", { className: "health", attrs: { "aria-label": ACCOUNT_HEALTH_LABEL } }, [
      el("h2", { text: ACCOUNT_HEALTH_LABEL }),
      quoteRow("Equity", NOT_COMPUTED),
      quoteRow("Available", NOT_COMPUTED),
      quoteRow("Unrealized PnL", NOT_COMPUTED),
      el(
        "div",
        { className: "health-meter", attrs: { role: "img", "aria-label": "Health not computed" } },
        [el("span", { text: "No session" })],
      ),
    ]),
  ]);
}

function mountPositions(): HTMLElement {
  const headers = [
    "Size",
    "Value",
    "Entry",
    "Mark",
    LIQ_PRICE_MARK_LABEL,
    "TP / SL",
    "Margin",
    "Funding",
    "PnL",
  ];
  return el("section", { className: "blotter", attrs: { "aria-label": "Positions" } }, [
    el("div", { className: "tabs", attrs: { role: "tablist", "aria-label": "Blotter" } }, [
      button("Positions", "tab is-current", true),
      button("Open orders", "tab"),
      button("History", "tab"),
      button("Fills", "tab"),
      button("Rules", "tab"),
    ]),
    el("div", { className: "table-wrap" }, [
      el("table", {}, [
        el("thead", {}, [
          el(
            "tr",
            {},
            headers.map((header) => el("th", { attrs: { scope: "col" }, text: header })),
          ),
        ]),
        el("tbody", {}, [
          el("tr", {}, [
            el("td", {
              className: "empty",
              attrs: { colspan: String(headers.length) },
              text: "No open positions. This scaffold does not track a book.",
            }),
          ]),
        ]),
      ]),
    ]),
  ]);
}

function mountReplay(): HTMLElement {
  return el("footer", { className: "replay", attrs: { "aria-label": "Replay" } }, [
    el("div", { className: "replay-controls" }, [
      button("Step back", "ghost"),
      button("Play", "ghost"),
      button("Step forward", "ghost"),
      button("Speed", "ghost"),
    ]),
    el("div", { className: "replay-meters" }, [
      stat("Equity", NOT_COMPUTED),
      stat("Drawdown", NOT_COMPUTED),
    ]),
  ]);
}

export function mountDesk(root: HTMLElement): void {
  const source = el("a", {
    className: "source-link",
    text: "Source code (AGPL §13)",
    attrs: { href: SOURCE_URL, rel: "noreferrer" },
  });
  source.title = "Source repository (AGPL §13)";

  const shell = el("div", { className: "shell" }, [
    el("p", {
      className: "banner",
      attrs: { role: "status" },
      text: "M0 骨架：沒有成交、保證金或強平計算。M0 scaffold. Fills, margin, and liquidation are not computed.",
    }),
    mountNav(),
    mountMarket(),
    el("div", { className: "workspace" }, [mountChart(), mountTicket()]),
    mountPositions(),
    mountReplay(),
    el("p", { className: "colophon" }, [
      el("span", {
        text: `${PRODUCT_NAME} ${PRODUCT_VERSION} · ${ENGINE_STATUS} · preset schema v${PROP_RULE_PRESET_SCHEMA_VERSION} · `,
      }),
      source,
    ]),
  ]);

  root.replaceChildren(shell);
}
