import {
  BUYING_POWER_PCTS,
  DEFAULT_BOLLINGER_DEVIATIONS,
  DEFAULT_BOLLINGER_PERIOD,
  DEFAULT_REALIZED_IMPACT_BPS,
  DEFAULT_SLIP_TOLERANCE_BPS,
  ENGINE_STATUS,
  MAX_REALIZED_IMPACT_BPS,
  MAX_SLIP_TOLERANCE_BPS,
  MIN_SLIP_TOLERANCE_BPS,
  MAX_SYNTHETIC_BARS,
  MIN_SYNTHETIC_BARS,
  PRODUCT_NAME,
  PRODUCT_VERSION,
  PROP_RULE_PRESET_SCHEMA_VERSION,
  SAMPLE_MARKETS,
  SYNTHETIC_TIMEFRAMES_MIN,
  TEACHING_MAX_LEVERAGE,
  TEACHING_MIN_LEVERAGE,
  bollingerBands,
  closesThrough,
  exponentialMovingAverage,
  isBuyingPowerPct,
  isMarketId,
  isSyntheticTimeframe,
  pairTrades,
  quoteClose,
  quoteOpen,
  replaySession,
  randomSeed,
  resolvedTakerBps,
  sessionStats,
  simpleMovingAverage,
  syntheticSeries,
  type Bar,
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
import {
  mountChart,
  type ChartBand,
  type ChartLine,
  type ChartOverlay,
  type IndicatorStroke,
} from "./chart.ts";
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
import {
  customPreset,
  dataKey,
  readStoredSetup,
  setupMarkets,
  setupStartingBalance,
  takeFirstRun,
  warmupBars,
  writeStoredSetup,
  type CustomRules,
  type SessionSetup,
} from "./setup.ts";

const SOURCE_URL = "https://github.com/Kinfxhk/perpdrill";

type Tab = "positions" | "history" | "fills" | "rules" | "review";

/** Bars drawn at once; older bars scroll off the left edge. */
const CHART_WINDOW = 140;
const SPEEDS = [
  { label: "1×", ms: 800 },
  { label: "2×", ms: 400 },
  { label: "4×", ms: 200 },
  { label: "8×", ms: 100 },
] as const;
const COUNTDOWN_STEP_MS = 1_000;

type MovingAverageKind = "sma" | "ema";

type MovingAverageInstance = {
  readonly id: string;
  readonly kind: MovingAverageKind;
  period: number;
  visible: boolean;
  readonly stroke: IndicatorStroke;
};

const MIN_INDICATOR_PERIOD = 1;
const MAX_INDICATOR_PERIOD = 500;

function defaultMovingAverages(): MovingAverageInstance[] {
  return [
    { id: "sma-9", kind: "sma", period: 9, visible: true, stroke: "text-dim" },
    { id: "sma-20", kind: "sma", period: 20, visible: true, stroke: "accent" },
    { id: "sma-50", kind: "sma", period: 50, visible: true, stroke: "line" },
    { id: "ema-9", kind: "ema", period: 9, visible: true, stroke: "short" },
    { id: "ema-21", kind: "ema", period: 21, visible: true, stroke: "danger" },
    { id: "ema-50", kind: "ema", period: 50, visible: true, stroke: "prop" },
  ];
}

type DeskState = {
  lang: Lang;
  screen: "setup" | "play";
  setup: SessionSetup;
  series: readonly Bar[];
  countdown: number | null;
  speedMs: number;
  stopLossText: string;
  takeProfitText: string;
  endedAt: number | null;
  market: MarketId;
  side: Side;
  leverage: number;
  powerPct: BuyingPowerPct;
  slipToleranceBps: number;
  realizedImpactBps: number;
  cursor: number;
  actions: SessionAction[];
  presets: readonly PracticePreset[];
  presetStatus: "loading" | "ready" | "error";
  tab: Tab;
  playing: boolean;
  movingAverages: MovingAverageInstance[];
  bollingerVisible: boolean;
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
    case "invalid-bracket":
      return "reject.bracket";
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
    case "stop":
      return "history.stop";
    case "take-profit":
      return "history.takeProfit";
    case "breach":
      return "history.breach";
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
  const stored = readStoredSetup();
  const state: DeskState = {
    lang: readStoredLang(),
    screen: "setup",
    setup: stored,
    series: [],
    countdown: null,
    speedMs: SPEEDS[0].ms,
    stopLossText: "",
    takeProfitText: "",
    endedAt: null,
    market: stored.market,
    side: "long",
    leverage: 10,
    powerPct: 25,
    slipToleranceBps: DEFAULT_SLIP_TOLERANCE_BPS,
    realizedImpactBps: DEFAULT_REALIZED_IMPACT_BPS,
    cursor: 0,
    actions: [],
    presets: [],
    presetStatus: "loading",
    tab: "positions",
    playing: false,
    movingAverages: defaultMovingAverages(),
    bollingerVisible: false,
  };
  let timer = 0;
  let countdownTimer = 0;
  // Effects fire once per new event; the desk DOM is rebuilt on every render.
  let seenFills = 0;
  let seenRejects = 0;
  let seenEnd: number | null = null;
  const toastHost = el("div", { className: "toast-host", attrs: { "aria-live": "polite" } });
  document.body.append(toastHost);
  const toast = (text: string, tone: "up" | "down" | "info" | "warn"): void => {
    const node = el("div", { className: `toast toast-${tone}`, text });
    toastHost.append(node);
    while (toastHost.children.length > 3) {
      toastHost.firstElementChild?.remove();
    }
    window.setTimeout(() => node.remove(), 2_400);
  };

  const t = (key: MessageKey): string => translate(state.lang, key);
  const locale = (): string => numberLocale(state.lang);
  const presetFor = (setup: SessionSetup): PracticePreset | null => {
    switch (setup.rulesMode) {
      case "none":
        return null;
      case "custom":
        return customPreset(setup.custom);
      case "preset":
        return state.presets.find((item) => item.id === setup.presetId) ?? null;
      default: {
        const unexpected: never = setup.rulesMode;
        return unexpected;
      }
    }
  };
  // The active session keeps the rules it started with.
  let sessionPreset: PracticePreset | null = null;
  const preset = (): PracticePreset | null => sessionPreset;
  const startingBalance = (): number => setupStartingBalance(preset());

  const stopPlay = (): void => {
    state.playing = false;
    if (timer !== 0) {
      window.clearInterval(timer);
      timer = 0;
    }
  };

  const stopCountdown = (): void => {
    state.countdown = null;
    if (countdownTimer !== 0) {
      window.clearInterval(countdownTimer);
      countdownTimer = 0;
    }
  };

  const lastIndex = (): number => state.series.length - 1;
  const firstCursor = (): number => warmupBars(state.series.length);

  const startPlay = (): void => {
    stopPlay();
    if (state.cursor >= lastIndex() || state.endedAt !== null) {
      return;
    }
    state.playing = true;
    timer = window.setInterval(() => {
      if (state.cursor >= lastIndex() || state.endedAt !== null) {
        stopPlay();
        render();
        return;
      }
      state.cursor += 1;
      settleEnd();
      render();
    }, state.speedMs);
  };

  /** Freeze the session when the account fails, passes or the data runs out. */
  const settleEnd = (): void => {
    if (state.endedAt !== null) {
      return;
    }
    const frame = currentFrame();
    if (frame.phase !== "practice" || state.cursor >= lastIndex()) {
      state.endedAt = state.cursor;
      stopPlay();
      state.tab = "review";
    }
  };

  const resetSession = (): void => {
    stopPlay();
    stopCountdown();
    state.cursor = firstCursor();
    state.actions = [];
    state.endedAt = null;
    state.stopLossText = "";
    state.takeProfitText = "";
    state.tab = "positions";
    seenFills = 0;
    seenRejects = 0;
    seenEnd = null;
  };

  /** Generate the data, then count 3-2-1 the first time this data set is played. */
  const beginSession = (setup: SessionSetup): void => {
    writeStoredSetup(setup);
    state.setup = setup;
    sessionPreset = presetFor(setup);
    const allowed = setupMarkets(sessionPreset);
    state.market = allowed.includes(setup.market) ? setup.market : (allowed[0] ?? "BTC-PERP");
    if (sessionPreset?.maxLeverage !== null && sessionPreset?.maxLeverage !== undefined) {
      state.leverage = Math.min(state.leverage, sessionPreset.maxLeverage);
    }
    state.series = syntheticSeries({
      market: state.market,
      seed: setup.seed,
      bars: setup.bars,
      timeframeMin: setup.timeframeMin,
    });
    state.screen = "play";
    resetSession();
    if (takeFirstRun(dataKey({ ...setup, market: state.market }))) {
      state.countdown = 3;
      countdownTimer = window.setInterval(() => {
        if (state.countdown === null || state.countdown <= 1) {
          stopCountdown();
          startPlay();
        } else {
          state.countdown -= 1;
        }
        render();
      }, COUNTDOWN_STEP_MS);
    } else {
      startPlay();
    }
    render();
  };

  const currentFrame = (): Frame =>
    replaySession({
      market: state.market,
      series: state.series,
      preset: preset(),
      actions: state.actions,
      cursor: state.cursor,
    });

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
    if (state.endedAt !== null || state.countdown !== null) {
      return;
    }
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
    settleEnd();
    render();
  };

  const parsePrice = (text: string): number | null => {
    const value = Number(text.trim().replace(/,/g, ""));
    return text.trim().length === 0 || !Number.isFinite(value) || value <= 0 ? null : value;
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
    if (state.screen === "setup" || state.series.length === 0) {
      return el("div", { className: "shell shell-setup" }, [
        el("p", { className: "banner", attrs: { role: "status" }, text: t("banner") }),
        mountNav(),
        mountSetup(),
        mountColophon(),
      ]);
    }
    const series = state.series;
    const last = series.length - 1;
    const frame = currentFrame();
    if (frame.fills.length < seenFills || frame.rejects.length < seenRejects) {
      seenFills = frame.fills.length;
      seenRejects = frame.rejects.length;
    }
    let flash: "up" | "down" | null = null;
    for (const fill of frame.fills.slice(seenFills)) {
      const pnl = fill.pricePnl - fill.fee;
      const label = `${t(fillKey(fill.kind))} · ${formatNumber(fill.price, locale())}`;
      if (fill.kind === "open") {
        toast(`${t(fill.side === "long" ? "side.long" : "side.short")} · ${label}`, "info");
      } else {
        toast(`${label} · ${signedNumber(pnl, locale())}`, pnl >= 0 ? "up" : "down");
        flash = pnl >= 0 ? "up" : "down";
      }
    }
    for (const reject of frame.rejects.slice(seenRejects)) {
      toast(t(rejectKey(reject.reason)), "warn");
    }
    seenFills = frame.fills.length;
    seenRejects = frame.rejects.length;
    const endedNow = state.endedAt !== null && seenEnd !== state.endedAt;
    seenEnd = state.endedAt;
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
    if (flash !== null) {
      shell.querySelector(".replay-meters")?.classList.add(`flash-${flash}`);
    }
    if (endedNow) {
      shell.querySelector(".verdict")?.classList.add("verdict-pop");
    }
    if (state.countdown !== null) {
      for (const child of Array.from(shell.children)) {
        child.setAttribute("inert", "");
      }
      shell.append(mountCountdown(state.countdown));
    }
    return shell;
  }

  function mountCountdown(value: number): HTMLElement {
    const skip = actionButton(t("countdown.skip"), "countdown-skip", () => {
      stopCountdown();
      startPlay();
      render();
    });
    return el(
      "div",
      {
        className: "countdown-overlay",
        attrs: { role: "dialog", "aria-modal": "true", "aria-label": t("countdown.label") },
      },
      [
        el("p", { className: "countdown-label", text: t("countdown.label") }),
        el("div", {
          className: "countdown-num countdown-pop",
          text: String(value),
          attrs: { "aria-live": "assertive", "data-testid": "countdown-num" },
        }),
        skip,
      ],
    );
  }

  function numberField(
    id: string,
    label: string,
    value: number,
    limits: { min: number; max: number; step: number },
    onChange: (value: number) => void,
    hint?: string,
  ): HTMLLabelElement {
    const input = el("input", {
      attrs: {
        id,
        type: "number",
        min: String(limits.min),
        max: String(limits.max),
        step: String(limits.step),
        value: String(value),
      },
    });
    input.addEventListener("change", () => {
      const next = input.valueAsNumber;
      if (Number.isFinite(next)) {
        onChange(Math.min(limits.max, Math.max(limits.min, next)));
      }
      render();
    });
    return el("label", { className: "field" }, [
      el("span", { text: label }),
      input,
      ...(hint === undefined ? [] : [el("span", { className: "hint", text: hint })]),
    ]);
  }

  function selectField(
    id: string,
    label: string,
    options: readonly { value: string; text: string }[],
    current: string,
    onChange: (value: string) => void,
  ): HTMLLabelElement {
    const select = el("select", { attrs: { id } });
    for (const option of options) {
      const node = el("option", { text: option.text, attrs: { value: option.value } });
      node.selected = option.value === current;
      select.append(node);
    }
    select.addEventListener("change", () => {
      onChange(select.value);
      render();
    });
    return el("label", { className: "field" }, [el("span", { text: label }), select]);
  }

  function mountSetup(): HTMLElement {
    const setup = state.setup;
    const rules = setup.custom;
    const setRule = <K extends keyof CustomRules>(key: K, value: CustomRules[K]): void => {
      state.setup = { ...state.setup, custom: { ...state.setup.custom, [key]: value } };
    };
    const tfLabel = (minutes: number): string =>
      minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`;
    const data = el(
      "section",
      { className: "setup-card", attrs: { "aria-label": t("setup.data") } },
      [
        el("h2", { text: t("setup.data") }),
        el("p", { className: "hint", text: t("setup.dataHint") }),
        selectField(
          "setup-market",
          t("setup.market"),
          SAMPLE_MARKETS.map((market) => ({ value: market, text: market })),
          setup.market,
          (value) => {
            if (isMarketId(value)) {
              state.setup = { ...state.setup, market: value };
            }
          },
        ),
        selectField(
          "setup-tf",
          t("setup.timeframe"),
          SYNTHETIC_TIMEFRAMES_MIN.map((minutes) => ({
            value: String(minutes),
            text: tfLabel(minutes),
          })),
          String(setup.timeframeMin),
          (value) => {
            const minutes = Number(value);
            if (isSyntheticTimeframe(minutes)) {
              state.setup = { ...state.setup, timeframeMin: minutes };
            }
          },
        ),
        numberField(
          "setup-bars",
          t("setup.bars"),
          setup.bars,
          { min: MIN_SYNTHETIC_BARS, max: MAX_SYNTHETIC_BARS, step: 50 },
          (value) => {
            state.setup = { ...state.setup, bars: Math.round(value) };
          },
        ),
        el("div", { className: "seed-row" }, [
          numberField(
            "setup-seed",
            t("setup.seed"),
            setup.seed,
            { min: 0, max: 0xffffffff, step: 1 },
            (value) => {
              state.setup = { ...state.setup, seed: Math.round(value) };
            },
            t("setup.seedHint"),
          ),
          actionButton(t("setup.newSeed"), "ghost", () => {
            state.setup = { ...state.setup, seed: randomSeed() };
            render();
          }),
        ]),
      ],
    );

    const modeOptions = [
      { value: "custom", text: t("setup.rulesCustom") },
      { value: "preset", text: t("setup.rulesPreset") },
      { value: "none", text: t("setup.rulesNone") },
    ];
    const ruleFields: HTMLElement[] = [];
    if (setup.rulesMode === "custom") {
      ruleFields.push(
        numberField(
          "rule-balance",
          t("setup.balance"),
          rules.startingBalanceUsd,
          { min: 100, max: 10_000_000, step: 100 },
          (v) => setRule("startingBalanceUsd", v),
          "USD",
        ),
        numberField(
          "rule-target",
          t("rules.target"),
          rules.profitTargetPct,
          { min: 0.1, max: 100, step: 0.5 },
          (v) => setRule("profitTargetPct", v),
          "%",
        ),
        numberField(
          "rule-maxdd",
          t("setup.maxDd"),
          rules.maxDrawdownPct,
          { min: 0.1, max: 100, step: 0.5 },
          (v) => setRule("maxDrawdownPct", v),
          "%",
        ),
        selectField(
          "rule-ddmode",
          t("setup.ddMode"),
          [
            { value: "trailing", text: t("setup.ddTrailing") },
            { value: "static", text: t("setup.ddStatic") },
          ],
          rules.drawdownMode,
          (value) => setRule("drawdownMode", value === "static" ? "static" : "trailing"),
        ),
        numberField(
          "rule-daily",
          t("setup.daily"),
          rules.dailyLossLimitPct,
          { min: 0, max: 100, step: 0.5 },
          (v) => setRule("dailyLossLimitPct", v),
          t("setup.dailyHint"),
        ),
        numberField(
          "rule-lev",
          t("setup.maxLev"),
          rules.maxLeverage,
          { min: 1, max: TEACHING_MAX_LEVERAGE, step: 1 },
          (v) => setRule("maxLeverage", Math.round(v)),
          "×",
        ),
        numberField(
          "rule-fee",
          t("setup.fee"),
          rules.takerBps,
          { min: 0, max: 100, step: 0.5 },
          (v) => setRule("takerBps", v),
          t("slip.bps"),
        ),
        numberField(
          "rule-swap",
          t("setup.swap"),
          rules.swapDailyRatePct,
          { min: 0, max: 5, step: 0.01 },
          (v) => setRule("swapDailyRatePct", v),
          t("setup.swapHint"),
        ),
      );
    } else if (setup.rulesMode === "preset") {
      const options = state.presets.map((item) => ({ value: item.id, text: item.displayName }));
      if (options.length === 0) {
        ruleFields.push(
          el("p", {
            className: "hint",
            text: state.presetStatus === "error" ? t("preset.error") : t("preset.loading"),
          }),
        );
      } else {
        const chosen = setup.presetId ?? options[0]?.value ?? "";
        ruleFields.push(
          selectField("rule-preset", t("preset.label"), options, chosen, (value) => {
            state.setup = { ...state.setup, presetId: value };
          }),
        );
        const active = state.presets.find((item) => item.id === chosen);
        if (active !== undefined) {
          ruleFields.push(
            el("p", { className: "hint", text: active.disclaimer }),
            el("p", { className: "hint", text: active.note }),
          );
        }
      }
    } else {
      ruleFields.push(el("p", { className: "hint", text: t("rules.none") }));
    }
    const rulesCard = el(
      "section",
      { className: "setup-card", attrs: { "aria-label": t("setup.rules") } },
      [
        el("h2", { text: t("setup.rules") }),
        selectField("setup-rules", t("setup.rulesMode"), modeOptions, setup.rulesMode, (value) => {
          if (value === "none" || value === "custom" || value === "preset") {
            state.setup = {
              ...state.setup,
              rulesMode: value,
              presetId:
                value === "preset"
                  ? (state.setup.presetId ?? state.presets[0]?.id ?? null)
                  : state.setup.presetId,
            };
          }
        }),
        ...ruleFields,
      ],
    );

    const presetBlocked =
      setup.rulesMode === "preset" &&
      state.presets.find((item) => item.id === (setup.presetId ?? state.presets[0]?.id)) ===
        undefined;
    const start = actionButton(t("setup.start"), "submit submit-long setup-start", () => {
      const chosen =
        setup.rulesMode === "preset"
          ? { ...setup, presetId: setup.presetId ?? state.presets[0]?.id ?? null }
          : setup;
      beginSession(chosen);
    });
    if (presetBlocked) {
      start.disabled = true;
    }
    return el("main", { className: "setup" }, [
      el("div", { className: "setup-grid" }, [data, rulesCard]),
      el("p", { className: "hint", text: t("setup.countdownHint") }),
      start,
    ]);
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
        actionButton(
          t("nav.setup"),
          state.screen === "setup" ? "nav-btn is-current" : "nav-btn",
          () => {
            stopPlay();
            stopCountdown();
            state.screen = "setup";
            render();
          },
        ),
        actionButton(
          t("nav.practice"),
          state.screen === "play" ? "nav-btn is-current" : "nav-btn",
          () => {
            if (state.series.length > 0) {
              state.screen = "play";
              render();
            }
          },
        ),
        actionButton(t("nav.review"), "nav-btn", () => {
          if (state.series.length > 0) {
            state.screen = "play";
            state.tab = "review";
            render();
          }
        }),
      ]),
      el("div", { className: "top-actions" }, [lang]),
    ]);
  }

  function mountMarket(frame: Frame, change: number, index: number): HTMLElement {
    const select = el("select", {
      className: "market-select",
      attrs: { "aria-label": t("market.synthetic") },
    });
    for (const market of [state.market]) {
      const option = el("option", { text: market, attrs: { value: market } });
      if (market === state.market) {
        option.selected = true;
      }
      select.append(option);
    }
    // The session's data was generated for one market; change it on the setup screen.
    select.disabled = true;

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

  function kindLabel(kind: MovingAverageKind): string {
    switch (kind) {
      case "sma":
        return t("indicator.sma");
      case "ema":
        return t("indicator.ema");
      default: {
        const unexpected: never = kind;
        return unexpected;
      }
    }
  }

  function movingAveragePoints(
    kind: MovingAverageKind,
    closes: readonly number[],
    period: number,
  ): readonly (number | null)[] {
    switch (kind) {
      case "sma":
        return simpleMovingAverage(closes, period);
      case "ema":
        return exponentialMovingAverage(closes, period);
      default: {
        const unexpected: never = kind;
        return unexpected;
      }
    }
  }

  function mountIndicatorControls(): HTMLElement {
    const row = el("div", {
      className: "indicator-controls",
      attrs: { role: "group", "aria-label": t("indicator.label") },
    });
    for (const instance of state.movingAverages) {
      const label = `${kindLabel(instance.kind)} ${instance.period}`;
      const toggle = el(
        "button",
        {
          className: instance.visible ? "chip indicator-toggle is-on" : "chip indicator-toggle",
          attrs: {
            type: "button",
            "aria-pressed": instance.visible ? "true" : "false",
            title: t("indicator.revealed"),
          },
        },
        [
          el("span", {
            className: `swatch swatch-${instance.stroke}`,
            attrs: { "aria-hidden": "true" },
          }),
          el("span", { text: label }),
        ],
      );
      toggle.addEventListener("click", () => {
        instance.visible = !instance.visible;
        render();
      });
      const period = el("input", {
        className: "indicator-period",
        attrs: {
          id: `indicator-${instance.id}`,
          type: "number",
          min: String(MIN_INDICATOR_PERIOD),
          max: String(MAX_INDICATOR_PERIOD),
          step: "1",
          value: String(instance.period),
          "aria-label": `${kindLabel(instance.kind)} ${t("indicator.period")}`,
          title: t("indicator.revealed"),
        },
      });
      period.addEventListener("change", () => {
        instance.period = clampInt(
          period.valueAsNumber,
          MIN_INDICATOR_PERIOD,
          MAX_INDICATOR_PERIOD,
          instance.period,
        );
        render();
      });
      row.append(el("div", { className: "indicator-instance" }, [toggle, period]));
    }

    const bollinger = el(
      "button",
      {
        className: state.bollingerVisible ? "chip indicator-toggle is-on" : "chip indicator-toggle",
        attrs: {
          type: "button",
          "aria-pressed": state.bollingerVisible ? "true" : "false",
          title: t("indicator.revealed"),
        },
      },
      [
        el("span", {
          className: "swatch swatch-line-strong",
          attrs: { "aria-hidden": "true" },
        }),
        el("span", {
          text: `${t("indicator.bollinger")} ${DEFAULT_BOLLINGER_PERIOD}`,
        }),
      ],
    );
    bollinger.addEventListener("click", () => {
      state.bollingerVisible = !state.bollingerVisible;
      render();
    });
    row.append(bollinger);
    return row;
  }

  function mountChartSection(
    series: readonly Bar[],
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
    if (frame.position?.stopLoss !== null && frame.position?.stopLoss !== undefined) {
      lines.push({ price: frame.position.stopLoss, kind: "sl" });
    }
    if (frame.position?.takeProfit !== null && frame.position?.takeProfit !== undefined) {
      lines.push({ price: frame.position.takeProfit, kind: "tp" });
    }
    const closes = closesThrough(series, state.cursor);
    // Indicators use the full revealed history; only the last window is drawn.
    const from = Math.max(0, closes.length - CHART_WINDOW);
    const revealed = series.slice(from, closes.length);
    const overlays: ChartOverlay[] = [];
    for (const instance of state.movingAverages) {
      if (!instance.visible) {
        continue;
      }
      overlays.push({
        points: movingAveragePoints(instance.kind, closes, instance.period).slice(from),
        stroke: instance.stroke,
      });
    }
    const bands: ChartBand[] = [];
    if (state.bollingerVisible) {
      const band = bollingerBands(
        closes,
        DEFAULT_BOLLINGER_PERIOD,
        DEFAULT_BOLLINGER_DEVIATIONS,
      ).slice(from);
      overlays.push({
        points: band.map((point) => point.mid),
        stroke: "line-strong",
      });
      bands.push({
        upper: band.map((point) => point.upper),
        lower: band.map((point) => point.lower),
      });
    }
    const stage = el("div", { className: "chart-stage" });
    mountChart(stage, {
      candles: revealed,
      lines,
      overlays,
      bands,
      label: `${t("chart.sample")} ${state.cursor + 1}/${series.length}`,
      formatPrice: money,
    });
    const legend = el("ul", { className: "legend" }, [
      el("li", { className: "legend-entry", text: t("legend.entry") }),
      el("li", { className: "legend-liq", text: t("legend.liquidation") }),
      el("li", { className: "legend-prop", text: t("legend.fail") }),
      el("li", { className: "legend-daily", text: t("legend.daily") }),
      el("li", { className: "legend-sl", text: t("legend.sl") }),
      el("li", { className: "legend-tp", text: t("legend.tp") }),
    ]);
    stage.append(legend);
    return el("section", { className: "chart", attrs: { "aria-label": "Chart" } }, [
      el("div", { className: "chart-toolbar" }, [
        el("span", {
          className: "chip is-current",
          text: `${state.market} · ${state.setup.timeframeMin >= 60 ? `${state.setup.timeframeMin / 60}h` : `${state.setup.timeframeMin}m`} · ${t("setup.seed")} ${state.setup.seed}`,
        }),
        el("span", {
          className: "toolbar-note",
          text: `${t("replay.bar")} ${state.cursor + 1}/${series.length} · ${t("teaching.mark")}`,
        }),
      ]),
      mountIndicatorControls(),
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
    const levCap = active?.maxLeverage ?? TEACHING_MAX_LEVERAGE;
    const priceInput = (id: string, label: string, value: string, set: (v: string) => void) => {
      const input = el("input", {
        className: "mono",
        attrs: {
          id,
          type: "text",
          inputmode: "decimal",
          autocomplete: "off",
          placeholder: t("bracket.off"),
          value,
          "aria-label": label,
        },
      });
      input.addEventListener("change", () => {
        set(input.value);
        render();
      });
      return el("label", { className: "field" }, [el("span", { text: label }), input]);
    };
    const slField = priceInput("stop-loss", t("bracket.sl"), state.stopLossText, (v) => {
      state.stopLossText = v;
    });
    const tpField = priceInput("take-profit", t("bracket.tp"), state.takeProfitText, (v) => {
      state.takeProfitText = v;
    });
    const bracketRow = el("div", { className: "bracket-row" }, [slField, tpField]);
    const updateBracket =
      view.frame.position === null
        ? null
        : actionButton(t("bracket.update"), "ghost bracket-update", () => {
            commit({
              kind: "bracket",
              barIndex: state.cursor,
              stopLoss: parsePrice(state.stopLossText),
              takeProfit: parsePrice(state.takeProfitText),
            });
          });

    const leverage = el("input", {
      attrs: {
        id: "leverage",
        type: "number",
        min: String(TEACHING_MIN_LEVERAGE),
        max: String(levCap),
        step: "1",
        value: String(state.leverage),
        "aria-label": t("field.leverage"),
      },
    });
    leverage.addEventListener("change", () => {
      state.leverage = clampInt(
        leverage.valueAsNumber,
        TEACHING_MIN_LEVERAGE,
        levCap,
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

    const ended = state.endedAt !== null || state.countdown !== null;
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
            stopLoss: parsePrice(state.stopLossText),
            takeProfit: parsePrice(state.takeProfitText),
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
    const submitButton = submit.querySelector("button");
    if (ended && submitButton !== null) {
      submitButton.disabled = true;
    }

    return el("aside", { className: "ticket", attrs: { "aria-label": "Order ticket" } }, [
      el("div", { className: "ticket-scroll" }, [
        el("p", { className: "ticket-note", text: t("ticket.note") }),
        el("div", { className: "side-row" }, [pressSide("long"), pressSide("short")]),
        el("div", { className: "type-row" }, [
          el("span", { className: "chip is-current", text: t("type.market") }),
          disabledButton(t("type.limit"), "chip"),
        ]),
        el("label", { className: "field" }, [el("span", { text: t("field.leverage") }), leverage]),
        el("p", {
          className: "hint",
          text: active?.maxLeverage
            ? `${t("setup.maxLev")}: ${active.maxLeverage}×`
            : t("field.leverageHint"),
        }),
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
        bracketRow,
        ...(updateBracket === null ? [] : [updateBracket]),
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
      { id: "review", key: "blotter.review" },
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
      case "review":
        return reviewPanel(frame, money, dash);
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
            el("td", {
              className: "mono",
              text: `${position.takeProfit === null ? dash : money(position.takeProfit)} / ${position.stopLoss === null ? dash : money(position.stopLoss)}`,
            }),
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
    if (active.id === "custom") {
      return el("div", { className: "rules" }, [
        el("h2", { text: t("setup.rulesCustom") }),
        quoteRow(t("setup.balance"), money(active.startingBalanceUsd ?? 0)),
        quoteRow(t("rules.target"), money(frame.profitTarget ?? 0)),
        quoteRow(
          `${t("rules.maxDd")} (${active.drawdownMode === "trailing" ? t("setup.ddTrailing") : t("setup.ddStatic")})`,
          frame.maxDrawdownFloor === null ? dash : money(frame.maxDrawdownFloor),
        ),
        quoteRow(
          t("rules.daily"),
          frame.dailyLossFloor === null ? dash : money(frame.dailyLossFloor),
        ),
        quoteRow(t("setup.maxLev"), `${active.maxLeverage ?? TEACHING_MAX_LEVERAGE}×`),
        quoteRow(t("setup.fee"), `${active.takerBps ?? 0} ${t("slip.bps")}`),
        quoteRow(t("rules.carry"), money(frame.carryPaid)),
        quoteRow(t("phase.practice"), t(phaseKey(frame.phase))),
      ]);
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

  function reviewPanel(frame: Frame, money: (value: number) => string, dash: string): HTMLElement {
    const stats = sessionStats({
      fills: frame.fills,
      equityCurve: frame.equityCurve,
      startingBalance: startingBalance(),
    });
    const pct = (value: number | null): string =>
      value === null ? dash : formatPct(value, locale());
    const amount = (value: number | null): string =>
      value === null ? dash : signedNumber(value, locale());
    const verdict =
      state.endedAt === null
        ? t("review.running")
        : frame.phase === "target"
          ? t("review.passed")
          : frame.phase === "practice"
            ? t("review.dataEnd")
            : `${t("review.failed")} · ${t(phaseKey(frame.phase))}`;
    const curve = frame.equityCurve;
    const lo = Math.min(...curve, startingBalance());
    const hi = Math.max(...curve, startingBalance());
    const span = hi - lo || 1;
    const points = curve
      .map(
        (value, index) =>
          `${((index / Math.max(1, curve.length - 1)) * 300).toFixed(1)},${(58 - ((value - lo) / span) * 56).toFixed(1)}`,
      )
      .join(" ");
    const spark = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    spark.setAttribute("viewBox", "0 0 300 60");
    spark.setAttribute("class", "equity-spark");
    spark.setAttribute("role", "img");
    spark.setAttribute("aria-label", t("review.curve"));
    const base = document.createElementNS("http://www.w3.org/2000/svg", "line");
    const baseY = (58 - ((startingBalance() - lo) / span) * 56).toFixed(1);
    for (const [key, value] of Object.entries({
      x1: "0",
      x2: "300",
      y1: baseY,
      y2: baseY,
      class: "spark-base",
    })) {
      base.setAttribute(key, value);
    }
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("points", points);
    line.setAttribute("class", "spark-line");
    spark.append(base, line);
    const trades = pairTrades(frame.fills);
    const tradeRows = trades.map((trade, index) =>
      el("tr", {}, [
        el("td", { className: "mono", text: String(index + 1) }),
        el("td", { text: t(trade.side === "long" ? "side.long" : "side.short") }),
        el("td", { className: "mono", text: `${trade.openBar + 1}→${trade.closeBar + 1}` }),
        el("td", { className: "mono", text: money(trade.entry) }),
        el("td", { className: "mono", text: money(trade.exit) }),
        el("td", { text: t(fillKey(trade.exitKind)) }),
        el("td", {
          className: trade.netPnl < 0 ? "mono pnl-down" : "mono pnl-up",
          text: signedNumber(trade.netPnl, locale()),
        }),
      ]),
    );
    const tradeHeaders = [
      "#",
      t("col.side"),
      t("replay.bar"),
      t("col.entry"),
      t("col.exit"),
      t("col.kind"),
      t("col.pnl"),
    ];
    return el("div", { className: "review" }, [
      el("h2", { className: `verdict verdict-${frame.phase}`, text: verdict }),
      el("div", { className: "review-grid" }, [
        stat(t("review.return"), pct(stats.returnPct)),
        stat(t("review.net"), amount(stats.netPnl)),
        stat(t("review.trades"), String(stats.trades)),
        stat(t("review.winRate"), pct(stats.winRate)),
        stat(
          t("review.pf"),
          stats.profitFactor === null ? dash : formatNumber(stats.profitFactor, locale()),
        ),
        stat(t("review.expectancy"), amount(stats.expectancy)),
        stat(t("review.avgWin"), amount(stats.avgWin)),
        stat(t("review.avgLoss"), amount(stats.avgLoss)),
        stat(t("review.best"), amount(stats.bestTrade)),
        stat(t("review.worst"), amount(stats.worstTrade)),
        stat(t("review.maxDd"), pct(stats.maxDrawdownPct)),
        stat(t("review.fees"), money(frame.feesPaid + frame.carryPaid)),
      ]),
      spark,
      el("table", {}, [
        el("thead", {}, [
          el(
            "tr",
            {},
            tradeHeaders.map((h) => el("th", { attrs: { scope: "col" }, text: h })),
          ),
        ]),
        el(
          "tbody",
          {},
          tradeRows.length > 0
            ? tradeRows
            : [
                el("tr", {}, [
                  el("td", {
                    className: "empty",
                    attrs: { colspan: String(tradeHeaders.length) },
                    text: t("empty.history"),
                  }),
                ]),
              ],
        ),
      ]),
      el("div", { className: "review-actions" }, [
        actionButton(t("review.replaySame"), "ghost", () => {
          beginSession(state.setup);
        }),
        actionButton(t("review.newData"), "submit submit-long", () => {
          beginSession({ ...state.setup, seed: randomSeed() });
        }),
        actionButton(t("nav.setup"), "ghost", () => {
          stopPlay();
          state.screen = "setup";
          render();
        }),
      ]),
    ]);
  }

  function mountReplay(
    frame: Frame,
    last: number,
    drawdown: number,
    money: (value: number) => string,
  ): HTMLElement {
    const ended = state.endedAt !== null;
    // No rewind button: a blind backtest only moves forward, like the live market.
    const play = actionButton(state.playing ? t("replay.pause") : t("replay.play"), "ghost", () => {
      if (state.playing) {
        stopPlay();
      } else {
        startPlay();
      }
      render();
    });
    const step = actionButton(t("replay.forward"), "ghost", () => {
      stopPlay();
      state.cursor = Math.min(last, state.cursor + 1);
      settleEnd();
      render();
    });
    const finish = actionButton(t("replay.finish"), "ghost", () => {
      stopPlay();
      state.endedAt = state.cursor;
      state.tab = "review";
      render();
    });
    for (const node of [play, step, finish]) {
      node.disabled = ended || state.countdown !== null;
    }
    const speeds = el(
      "div",
      { className: "speed-row", attrs: { role: "group", "aria-label": t("replay.speed") } },
      SPEEDS.map((speed) => {
        const node = actionButton(
          speed.label,
          speed.ms === state.speedMs ? "chip is-current" : "chip",
          () => {
            state.speedMs = speed.ms;
            if (state.playing) {
              startPlay();
            }
            render();
          },
        );
        node.setAttribute("aria-pressed", speed.ms === state.speedMs ? "true" : "false");
        return node;
      }),
    );
    return el("footer", { className: "replay", attrs: { "aria-label": "Replay" } }, [
      el("div", { className: "replay-controls" }, [
        play,
        step,
        speeds,
        finish,
        actionButton(t("replay.reset"), "ghost", () => {
          beginSession(state.setup);
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

  document.addEventListener("keydown", (event) => {
    if (state.screen !== "play" || state.countdown !== null || state.endedAt !== null) {
      return;
    }
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) {
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      if (state.playing) {
        stopPlay();
      } else {
        startPlay();
      }
      render();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      stopPlay();
      state.cursor = Math.min(lastIndex(), state.cursor + 1);
      settleEnd();
      render();
    }
  });

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
