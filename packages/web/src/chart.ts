import {
  clampViewport,
  indexToCoordinate,
  indicatorIndexSpan,
  pinchZoomScale,
  scrollChartTo,
  showRecentViewport,
  viewportAfterEndChange,
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
  "anchor",
] as const;

export type IndicatorStroke = (typeof INDICATOR_STROKES)[number];

export type ChartOverlay = {
  readonly points: readonly (number | null)[];
  readonly stroke: IndicatorStroke;
  /** False when the study should not widen the price scale, e.g. an anchor from bar 0. */
  readonly fitsScale?: boolean;
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
    case "anchor":
      return "stroke-anchor";
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
  /** Vertical magnification around the window midpoint. 1 fits the visible range. */
  readonly priceScale?: number;
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
  const zoom = zoomedPriceScale(input.priceScale);
  const mid = (low + high) / 2;
  const half = span / 2 / zoom;
  const floorPrice = mid - half;
  const zoomedSpan = half * 2;
  const topMargin = plotHeight * CANDLE_PANE_MARGIN;
  const bottomMargin = plotHeight * CANDLE_PANE_MARGIN;
  const internal = Math.max(1, plotHeight - topMargin - bottomMargin);
  const yOf = (price: number): number => {
    const inv = bottomMargin + ((internal - 1) * (price - floorPrice)) / zoomedSpan;
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
  from: number,
  to: number,
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

  const end = Math.min(to, overlay.points.length - 1);
  for (let index = Math.max(0, from); index <= end; index += 1) {
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
  from: number,
  to: number,
  xOf: (index: number) => number,
  yOf: (price: number) => number,
): void {
  const end = Math.min(to, band.upper.length - 1, band.lower.length - 1);
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

  for (let index = Math.max(0, from); index <= end; index += 1) {
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

type ChartExtent = {
  seriesKey: string;
  endIndex: number;
  barCount: number;
};

type GestureSession = {
  retarget: (read: () => ChartExtent, paint: () => void) => void;
  detach: () => void;
};

type HostChart = {
  seriesKey: string;
  paint: () => void;
  retarget: (read: () => ChartExtent, paint: () => void) => void;
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

/** Series keys with a pointer still down. Playback paints must not shift that pan. */
const activeGestures = new Set<string>();

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

/** Vertical magnification per series. 1 fits the visible price range to the pane. */
const priceZooms = new Map<string, number>();

const MAX_PRICE_ZOOM = 20;
const PRICE_ZOOM_STEP = 1.15;

/** Stored zoom, clamped to [1, MAX_PRICE_ZOOM]. 1 is the fitted view. */
function zoomedPriceScale(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return 1;
  }
  return Math.min(MAX_PRICE_ZOOM, value);
}

/** Stage element already showing this series, so a playback paint can keep its pan. */
export function connectedChartHost(seriesKey: string): HTMLElement | null {
  for (const [host, chart] of paints) {
    if (chart.seriesKey === seriesKey && host.isConnected) {
      return host;
    }
  }
  return null;
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
  if (previous === null || previous.seriesKey !== seriesKey || barCount <= 0 || plotWidth <= 0) {
    const next = showRecentViewport(plotWidth, barCount);
    viewports.set(seriesKey, { seriesKey, endIndex, barCount, ...next });
    return next;
  }
  if (activeGestures.has(seriesKey)) {
    const next = clampViewport(plotWidth, barCount, viewportFrom(previous));
    viewports.set(seriesKey, { seriesKey, endIndex, barCount, ...next });
    return next;
  }
  const stepped = viewportAfterEndChange(
    plotWidth,
    previous.barCount,
    barCount,
    previous.endIndex,
    endIndex,
    viewportFrom(previous),
  );
  const next = stepped ?? showRecentViewport(plotWidth, barCount);
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

type PointerPoint = {
  x: number;
  y: number;
};

function pointerDistance(a: PointerPoint, b: PointerPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function bindGestures(
  host: HTMLElement,
  read: () => ChartExtent,
  paint: () => void,
): GestureSession {
  let currentRead = read;
  let currentPaint = paint;
  const heldKeys = new Set<string>();
  const pointers = new Map<number, PointerPoint>();
  let drag: { startX: number; startOffset: number; spacing: number } | null = null;
  let finger: {
    startX: number;
    startY: number;
    startOffset: number;
    spacing: number;
    mode: "pending" | "pan" | "page";
  } | null = null;
  let pinch: { distance: number; previousScale: number } | null = null;

  const capturePointer = (pointerId: number): void => {
    try {
      host.setPointerCapture(pointerId);
    } catch {
      // The pointer can end before the stage claims it.
    }
  };

  const releasePointer = (pointerId: number): void => {
    try {
      if (host.hasPointerCapture(pointerId)) {
        host.releasePointerCapture(pointerId);
      }
    } catch {
      // Already released with the pointer.
    }
  };

  const remember = (active: boolean): void => {
    const key = currentRead().seriesKey;
    if (active) {
      heldKeys.add(key);
      activeGestures.add(key);
      return;
    }
    for (const held of heldKeys) {
      activeGestures.delete(held);
    }
    heldKeys.clear();
  };

  const releaseGesture = (): void => {
    if (drag !== null || finger !== null || pinch !== null || pointers.size > 0) {
      return;
    }
    remember(false);
  };

  const apply = (view: TimeViewport): void => {
    const ctx = currentRead();
    if (ctx.barCount <= 0) {
      return;
    }
    commitViewport(ctx.seriesKey, ctx.endIndex, ctx.barCount, view);
    currentPaint();
  };

  const onWheel = (event: WheelEvent): void => {
    const ctx = currentRead();
    const current = viewportFor(ctx.seriesKey);
    if ((event.deltaX === 0 && event.deltaY === 0) || current === null) {
      return;
    }
    const rect = host.getBoundingClientRect();
    if (event.clientX - rect.left >= rect.width - PAD_RIGHT) {
      // Over the price axis the wheel scales prices, the way a charting desk does it.
      if (event.cancelable) {
        event.preventDefault();
      }
      const step = event.deltaY < 0 ? PRICE_ZOOM_STEP : 1 / PRICE_ZOOM_STEP;
      priceZooms.set(ctx.seriesKey, zoomedPriceScale((priceZooms.get(ctx.seriesKey) ?? 1) * step));
      currentPaint();
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

  const trackedPair = (): { a: PointerPoint; b: PointerPoint } | null => {
    const points = [...pointers.values()];
    const a = points[0];
    const b = points[1];
    if (a === undefined || b === undefined) {
      return null;
    }
    return { a, b };
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    const current = viewportFor(currentRead().seriesKey);
    if (current === null) {
      return;
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (event.pointerType !== "touch") {
      capturePointer(event.pointerId);
      drag = {
        startX: event.clientX,
        startOffset: current.rightOffset,
        spacing: current.barSpacing,
      };
      if (event.cancelable) {
        event.preventDefault();
      }
    } else if (pointers.size >= 2) {
      const pair = trackedPair();
      if (pair !== null) {
        finger = null;
        drag = null;
        pinch = {
          distance: pointerDistance(pair.a, pair.b),
          previousScale: 1,
        };
        for (const pointerId of pointers.keys()) {
          capturePointer(pointerId);
        }
      }
    } else {
      pinch = null;
      finger = {
        startX: event.clientX,
        startY: event.clientY,
        startOffset: current.rightOffset,
        spacing: current.barSpacing,
        mode: "pending",
      };
      // Claim the stage before the next paint replaces the candle under the finger.
      capturePointer(event.pointerId);
    }
    remember(true);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!pointers.has(event.pointerId)) {
      return;
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pair = trackedPair();
    const current = viewportFor(currentRead().seriesKey);
    if (
      pointers.size >= 2 &&
      pinch !== null &&
      current !== null &&
      pair !== null &&
      pinch.distance > 0
    ) {
      const scale = pointerDistance(pair.a, pair.b) / pinch.distance;
      const zoomScale = pinchZoomScale(scale, pinch.previousScale);
      pinch = { distance: pinch.distance, previousScale: scale };
      const rect = host.getBoundingClientRect();
      const pointX = (pair.a.x + pair.b.x) / 2 - rect.left - PAD_LEFT;
      if (event.cancelable) {
        event.preventDefault();
      }
      apply(
        zoomTime(
          plotWidthOf(host),
          currentRead().barCount,
          viewportFrom(current),
          pointX,
          zoomScale,
        ),
      );
      return;
    }
    if (drag !== null) {
      const ctx = currentRead();
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
      return;
    }
    if (finger === null || pointers.size !== 1) {
      return;
    }
    if (finger.mode === "pending") {
      const xOffset = Math.abs(event.clientX - finger.startX);
      const yOffset = Math.abs(event.clientY - finger.startY);
      if (xOffset + yOffset < TOUCH_SLOP) {
        return;
      }
      // Vertical drag scrolls the page. A horizontal drag pans the bars.
      const mode = yOffset >= xOffset * 0.5 ? "page" : "pan";
      finger = { ...finger, mode };
    }
    switch (finger.mode) {
      case "pending":
      case "page":
        return;
      case "pan": {
        const ctx = currentRead();
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
            event.clientX,
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

  const onPointerUp = (event: PointerEvent): void => {
    if (!pointers.has(event.pointerId) && drag === null && finger === null && pinch === null) {
      return;
    }
    pointers.delete(event.pointerId);
    releasePointer(event.pointerId);
    if (pointers.size === 0) {
      drag = null;
      finger = null;
      pinch = null;
    } else if (pointers.size < 2) {
      pinch = null;
    }
    releaseGesture();
  };

  host.addEventListener("wheel", onWheel, { passive: false });
  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointerup", onPointerUp);
  host.addEventListener("pointercancel", onPointerUp);

  return {
    retarget(nextRead, nextPaint) {
      currentRead = nextRead;
      currentPaint = nextPaint;
    },
    detach() {
      drag = null;
      finger = null;
      pinch = null;
      for (const pointerId of pointers.keys()) {
        releasePointer(pointerId);
      }
      pointers.clear();
      remember(false);
      host.removeEventListener("wheel", onWheel);
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", onPointerUp);
      host.removeEventListener("pointercancel", onPointerUp);
    },
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
    /** Same series keeps the zoom. A new key, or an end that falls by more than one bar, shows recent bars. */
    readonly seriesKey: string;
    /** Index of the last revealed bar, including a forming preview. Grows as playback steps. */
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
      if (overlay.fitsScale === false) {
        continue;
      }
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
      priceScale: priceZooms.get(input.seriesKey) ?? 1,
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

    // Plot coordinates, clipped to the candle pane so a zoomed line cannot cover the price scale.
    const xInPlot = (index: number): number =>
      indexToCoordinate(plotWidth, revealed, timeScale, index);
    const span = indicatorIndexSpan(plotWidth, revealed, timeScale);
    const indicators = svg("svg", {
      class: "indicator-layer",
      x: px(laid.plotLeft),
      y: "0",
      width: px(plotWidth),
      height: px(height),
      overflow: "hidden",
      "aria-hidden": "true",
    });
    for (const band of input.bands) {
      appendBand(indicators, band, span.from, span.to, xInPlot, laid.yOf);
    }
    for (const overlay of input.overlays) {
      appendOverlay(indicators, overlay, span.from, span.to, xInPlot, laid.yOf);
    }
    root.append(indicators);

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

  const read = (): ChartExtent => ({
    seriesKey: input.seriesKey,
    endIndex: input.endIndex,
    barCount: input.candles.length,
  });
  const existing = paints.get(host);
  if (existing === undefined) {
    resizeObserver?.observe(host);
    const session = bindGestures(host, read, paint);
    paints.set(host, {
      seriesKey: input.seriesKey,
      paint,
      retarget: session.retarget,
      detach: session.detach,
    });
  } else {
    existing.retarget(read, paint);
    existing.seriesKey = input.seriesKey;
    existing.paint = paint;
  }
  paint();
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      if (paints.get(host)?.paint === paint) {
        paint();
      }
    });
  }
}
