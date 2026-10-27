import {
  clampViewport,
  coordinateToFloatIndex,
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
export const CANDLE_PANE_MARGIN = 0.05;

/**
 * A horizontal drawing (entry, liquidation, floor, stop, target) may stretch the price
 * scale at most this share of the visible candle range on each side. A risk line further
 * away is clipped instead of flattening the candles into a strip.
 */
export const LINE_SCALE_REACH = 0.15;

export type PriceRange = {
  readonly low: number;
  readonly high: number;
};

/** Highest high and lowest low of the revealed bars inside `visible`. */
export function visibleCandleRange(
  candles: readonly Candle[],
  visible: { readonly from: number; readonly to: number },
): PriceRange | null {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  const end = Math.min(visible.to, candles.length - 1);
  for (let index = Math.max(0, visible.from); index <= end; index += 1) {
    const candle = candles[index];
    if (candle === undefined) {
      continue;
    }
    for (const price of [candle.high, candle.low]) {
      if (Number.isFinite(price)) {
        low = Math.min(low, price);
        high = Math.max(high, price);
      }
    }
  }
  return low <= high ? { low, high } : null;
}

/** True when a drawing sits close enough to the candles to join the price scale. */
export function withinPriceReach(range: PriceRange | null, price: number): boolean {
  if (range === null) {
    return true;
  }
  const span = range.high - range.low || Math.abs(range.high) * 0.01 || 1;
  return (
    price >= range.low - span * LINE_SCALE_REACH && price <= range.high + span * LINE_SCALE_REACH
  );
}

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
  readonly priceOf: (y: number) => number;
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
  // The bottom band always leaves room for the time labels under the candles.
  const bottomMargin = Math.max(plotHeight * CANDLE_PANE_MARGIN, 16);
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

  /** Inverse of yOf: the price under a pane y coordinate, clamped nowhere. */
  const priceOf = (y: number): number => {
    const inv = plotHeight - 1 - y;
    return floorPrice + ((inv - bottomMargin) * zoomedSpan) / (internal - 1);
  };

  return { candles: laid, yOf, priceOf, plotLeft, plotRight: plotLeft + plotWidth };
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

/** Stored zoom, clamped to [1, MAX_PRICE_ZOOM]. 1 is the fitted view. */
function zoomedPriceScale(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return 1;
  }
  return Math.min(MAX_PRICE_ZOOM, value);
}

/** Wheel travel per unit of magnification. A 120-delta notch is about 1.075x. */
const PRICE_ZOOM_PER_DELTA = 0.0006;

/** Axis drag travel per unit of magnification, in pixels. */
const PRICE_ZOOM_PER_PIXEL = 0.004;

/** Continuous price magnification from a wheel delta; small deltas stay fine-grained. */
export function priceZoomAfterWheel(zoom: number, deltaY: number): number {
  return zoomedPriceScale(zoomedPriceScale(zoom) * Math.exp(-deltaY * PRICE_ZOOM_PER_DELTA));
}

/** Magnification from dragging the price axis: up magnifies, down returns toward the fit. */
export function priceZoomAfterDrag(startZoom: number, startY: number, currentY: number): number {
  return zoomedPriceScale(
    zoomedPriceScale(startZoom) * Math.exp((startY - currentY) * PRICE_ZOOM_PER_PIXEL),
  );
}

/** Pointer over the price axis, not the plot. */
function onPriceAxis(host: HTMLElement, clientX: number): boolean {
  const rect = host.getBoundingClientRect();
  return clientX - rect.left >= rect.width - PAD_RIGHT;
}

/** Mapping the last paint left behind, so the crosshair can read prices without a repaint. */
type ChartGeometry = {
  readonly plotWidth: number;
  readonly revealed: number;
  readonly timeScale: TimeViewport;
  readonly priceOf: (y: number) => number;
  readonly candles: readonly Candle[];
  readonly times: readonly number[] | undefined;
};

const chartGeometries = new WeakMap<HTMLElement, ChartGeometry>();

type CrosshairLayer = {
  readonly root: HTMLElement;
  readonly vertical: HTMLElement;
  readonly horizontal: HTMLElement;
  readonly priceTag: HTMLElement;
  readonly timeTag: HTMLElement;
  readonly readout: HTMLElement;
};

