import {
  advanceViewport,
  indexToCoordinate,
  pinchZoomScale,
  scrollChartTo,
  showRecentViewport,
  viewportAfterWheel,
  visibleIndexRange,
  wheelChartDeltas,
  zoomTime,
  type TimeViewport,
} from "./chart-scale.ts";

export type Candle = {
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
};

export type ChartLineKind = "entry" | "liq" | "fail" | "daily" | "sl" | "tp";

export type ChartLine = {
  readonly price: number;
  readonly kind: ChartLineKind;
};

/** Stroke token. Colors live in the desk stylesheet, not in this module. */
export const INDICATOR_STROKES = [
  "text-dim",
  "accent",
  "line",
  "short",
  "danger",
  "prop",
  "line-strong",
] as const;

export type IndicatorStroke = (typeof INDICATOR_STROKES)[number];

export type ChartOverlay = {
  readonly points: readonly (number | null)[];
  readonly stroke: IndicatorStroke;
};

export type ChartBand = {
  readonly upper: readonly (number | null)[];
  readonly lower: readonly (number | null)[];
};

export type CandleDirection = "up" | "down";

export type PxRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type LaidCandle = {
  readonly direction: CandleDirection;
  readonly body: PxRect;
  readonly upperWick: PxRect | null;
  readonly lowerWick: PxRect | null;
};

/** Empty band above and below the high/low range, as a fraction of the pane. */
export const CANDLE_PANE_MARGIN = 0.08;

const SVG_NS = "http://www.w3.org/2000/svg";
const SLOT_SPECIAL_FROM = 2.5;
const SLOT_SPECIAL_TO = 4;
const SLOT_SPECIAL_WIDTH = 3;

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value);
  }
  return node;
}

function lineClass(kind: ChartLineKind): string {
  switch (kind) {
    case "entry":
      return "line-entry";
    case "liq":
      return "line-liq";
    case "fail":
      return "line-fail";
    case "daily":
      return "line-daily";
    case "sl":
      return "line-sl";
    case "tp":
      return "line-tp";
    default: {
      const unexpected: never = kind;
      return unexpected;
    }
  }
}

function strokeClass(stroke: IndicatorStroke): string {
  switch (stroke) {
    case "text-dim":
      return "stroke-text-dim";
    case "accent":
      return "stroke-accent";
    case "line":
      return "stroke-line";
    case "short":
      return "stroke-short";
    case "danger":
      return "stroke-danger";
    case "prop":
      return "stroke-prop";
    case "line-strong":
      return "stroke-line-strong";
    default: {
      const unexpected: never = stroke;
      return unexpected;
    }
  }
}

function deviceRatio(pixelRatio: number): number {
  if (!Number.isFinite(pixelRatio) || pixelRatio < 1) {
    return 1;
  }
  return pixelRatio;
}

/** Close at or above the open is an up candle, including a flat doji. */
export function candleDirection(candle: Candle): CandleDirection {
  return candle.close >= candle.open ? "up" : "down";
}

function partClass(direction: CandleDirection, part: "body" | "wick"): string {
  switch (direction) {
    case "up":
      return part === "body" ? "candle-up" : "wick-up";
    case "down":
      return part === "body" ? "candle-down" : "wick-down";
    default: {
      const unexpected: never = direction;
      return unexpected;
    }
  }
}

/**
 * Body width in device pixels for a slot of `barSpacing` CSS pixels.
 * Narrow slots stay a few pixels wide. Wider slots leave about a fifth of the slot empty.
 */
