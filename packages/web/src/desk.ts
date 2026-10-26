import {
  BUYING_POWER_PCTS,
  DEFAULT_REALIZED_IMPACT_BPS,
  DEFAULT_SLIP_TOLERANCE_BPS,
  ENGINE_STATUS,
  MAX_REALIZED_IMPACT_BPS,
  MAX_SLIP_TOLERANCE_BPS,
  MIN_SLIP_TOLERANCE_BPS,
  PRACTICE_STARTING_BALANCE_USD,
  PRODUCT_NAME,
  PRODUCT_VERSION,
  PROP_RULE_PRESET_SCHEMA_VERSION,
  SAMPLE_MARKETS,
  TEACHING_MAX_LEVERAGE,
  TEACHING_MIN_LEVERAGE,
  isBuyingPowerPct,
  quoteClose,
  quoteOpen,
  replaySession,
  resolvedTakerBps,
  sampleSeries,
  type BuyingPowerPct,
  type FillKind,
  type Frame,
  type MarketId,
  type Phase,
  type PracticePreset,
  type RejectReason,
  type SessionAction,
  type Side,
} from "@perpdrill/core";
import { mountChart, type ChartLine } from "./chart.ts";
import { formatNumber, formatPct, formatQty, signedNumber } from "./format.ts";
import {
  LANG_CHOICES,
  numberLocale,
  readStoredLang,
  translate,
  writeStoredLang,
  type Lang,
  type MessageKey,
} from "./i18n.ts";
import { loadCommunityPresets } from "./preset-loader.ts";

const SOURCE_URL = "https://github.com/Kinfxhk/perpdrill";

type Tab = "positions" | "history" | "fills" | "rules";

type DeskState = {
  lang: Lang;
  market: MarketId;
  side: Side;
  leverage: number;
  powerPct: BuyingPowerPct;
  slipToleranceBps: number;
  realizedImpactBps: number;
  cursor: number;
  actions: SessionAction[];
  presetId: string | null;
  presets: readonly PracticePreset[];
  presetStatus: "loading" | "ready" | "error";
  tab: Tab;
  playing: boolean;
};

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

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function rejectKey(reason: RejectReason): MessageKey {
  switch (reason) {
    case "impact-over-tolerance":
      return "reject.impact";
    case "tolerance-out-of-range":
      return "reject.tolerance";
    case "invalid-impact":
      return "reject.impactInvalid";
    case "invalid-leverage":
      return "reject.leverage";
    case "invalid-power":
      return "reject.power";
    case "insufficient-cash":
      return "reject.cash";
    case "position-open":
      return "reject.position";
    case "account-frozen":
      return "reject.frozen";
    case "flat":
      return "reject.flat";
    case "market-not-allowed":
      return "reject.market";
    default: {
      const unexpected: never = reason;
      throw new Error(`unexpected reject ${String(unexpected)}`);
    }
  }
}

function phaseKey(phase: Phase): MessageKey {
  switch (phase) {
    case "practice":
      return "phase.practice";
    case "target":
      return "phase.target";
    case "drawdown":
      return "phase.drawdown";
    case "daily":
      return "phase.daily";
    case "liquidated":
      return "phase.liquidated";
    default: {
      const unexpected: never = phase;
      throw new Error(`unexpected phase ${String(unexpected)}`);
    }
  }
}

function fillKey(kind: FillKind): MessageKey {
  switch (kind) {
    case "open":
      return "history.open";
    case "close":
      return "history.close";
    case "liquidation":
      return "history.liquidation";
    default: {
      const unexpected: never = kind;
      throw new Error(`unexpected fill ${String(unexpected)}`);
    }
  }
}

function costKey(model: PracticePreset["costModel"] | "off"): MessageKey {
  switch (model) {
    case "funding":
      return "cost.funding";
    case "swap":
      return "cost.swap";
    case "off":
      return "cost.off";
    default: {
      const unexpected: never = model;
      throw new Error(`unexpected cost ${String(unexpected)}`);
    }
  }
}

function healthRatio(frame: Frame): number {
  if (frame.position === null || frame.positionEquity === null) {
    return 1;
  }
  const cushion = frame.position.initialMargin - frame.maintenance;
  if (cushion <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, (frame.positionEquity - frame.maintenance) / cushion));
}