function childDiv(parent: HTMLElement, className: string): HTMLElement {
  const node = document.createElement("div");
  node.className = className;
  parent.append(node);
  return node;
}

/** Crosshair, axis tags and the OHLC readout. The desk strips chrome before a mount. */
function ensureCrosshair(host: HTMLElement): CrosshairLayer {
  let root = host.querySelector<HTMLElement>(":scope > .crosshair");
  if (root === null) {
    root = document.createElement("div");
    root.className = "crosshair";
    root.hidden = true;
    root.setAttribute("aria-hidden", "true");
    childDiv(root, "crosshair-v");
    childDiv(root, "crosshair-h");
    childDiv(root, "crosshair-price");
    childDiv(root, "crosshair-time");
    host.append(root);
  }
  let readout = host.querySelector<HTMLElement>(":scope > .chart-ohlc");
  if (readout === null) {
    readout = document.createElement("div");
    readout.className = "chart-ohlc";
    readout.hidden = true;
    host.append(readout);
  }
  const part = (selector: string): HTMLElement => {
    const node = root.querySelector<HTMLElement>(selector);
    if (node === null) {
      throw new Error(`crosshair part missing: ${selector}`);
    }
    return node;
  };
  return {
    root,
    vertical: part(".crosshair-v"),
    horizontal: part(".crosshair-h"),
    priceTag: part(".crosshair-price"),
    timeTag: part(".crosshair-time"),
    readout,
  };
}

/** Hide the crosshair lines. The readout keeps showing the last bar, as a desk does. */
function hideCrosshair(layer: CrosshairLayer): void {
  layer.root.hidden = true;
}

/** OHLC readout for one bar, green or red from that bar's own direction. */
function updateReadout(
  layer: CrosshairLayer,
  candles: readonly Candle[],
  index: number,
  formatPrice: (price: number) => string,
  compact: boolean,
): void {
  const candle = candles[index];
  if (candle === undefined) {
    layer.readout.hidden = true;
    return;
  }
  const previous = candles[index - 1]?.close ?? candle.open;
  const change = previous === 0 ? 0 : ((candle.close - previous) / previous) * 100;
  const sign = change >= 0 ? "+" : "";
  layer.readout.hidden = false;
  layer.readout.className = candle.close >= candle.open ? "chart-ohlc is-up" : "chart-ohlc is-down";
  const parts = [
    `O ${formatPrice(candle.open)}`,
    `H ${formatPrice(candle.high)}`,
    `L ${formatPrice(candle.low)}`,
    `C ${formatPrice(candle.close)}`,
  ];
  if (!compact) {
    parts.push(`${sign}${change.toFixed(2)}%`);
  }
  layer.readout.textContent = parts.join(compact ? "  " : "   ");
}