export function candleBodyDeviceWidth(barSpacing: number, pixelRatio: number): number {
  const ratio = deviceRatio(pixelRatio);
  let width: number;
  if (barSpacing >= SLOT_SPECIAL_FROM && barSpacing <= SLOT_SPECIAL_TO) {
    width = Math.floor(SLOT_SPECIAL_WIDTH * ratio);
  } else {
    const coeff =
      1 -
      (0.2 * Math.atan(Math.max(SLOT_SPECIAL_TO, barSpacing) - SLOT_SPECIAL_TO)) / (Math.PI * 0.5);
    const fitted = Math.floor(barSpacing * coeff * ratio);
    const slot = Math.floor(barSpacing * ratio);
    width = Math.max(Math.floor(ratio), Math.min(fitted, slot));
  }
  if (width >= 2 && Math.floor(ratio) % 2 !== width % 2) {
    width -= 1;
  }
  return width;
}

/** Wick thickness in device pixels: one device pixel, and never wider than the body. */
export function candleWickDeviceWidth(
  barSpacing: number,
  pixelRatio: number,
  bodyWidth: number,
): number {
  const ratio = deviceRatio(pixelRatio);
  const hairline = Math.floor(ratio);
  const slot = Math.floor(barSpacing * ratio);
  const raw = Math.min(hairline, slot);
  return Math.max(hairline, Math.min(raw, bodyWidth));
}

function finitePrice(value: number): boolean {
  return Number.isFinite(value);
}

function rectFromDevice(
  x: number,
  y: number,
  width: number,
  height: number,
  originX: number,
  ratio: number,
): PxRect {
  return {
    x: originX + x / ratio,
    y: y / ratio,
    width: width / ratio,
    height: height / ratio,
  };
}

export function layoutCandles(input: {
  readonly candles: readonly Candle[];
  readonly width: number;
  readonly height: number;
  readonly padLeft: number;
  readonly padRight: number;
  readonly pixelRatio: number;
  readonly extraPrices?: readonly number[];
  /** When set, candles use this spacing instead of stretching to the pane. */
  readonly timeScale?: TimeViewport;
}): {
  readonly candles: readonly LaidCandle[];
  readonly yOf: (price: number) => number;
  readonly plotLeft: number;
  readonly plotRight: number;
} {
  const ratio = deviceRatio(input.pixelRatio);
  const plotLeft = input.padLeft;
  const plotWidth = Math.max(1, input.width - input.padLeft - input.padRight);
  const plotHeight = Math.max(1, input.height);
  const prices: number[] = [];
  const visible =
    input.timeScale === undefined
      ? { from: 0, to: input.candles.length - 1 }
      : visibleIndexRange(plotWidth, input.candles.length, input.timeScale);
  for (let index = visible.from; index <= visible.to; index += 1) {
    const candle = input.candles[index];
    if (candle === undefined) {
      continue;
    }
    for (const price of [candle.open, candle.high, candle.low, candle.close]) {
      if (finitePrice(price)) {
        prices.push(price);
      }
    }
  }
  for (const price of input.extraPrices ?? []) {
    if (finitePrice(price)) {
      prices.push(price);
    }
  }
  const low = prices.length === 0 ? 0 : Math.min(...prices);
  const high = prices.length === 0 ? 1 : Math.max(...prices);
  const span = high - low || 1;
  const topMargin = plotHeight * CANDLE_PANE_MARGIN;
  const bottomMargin = plotHeight * CANDLE_PANE_MARGIN;
  const internal = Math.max(1, plotHeight - topMargin - bottomMargin);
  const yOf = (price: number): number => {
    const inv = bottomMargin + ((internal - 1) * (price - low)) / span;
    return plotHeight - 1 - inv;
  };

  const count = input.candles.length;
  const barSpacing =
    input.timeScale === undefined
      ? count === 0
        ? plotWidth
        : plotWidth / count
      : input.timeScale.barSpacing;
  const bodyWidth = candleBodyDeviceWidth(barSpacing, ratio);
  const wickWidth = candleWickDeviceWidth(barSpacing, ratio, bodyWidth);
  const wickOffset = Math.floor(wickWidth * 0.5);
  const laid: LaidCandle[] = [];
  let prevWickEdge: number | null = null;

  input.candles.forEach((candle, index) => {
    if (
      !finitePrice(candle.open) ||
      !finitePrice(candle.high) ||
      !finitePrice(candle.low) ||
      !finitePrice(candle.close)
    ) {
      return;
    }
    const center =
      input.timeScale === undefined
        ? (index + 0.5) * barSpacing
        : indexToCoordinate(plotWidth, count, input.timeScale, index);
    if (
      input.timeScale !== undefined &&
      (center < -barSpacing || center > plotWidth + barSpacing)
    ) {
      return;
    }
    const scaledX = Math.round(ratio * center);
    const openY = Math.round(Math.min(yOf(candle.open), yOf(candle.close)) * ratio);
    const closeY = Math.round(Math.max(yOf(candle.open), yOf(candle.close)) * ratio);
    const highY = Math.round(yOf(candle.high) * ratio);
    const lowY = Math.round(yOf(candle.low) * ratio);
    const bodyLeft = scaledX - Math.floor(bodyWidth * 0.5);
    const bodyRight = bodyLeft + bodyWidth - 1;

    let wickLeft = scaledX - wickOffset;
    const wickRight = wickLeft + wickWidth - 1;
    if (prevWickEdge !== null) {
      wickLeft = Math.max(prevWickEdge + 1, wickLeft);
      wickLeft = Math.min(wickLeft, wickRight);
    }
    prevWickEdge = wickRight;
    const wickSpan = wickRight - wickLeft + 1;
    const upperHeight = openY - highY;
    const lowerHeight = lowY - closeY;

    laid.push({
      direction: candleDirection(candle),
      body: rectFromDevice(
        bodyLeft,
        openY,
        bodyRight - bodyLeft + 1,
        closeY - openY + 1,
        plotLeft,
        ratio,
      ),
      upperWick:
        upperHeight > 0
          ? rectFromDevice(wickLeft, highY, wickSpan, upperHeight, plotLeft, ratio)
          : null,
      lowerWick:
        lowerHeight > 0
          ? rectFromDevice(wickLeft, closeY + 1, wickSpan, lowerHeight, plotLeft, ratio)
          : null,
    });
  });

  return { candles: laid, yOf, plotLeft, plotRight: plotLeft + plotWidth };
}