export function mountDesk(root: HTMLElement): void {
  const state: DeskState = {
    lang: readStoredLang(),
    market: "BTC-PERP",
    side: "long",
    leverage: 10,
    powerPct: 25,
    slipToleranceBps: DEFAULT_SLIP_TOLERANCE_BPS,
    realizedImpactBps: DEFAULT_REALIZED_IMPACT_BPS,
    cursor: 0,
    actions: [],
    presetId: null,
    presets: [],
    presetStatus: "loading",
    tab: "positions",
    playing: false,
  };
  let timer = 0;

  const t = (key: MessageKey): string => translate(state.lang, key);
  const locale = (): string => numberLocale(state.lang);
  const preset = (): PracticePreset | null =>
    state.presets.find((item) => item.id === state.presetId) ?? null;
  const markets = (): readonly MarketId[] => preset()?.markets ?? SAMPLE_MARKETS;
  const startingBalance = (): number =>
    preset()?.startingBalanceUsd ?? PRACTICE_STARTING_BALANCE_USD;

  const stopPlay = (): void => {
    state.playing = false;
    if (timer !== 0) {
      window.clearInterval(timer);
      timer = 0;
    }
  };

  const resetSession = (): void => {
    stopPlay();
    state.cursor = 0;
    state.actions = [];
    if (!markets().includes(state.market)) {
      state.market = markets()[0] ?? "BTC-PERP";
    }
  };

  const render = (): void => {
    const active = document.activeElement;
    const restore = active instanceof HTMLInputElement && root.contains(active) ? active.id : "";
    document.documentElement.lang = state.lang;
    root.replaceChildren(build());
    if (restore.length > 0) {
      const next = root.querySelector(`#${CSS.escape(restore)}`);
      if (next instanceof HTMLInputElement) {
        next.focus();
      }
    }
  };

  const commit = (action: SessionAction): void => {
    stopPlay();
    state.actions = [...state.actions.filter((item) => item.barIndex <= state.cursor), action];
    // Same-bar replacements: a new open should not stack on an older open at this bar
    // unless a close sits between them. Drop a previous same-kind action at this bar.
    const kept: SessionAction[] = [];
    for (const item of state.actions) {
      const replaced =
        item !== action && item.barIndex === action.barIndex && item.kind === action.kind;
      if (!replaced) {
        kept.push(item);
      }
    }
    state.actions = kept.filter((item) => item.barIndex <= state.cursor);
    render();
  };

  function disabledButton(text: string, className: string, current = false): HTMLButtonElement {
    const node = el("button", {
      className,
      text,
      disabled: true,
      attrs: { type: "button", title: t("disabled.control") },
    });
    if (current) {
      node.setAttribute("aria-current", "page");
    }
    return node;
  }

  function actionButton(text: string, className: string, onClick: () => void): HTMLButtonElement {
    const node = el("button", { className, text, attrs: { type: "button" } });
    node.addEventListener("click", () => {
      onClick();
    });
    return node;
  }

  function stat(label: string, value: string): HTMLDivElement {
    return el("div", { className: "stat" }, [
      el("span", { className: "stat-label", text: label }),
      el("span", { className: "stat-value", text: value }),
    ]);
  }

  function quoteRow(label: string, value: string, valueClass = "mono"): HTMLDivElement {
    return el("div", { className: "quote-row" }, [
      el("span", { text: label }),
      el("span", { className: valueClass, text: value }),
    ]);
  }

  function build(): HTMLElement {
    const series = sampleSeries(state.market);
    const last = series.length - 1;
    const frame = replaySession({
      market: state.market,
      series,
      preset: preset(),
      actions: state.actions,
      cursor: state.cursor,
    });
    const takerBps = resolvedTakerBps(preset());
    const openQuote =
      frame.position === null
        ? quoteOpen({
            side: state.side,
            leverage: state.leverage,
            powerPct: state.powerPct,
            cash: frame.available,
            mark: frame.mark,
            takerBps,
            slipToleranceBps: state.slipToleranceBps,
            realizedImpactBps: state.realizedImpactBps,
          })
        : null;
    const closeQuote =
      frame.position === null
        ? null
        : quoteClose({
            side: frame.position.side,
            qty: frame.position.qty,
            entry: frame.position.entry,
            mark: frame.mark,
            takerBps,
            slipToleranceBps: state.slipToleranceBps,
            realizedImpactBps: state.realizedImpactBps,
          });
    const money = (value: number): string => formatNumber(value, locale());
    const dash = t("liq.none");
    const previewQty =
      frame.position !== null
        ? formatQty(frame.position.qty, locale())
        : openQuote?.ok
          ? formatQty(openQuote.qty, locale())
          : dash;
    const previewFee =
      frame.position !== null
        ? closeQuote?.ok
          ? money(closeQuote.fee)
          : dash
        : openQuote?.ok
          ? money(openQuote.fee)
          : dash;
    const previewValue =
      frame.position !== null
        ? money(frame.position.qty * frame.mark)
        : openQuote?.ok
          ? money(openQuote.notional)
          : dash;
    const liqPrice = frame.liqPrice ?? (openQuote?.ok ? openQuote.liqPrice : null);
    const liqDistance = frame.liqDistance ?? (openQuote?.ok ? openQuote.liqDistance : null);
    const maintenance =
      frame.position !== null ? frame.maintenance : openQuote?.ok ? openQuote.maintenance : null;
    const tradingPower = frame.available * state.leverage;
    const latestReject = [...frame.rejects]
      .reverse()
      .find((item) => item.barIndex === frame.barIndex);
    const drawdown =
      startingBalance() <= 0
        ? 0
        : Math.max(0, ((startingBalance() - frame.equity) / startingBalance()) * 100);
    const first = series[0];
    const change =
      first === undefined || first.close === 0
        ? 0
        : ((frame.mark - first.close) / first.close) * 100;
    const currentBar = series[state.cursor];

    const shell = el("div", { className: "shell" }, [
      el("p", { className: "banner", attrs: { role: "status" }, text: t("banner") }),
      mountNav(),
      mountMarket(frame, change, currentBar?.close ?? frame.mark),
      mountDisclaimer(),
      el("div", { className: "workspace" }, [
        mountChartSection(series, frame, money),
        mountTicket({
          frame,
          previewQty,
          previewFee,
          previewValue,
          liqPrice,
          liqDistance,
          maintenance,
          tradingPower,
          latestReject: latestReject?.reason ?? null,
          money,
          dash,
        }),
        el("div", { className: "desk-bottom" }, [
          mountBlotter(frame, money, dash),
          mountReplay(frame, last, drawdown, money),
        ]),
      ]),
      mountColophon(),
    ]);
    return shell;
  }

  function mountNav(): HTMLElement {
    const lang = el("select", {
      className: "lang-select",
      attrs: { id: "lang", "aria-label": t("lang.label") },
    });
    for (const choice of LANG_CHOICES) {
      const option = el("option", { text: choice.label, attrs: { value: choice.lang } });
      if (choice.lang === state.lang) {
        option.selected = true;
      }
      lang.append(option);
    }
    lang.addEventListener("change", () => {
      const value = lang.value;
      switch (value) {
        case "en":
        case "zh-Hant":
        case "zh-Hans":
        case "ja":
        case "ko":
          state.lang = value;
          writeStoredLang(value);
          render();
          return;
        default:
          return;
      }
    });

    return el("header", { className: "topnav" }, [
      el("div", { className: "brand" }, [
        el("p", { className: "brand-kicker", text: t("kicker") }),
        el("h1", { text: PRODUCT_NAME }),
      ]),
      el("nav", { attrs: { "aria-label": "Primary" } }, [
        actionButton(t("nav.practice"), "nav-btn is-current", () => {
          state.tab = "positions";
          render();
        }),
        disabledButton(t("nav.markets"), "nav-btn"),
        disabledButton(t("nav.review"), "nav-btn"),
        actionButton(t("nav.rules"), "nav-btn", () => {
          state.tab = "rules";
          render();
        }),
        disabledButton(t("nav.docs"), "nav-btn"),
      ]),
      el("div", { className: "top-actions" }, [
        disabledButton(t("session.local"), "ghost"),
        disabledButton(t("settings"), "ghost"),
        lang,
      ]),
    ]);
  }

  function mountMarket(frame: Frame, change: number, index: number): HTMLElement {
    const select = el("select", {
      className: "market-select",
      attrs: { "aria-label": t("market.synthetic") },
    });
    for (const market of markets()) {
      const option = el("option", { text: market, attrs: { value: market } });
      if (market === state.market) {
        option.selected = true;
      }
      select.append(option);
    }
    select.disabled = frame.position !== null;
    select.addEventListener("change", () => {
      const value = select.value;
      if (value !== "BTC-PERP" && value !== "ETH-PERP") {
        return;
      }
      if (value === state.market || frame.position !== null) {
        return;
      }
      stopPlay();
      state.market = value;
      state.cursor = 0;
      state.actions = [];
      render();
    });

    const active = preset();
    let funding = t("liq.none");
    if (active?.costModel === "swap" && active.swapDailyRatePct !== null) {
      funding = formatPct(active.swapDailyRatePct, locale());
    } else if (active?.costModel === "funding") {
      funding = formatNumber(active.fundingRatePerHour ?? 0, locale(), 4);
    }

    return el("section", { className: "market", attrs: { "aria-label": "Market" } }, [
      el("div", { className: "symbol-block" }, [
        select,
        el("span", { className: "toolbar-note", text: t("market.synthetic") }),
      ]),
      el("div", { className: "stats" }, [
        stat(t("market.mid"), formatNumber(frame.mark, locale())),
        stat(t("market.index"), formatNumber(index, locale())),
        stat(t("market.change"), formatPct(change, locale())),
        stat(t("market.funding"), funding),
        stat(t("market.oi"), t("liq.none")),
        stat(t("market.vol"), t("liq.none")),
      ]),
    ]);
  }

  function mountDisclaimer(): HTMLElement {
    const active = preset();
    if (state.presetStatus === "loading") {
      return el("p", { className: "disclaimer", text: t("preset.loading") });
    }
    if (state.presetStatus === "error") {
      return el("p", { className: "disclaimer", text: t("preset.error") });
    }
    if (active === null) {
      return el("p", { className: "disclaimer", text: t("balance.practice") });
    }
    return el("p", { className: "disclaimer", text: active.disclaimer });
  }

  function mountChartSection(
    series: ReturnType<typeof sampleSeries>,
    frame: Frame,
    money: (value: number) => string,
  ): HTMLElement {
    const lines: ChartLine[] = [];
    if (frame.position !== null) {
      lines.push({ price: frame.position.entry, kind: "entry" });
    }
    if (frame.liqPrice !== null) {
      lines.push({ price: frame.liqPrice, kind: "liq" });
    }
    if (frame.failPrice !== null) {
      lines.push({ price: frame.failPrice, kind: "fail" });
    }
    if (frame.dailyFailPrice !== null) {
      lines.push({ price: frame.dailyFailPrice, kind: "daily" });
    }
    const stage = el("div", { className: "chart-stage" });
    mountChart(stage, {
      candles: series.slice(0, state.cursor + 1),
      lines,
      label: `${t("chart.sample")} ${state.cursor + 1}/${series.length}`,
      formatPrice: money,
    });
    const legend = el("ul", { className: "legend" }, [
      el("li", { className: "legend-entry", text: t("legend.entry") }),
      el("li", { className: "legend-liq", text: t("legend.liquidation") }),
      el("li", { className: "legend-prop", text: t("legend.fail") }),
      el("li", { className: "legend-daily", text: t("legend.daily") }),
    ]);
    stage.append(legend);
    return el("section", { className: "chart", attrs: { "aria-label": "Chart" } }, [
      el("div", { className: "chart-toolbar" }, [
        el("span", { className: "chip is-current", text: t("chart.sample") }),
        el("span", {
          className: "toolbar-note",
          text: `${t("replay.bar")} ${state.cursor + 1}/${series.length} · ${t("teaching.mark")}`,
        }),
      ]),
      stage,
    ]);
  }

  function mountTicket(view: {
    frame: Frame;
    previewQty: string;
    previewFee: string;
    previewValue: string;
    liqPrice: number | null;
    liqDistance: number | null;
    maintenance: number | null;
    tradingPower: number;
    latestReject: RejectReason | null;
    money: (value: number) => string;
    dash: string;
  }): HTMLElement {
    const active = preset();
    const presetSelect = el("select", {
      attrs: { id: "preset", "aria-label": t("preset.label") },
    });
    const none = el("option", { text: t("preset.none"), attrs: { value: "" } });
    none.selected = state.presetId === null;
    presetSelect.append(none);
    for (const item of state.presets) {
      const option = el("option", { text: item.displayName, attrs: { value: item.id } });
      option.selected = item.id === state.presetId;
      presetSelect.append(option);
    }
    presetSelect.disabled = state.presetStatus !== "ready";
    presetSelect.addEventListener("change", () => {
      state.presetId = presetSelect.value.length === 0 ? null : presetSelect.value;
      resetSession();
      render();
    });

    const leverage = el("input", {
      attrs: {
        id: "leverage",
        type: "number",
        min: String(TEACHING_MIN_LEVERAGE),
        max: String(TEACHING_MAX_LEVERAGE),
        step: "1",
        value: String(state.leverage),
        "aria-label": t("field.leverage"),
      },
    });
    leverage.addEventListener("change", () => {
      state.leverage = clampInt(
        leverage.valueAsNumber,
        TEACHING_MIN_LEVERAGE,
        TEACHING_MAX_LEVERAGE,
        state.leverage,
      );
      render();
    });

    const maxSlip = el("input", {
      attrs: {
        id: "max-slip",
        type: "number",
        min: String(MIN_SLIP_TOLERANCE_BPS),
        max: String(MAX_SLIP_TOLERANCE_BPS),
        step: "1",
        value: String(state.slipToleranceBps),
        "aria-label": t("field.maxSlip"),
      },
    });
    maxSlip.addEventListener("change", () => {
      state.slipToleranceBps = clampInt(
        maxSlip.valueAsNumber,
        MIN_SLIP_TOLERANCE_BPS,
        MAX_SLIP_TOLERANCE_BPS,
        DEFAULT_SLIP_TOLERANCE_BPS,
      );
      render();
    });

    const estSlip = el("input", {
      attrs: {
        id: "est-slip",
        type: "number",
        min: "0",
        max: String(MAX_REALIZED_IMPACT_BPS),
        step: "1",
        value: String(state.realizedImpactBps),
        "aria-label": t("field.estSlip"),
      },
    });
    estSlip.addEventListener("change", () => {
      state.realizedImpactBps = clampInt(
        estSlip.valueAsNumber,
        0,
        MAX_REALIZED_IMPACT_BPS,
        DEFAULT_REALIZED_IMPACT_BPS,
      );
      render();
    });

    const slider = el("input", {
      className: "slider",
      attrs: {
        type: "range",
        min: "25",
        max: "100",
        step: "25",
        value: String(state.powerPct),
        "aria-label": t("power.label"),
        "aria-valuetext": `${state.powerPct}%`,
      },
    });
    slider.addEventListener("change", () => {
      if (isBuyingPowerPct(slider.valueAsNumber)) {
        state.powerPct = slider.valueAsNumber;
        render();
      }
    });

    const percents = el(
      "div",
      { className: "pct-row", attrs: { role: "group", "aria-label": t("power.label") } },
      BUYING_POWER_PCTS.map((pct) => {
        const node = actionButton(
          `${pct}%`,
          pct === state.powerPct ? "pct is-selected" : "pct",
          () => {
            state.powerPct = pct;
            render();
          },
        );
        if (pct === state.powerPct) {
          node.setAttribute("aria-pressed", "true");
        }
        return node;
      }),
    );

    const submitLabel =
      view.frame.position !== null
        ? t("submit.close")
        : state.side === "long"
          ? t("submit.long")
          : t("submit.short");
    const submitClass =
      view.frame.position !== null
        ? "submit"
        : state.side === "long"
          ? "submit submit-long"
          : "submit submit-short";

    const ratio = healthRatio(view.frame);
    const meter = el(
      "div",
      {
        className: ratio < 0.25 ? "health-meter is-hot" : "health-meter",
        attrs: {
          role: "meter",
          "aria-valuemin": "0",
          "aria-valuemax": "100",
          "aria-valuenow": String(Math.round(ratio * 100)),
          "aria-label": t("health.title"),
        },
      },
      [
        el("span", { className: "health-fill" }),
        el("span", { className: "health-readout", text: t(phaseKey(view.frame.phase)) }),
      ],
    );
    const fill = meter.querySelector(".health-fill");
    if (fill instanceof HTMLElement) {
      fill.style.width = `${Math.round(ratio * 100)}%`;
    }

    const pnlClass =
      view.frame.unrealizedPnl > 0
        ? "mono pnl-up"
        : view.frame.unrealizedPnl < 0
          ? "mono pnl-down"
          : "mono";

    const submit = el("div", { className: "submit-row" }, [
      actionButton(submitLabel, submitClass, () => {
        if (view.frame.position === null) {
          commit({
            kind: "open",
            barIndex: state.cursor,
            side: state.side,
            leverage: state.leverage,
            powerPct: state.powerPct,
            slipToleranceBps: state.slipToleranceBps,
            realizedImpactBps: state.realizedImpactBps,
          });
          return;
        }
        commit({
          kind: "close",
          barIndex: state.cursor,
          slipToleranceBps: state.slipToleranceBps,
          realizedImpactBps: state.realizedImpactBps,
        });
      }),
    ]);

    return el("aside", { className: "ticket", attrs: { "aria-label": "Order ticket" } }, [
      el("div", { className: "ticket-scroll" }, [
        el("p", { className: "ticket-note", text: t("ticket.note") }),
        el("label", { className: "field" }, [
          el("span", { text: t("preset.label") }),
          presetSelect,
        ]),
        el("div", { className: "side-row" }, [pressSide("long"), pressSide("short")]),
        el("div", { className: "type-row" }, [
          el("span", { className: "chip is-current", text: t("type.market") }),
          disabledButton(t("type.limit"), "chip"),
        ]),
        el("label", { className: "field" }, [el("span", { text: t("field.leverage") }), leverage]),
        el("p", { className: "hint", text: t("field.leverageHint") }),
        el("label", { className: "field" }, [
          el("span", { text: t("field.maxSlip") }),
          maxSlip,
          el("span", { className: "hint", text: t("slip.bps") }),
        ]),
        el("label", { className: "field" }, [
          el("span", { text: t("field.estSlip") }),
          estSlip,
          el("span", { className: "hint", text: t("slip.bps") }),
        ]),
        el("label", { className: "field" }, [
          el("span", { text: t("field.amount") }),
          el("output", { className: "mono", text: view.previewQty, attrs: { for: "leverage" } }),
        ]),
        slider,
        percents,
        quoteRow(t("power.label"), view.money(view.tradingPower)),
        quoteRow(t("est.fee"), view.previewFee),
        quoteRow(
          view.frame.position === null ? t("orderValue") : t("col.value"),
          view.previewValue,
        ),
        quoteRow(t("cost.model"), t(costKey(active?.costModel ?? "off"))),
        el("p", { className: "hint", text: costHint(active) }),
        el("section", { className: "health", attrs: { "aria-label": t("health.title") } }, [
          el("h2", { text: t("health.title") }),
          quoteRow(t("health.equity"), view.money(view.frame.equity)),
          quoteRow(t("health.available"), view.money(view.frame.available)),
          quoteRow(t("health.upnl"), signedNumber(view.frame.unrealizedPnl, locale()), pnlClass),
          quoteRow(
            t("health.maintenance"),
            view.maintenance === null ? view.dash : view.money(view.maintenance),
          ),
          meter,
        ]),
      ]),
      el("div", { className: "ticket-pin" }, [
        quoteRow(t("liq.price"), view.liqPrice === null ? view.dash : view.money(view.liqPrice)),
        quoteRow(
          t("liq.risk"),
          view.liqDistance === null ? view.dash : formatPct(view.liqDistance * 100, locale()),
        ),
        ...(view.latestReject === null
          ? []
          : [
              el("p", {
                className: "reject",
                attrs: { role: "status" },
                text: t(rejectKey(view.latestReject)),
              }),
            ]),
        submit,
      ]),
    ]);
  }

  function pressSide(side: Side): HTMLButtonElement {
    const selected = state.side === side;
    const node = actionButton(
      t(side === "long" ? "side.long" : "side.short"),
      `side ${side === "long" ? "side-long" : "side-short"}${selected ? " is-selected" : ""}`,
      () => {
        state.side = side;
        render();
      },
    );
    node.setAttribute("aria-pressed", selected ? "true" : "false");
    return node;
  }

  function costHint(active: PracticePreset | null): string {
    if (active === null) {
      return t("balance.practice");
    }
    const balance =
      active.startingBalanceUsd === null ? t("balance.practice") : t("balance.fromPreset");
    if (active.costModel === "funding") {
      return `${t("cost.stub")} ${balance}`;
    }
    if (active.takerBps === null) {
      return `${t("cost.noFee")} ${balance}`;
    }
    return balance;
  }

  function mountBlotter(frame: Frame, money: (value: number) => string, dash: string): HTMLElement {
    const tabs: readonly { id: Tab; key: MessageKey }[] = [
      { id: "positions", key: "blotter.positions" },
      { id: "history", key: "blotter.history" },
      { id: "fills", key: "blotter.fills" },
      { id: "rules", key: "blotter.rules" },
    ];
    const tabRow = el(
      "div",
      { className: "tabs", attrs: { role: "tablist", "aria-label": "Blotter" } },
      [
        ...tabs.map((tab) => {
          const node = actionButton(
            t(tab.key),
            tab.id === state.tab ? "tab is-current" : "tab",
            () => {
              state.tab = tab.id;
              render();
            },
          );
          if (tab.id === state.tab) {
            node.setAttribute("aria-current", "page");
          }
          return node;
        }),
        disabledButton(t("blotter.orders"), "tab"),
      ],
    );
    return el("section", { className: "blotter", attrs: { "aria-label": "Positions" } }, [
      tabRow,
      el("div", { className: "table-wrap" }, [blotterBody(frame, money, dash)]),
    ]);
  }

  function blotterBody(frame: Frame, money: (value: number) => string, dash: string): HTMLElement {
    switch (state.tab) {
      case "positions":
        return positionTable(frame, money, dash);
      case "history":
        return fillTable(
          frame.fills.filter((fill) => fill.kind !== "open"),
          t("empty.history"),
          money,
        );
      case "fills":
        return fillTable(frame.fills, t("empty.fills"), money);
      case "rules":
        return rulesPanel(frame, money, dash);
      default: {
        const unexpected: never = state.tab;
        throw new Error(`unexpected tab ${String(unexpected)}`);
      }
    }
  }

  function positionTable(
    frame: Frame,
    money: (value: number) => string,
    dash: string,
  ): HTMLTableElement {
    const headers = [
      t("col.size"),
      t("col.value"),
      t("col.entry"),
      t("col.mark"),
      t("col.liq"),
      t("col.tpsl"),
      t("col.margin"),
      t("col.carry"),
      t("col.pnl"),
    ];
    const position = frame.position;
    const body =
      position === null
        ? el("tr", {}, [
            el("td", {
              className: "empty",
              attrs: { colspan: String(headers.length) },
              text: t("empty.positions"),
            }),
          ])
        : el("tr", {}, [
            el("td", {
              className: "mono",
              text: `${position.side === "long" ? "+" : "−"}${formatQty(position.qty, locale())}`,
            }),
            el("td", { className: "mono", text: money(position.qty * frame.mark) }),
            el("td", { className: "mono", text: money(position.entry) }),
            el("td", { className: "mono", text: money(frame.mark) }),
            el("td", { className: "mono", text: money(position.liqPrice) }),
            el("td", { text: dash }),
            el("td", { className: "mono", text: money(position.isolatedMargin) }),
            el("td", { className: "mono", text: money(frame.carryPaid) }),
            el("td", {
              className: frame.unrealizedPnl < 0 ? "mono pnl-down" : "mono pnl-up",
              text: signedNumber(frame.unrealizedPnl, locale()),
            }),
          ]);
    return el("table", {}, [
      el("thead", {}, [
        el(
          "tr",
          {},
          headers.map((header) => el("th", { attrs: { scope: "col" }, text: header })),
        ),
      ]),
      el("tbody", {}, [body]),
    ]);
  }

  function fillTable(
    fills: Frame["fills"],
    empty: string,
    money: (value: number) => string,
  ): HTMLTableElement {
    const headers = [
      t("replay.bar"),
      t("col.kind"),
      t("col.price"),
      t("preview.qty"),
      t("est.fee"),
      t("col.pnl"),
    ];
    const rows =
      fills.length === 0
        ? [
            el("tr", {}, [
              el("td", {
                className: "empty",
                attrs: { colspan: String(headers.length) },
                text: empty,
              }),
            ]),
          ]
        : fills.map((fill) =>
            el("tr", {}, [
              el("td", { className: "mono", text: String(fill.barIndex + 1) }),
              el("td", { text: t(fillKey(fill.kind)) }),
              el("td", { className: "mono", text: money(fill.price) }),
              el("td", { className: "mono", text: formatQty(fill.qty, locale()) }),
              el("td", { className: "mono", text: money(fill.fee) }),
              el("td", { className: "mono", text: signedNumber(fill.pricePnl, locale()) }),
            ]),
          );
    return el("table", {}, [
      el("thead", {}, [
        el(
          "tr",
          {},
          headers.map((header) => el("th", { attrs: { scope: "col" }, text: header })),
        ),
      ]),
      el("tbody", {}, rows),
    ]);
  }

  function rulesPanel(
    frame: Frame,
    money: (value: number) => string,
    dash: string,
  ): HTMLDivElement {
    const active = preset();
    if (active === null) {
      return el("div", { className: "rules" }, [el("p", { text: t("rules.none") })]);
    }
    const upnl =
      active.equityIncludesUPnL === true
        ? t("rules.upnlYes")
        : active.equityIncludesUPnL === false
          ? t("rules.upnlNo")
          : t("rules.upnlUnstated");
    const links = active.sourceUrls.map((url) => {
      const link = el("a", {
        className: "source-link",
        text: url,
        attrs: { href: url, rel: "noreferrer" },
      });
      return el("li", {}, [link]);
    });
    return el("div", { className: "rules" }, [
      el("h2", { text: active.displayName }),
      el("p", { text: active.disclaimer }),
      el("p", { text: upnl }),
      quoteRow(t("rules.target"), money(frame.profitTarget ?? 0)),
      quoteRow(
        t("rules.maxDd"),
        frame.maxDrawdownFloor === null ? dash : money(frame.maxDrawdownFloor),
      ),
      quoteRow(
        t("rules.daily"),
        frame.dailyLossFloor === null ? dash : money(frame.dailyLossFloor),
      ),
      quoteRow(t("rules.carry"), money(frame.carryPaid)),
      quoteRow(t("phase.practice"), t(phaseKey(frame.phase))),
      active.note.length > 0 ? el("p", { text: active.note }) : el("p", { text: "" }),
      el("h3", { text: t("rules.sources") }),
      el("ul", { className: "sources" }, links),
    ]);
  }

  function mountReplay(
    frame: Frame,
    last: number,
    drawdown: number,
    money: (value: number) => string,
  ): HTMLElement {
    return el("footer", { className: "replay", attrs: { "aria-label": "Replay" } }, [
      el("div", { className: "replay-controls" }, [
        actionButton(t("replay.back"), "ghost", () => {
          stopPlay();
          state.cursor = Math.max(0, state.cursor - 1);
          render();
        }),
        actionButton(state.playing ? t("replay.pause") : t("replay.play"), "ghost", () => {
          if (state.playing) {
            stopPlay();
            render();
            return;
          }
          if (state.cursor >= last) {
            return;
          }
          state.playing = true;
          timer = window.setInterval(() => {
            if (state.cursor >= last) {
              stopPlay();
              render();
              return;
            }
            state.cursor += 1;
            render();
          }, 700);
          render();
        }),
        actionButton(t("replay.forward"), "ghost", () => {
          stopPlay();
          state.cursor = Math.min(last, state.cursor + 1);
          render();
        }),
        actionButton(t("replay.reset"), "ghost", () => {
          resetSession();
          render();
        }),
      ]),
      el("div", { className: "replay-meters" }, [
        stat(t("replay.equity"), money(frame.equity)),
        stat(t("replay.drawdown"), formatPct(drawdown, locale())),
        stat(t("replay.bar"), `${state.cursor + 1}/${last + 1}`),
      ]),
    ]);
  }

  function mountColophon(): HTMLElement {
    const source = el("a", {
      className: "source-link",
      text: t("footer.source"),
      attrs: { href: SOURCE_URL, rel: "noreferrer" },
    });
    source.dataset.license = "AGPL-3.0-or-later";
    return el("p", { className: "colophon" }, [
      el("span", {
        text: `${PRODUCT_NAME} ${PRODUCT_VERSION} · ${ENGINE_STATUS} · preset schema v${PROP_RULE_PRESET_SCHEMA_VERSION} · `,
      }),
      source,
    ]);
  }

  render();
  void loadCommunityPresets()
    .then((presets) => {
      state.presets = presets;
      state.presetStatus = "ready";
      render();
    })
    .catch(() => {
      state.presetStatus = "error";
      render();
    });
}