/** Place the crosshair, its axis tags and the OHLC readout under the pointer. */
function placeCrosshair(
  host: HTMLElement,
  layer: CrosshairLayer,
  geometry: ChartGeometry,
  clientX: number,
  clientY: number,
  formatPrice: (price: number) => string,
  formatTime: ((timeMs: number) => string) | undefined,
): void {
  const rect = host.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const lastIndex = Math.max(0, geometry.revealed - 1);
  if (localX < PAD_LEFT || localX > rect.width - PAD_RIGHT || localY < 0 || localY > rect.height) {
    hideCrosshair(layer);
    updateReadout(layer, geometry.candles, lastIndex, formatPrice, rect.width < 520);
    return;
  }
  const rawIndex = Math.round(
    coordinateToFloatIndex(
      geometry.plotWidth,
      geometry.revealed,
      geometry.timeScale,
      localX - PAD_LEFT,
    ),
  );
  const index = Math.min(lastIndex, Math.max(0, rawIndex));
  const candle = geometry.candles[index];
  if (candle === undefined) {
    hideCrosshair(layer);
    updateReadout(layer, geometry.candles, lastIndex, formatPrice, rect.width < 520);
    return;
  }
  const x =
    indexToCoordinate(geometry.plotWidth, geometry.revealed, geometry.timeScale, index) + PAD_LEFT;
  layer.root.hidden = false;
  layer.vertical.style.transform = `translate(${px(x)}px, 0)`;
  layer.horizontal.style.left = `${px(PAD_LEFT)}px`;
  layer.horizontal.style.width = `${px(geometry.plotWidth)}px`;
  layer.horizontal.style.transform = `translate(0, ${px(localY)}px)`;
  layer.priceTag.style.transform = `translate(0, ${px(localY - 9)}px)`;
  layer.priceTag.textContent = formatPrice(geometry.priceOf(localY));
  const timeMs = geometry.times?.[index];
  if (timeMs !== undefined && formatTime !== undefined) {
    layer.timeTag.hidden = false;
    layer.timeTag.style.transform = `translate(${px(x)}px, 0)`;
    layer.timeTag.textContent = formatTime(timeMs);
  } else {
    layer.timeTag.hidden = true;
  }
  updateReadout(layer, geometry.candles, index, formatPrice, rect.width < 520);
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
  formatters: () => {
    readonly formatPrice: (price: number) => string;
    readonly formatTime?: ((timeMs: number) => string) | undefined;
  },
): GestureSession {
  let currentRead = read;
  let currentPaint = paint;
  const heldKeys = new Set<string>();
  const pointers = new Map<number, PointerPoint>();
  let drag: { startX: number; startOffset: number; spacing: number } | null = null;
  let priceDrag: { startY: number; startZoom: number } | null = null;
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
      const zoom = priceZoomAfterWheel(priceZooms.get(ctx.seriesKey) ?? 1, event.deltaY);
      priceZooms.set(ctx.seriesKey, zoom);
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
    if (event.pointerType !== "touch" && onPriceAxis(host, event.clientX)) {
      // Dragging the price axis scales prices, the way a charting desk does it.
      const current = viewportFor(currentRead().seriesKey);
      if (current === null) {
        return;
      }
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      capturePointer(event.pointerId);
      priceDrag = {
        startY: event.clientY,
        startZoom: priceZooms.get(currentRead().seriesKey) ?? 1,
      };
      if (event.cancelable) {
        event.preventDefault();
      }
      remember(true);
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
    if (priceDrag === null && event.pointerType !== "touch") {
      host.style.cursor = onPriceAxis(host, event.clientX) ? "ns-resize" : "";
    }
    if (!pointers.has(event.pointerId)) {
      return;
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (priceDrag !== null) {
      priceZooms.set(
        currentRead().seriesKey,
        priceZoomAfterDrag(priceDrag.startZoom, priceDrag.startY, event.clientY),
      );
      currentPaint();
      return;
    }
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
    if (
      !pointers.has(event.pointerId) &&
      drag === null &&
      priceDrag === null &&
      finger === null &&
      pinch === null
    ) {
      return;
    }
    pointers.delete(event.pointerId);
    releasePointer(event.pointerId);
    if (pointers.size === 0) {
      drag = null;
      priceDrag = null;
      finger = null;
      pinch = null;
    } else if (pointers.size < 2) {
      pinch = null;
    }
    releaseGesture();
  };

  /** Double-click the axis to fit prices again; double-click the plot to re-fit the time scale. */
  const onDoubleClick = (event: MouseEvent): void => {
    const ctx = currentRead();
    if (onPriceAxis(host, event.clientX)) {
      priceZooms.set(ctx.seriesKey, 1);
      currentPaint();
      return;
    }
    const plotWidth = plotWidthOf(host);
    if (plotWidth > 0 && ctx.barCount > 0) {
      commitViewport(
        ctx.seriesKey,
        ctx.endIndex,
        ctx.barCount,
        showRecentViewport(plotWidth, ctx.barCount),
      );
      currentPaint();
    }
  };

  /** Crosshair follows a mouse or pen; touch drags the chart instead. */
  const onHover = (event: PointerEvent): void => {
    if (event.pointerType === "touch" || priceDrag !== null || drag !== null || finger !== null) {
      return;
    }
    const geometry = chartGeometries.get(host);
    if (geometry === undefined) {
      return;
    }
    const { formatPrice, formatTime } = formatters();
    placeCrosshair(
      host,
      ensureCrosshair(host),
      geometry,
      event.clientX,
      event.clientY,
      formatPrice,
      formatTime,
    );
  };

  const onLeave = (): void => {
    const layer = ensureCrosshair(host);
    hideCrosshair(layer);
    const geometry = chartGeometries.get(host);
    if (geometry !== undefined) {
      updateReadout(
        layer,
        geometry.candles,
        Math.max(0, geometry.revealed - 1),
        formatters().formatPrice,
        host.clientWidth < 520,
      );
    }
    if (priceDrag === null) {
      host.style.cursor = "";
    }
  };

  host.addEventListener("wheel", onWheel, { passive: false });
  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointermove", onHover);
  host.addEventListener("pointerleave", onLeave);
  host.addEventListener("pointerup", onPointerUp);
  host.addEventListener("pointercancel", onPointerUp);
  host.addEventListener("dblclick", onDoubleClick);

  return {
    retarget(nextRead, nextPaint) {
      currentRead = nextRead;
      currentPaint = nextPaint;
    },
    detach() {
      drag = null;
      priceDrag = null;
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
      host.removeEventListener("pointermove", onHover);
      host.removeEventListener("pointerleave", onLeave);
      host.removeEventListener("pointerup", onPointerUp);
      host.removeEventListener("pointercancel", onPointerUp);
      host.removeEventListener("dblclick", onDoubleClick);
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
    /** Bar timestamps, one per candle, for the crosshair time tag. */
    readonly times?: readonly number[];
    /** Last closed bar. A forming preview bar is not what the idle readout should show. */
    readonly latestClosedIndex?: number | undefined;
    readonly formatTime?: ((timeMs: number) => string) | undefined;
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
    const candleRange = visibleCandleRange(input.candles, visible);
    const extraPrices = input.lines
      .map((line) => line.price)
      .filter((price) => withinPriceReach(candleRange, price));
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
    chartGeometries.set(host, {
      plotWidth,
      revealed,
      timeScale,
      priceOf: laid.priceOf,
      candles: input.candles,
      times: input.times,
    });
    // Idle panes show the latest bar; a hovering pointer owns the readout.
    if (!host.matches(":hover")) {
      updateReadout(
        ensureCrosshair(host),
        input.candles,
        input.latestClosedIndex ?? input.candles.length - 1,
        input.formatPrice,
        width < 520,
      );
    }
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

    const lastBar = input.candles[input.candles.length - 1];
    if (lastBar !== undefined && finitePrice(lastBar.close)) {
      // Live price line: it moves as the forming candle prints, the way a desk shows it.
      const y = laid.yOf(lastBar.close);
      const up = lastBar.close >= lastBar.open;
      root.append(
        svg("line", {
          class: up ? "last-price is-up" : "last-price is-down",
          x1: String(laid.plotLeft),
          x2: String(laid.plotRight),
          y1: px(y),
          y2: px(y),
        }),
      );
      root.append(
        svg("rect", {
          class: up ? "last-price-tag is-up" : "last-price-tag is-down",
          x: px(laid.plotRight + 1),
          y: px(y - 8),
          width: String(PAD_RIGHT - 1),
          height: "16",
          rx: "3",
        }),
      );
      const tag = svg("text", {
        class: "last-price-text",
        x: px(laid.plotRight + 6),
        y: px(y + 4),
      });
      tag.textContent = input.formatPrice(lastBar.close);
      root.append(tag);
    }

    if (input.times !== undefined && input.formatTime !== undefined) {
      // Time labels along the bottom edge, spaced so they never collide.
      const minGap = 76;
      const step = Math.max(1, Math.ceil(minGap / Math.max(1, timeScale.barSpacing)));
      for (let index = visible.from; index <= Math.min(visible.to, revealed - 1); index += step) {
        const timeMs = input.times[index];
        if (timeMs === undefined) {
          continue;
        }
        const x = indexToCoordinate(plotWidth, revealed, timeScale, index) + laid.plotLeft;
        if (x < laid.plotLeft + 8 || x > laid.plotRight - 8) {
          continue;
        }
        const tick = svg("text", {
          class: "time-tick",
          x: px(x),
          y: px(height - 6),
          "text-anchor": "middle",
        });
        tick.textContent = input.formatTime(timeMs);
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
    const session = bindGestures(host, read, paint, () => input);
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
