import {
  BUYING_POWER_PCTS,
  DEFAULT_BOLLINGER_DEVIATIONS,
  DEFAULT_BOLLINGER_PERIOD,
  DEFAULT_CHANNEL_PERIOD,
  DEFAULT_KELTNER_MULTIPLIER,
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
  anchoredVwap,
  bollingerBands,
  donchianChannels,
  exponentialMovingAverage,
  keltnerChannels,
  isBuyingPowerPct,
  isMarketId,
  leverageCap,
  coarserTimeframe,
  parseOhlcCsv,
  monteCarlo,
  pairTrades,
  quoteClose,
  quoteOpen,
  replaySession,
  randomSeed,
  resampleBars,
  reviewMetrics,
  resolvedMaxDrawdownUsd,
  resolvedTakerBps,
  seriesTimeframeMin,
  simpleMovingAverage,
  syntheticFunding,
  syntheticMarks,
  syntheticSeries,
  timeframeSupported,
  type CsvImportError,
  type Bar,
  type BuyingPowerPct,
  type ChannelPoint,
  type FillKind,
  type Frame,
  type MarketId,
  type Phase,
  type PracticePreset,
  type RejectReason,
  type SessionAction,
  type Side,
  type SyntheticTimeframe,
} from "@perpdrill/core";
import {
  connectedChartHost,
  mountChart,
  releaseDetachedCharts,
  type ChartBand,
  type ChartLine,
  type ChartOverlay,
  type IndicatorStroke,
} from "./chart.ts";
import {
  PRACTICE_INTRO_MS,
  cancelPracticeIntro,
  idlePracticeIntro,
  skipPracticeIntro,
  startPracticeIntro,
  stepPracticeIntro,
  type PracticeIntro,
} from "./countdown-run.ts";
import {
  FORMING_PARTS,
  formingBudgetMs,
  formingCancel,
  formingGapMs,
  formingRequestStep,
  formingSnapshot,
  formingStart,
  formingStep,
  type FormingState,
} from "./forming.ts";
import {
  formatBarTime,
  formatNumber,
  formatPct,
  formatQty,
  formatTimeframe,
  signedNumber,
} from "./format.ts";
import {
  LANG_CHOICES,
  THEMES,
  applyDocumentTheme,
  numberLocale,
  readStoredLang,
  readStoredTheme,
  sampleMarketLabel,
  translate,
  writeStoredLang,
  writeStoredTheme,
  type Lang,
  type MessageKey,
  type Theme,
} from "./i18n.ts";
import { LIVE_PAIRS, fetchLiveKlines, isLivePair, type LivePair } from "./live-data.ts";
import {
  challengeFor,
  challengeFromSearch,
  challengeHref,
  challengeSetup,
  dailyStreak,
  matchesChallenge,
  readDailyResults,
  writeDailyResult,
  type Challenge,
  type ChallengeOutcome,
  type ChallengeResult,
  type DailyResults,
} from "./challenge.ts";
import { loadCommunityPresets } from "./preset-loader.ts";
import { showExamCard } from "./exam-card.ts";
import {
  examOpen,
  examPreset,
  examResult,
  markSubmitted,
  maxLeverage,
  rewardRisk,
  readBest,
  readSubmitted,
  recordBest,
} from "./exam.ts";
import {
  MAX_RULE_DRAWDOWN_PCT,
  applyPresetChoices,
  customPreset,
  countdownPending,
  dataKey,
  markCountdownPlayed,
  readStoredSetup,
  setupMarkets,
  setupStartingBalance,
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
  { label: "0.5×", ms: 1600 },
  { label: "1×", ms: 800 },
  { label: "2×", ms: 400 },
  { label: "4×", ms: 200 },
  { label: "8×", ms: 100 },
] as const;

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
  theme: Theme;
  screen: "setup" | "play";
  setup: SessionSetup;
  /** Frozen daily round this run belongs to, or null for free practice. */
  challenge: Challenge | null;
  dailyResults: DailyResults;
  series: readonly Bar[];
  importedBars: readonly Bar[];
  /** Shown in the market bar instead of the sample name when imported. */
  dataLabel: string | null;
  funding: readonly (number | null)[];
  marks: readonly number[];
  indexSeries: readonly number[];
  countdown: number | null;
  speedMs: number;
  stopLossText: string;
  takeProfitText: string;
  endedAt: number | null;
  /** True when the player ended the run themselves, so it is practice, not a result. */
  endedByUser: boolean;
  market: MarketId;
  side: Side;
  leverage: number;
  powerPct: BuyingPowerPct;
  orderType: "market" | "limit" | "stop";
  orderPriceText: string;
  /** Fraction of the position the ticket close control closes. */
  closePct: BuyingPowerPct;
  /** Teaching margin mode; cross counts free cash toward the liq cushion. */
  marginMode: "isolated" | "cross";
  slipToleranceBps: number;
  realizedImpactBps: number;
  cursor: number;
  actions: SessionAction[];
  presets: readonly PracticePreset[];
  presetStatus: "loading" | "ready" | "error";
  tab: Tab;
  playing: boolean;
  /** Paints shown for the unclosed bar after `cursor`. `null` keeps that bar off the engine. */
  formingPart: number | null;
  movingAverages: MovingAverageInstance[];
  bollingerVisible: boolean;
  vwapVisible: boolean;
  keltnerVisible: boolean;
  donchianVisible: boolean;
  /** Second price pane. Each pane resamples the session bars; it does not invent a finer series. */
  splitChart: boolean;
  /** Phone drawer (order ticket + blotter) is open. */
  drawerOpen: boolean;
  primaryTf: SyntheticTimeframe;
  secondaryTf: SyntheticTimeframe;
};

/** Spacing the generator actually wrote, or null when the series is not that timeframe. */
function practiceSourceMin(
  series: readonly Bar[],
  setupMin: SyntheticTimeframe,
): SyntheticTimeframe | null {
  if (series.length < 2) {
    return setupMin;
  }
  return seriesTimeframeMin(series) === setupMin ? setupMin : null;
}

type Attrs = Record<string, string>;

type ChartPlacement = {
  slot: HTMLElement;
  stage: HTMLElement;
  mount: () => void;
};

function stripChartChrome(stage: HTMLElement): void {
  for (const child of [...stage.children]) {
    const keep = child instanceof SVGSVGElement && child.classList.contains("chart-svg");
    if (!keep) {
      child.remove();
    }
  }
}

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