function px(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function appendRect(parent: SVGElement, className: string, rect: PxRect): void {
  parent.append(
    svg("rect", {
      class: className,
      x: px(rect.x),
      y: px(rect.y),
      width: px(rect.width),
      height: px(rect.height),
    }),
  );
}

function collectPrices(
  prices: number[],
  points: readonly (number | null)[],
  from: number,
  to: number,
): void {
  const end = Math.min(to, points.length - 1);
  for (let index = Math.max(0, from); index <= end; index += 1) {
    const price = points[index];
    if (price !== null && price !== undefined && Number.isFinite(price)) {
      prices.push(price);
    }
  }
}

function appendOverlay(
  root: SVGSVGElement,
  overlay: ChartOverlay,
  limit: number,
  xOf: (index: number) => number,
  yOf: (price: number) => number,
): void {
  const stroke = strokeClass(overlay.stroke);
  let run: { readonly x: number; readonly y: number }[] = [];
  const flush = (): void => {
    const first = run[0];
    if (run.length >= 2) {
      root.append(
        svg("polyline", {
          class: `indicator-line ${stroke}`,
          points: run.map((point) => `${px(point.x)},${px(point.y)}`).join(" "),
        }),
      );
    } else if (run.length === 1 && first !== undefined) {
      root.append(
        svg("circle", {
          class: `indicator-point ${stroke}`,
          cx: px(first.x),
          cy: px(first.y),
          r: "2.2",
        }),
      );
    }
    run = [];
  };

  const end = Math.min(limit, overlay.points.length);
  for (let index = 0; index < end; index += 1) {
    const price = overlay.points[index];
    if (price === null || price === undefined || !Number.isFinite(price)) {
      flush();
      continue;
    }
    run.push({ x: xOf(index), y: yOf(price) });
  }
  flush();
}

function appendBand(
  root: SVGSVGElement,
  band: ChartBand,
  limit: number,
  xOf: (index: number) => number,
  yOf: (price: number) => number,
): void {
  const end = Math.min(limit, band.upper.length, band.lower.length);
  let top: string[] = [];
  let bottom: string[] = [];
  const flush = (): void => {
    if (top.length >= 2) {
      const points = top.concat(bottom.reverse());
      root.append(
        svg("polygon", {
          class: "indicator-band",
          points: points.join(" "),
        }),
      );
    }
    top = [];
    bottom = [];
  };

  for (let index = 0; index < end; index += 1) {
    const upper = band.upper[index];
    const lower = band.lower[index];
    if (
      upper === null ||
      upper === undefined ||
      lower === null ||
      lower === undefined ||
      !Number.isFinite(upper) ||
      !Number.isFinite(lower)
    ) {
      flush();
      continue;
    }
    const x = px(xOf(index));
    top.push(`${x},${px(yOf(upper))}`);
    bottom.push(`${x},${px(yOf(lower))}`);
  }
  flush();
}

const PAD_LEFT = 12;
const PAD_RIGHT = 72;
const TOUCH_SLOP = 5;

type ViewportMemory = {
  seriesKey: string;
  endIndex: number;
  barCount: number;
  barSpacing: number;
  rightOffset: number;
};

type HostChart = {
  paint: () => void;
  detach: () => void;
};

/**
 * One paint per host. Split panes mount more than one host, and a resize
 * repaints only the host that changed. Wheel zoom listens on that host and
 * repaints it; this module does not keep a single active chart.
 */
const paints = new Map<HTMLElement, HostChart>();

/** Zoom for each pane. A desk re-render keeps the entry for that series key. */
const viewports = new Map<string, ViewportMemory>();

const resizeObserver =
  typeof ResizeObserver === "undefined"
    ? null
    : new ResizeObserver((entries) => {
        for (const entry of entries) {
          const host = entry.target;
          if (host instanceof HTMLElement) {
            paints.get(host)?.paint();
          }
        }
      });

function viewportFor(seriesKey: string): ViewportMemory | null {
  return viewports.get(seriesKey) ?? null;
}

/** Drop hosts the desk already removed so a split re-render does not leak them. */
export function releaseDetachedCharts(): void {
  for (const host of paints.keys()) {
    if (!host.isConnected) {
      paints.get(host)?.detach();
      resizeObserver?.unobserve(host);
      paints.delete(host);
    }
  }
}

function plotWidthOf(host: HTMLElement): number {
  return Math.max(0, host.clientWidth - PAD_LEFT - PAD_RIGHT);
}

function viewportFrom(state: ViewportMemory): TimeViewport {
  return { barSpacing: state.barSpacing, rightOffset: state.rightOffset };
}

function reconcileViewport(
  plotWidth: number,
  barCount: number,
  endIndex: number,
  seriesKey: string,
): TimeViewport {
  const previous = viewportFor(seriesKey);
  if (
    previous === null ||
    previous.seriesKey !== seriesKey ||
    endIndex < previous.endIndex ||
    barCount <= 0 ||
    plotWidth <= 0
  ) {
    const next = showRecentViewport(plotWidth, barCount);
    viewports.set(seriesKey, { seriesKey, endIndex, barCount, ...next });
    return next;
  }
  const next = advanceViewport(
    plotWidth,
    previous.barCount,
    barCount,
    endIndex - previous.endIndex,
    viewportFrom(previous),
  );
  viewports.set(seriesKey, { seriesKey, endIndex, barCount, ...next });
  return next;
}

function commitViewport(
  seriesKey: string,
  endIndex: number,
  barCount: number,
  view: TimeViewport,
): void {
  viewports.set(seriesKey, {
    seriesKey,
    endIndex,
    barCount,
    barSpacing: view.barSpacing,
    rightOffset: view.rightOffset,
  });
}

function isWindowsChromium(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  const uaData = (
    navigator as Navigator & {
      userAgentData?: { platform?: string; brands?: readonly { brand: string }[] };
    }
  ).userAgentData;
  if (uaData === undefined) {
    return false;
  }
  const chromium = uaData.brands?.some((brand) => brand.brand.includes("Chromium")) ?? false;
  return uaData.platform === "Windows" && chromium;
}

function touchDistance(a: Touch, b: Touch): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function bindGestures(
  host: HTMLElement,
  read: () => { seriesKey: string; endIndex: number; barCount: number },
  paint: () => void,
): () => void {
  let drag: { startX: number; startOffset: number; spacing: number } | null = null;
  let finger: {
    startX: number;
    startY: number;
    startOffset: number;
    spacing: number;
    mode: "pending" | "pan" | "page";
  } | null = null;
  let pinch: { distance: number; previousScale: number } | null = null;

  const apply = (view: TimeViewport): void => {
    const ctx = read();
    if (ctx.barCount <= 0) {
      return;
    }
    commitViewport(ctx.seriesKey, ctx.endIndex, ctx.barCount, view);
    paint();
  };

  const onWheel = (event: WheelEvent): void => {
    const ctx = read();
    const current = viewportFor(ctx.seriesKey);
    if ((event.deltaX === 0 && event.deltaY === 0) || current === null) {
      return;
    }
    const plotWidth = plotWidthOf(host);
    if (ctx.barCount <= 0 || plotWidth <= 0) {
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
    const pointX = event.clientX - host.getBoundingClientRect().left - PAD_LEFT;
    apply(
      viewportAfterWheel(
        plotWidth,
        ctx.barCount,
        viewportFrom(current),
        pointX,
        wheelChartDeltas({
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaMode: event.deltaMode,
          windowsChrome: isWindowsChromium(),
          devicePixelRatio: window.devicePixelRatio,
        }),
      ),
    );
  };

  const onMouseMove = (event: MouseEvent): void => {
    if (drag === null) {
      return;
    }
    const ctx = read();
    apply(
      scrollChartTo(
        plotWidthOf(host),
        ctx.barCount,
        drag.spacing,
        drag.startOffset,
        drag.startX,
        event.clientX,
      ),
    );
  };

  const endDrag = (): void => {
    drag = null;
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", endDrag);
  };

  const onMouseDown = (event: MouseEvent): void => {
    const current = viewportFor(read().seriesKey);
    if (event.button !== 0 || current === null) {
      return;
    }
    drag = {
      startX: event.clientX,
      startOffset: current.rightOffset,
      spacing: current.barSpacing,
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", endDrag);
    event.preventDefault();
  };

  const onTouchStart = (event: TouchEvent): void => {
    if (event.touches.length === 2) {
      finger = null;
      const first = event.touches[0];
      const second = event.touches[1];
      if (first === undefined || second === undefined) {
        return;
      }
      pinch = { distance: touchDistance(first, second), previousScale: 1 };
      return;
    }
    const first = event.touches[0];
    const current = viewportFor(read().seriesKey);
    if (event.touches.length !== 1 || current === null || first === undefined) {
      return;
    }
    pinch = null;
    finger = {
      startX: first.clientX,
      startY: first.clientY,
      startOffset: current.rightOffset,
      spacing: current.barSpacing,
      mode: "pending",
    };
  };

  const onTouchMove = (event: TouchEvent): void => {
    const first = event.touches[0];
    const second = event.touches[1];
    const current = viewportFor(read().seriesKey);
    if (
      event.touches.length === 2 &&
      pinch !== null &&
      current !== null &&
      first !== undefined &&
      second !== undefined &&
      pinch.distance > 0
    ) {
      const scale = touchDistance(first, second) / pinch.distance;
      const zoomScale = pinchZoomScale(scale, pinch.previousScale);
      pinch = { distance: pinch.distance, previousScale: scale };
      const ctx = read();
      const rect = host.getBoundingClientRect();
      const pointX = (first.clientX + second.clientX) / 2 - rect.left - PAD_LEFT;
      if (event.cancelable) {
        event.preventDefault();
      }
      apply(zoomTime(plotWidthOf(host), ctx.barCount, viewportFrom(current), pointX, zoomScale));
      return;
    }
    if (finger === null || event.touches.length !== 1 || first === undefined) {
      return;
    }
    if (finger.mode === "pending") {
      const xOffset = Math.abs(first.clientX - finger.startX);
      const yOffset = Math.abs(first.clientY - finger.startY);
      if (xOffset + yOffset < TOUCH_SLOP) {
        return;
      }
      // Vertical drag scrolls the page. A horizontal drag pans the bars.
      finger = { ...finger, mode: yOffset >= xOffset * 0.5 ? "page" : "pan" };
    }
    switch (finger.mode) {
      case "pending":
      case "page":
        return;
      case "pan": {
        const ctx = read();
        if (event.cancelable) {
          event.preventDefault();
        }
        apply(
          scrollChartTo(
            plotWidthOf(host),
            ctx.barCount,
            finger.spacing,
            finger.startOffset,
            finger.startX,
            first.clientX,
          ),
        );
        return;
      }
      default: {
        const unexpected: never = finger.mode;
        return unexpected;
      }
    }
  };

  const onTouchEnd = (event: TouchEvent): void => {
    if (event.touches.length < 2) {
      pinch = null;
    }
    if (event.touches.length === 0) {
      finger = null;
    }
  };

  host.addEventListener("wheel", onWheel, { passive: false });
  host.addEventListener("mousedown", onMouseDown);
  host.addEventListener("touchstart", onTouchStart, { passive: true });
  host.addEventListener("touchmove", onTouchMove, { passive: false });
  host.addEventListener("touchend", onTouchEnd);
  host.addEventListener("touchcancel", onTouchEnd);

  return () => {
    endDrag();
    host.removeEventListener("wheel", onWheel);
    host.removeEventListener("mousedown", onMouseDown);
    host.removeEventListener("touchstart", onTouchStart);
    host.removeEventListener("touchmove", onTouchMove);
    host.removeEventListener("touchend", onTouchEnd);
    host.removeEventListener("touchcancel", onTouchEnd);
  };
}

export function mountChart(
  host: HTMLElement,
  input: {
    readonly candles: readonly Candle[];
    readonly lines: readonly ChartLine[];
    readonly overlays: readonly ChartOverlay[];
    readonly bands: readonly ChartBand[];
    readonly label: string;
    readonly formatPrice: (price: number) => string;
    /** Same series keeps the zoom. A new key, or a cursor rewind, shows recent bars. */
    readonly seriesKey: string;
    /** Absolute index of the last revealed bar. Grows by one as playback steps. */
    readonly endIndex: number;
  },
): void {
  const paint = (): void => {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (width < 2 || height < 2) {
      return;
    }
    const ratio = deviceRatio(window.devicePixelRatio);
    const revealed = input.candles.length;
    const plotWidth = Math.max(1, width - PAD_LEFT - PAD_RIGHT);
    const timeScale = reconcileViewport(plotWidth, revealed, input.endIndex, input.seriesKey);
    const visible = visibleIndexRange(plotWidth, revealed, timeScale);
    const extraPrices = input.lines.map((line) => line.price);
    for (const overlay of input.overlays) {
      collectPrices(extraPrices, overlay.points, visible.from, visible.to);
    }
    for (const band of input.bands) {
      collectPrices(extraPrices, band.upper, visible.from, visible.to);
      collectPrices(extraPrices, band.lower, visible.from, visible.to);
    }
    const laid = layoutCandles({
      candles: input.candles,
      width,
      height,
      padLeft: PAD_LEFT,
      padRight: PAD_RIGHT,
      pixelRatio: ratio,
      extraPrices,
      timeScale,
    });
    const root = svg("svg", {
      class: "chart-svg",
      viewBox: `0 0 ${width} ${height}`,
      width: String(width),
      height: String(height),
      role: "img",
      "aria-label": input.label,
    });
    const wicks = svg("g", { class: "wicks" });
    const bodies = svg("g", { class: "bodies" });
    for (const candle of laid.candles) {
      const wickClass = partClass(candle.direction, "wick");
      if (candle.upperWick !== null) {
        appendRect(wicks, wickClass, candle.upperWick);
      }
      if (candle.lowerWick !== null) {
        appendRect(wicks, wickClass, candle.lowerWick);
      }
      appendRect(bodies, partClass(candle.direction, "body"), candle.body);
    }
    root.append(wicks, bodies);

    const xOf = (index: number): number =>
      laid.plotLeft + indexToCoordinate(plotWidth, revealed, timeScale, index);
    for (const band of input.bands) {
      appendBand(root, band, revealed, xOf, laid.yOf);
    }
    for (const overlay of input.overlays) {
      appendOverlay(root, overlay, revealed, xOf, laid.yOf);
    }

    // Price scale: five evenly spaced labels on the right edge, from visible bars.
    let hiPrice = Number.NEGATIVE_INFINITY;
    let loPrice = Number.POSITIVE_INFINITY;
    for (let index = visible.from; index <= visible.to; index += 1) {
      const candle = input.candles[index];
      if (candle === undefined) {
        continue;
      }
      if (finitePrice(candle.high)) {
        hiPrice = Math.max(hiPrice, candle.high);
      }
      if (finitePrice(candle.low)) {
        loPrice = Math.min(loPrice, candle.low);
      }
    }
    if (Number.isFinite(hiPrice) && Number.isFinite(loPrice) && hiPrice > loPrice) {
      for (let step = 0; step <= 4; step += 1) {
        const price = loPrice + ((hiPrice - loPrice) * step) / 4;
        const y = laid.yOf(price);
        root.append(
          svg("line", {
            class: "price-grid",
            x1: String(laid.plotLeft),
            x2: String(laid.plotRight),
            y1: px(y),
            y2: px(y),
          }),
        );
        const tick = svg("text", { class: "price-tick", x: px(laid.plotRight + 6), y: px(y + 4) });
        tick.textContent = input.formatPrice(price);
        root.append(tick);
      }
    }

    for (const line of input.lines) {
      if (!finitePrice(line.price)) {
        continue;
      }
      const y = laid.yOf(line.price);
      root.append(
        svg("line", {
          class: lineClass(line.kind),
          x1: String(laid.plotLeft),
          x2: String(laid.plotRight),
          y1: px(y),
          y2: px(y),
        }),
      );
      const label = svg("text", {
        class: "chart-label",
        x: px(laid.plotRight + 6),
        y: px(y + 4),
      });
      label.textContent = input.formatPrice(line.price);
      root.append(label);
    }

    const current = host.querySelector(":scope > svg.chart-svg");
    if (current instanceof SVGSVGElement) {
      current.replaceWith(root);
    } else {
      host.prepend(root);
    }
  };

  const existing = paints.get(host);
  if (existing === undefined) {
    resizeObserver?.observe(host);
  } else {
    existing.detach();
  }
  const detach = bindGestures(
    host,
    () => ({
      seriesKey: input.seriesKey,
      endIndex: input.endIndex,
      barCount: input.candles.length,
    }),
    paint,
  );
  paints.set(host, { paint, detach });
  paint();
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      if (paints.get(host)?.paint === paint) {
        paint();
      }
    });
  }
}