function csvErrorKey(error: CsvImportError): MessageKey {
  switch (error) {
    case "empty":
      return "csv.empty";
    case "columns":
      return "csv.columns";
    case "times":
      return "csv.times";
    case "prices":
      return "csv.prices";
    case "count":
      return "csv.count";
    default: {
      const unexpected: never = error;
      throw new Error(`unexpected csv error ${String(unexpected)}`);
    }
  }
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
    case "invalid-price":
      return "reject.price";
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
    case "limit":
      return "history.limit";
    case "stop-entry":
      return "history.stopEntry";
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
  // A shared challenge link lands on that frozen round, not on the stored setup.
  const linked = challengeFromSearch(window.location.search);
  const opening = linked === null ? stored : challengeSetup(linked, stored);
  const state: DeskState = {
    lang: readStoredLang(),
    theme: readStoredTheme(),
    screen: "setup",
    setup: opening,
    challenge: linked,
    dailyResults: readDailyResults(window.localStorage),
    series: [],
    importedBars: [],
    dataLabel: null,
    funding: [],
    marks: [],
    indexSeries: [],
    countdown: null,
    speedMs: SPEEDS[0].ms,
    stopLossText: "",
    takeProfitText: "",
    endedAt: null,
    endedByUser: false,
    market: opening.market,
    side: "long",
    leverage: 10,
    powerPct: 25,
    orderType: "market",
    orderPriceText: "",
    closePct: 100,
    marginMode: "isolated",
    slipToleranceBps: DEFAULT_SLIP_TOLERANCE_BPS,
    realizedImpactBps: DEFAULT_REALIZED_IMPACT_BPS,
    cursor: 0,
    actions: [],
    presets: [],
    presetStatus: "loading",
    tab: "positions",
    playing: false,
    formingPart: null,
    movingAverages: defaultMovingAverages(),
    bollingerVisible: false,
    vwapVisible: true,
    keltnerVisible: false,
    donchianVisible: false,
    splitChart: false,
    drawerOpen: false,
    primaryTf: opening.timeframeMin,
    secondaryTf: opening.timeframeMin,
  };
  let indicatorsOpen = false;
  let noticesOpen = false;
  let introTimer = 0;
  let intro: PracticeIntro = idlePracticeIntro();
  let introKey: string | null = null;
  let formingTimer = 0;
  let formingToken = 0;
  let formingBudget = 0;
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
  // Clipboard needs a secure context; a blocked copy still shows the text to select.
  const copyText = (text: string): void => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        toast(t("challenge.copied"), "info");
      })
      .catch(() => {
        toast(text, "info");
      });
  };
  const outcomeLabel = (outcome: ChallengeOutcome): string =>
    outcome === "pass"
      ? t("review.passed")
      : outcome === "fail"
        ? t("review.failed")
        : t("challenge.unfinished");
  /** One line a player can paste into a chat, plus the link that rebuilds the round. */
  const challengeLine = (challenge: Challenge, result: ChallengeResult): string =>
    [
      `${t("challenge.title")} ${challenge.day}`,
      `${challenge.market} ${formatTimeframe(challenge.timeframeMin)}`,
      `${outcomeLabel(result.outcome)} · ${t("review.maxDd")} ${formatPct(result.maxDrawdownPct, locale())} · ${result.bars} ${t("setup.bars")}`,
      challengeHref(challenge, window.location.href),
    ].join("\n");

  const presetFor = (setup: SessionSetup): PracticePreset | null => {
    switch (setup.rulesMode) {
      case "none":
        return null;
      case "custom":
        return customPreset(setup.custom);
      case "preset": {
        if (setup.presetId === examPreset().id) {
          return examPreset();
        }
        const found = state.presets.find((item) => item.id === setup.presetId);
        return found === undefined ? null : applyPresetChoices(found, setup);
      }
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

  const clearFormingTimer = (): void => {
    if (formingTimer !== 0) {
      window.clearTimeout(formingTimer);
      formingTimer = 0;
    }
  };

  const formingView = (): FormingState => ({
    cursor: state.cursor,
    part: state.formingPart,
    playing: state.playing,
  });

  const assignForming = (next: FormingState): void => {
    state.cursor = next.cursor;
    state.formingPart = next.part;
    state.playing = next.playing;
  };

  /** Stop autoplay and drop a preview the engine has not closed. */
  const pausePlayback = (): void => {
    formingToken += 1;
    clearFormingTimer();
    assignForming(formingCancel(formingView()));
  };

  const lastIndex = (): number => state.series.length - 1;
  const firstCursor = (): number => warmupBars(state.series.length);

  const armFormingTimer = (): void => {
    clearFormingTimer();
    if (state.formingPart === null) {
      return;
    }
    const token = formingToken;
    const gap = formingGapMs(formingBudget, FORMING_PARTS);
    formingTimer = window.setTimeout(() => {
      formingTimer = 0;
      if (token !== formingToken) {
        return;
      }
      applyFormingStep();
    }, gap);
  };

  const applyFormingStep = (): void => {
    const beforeCursor = state.cursor;
    assignForming(formingStep(formingView(), lastIndex()));
    const committed = state.cursor !== beforeCursor;
    if (committed) {
      settleEnd();
    }
    if (state.endedAt !== null) {
      clearFormingTimer();
      render();
      return;
    }
    render();
    if (state.formingPart === null) {
      return;
    }
    if (committed) {
      formingBudget = formingBudgetMs(state.playing, state.speedMs);
    }
    armFormingTimer();
  };

  const beginForming = (playing: boolean): void => {
    if (state.endedAt !== null || state.countdown !== null) {
      return;
    }
    const before = state.formingPart;
    const next = formingStart(formingView(), lastIndex(), playing);
    assignForming(next);
    if (before === null && next.part !== null) {
      formingBudget = formingBudgetMs(playing, state.speedMs);
      armFormingTimer();
    }
  };

  /**
   * Preview the next bar across the speed interval. The cursor moves on the last
   * paint, which is the same beat the play clock used to step on.
   */
  const startPlay = (): void => {
    beginForming(true);
  };

  /** One bar across the step beat. A preview already running does not start another. */
  const requestStep = (): void => {
    if (state.endedAt !== null || state.countdown !== null) {
      return;
    }
    const before = state.formingPart;
    const next = formingRequestStep(formingView(), lastIndex());
    assignForming(next);
    if (before === null && next.part !== null) {
      formingBudget = formingBudgetMs(false, state.speedMs);
      armFormingTimer();
    }
  };

  const clearIntroTimer = (): void => {
    if (introTimer !== 0) {
      window.clearInterval(introTimer);
      introTimer = 0;
    }
  };

  /** Hide the 3-2-1 overlay. Bars stay put, and this data set can count down again. */
  const cancelIntro = (): void => {
    clearIntroTimer();
    intro = cancelPracticeIntro(intro);
    introKey = null;
    state.countdown = null;
  };

  /** Apply one intro step. `play` records the data set and starts the bars. */
  const publishIntro = (next: PracticeIntro, play: boolean): void => {
    intro = next;
    state.countdown = next.number;
    if (next.number === null) {
      clearIntroTimer();
    }
    if (play) {
      const key = introKey;
      introKey = null;
      if (key !== null) {
        markCountdownPlayed(key);
      }
      startPlay();
    }
    render();
  };

  const armIntro = (key: string): void => {
    cancelIntro();
    introKey = key;
    intro = startPracticeIntro();
    state.countdown = intro.number;
    introTimer = window.setInterval(() => {
      const stepped = stepPracticeIntro(intro);
      publishIntro(stepped.intro, stepped.play);
    }, PRACTICE_INTRO_MS);
    render();
  };

  /** Leave the practice screen. An in-progress intro is dropped and does not start playback. */
  const leavePractice = (): void => {
    pausePlayback();
    cancelIntro();
    state.screen = "setup";
    state.drawerOpen = false;
    render();
  };

  /** Keep the first settled attempt of the day; later replays stay practice. */
  const recordChallenge = (frame: Frame): void => {
    const challenge = state.challenge;
    if (challenge === null || !matchesChallenge(state.setup, challenge)) {
      return;
    }
    if (state.dailyResults[challenge.day] !== undefined) {
      return;
    }
    const outcome: ChallengeOutcome =
      frame.phase === "target" ? "pass" : frame.phase === "practice" ? "unfinished" : "fail";
    const metrics = reviewMetrics({
      fills: frame.fills,
      equityCurve: frame.equityCurve,
      startingBalance: startingBalance(),
    });
    state.dailyResults = writeDailyResult(window.localStorage, challenge.day, {
      outcome,
      maxDrawdownPct: metrics.maxDrawdownPct,
      bars: Math.max(0, state.cursor - firstCursor()),
    });
  };

  /** Freeze the session when the account fails, passes or the data runs out. */
  const settleEnd = (): void => {
    if (state.endedAt !== null) {
      return;
    }
    const frame = currentFrame();
    if (frame.phase !== "practice" || state.cursor >= lastIndex()) {
      state.endedAt = state.cursor;
      pausePlayback();
      state.tab = "review";
      state.drawerOpen = true;
      recordChallenge(frame);
      const challenge = state.challenge;
      if (
        frame.phase === "target" &&
        challenge !== null &&
        matchesChallenge(state.setup, challenge)
      ) {
        // Score a finished run: close whatever is still open at the mark.
        if (frame.position !== null) {
          state.actions = [
            ...state.actions,
            {
              kind: "close",
              barIndex: state.cursor,
              powerPct: 100,
              slipToleranceBps: state.slipToleranceBps,
              realizedImpactBps: state.realizedImpactBps,
            },
          ];
        }
        const settled = currentFrame();
        const metrics = reviewMetrics({
          fills: settled.fills,
          equityCurve: settled.equityCurve,
          startingBalance: startingBalance(),
        });
        const leverage = maxLeverage(settled.fills, startingBalance());
        const result = examResult({
          net: metrics.netPnl,
          maxDrawdownUsd: (metrics.maxDrawdownPct / 100) * startingBalance(),
          trades: metrics.trades,
          winRatePct: metrics.winRate === null ? null : Math.round(metrics.winRate * 10) / 10,
          rrr: rewardRisk(metrics.avgWin, metrics.avgLoss),
          lots: leverage === null ? "—" : `${leverage}×`,
        });
        // A certificate needs the target, not just the engine's phase.
        if (result.tier !== null) {
          recordBest(result);
          showExamCard({
            result,
            best: readBest(),
            submitted: readSubmitted(),
            open: examOpen(),
            lang: state.lang,
            t,
            onSubmit: () => {
              markSubmitted(result);
            },
            onClose: () => {
              render();
            },
          });
        }
      }
    }
  };

  const resetSession = (): void => {
    pausePlayback();
    cancelIntro();
    state.cursor = firstCursor();
    state.actions = [];
    state.endedAt = null;
    state.endedByUser = false;
    state.stopLossText = "";
    state.takeProfitText = "";
    state.tab = "positions";
    seenFills = 0;
    seenRejects = 0;
    seenEnd = null;
  };

  /** Generate the data. The first playback of that set counts 3-2-1, then the bars advance. */
  const beginSession = (setup: SessionSetup): void => {
    writeStoredSetup(setup);
    state.setup = setup;
    sessionPreset = presetFor(setup);
    const allowed = setupMarkets(sessionPreset);
    state.market = allowed.includes(setup.market)
      ? setup.market
      : (allowed[0] ?? SAMPLE_MARKETS[0]);
    {
      state.leverage = Math.min(state.leverage, leverageCap(sessionPreset, state.market));
    }
    state.series =
      setup.dataSource === "imported" && state.importedBars.length > 0
        ? state.importedBars
        : syntheticSeries({
            market: state.market,
            seed: setup.seed,
            bars: setup.bars,
            timeframeMin: setup.timeframeMin,
            stress: setup.stress,
          });
    if (setup.dataSource !== "imported") {
      state.dataLabel = null;
    }
    state.funding =
      sessionPreset?.costModel === "funding" && sessionPreset.fundingRatePerHour !== null
        ? syntheticFunding({
            seed: setup.seed,
            bars: state.series.length,
            timeframeMin: setup.timeframeMin,
            meanPerHour: sessionPreset.fundingRatePerHour,
            intervalHours: sessionPreset.fundingIntervalHours ?? 8,
          })
        : [];
    {
      const { index } = syntheticMarks({
        seed: setup.seed,
        closes: state.series.map((bar) => bar.close),
      });
      // The account, the fills and the chart must read the same price. A smoothed
      // index used as the mark drifted 1,600+ points from the candles a player sees.
      state.marks = state.series.map((bar) => bar.close);
      state.indexSeries = index;
    }
    const sourceMin = setup.timeframeMin;
    state.primaryTf = timeframeSupported(sourceMin, state.primaryTf) ? state.primaryTf : sourceMin;
    state.secondaryTf = timeframeSupported(sourceMin, state.secondaryTf)
      ? state.secondaryTf
      : sourceMin;
    state.screen = "play";
    // A scored round pays taker fees, not a 25 bp impact on every fill: twenty
    // round trips would cost more than the whole drawdown allowance.
    state.realizedImpactBps = setup.presetId === examPreset().id ? 0 : state.realizedImpactBps;
    resetSession();
    const key = dataKey({ ...setup, market: state.market });
    if (countdownPending(key)) {
      armIntro(key);
    } else {
      startPlay();
      render();
    }
  };

  const currentFrame = (): Frame =>
    replaySession({
      market: state.market,
      series: state.series,
      preset: preset(),
      actions: state.actions,
      cursor: state.cursor,
      funding: state.funding,
      marks: state.marks,
      index: state.indexSeries,
      marginMode: state.marginMode,
    });

  let chartPlacements: ChartPlacement[] = [];

  const render = (): void => {
    const active = document.activeElement;
    const restore = active instanceof HTMLInputElement && root.contains(active) ? active.id : "";
    document.documentElement.lang = state.lang;
    applyDocumentTheme(state.theme);
    // Keep the live stage in the document so a press-drag or pinch survives this paint.
    const holder = document.createElement("div");
    holder.setAttribute("data-chart-park", "");
    holder.style.position = "fixed";
    holder.style.width = "0";
    holder.style.height = "0";
    holder.style.overflow = "hidden";
    document.body.append(holder);
    try {
      for (const stage of [...root.querySelectorAll<HTMLElement>(".chart-stage")]) {
        holder.append(stage);
      }
      chartPlacements = [];
      const shell = build();
      root.replaceChildren(shell);
      for (const placement of chartPlacements) {
        placement.slot.replaceWith(placement.stage);
        placement.mount();
      }
    } finally {
      holder.remove();
    }
    releaseDetachedCharts();
    if (restore.length > 0) {
      const next = root.querySelector(`#${CSS.escape(restore)}`);
      if (next instanceof HTMLInputElement) {
        next.focus();
      }
    }
  };

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.drawerOpen) {
      state.drawerOpen = false;
      render();
    }
  });

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

    const drawerOverlay = el("div", {
      className: "drawer-overlay",
      attrs: { "aria-hidden": "true" },
    });
    drawerOverlay.addEventListener("click", () => {
      state.drawerOpen = false;
      render();
    });
    const notices = el("details", { className: "desk-notices" }, [
      el("summary", { text: `${ENGINE_STATUS} · ${t("nav.rules")}` }),
      el("div", { className: "notice-content" }, [
        el("p", { className: "banner", attrs: { role: "status" }, text: t("banner") }),
        mountDisclaimer(),
      ]),
    ]);
    notices.open = noticesOpen;
    notices.addEventListener("toggle", () => {
      if (notices.isConnected) noticesOpen = notices.open;
    });
    const colophon = mountColophon();
    colophon.append(notices);
    const shell = el(
      "div",
      {
        className: `shell shell-desk${state.drawerOpen ? " drawer-open" : ""}${state.tab === "review" ? " shell-review" : ""}`,
      },
      [
        mountNav(),
        mountMarket(frame, change, currentBar?.close ?? frame.mark),
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
          el("div", { className: "desk-bottom" }, [mountBlotter(frame, money, dash)]),
          drawerOverlay,
        ]),
        colophon,
        mountReplay(frame, last, drawdown, money),
      ],
    );
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
      const nav = shell.querySelector(".topnav");
      if (nav instanceof HTMLElement) {
        nav.classList.add("topnav-live");
        nav.removeAttribute("inert");
        for (const control of nav.querySelectorAll<HTMLElement>("button, select")) {
          if (control.dataset.action !== "leave-practice") {
            control.setAttribute("inert", "");
          }
        }
      }
      shell.append(mountCountdown(state.countdown));
    }
    return shell;
  }

  function mountCountdown(value: number): HTMLElement {
    const skip = actionButton(t("countdown.skip"), "countdown-skip", () => {
      const stepped = skipPracticeIntro(intro);
      publishIntro(stepped.intro, stepped.play);
    });
    skip.dataset.testid = "countdown-skip";
    const cancel = actionButton(t("countdown.cancel"), "countdown-cancel", () => {
      leavePractice();
    });
    cancel.dataset.testid = "countdown-cancel";
    return el(
      "div",
      {
        className: "countdown-overlay",
        attrs: {
          role: "dialog",
          "aria-modal": "true",
          "aria-label": t("countdown.label"),
          "data-testid": "countdown",
        },
      },
      [
        el("p", { className: "countdown-label", text: t("countdown.label") }),
        el("div", {
          className: "countdown-num countdown-pop",
          text: String(value),
          attrs: { "aria-live": "assertive", "data-testid": "countdown-num" },
        }),
        el("div", { className: "countdown-actions" }, [skip, cancel]),
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
    const allowedMarkets = setupMarkets(presetFor(state.setup));
    if (!allowedMarkets.includes(state.setup.market)) {
      const fallback = allowedMarkets[0] ?? SAMPLE_MARKETS[0];
      state.setup = { ...state.setup, market: fallback };
    }
    const setup = state.setup;
    const rules = setup.custom;
    const loadLive = async (pair: LivePair): Promise<void> => {
      try {
        const bars = await fetchLiveKlines(pair, setup.timeframeMin, 500);
        if (bars.length === 0) {
          toast(t("live.error"), "warn");
          return;
        }
        state.importedBars = bars;
        state.dataLabel = `${pair}·live`;
        state.setup = { ...state.setup, dataSource: "imported", bars: bars.length };
        render();
      } catch {
        toast(t("live.error"), "warn");
      }
    };
    const setRule = <K extends keyof CustomRules>(key: K, value: CustomRules[K]): void => {
      state.setup = { ...state.setup, custom: { ...state.setup.custom, [key]: value } };
    };
    const tfRow = el("div", {
      className: "tf-chips",
      attrs: { role: "group", "aria-label": t("setup.timeframe") },
    });
    for (const minutes of SYNTHETIC_TIMEFRAMES_MIN) {
      const button = el("button", {
        className: minutes === setup.timeframeMin ? "chip is-current" : "chip",
        text: formatTimeframe(minutes),
        attrs: {
          type: "button",
          "aria-pressed": minutes === setup.timeframeMin ? "true" : "false",
        },
      });
      button.addEventListener("click", () => {
        state.setup = { ...state.setup, timeframeMin: minutes };
        render();
      });
      tfRow.append(button);
    }
    const data = el(
      "section",
      { className: "setup-card", attrs: { "aria-label": t("setup.data") } },
      [
        el("h2", { text: t("setup.data") }),
        el("p", { className: "hint", text: t("setup.dataHint") }),
        selectField(
          "setup-market",
          t("setup.market"),
          allowedMarkets.map((market) => ({
            value: market,
            text: sampleMarketLabel(state.lang, market),
          })),
          setup.market,
          (value) => {
            if (isMarketId(value)) {
              state.setup = { ...state.setup, market: value };
            }
          },
        ),
        el("div", { className: "field" }, [
          el("span", { text: t("setup.timeframe") }),
          tfRow,
          el("span", { className: "hint", text: t("setup.timeframeHint") }),
        ]),
        numberField(
          "setup-bars",
          t("setup.bars"),
          setup.bars,
          { min: MIN_SYNTHETIC_BARS, max: MAX_SYNTHETIC_BARS, step: 50 },
          (value) => {
            state.setup = { ...state.setup, bars: Math.round(value) };
          },
        ),
        el("label", { className: "field" }, [
          el("span", { text: t("setup.stress") }),
          (() => {
            const select = el("select", {
              attrs: { "aria-label": t("setup.stress") },
            });
            for (const choice of [
              { value: "false", text: t("setup.stressNormal") },
              { value: "true", text: t("setup.stressHard") },
            ]) {
              const option = el("option", { text: choice.text, attrs: { value: choice.value } });
              option.selected = String(setup.stress) === choice.value;
              select.append(option);
            }
            select.addEventListener("change", () => {
              state.setup = { ...state.setup, stress: select.value === "true" };
              render();
            });
            return select;
          })(),
        ]),
        el("label", { className: "field" }, [
          el("span", { text: t("setup.source") }),
          (() => {
            const select = el("select", {
              attrs: { id: "setup-source", "aria-label": t("setup.source") },
            });
            const current =
              setup.dataSource === "imported"
                ? (state.dataLabel ?? "").endsWith("csv")
                  ? "csv"
                  : "live"
                : "synthetic";
            for (const choice of [
              { value: "synthetic", text: t("setup.sourceSynth") },
              { value: "csv", text: t("setup.sourceCsv") },
              { value: "live", text: t("setup.sourceLive") },
            ]) {
              const option = el("option", { text: choice.text, attrs: { value: choice.value } });
              option.selected = current === choice.value;
              select.append(option);
            }
            const fileInput = el("input", {
              attrs: { type: "file", accept: ".csv,text/csv", "aria-label": t("setup.sourceCsv") },
            });
            fileInput.style.display = "none";
            fileInput.addEventListener("change", () => {
              const file = fileInput.files?.[0];
              if (file === undefined) {
                return;
              }
              void file
                .text()
                .then((text) => {
                  const parsed = parseOhlcCsv(text);
                  if (!parsed.ok) {
                    toast(t(csvErrorKey(parsed.error)), "warn");
                    return;
                  }
                  state.importedBars = parsed.bars;
                  state.dataLabel = `${file.name}·csv`;
                  state.setup = {
                    ...state.setup,
                    dataSource: "imported",
                    bars: parsed.bars.length,
                    seed: (file.name.length * 7919) % 0xffffffff,
                  };
                  render();
                })
                .catch(() => {
                  toast(t("csv.read"), "warn");
                });
            });
            select.addEventListener("change", () => {
              if (select.value === "csv") {
                fileInput.click();
                render();
                return;
              }
              if (select.value === "live") {
                void loadLive("BTCUSDT");
                return;
              }
              state.setup = { ...state.setup, dataSource: "synthetic" };
              state.importedBars = [];
              state.dataLabel = null;
              render();
            });
            return el("span", { className: "source-row" }, [select, fileInput]);
          })(),
        ]),
        ...(state.dataLabel === null
          ? []
          : [
              el("div", { className: "seed-row" }, [
                el("span", { className: "hint", text: `${t("setup.loaded")} ${state.dataLabel}` }),
                el("label", { className: "field" }, [
                  el("span", { text: t("setup.pair") }),
                  (() => {
                    const pair = el("select", {
                      attrs: { id: "setup-pair", "aria-label": t("setup.pair") },
                    });
                    for (const choice of LIVE_PAIRS) {
                      const option = el("option", { text: choice, attrs: { value: choice } });
                      option.selected = state.dataLabel?.startsWith(choice) === true;
                      pair.append(option);
                    }
                    return pair;
                  })(),
                ]),
                actionButton(t("setup.load"), "ghost", () => {
                  const pair = document.getElementById("setup-pair");
                  if (pair instanceof HTMLSelectElement && isLivePair(pair.value)) {
                    void loadLive(pair.value);
                  }
                }),
              ]),
            ]),
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
          { min: 0.1, max: MAX_RULE_DRAWDOWN_PCT, step: 0.5 },
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
        const groups = new Map<string, { value: string; text: string }[]>();
        for (const item of state.presets) {
          const list = groups.get(item.group) ?? [];
          list.push({ value: item.id, text: item.displayName });
          groups.set(item.group, list);
        }
        const select = el("select", { attrs: { id: "rule-preset" } });
        for (const [group, list] of groups) {
          const parent = group.length > 0 ? el("optgroup", { attrs: { label: group } }) : select;
          for (const option of list) {
            const node = el("option", { text: option.text, attrs: { value: option.value } });
            node.selected = option.value === chosen;
            parent.append(node);
          }
          if (parent !== select) {
            select.append(parent);
          }
        }
        select.addEventListener("change", () => {
          state.setup = {
            ...state.setup,
            presetId: select.value,
            presetTargetPct: undefined,
            presetDailyPct: undefined,
          };
          render();
        });
        ruleFields.push(
          el("label", { className: "field" }, [el("span", { text: t("preset.label") }), select]),
        );
        const active = state.presets.find((item) => item.id === chosen);
        if (active !== undefined) {
          const applied = applyPresetChoices(active, setup);
          const pctText = (value: number | null): string =>
            value === null ? t("setup.optNone") : `${value}%`;
          const choiceRow = (
            label: string,
            allowed: readonly (number | null)[] | null,
            current: number | null,
            set: (value: number | null) => void,
          ): HTMLElement | null => {
            if (allowed === null) {
              return null;
            }
            return el("div", { className: "field" }, [
              el("span", { text: label }),
              el(
                "div",
                { className: "pct-row", attrs: { role: "group", "aria-label": label } },
                allowed.map((value) => {
                  const node = actionButton(
                    pctText(value),
                    value === current ? "pct is-selected" : "pct",
                    () => {
                      set(value);
                      render();
                    },
                  );
                  node.setAttribute("aria-pressed", value === current ? "true" : "false");
                  return node;
                }),
              ),
            ]);
          };
          const targetRow = choiceRow(
            t("rules.target"),
            active.choices.profitTargetPct,
            applied.profitTargetPct,
            (value) => {
              state.setup = { ...state.setup, presetTargetPct: value };
            },
          );
          const dailyRow = choiceRow(
            t("setup.daily"),
            active.choices.dailyLossLimitPct,
            applied.dailyLossLimitPct,
            (value) => {
              state.setup = { ...state.setup, presetDailyPct: value };
            },
          );
          const capital = applied.startingBalanceUsd ?? 0;
          const money0 = (value: number): string => formatNumber(value, locale(), 0);
          const drawdownUsd = resolvedMaxDrawdownUsd(
            capital,
            applied.maxDrawdownUsd,
            applied.maxDrawdownPct,
          );
          const summary = el("div", { className: "preset-summary" }, [
            quoteRow(t("setup.balance"), money0(capital)),
            quoteRow(
              t("rules.maxDd"),
              `${money0(drawdownUsd)} (${applied.drawdownMode === "trailing" ? t("setup.ddTrailing") : t("setup.ddStatic")})`,
            ),
            quoteRow(t("rules.target"), pctText(applied.profitTargetPct)),
            quoteRow(t("setup.daily"), pctText(applied.dailyLossLimitPct)),
            quoteRow(
              t("setup.maxLev"),
              (applied.markets ?? SAMPLE_MARKETS)
                .map(
                  (market) =>
                    `${sampleMarketLabel(state.lang, market)} ${leverageCap(applied, market)}×`,
                )
                .join(" · "),
            ),
            quoteRow(t("setup.fee"), `${applied.takerBps ?? 0} ${t("slip.bps")}`),
          ]);
          ruleFields.push(
            ...[targetRow, dailyRow].filter((node): node is HTMLElement => node !== null),
            summary,
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

    const today = challengeFor();
    // A shared link keeps its own round; otherwise the card is today's round.
    const shown = state.challenge ?? today;
    const shownResult = state.dailyResults[shown.day];
    const streak = dailyStreak(state.dailyResults, today.day);
    const challengeCard = el(
      "section",
      { className: "setup-card", attrs: { "aria-label": t("challenge.title") } },
      [
        el("h2", { text: t("challenge.title") }),
        el("p", { className: "hint", text: t("exam.note") }),
        quoteRow(t("setup.market"), sampleMarketLabel(state.lang, shown.market)),
        quoteRow(t("setup.timeframe"), formatTimeframe(shown.timeframeMin)),
        quoteRow(
          t("challenge.result"),
          shownResult === undefined
            ? `${shown.day} · ${t("challenge.fresh")}`
            : `${shown.day} · ${outcomeLabel(shownResult.outcome)} · ${t("review.maxDd")} ${formatPct(shownResult.maxDrawdownPct, locale())}`,
        ),
        ...(streak > 1 ? [quoteRow(t("challenge.streak"), String(streak))] : []),
        el("p", { className: "hint", text: t("challenge.resetHint") }),
        el("div", { className: "review-actions" }, [
          actionButton(t("challenge.start"), "submit submit-long", () => {
            state.challenge = shown;
            beginSession(challengeSetup(shown, state.setup));
          }),
          actionButton(t("challenge.link"), "ghost", () => {
            copyText(
              shownResult === undefined
                ? challengeHref(shown, window.location.href)
                : challengeLine(shown, shownResult),
            );
          }),
        ]),
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
      el("div", { className: "setup-grid" }, [challengeCard, data, rulesCard]),
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

    const theme = el("select", {
      className: "theme-select",
      attrs: { id: "theme", "aria-label": t("theme.label") },
    });
    for (const choice of THEMES) {
      const option = el("option", { text: t(`theme.${choice}`), attrs: { value: choice } });
      option.selected = choice === state.theme;
      theme.append(option);
    }
    theme.addEventListener("change", () => {
      const value = THEMES.find((item) => item === theme.value);
      if (value !== undefined) {
        state.theme = value;
        writeStoredTheme(value);
        render();
      }
    });

    const leave = actionButton(
      t("nav.setup"),
      state.screen === "setup" ? "nav-btn is-current" : "nav-btn",
      () => {
        leavePractice();
      },
    );
    leave.dataset.action = "leave-practice";

    const panelToggle =
      state.screen === "play"
        ? actionButton(t("panel.label"), "panel-toggle", () => {
            state.drawerOpen = !state.drawerOpen;
            render();
          })
        : null;
    if (panelToggle !== null) {
      panelToggle.setAttribute("aria-expanded", String(state.drawerOpen));
    }
    return el("header", { className: "topnav" }, [
      el("div", { className: "brand" }, [
        el("p", { className: "brand-kicker", text: t("kicker") }),
        el("h1", { text: PRODUCT_NAME }),
      ]),
      el("nav", { attrs: { "aria-label": "Primary" } }, [
        leave,
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
            state.drawerOpen = true;
            render();
          }
        }),
      ]),
      el("div", { className: "top-actions" }, [
        theme,
        lang,
        ...(panelToggle === null ? [] : [panelToggle]),
      ]),
    ]);
  }

  function mountMarket(frame: Frame, change: number, index: number): HTMLElement {
    const select = el("select", {
      className: "market-select",
      attrs: { "aria-label": t("market.synthetic") },
    });
    for (const market of [state.market]) {
      const option = el("option", {
        text: state.dataLabel ?? sampleMarketLabel(state.lang, market),
        attrs: { value: market },
      });
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
        el("span", {
          className: "toolbar-note",
          text:
            state.dataLabel?.endsWith("live") === true
              ? t("data.attribution")
              : t("market.synthetic"),
        }),
      ]),
      el("div", { className: "stats" }, [
        stat(t("market.mid"), formatNumber(frame.mark, locale())),
        stat(t("market.index"), formatNumber(frame.indexPrice ?? index, locale())),
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

    const studyChip = (
      label: string,
      stroke: IndicatorStroke,
      isVisible: () => boolean,
      flip: () => void,
    ): HTMLElement => {
      const visible = isVisible();
      const chip = el(
        "button",
        {
          className: visible ? "chip indicator-toggle is-on" : "chip indicator-toggle",
          attrs: {
            type: "button",
            "aria-pressed": visible ? "true" : "false",
            title: t("indicator.revealed"),
          },
        },
        [
          el("span", {
            className: `swatch swatch-${stroke}`,
            attrs: { "aria-hidden": "true" },
          }),
          el("span", { text: label }),
        ],
      );
      chip.addEventListener("click", () => {
        flip();
        render();
      });
      return chip;
    };

    row.append(
      studyChip(
        t("indicator.vwap"),
        "anchor",
        () => state.vwapVisible,
        () => {
          state.vwapVisible = !state.vwapVisible;
        },
      ),
      studyChip(
        `${t("indicator.bollinger")} ${DEFAULT_BOLLINGER_PERIOD}`,
        "line-strong",
        () => state.bollingerVisible,
        () => {
          state.bollingerVisible = !state.bollingerVisible;
        },
      ),
      studyChip(
        `${t("indicator.keltner")} ${DEFAULT_CHANNEL_PERIOD}`,
        "accent",
        () => state.keltnerVisible,
        () => {
          state.keltnerVisible = !state.keltnerVisible;
        },
      ),
      studyChip(
        `${t("indicator.donchian")} ${DEFAULT_CHANNEL_PERIOD}`,
        "short",
        () => state.donchianVisible,
        () => {
          state.donchianVisible = !state.donchianVisible;
        },
      ),
    );
    return row;
  }

  function mountTimeframeChips(
    source: SyntheticTimeframe | null,
    selected: SyntheticTimeframe | null,
    onSelect: (minutes: SyntheticTimeframe) => void,
  ): HTMLElement {
    const row = el("div", {
      className: "pane-toolbar",
      attrs: { role: "group", "aria-label": t("chart.timeframe") },
    });
    for (const minutes of SYNTHETIC_TIMEFRAMES_MIN) {
      const supported = source !== null && timeframeSupported(source, minutes);
      const current = minutes === selected;
      const button = el("button", {
        className: current ? "chip is-current" : "chip",
        text: formatTimeframe(minutes),
        disabled: !supported,
        attrs: {
          type: "button",
          "aria-pressed": current ? "true" : "false",
          ...(supported ? {} : { title: t("chart.tfUnsupported") }),
        },
      });
      button.addEventListener("click", () => {
        if (!supported || current) {
          return;
        }
        onSelect(minutes);
      });
      row.append(button);
    }
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
    const source = practiceSourceMin(series, state.setup.timeframeMin);
    const closed = series.slice(0, Math.max(0, state.cursor) + 1);
    // The unclosed preview is paint only. The engine still closes on `cursor`.
    const previewBar = state.formingPart === null ? undefined : series[state.cursor + 1];
    const preview =
      previewBar === undefined || state.formingPart === null
        ? null
        : { ...previewBar, ...formingSnapshot(previewBar, state.formingPart) };
    const painted = preview === null ? closed : [...closed, preview];

    const mountPane = (paneIndex: number, requested: SyntheticTimeframe, showLegend: boolean) => {
      const selected =
        source === null ? null : timeframeSupported(source, requested) ? requested : source;
      const closedView =
        source === null || selected === null ? null : resampleBars(closed, source, selected);
      const view =
        closedView === null || source === null || selected === null
          ? null
          : preview === null
            ? closedView
            : (resampleBars(painted, source, selected) ?? closedView);
      const closes = closedView === null ? [] : closedView.map((bar) => bar.close);
      // Indicators use the closed resample. A new preview candle takes the last slot.
      const previewExtra = view !== null && closedView !== null && view.length > closedView.length;
      const closedWindow = previewExtra ? Math.max(1, CHART_WINDOW - 1) : CHART_WINDOW;
      const from = Math.max(0, closes.length - closedWindow);
      const drawn = view === null ? [] : view.slice(from);
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
      const closedBars = closedView ?? [];
      const pushChannel = (points: readonly ChannelPoint[], stroke: IndicatorStroke): void => {
        if (points.length === 0) {
          return;
        }
        overlays.push({ points: points.map((point) => point.mid).slice(from), stroke });
        bands.push({
          upper: points.map((point) => point.upper).slice(from),
          lower: points.map((point) => point.lower).slice(from),
        });
      };
      if (state.vwapVisible && closedBars.length > 0) {
        overlays.push({
          points: anchoredVwap(closedBars).slice(from),
          stroke: "anchor",
          // Anchored at bar 0: a long trend can put it off-screen, which must not
          // squash the candles to fit it.
          fitsScale: false,
        });
      }
      if (state.bollingerVisible) {
        pushChannel(
          bollingerBands(closes, DEFAULT_BOLLINGER_PERIOD, DEFAULT_BOLLINGER_DEVIATIONS),
          "line-strong",
        );
      }
      if (state.keltnerVisible) {
        pushChannel(
          keltnerChannels(closedBars, DEFAULT_CHANNEL_PERIOD, DEFAULT_KELTNER_MULTIPLIER),
          "accent",
        );
      }
      if (state.donchianVisible) {
        pushChannel(donchianChannels(closedBars, DEFAULT_CHANNEL_PERIOD), "short");
      }
      const labelTf = selected === null ? t("chart.tfUnsupported") : formatTimeframe(selected);
      const seriesKey = `${dataKey({ ...state.setup, market: state.market })}:${selected ?? "none"}:${paneIndex}`;
      const stage = connectedChartHost(seriesKey) ?? el("div", { className: "chart-stage" });
      const slot = el("div", { attrs: { "data-chart-slot": seriesKey } });
      chartPlacements.push({
        slot,
        stage,
        mount: () => {
          stripChartChrome(stage);
          mountChart(stage, {
            candles: drawn,
            lines,
            overlays,
            bands,
            label: `${labelTf} · ${t("chart.sample")} · ${t("replay.bar")} ${state.cursor + 1}/${series.length}`,
            formatPrice: money,
            times: drawn.map((bar) => bar.timeMs),
            latestClosedIndex: Math.max(0, previewExtra ? drawn.length - 2 : drawn.length - 1),
            formatTime: (timeMs) => formatBarTime(timeMs, locale()),
            seriesKey,
            // Counts the forming preview. Pause removes that one bar and keeps the zoom.
            endIndex: view === null || view.length === 0 ? 0 : view.length - 1,
          });
          if (view === null) {
            stage.append(el("p", { className: "chart-empty", text: t("chart.tfUnsupported") }));
          } else if (view.length === 0) {
            stage.append(el("p", { className: "chart-empty", text: t("chart.tfEmpty") }));
          }
          if (showLegend) {
            stage.append(
              el("ul", { className: "legend" }, [
                el("li", { className: "legend-entry", text: t("legend.entry") }),
                el("li", { className: "legend-liq", text: t("legend.liquidation") }),
                el("li", { className: "legend-prop", text: t("legend.fail") }),
                el("li", { className: "legend-daily", text: t("legend.daily") }),
                el("li", { className: "legend-sl", text: t("legend.sl") }),
                el("li", { className: "legend-tp", text: t("legend.tp") }),
              ]),
            );
          }
        },
      });
      const chips = mountTimeframeChips(source, selected, (minutes) => {
        if (paneIndex === 0) {
          state.primaryTf = minutes;
        } else {
          state.secondaryTf = minutes;
        }
        render();
      });
      chips.append(
        el("span", {
          className: "pane-count",
          text: view === null ? "" : `${t("replay.bar")} ${view.length}`,
        }),
      );
      return el(
        "div",
        {
          className: "chart-pane",
          attrs: { "aria-label": `${t("chart.pane")} ${paneIndex + 1}` },
        },
        [chips, slot],
      );
    };

    const split = el("button", {
      className: state.splitChart ? "chip split-toggle is-on" : "chip split-toggle",
      text: t("chart.split"),
      attrs: {
        type: "button",
        "aria-pressed": state.splitChart ? "true" : "false",
        title: state.splitChart ? t("chart.singleHint") : t("chart.splitHint"),
      },
    });
    split.addEventListener("click", () => {
      const enabling = !state.splitChart;
      state.splitChart = enabling;
      if (enabling && source !== null) {
        const primary = timeframeSupported(source, state.primaryTf) ? state.primaryTf : source;
        const secondary = timeframeSupported(source, state.secondaryTf)
          ? state.secondaryTf
          : source;
        if (secondary === primary) {
          const next = coarserTimeframe(SYNTHETIC_TIMEFRAMES_MIN, source, primary);
          if (next !== null) {
            state.secondaryTf = next;
          }
        }
      }
      render();
    });

    const panes = el("div", {
      className: state.splitChart ? "chart-panes is-split" : "chart-panes",
    });
    panes.append(mountPane(0, state.primaryTf, true));
    if (state.splitChart) {
      panes.append(mountPane(1, state.secondaryTf, false));
    }

    const indicators = el("details", { className: "indicator-settings" }, [
      el("summary", { text: t("indicator.label") }),
      mountIndicatorControls(),
    ]);
    indicators.open = indicatorsOpen;
    indicators.addEventListener("toggle", () => {
      if (indicators.isConnected) indicatorsOpen = indicators.open;
    });
    return el("section", { className: "chart", attrs: { "aria-label": "Chart" } }, [
      el("div", { className: "chart-toolbar" }, [
        el("span", {
          className: "chip is-current",
          text: `${sampleMarketLabel(state.lang, state.market)} · ${formatTimeframe(state.setup.timeframeMin)} · ${t("setup.seed")} ${state.setup.seed}`,
        }),
        split,
        indicators,
        el("span", {
          className: "toolbar-note",
          text: `${t("replay.bar")} ${state.cursor + 1}/${series.length} · ${t("teaching.mark")}`,
        }),
      ]),
      panes,
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
    const levCap = leverageCap(active, state.market);
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
      // No render here: rebuilding mid-click swallows the submit that follows.
      // State persists and the next render (from the click) shows the value.
      input.addEventListener("change", () => {
        set(input.value);
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

    const percents = pctChips();

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

    const submit = submitControl(view.frame);

    return el("aside", { className: "ticket", attrs: { "aria-label": "Order ticket" } }, [
      el("div", { className: "ticket-scroll" }, [
        el("p", { className: "ticket-note", text: t("ticket.note") }),
        el("div", { className: "side-row" }, [pressSide("long"), pressSide("short")]),
        ...(view.frame.position === null
          ? [
              el(
                "div",
                { className: "type-row" },
                (["market", "limit", "stop"] as const).map((kind) =>
                  actionButton(
                    t(`type.${kind}`),
                    kind === state.orderType ? "chip is-current" : "chip",
                    () => {
                      state.orderType = kind;
                      if (kind !== "market" && state.orderPriceText === "") {
                        state.orderPriceText = view.money(view.frame.mark);
                      }
                      render();
                    },
                  ),
                ),
              ),
              ...(state.orderType === "market"
                ? []
                : [
                    priceInput("order-price", t("field.price"), state.orderPriceText, (value) => {
                      state.orderPriceText = value;
                    }),
                  ]),
            ]
          : []),
        el(
          "div",
          { className: "margin-row", attrs: { role: "group", "aria-label": t("margin.mode") } },
          (["isolated", "cross"] as const).map((mode) =>
            actionButton(
              t(`margin.${mode}`),
              mode === state.marginMode ? "chip is-current" : "chip",
              () => {
                state.marginMode = mode;
                render();
              },
            ),
          ),
        ),
        ...(view.frame.position === null
          ? []
          : [
              el(
                "div",
                {
                  className: "close-row",
                  attrs: { role: "group", "aria-label": t("close.fraction") },
                },
                [
                  ...BUYING_POWER_PCTS.map((pct) => {
                    const chip = actionButton(
                      `${pct}%`,
                      pct === state.closePct ? "chip is-current" : "chip",
                      () => {
                        state.closePct = pct;
                        render();
                      },
                    );
                    if (pct === state.closePct) {
                      chip.setAttribute("aria-pressed", "true");
                    }
                    return chip;
                  }),
                  actionButton(t("submit.close"), "ghost", commitClose),
                ],
              ),
            ]),
        el("label", { className: "field" }, [el("span", { text: t("field.leverage") }), leverage]),
        el("p", {
          className: "hint",
          text: active?.maxLeverage ? `${t("setup.maxLev")}: ${levCap}×` : t("field.leverageHint"),
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
        ...(view.frame.pendingOrders.length === 0
          ? []
          : [
              el("section", { className: "orders", attrs: { "aria-label": t("orders.title") } }, [
                el("h2", { text: t("orders.title") }),
                ...view.frame.pendingOrders.map((order) =>
                  el("div", { className: "order-row" }, [
                    el("span", {
                      className: "mono",
                      text: `${t(`type.${order.kind}`)} ${order.side === "long" ? t("side.long") : t("side.short")} @ ${view.money(order.price)}`,
                    }),
                    actionButton(t("orders.cancel"), "ghost", () => {
                      state.actions = state.actions.filter(
                        (item) =>
                          !(item.kind === order.kind && item.barIndex === order.placedAtBar),
                      );
                      render();
                    }),
                  ]),
                ),
              ]),
            ]),
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

  function pctChips(): HTMLElement {
    return el(
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
  }

  function commitOpenOrClose(): void {
    // While holding, the side picker decides: same side adds, opposite
    // side reverses. The engine does both; the close control flattens.
    if (currentFrame().position === null && state.orderType !== "market") {
      commit({
        kind: state.orderType,
        barIndex: state.cursor,
        side: state.side,
        leverage: state.leverage,
        powerPct: state.powerPct,
        price: parsePrice(state.orderPriceText) ?? Number.NaN,
        slipToleranceBps: state.slipToleranceBps,
        realizedImpactBps: state.realizedImpactBps,
        stopLoss: parsePrice(state.stopLossText),
        takeProfit: parsePrice(state.takeProfitText),
      });
      return;
    }
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
  }

  function commitClose(): void {
    // Flattening from the phone drawer should hand the chart back.
    state.drawerOpen = false;
    commit({
      kind: "close",
      barIndex: state.cursor,
      powerPct: state.closePct,
      slipToleranceBps: state.slipToleranceBps,
      realizedImpactBps: state.realizedImpactBps,
    });
  }

  function submitControl(frame: Frame): HTMLElement {
    const label =
      frame.position !== null
        ? frame.position.side === state.side
          ? t("submit.add")
          : t("submit.reverse")
        : state.orderType !== "market"
          ? t("submit.place")
          : state.side === "long"
            ? t("submit.long")
            : t("submit.short");
    const className = state.side === "long" ? "submit submit-long" : "submit submit-short";
    const ended = state.endedAt !== null || state.countdown !== null;
    const button = actionButton(label, className, commitOpenOrClose);
    if (ended) {
      button.disabled = true;
    }
    return el("div", { className: "submit-row" }, [button]);
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
        quoteRow(t("setup.maxLev"), `${leverageCap(active, state.market)}×`),
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
    const links = active.sourceUrls.map((url, index) => {
      const link = el("a", {
        className: "source-link",
        text: `${t("rules.sources")} ${index + 1}`,
        attrs: { href: url, rel: "noreferrer" },
      });
      return el("li", {}, [link]);
    });
    return el("div", { className: "rules" }, [
      el("h2", { text: active.displayName }),
      el("p", { text: active.disclaimer }),
      el("p", { text: upnl }),
      quoteRow(t("rules.target"), frame.profitTarget === null ? dash : money(frame.profitTarget)),
      quoteRow(t("setup.maxLev"), `${leverageCap(active, state.market)}×`),
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
    const metrics = reviewMetrics({
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
            ? state.endedByUser
              ? t("review.endedByUser")
              : t("review.dataEnd")
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
      spark,
      el("div", { className: "review-grid" }, [
        stat(t("review.return"), pct(metrics.returnPct)),
        stat(t("review.net"), amount(metrics.netPnl)),
        stat(t("review.trades"), String(metrics.trades)),
        stat(t("review.winRate"), pct(metrics.winRate)),
        stat(
          t("review.pf"),
          metrics.profitFactor === null
            ? dash
            : Number.isFinite(metrics.profitFactor)
              ? formatNumber(metrics.profitFactor, locale())
              : "∞",
        ),
        stat(t("review.expectancy"), amount(metrics.expectancy)),
        stat(t("review.avgWin"), amount(metrics.avgWin)),
        stat(t("review.avgLoss"), amount(metrics.avgLoss)),
        stat(t("review.best"), amount(metrics.bestTrade)),
        stat(t("review.worst"), amount(metrics.worstTrade)),
        stat(t("review.maxDd"), pct(metrics.maxDrawdownPct)),
        stat(
          t("review.sharpe"),
          metrics.sharpe === null ? dash : formatNumber(metrics.sharpe, locale(), 2),
        ),
        stat(
          t("review.sortino"),
          metrics.sortino === null ? dash : formatNumber(metrics.sortino, locale(), 2),
        ),
        stat(
          t("review.calmar"),
          metrics.calmar === null ? dash : formatNumber(metrics.calmar, locale(), 2),
        ),
        stat(
          t("review.avgHold"),
          metrics.avgHoldBars === null ? dash : formatNumber(metrics.avgHoldBars, locale(), 1),
        ),
        stat(t("review.fees"), money(frame.feesPaid)),
        stat(t("review.carry"), money(frame.carryPaid)),
        stat(t("review.funding"), money(frame.fundingPaid)),
      ]),
      ...(() => {
        const trades = pairTrades(frame.fills);
        const mc = monteCarlo({
          netPnls: trades.map((trade) => trade.netPnl),
          startingBalance: startingBalance(),
          floor: frame.maxDrawdownFloor,
          seed: state.setup.seed,
        });
        if (mc.breachProbability === null) {
          return [];
        }
        const pctOrDash = (value: number | null): string =>
          value === null ? dash : formatPct(value, locale());
        return [
          el("div", { className: "monte-carlo", attrs: { "aria-label": t("review.mc") } }, [
            el("h3", { text: t("review.mc") }),
            el("p", { className: "hint", text: t("review.mcNote") }),
            el("div", { className: "review-grid" }, [
              stat(
                t("review.mcBreach"),
                mc.breachProbability === null
                  ? dash
                  : formatPct(mc.breachProbability * 100, locale()),
              ),
              stat(t("review.mcDd50"), pctOrDash(mc.maxDrawdownP50)),
              stat(t("review.mcDd95"), pctOrDash(mc.maxDrawdownP95)),
              stat(t("review.mcSamples"), String(mc.samples)),
            ]),
          ]),
        ];
      })(),
      el("p", { className: "hint", text: t("review.carryNote") }),
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
      ...(() => {
        const challenge = state.challenge;
        const result = challenge === null ? undefined : state.dailyResults[challenge.day];
        if (challenge === null || result === undefined) {
          return [];
        }
        return [
          el("div", { className: "monte-carlo", attrs: { "aria-label": t("challenge.result") } }, [
            el("h3", { text: `${t("challenge.result")} · ${challenge.day}` }),
            el("div", { className: "review-grid" }, [
              stat(t("challenge.outcome"), outcomeLabel(result.outcome)),
              stat(t("review.maxDd"), formatPct(result.maxDrawdownPct, locale())),
              stat(t("setup.bars"), String(result.bars)),
            ]),
            el("div", { className: "review-actions" }, [
              actionButton(t("challenge.link"), "ghost", () => {
                copyText(challengeLine(challenge, result));
              }),
            ]),
          ]),
        ];
      })(),
      el("div", { className: "review-actions" }, [
        actionButton(t("review.replaySame"), "ghost", () => {
          beginSession(state.setup);
        }),
        actionButton(t("review.newData"), "submit submit-long", () => {
          beginSession({ ...state.setup, seed: randomSeed() });
        }),
        actionButton(t("nav.setup"), "ghost", () => {
          leavePractice();
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
        pausePlayback();
      } else {
        startPlay();
      }
      render();
    });
    const step = actionButton(t("replay.forward"), "ghost", () => {
      requestStep();
      render();
    });
    const finish = actionButton(t("replay.finish"), "ghost", () => {
      const daily = state.challenge !== null && matchesChallenge(state.setup, state.challenge);
      if (daily && currentFrame().phase === "practice" && !window.confirm(t("replay.endConfirm"))) {
        return;
      }
      pausePlayback();
      state.endedByUser = true;
      state.endedAt = state.cursor;
      state.tab = "review";
      state.drawerOpen = true;
      render();
    });
    for (const node of [play, step, finish]) {
      node.disabled = ended || state.countdown !== null;
    }
    const speeds = el("select", {
      className: "speed-select",
      attrs: { "aria-label": t("replay.speed") },
    });
    for (const speed of SPEEDS) {
      const option = el("option", { text: speed.label, attrs: { value: String(speed.ms) } });
      option.selected = speed.ms === state.speedMs;
      speeds.append(option);
    }
    speeds.addEventListener("change", () => {
      const speed = SPEEDS.find((item) => String(item.ms) === speeds.value);
      if (speed === undefined) return;
      state.speedMs = speed.ms;
      if (state.playing) startPlay();
      render();
    });
    return el("div", { className: "replay", attrs: { "aria-label": "Replay" } }, [
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
      el("div", { className: "trade-order-row", attrs: { "data-testid": "trade-bar" } }, [
        pressSide("long"),
        pressSide("short"),
        pctChips(),
        submitControl(frame),
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
    return el("div", { className: "colophon" }, [
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
    if (target instanceof Element && target.closest("input, select, button, summary, a")) {
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      if (state.playing) {
        pausePlayback();
      } else {
        startPlay();
      }
      render();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      requestStep();
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
