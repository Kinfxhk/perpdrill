export type Candle = {
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
};

export type ChartLineKind = "entry" | "liq" | "fail" | "daily";

export type ChartLine = {
  readonly price: number;
  readonly kind: ChartLineKind;
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
    default: {
      const unexpected: never = kind;
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
  for (const candle of input.candles) {
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
  const barSpacing = count === 0 ? plotWidth : plotWidth / count;
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
    const center = (index + 0.5) * barSpacing;
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

let activeHost: HTMLElement | null = null;
let activePaint: (() => void) | null = null;
const resizeObserver =
  typeof ResizeObserver === "undefined"
    ? null
    : new ResizeObserver(() => {
        activePaint?.();
      });

export function mountChart(
  host: HTMLElement,
  input: {
    readonly candles: readonly Candle[];
    readonly lines: readonly ChartLine[];
    readonly label: string;
    readonly formatPrice: (price: number) => string;
  },
): void {
  const paint = (): void => {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (width < 2 || height < 2) {
      return;
    }
    const ratio = deviceRatio(window.devicePixelRatio);
    const padLeft = 12;
    const padRight = 72;
    const laid = layoutCandles({
      candles: input.candles,
      width,
      height,
      padLeft,
      padRight,
      pixelRatio: ratio,
      extraPrices: input.lines.map((line) => line.price),
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

  if (resizeObserver !== null && activeHost !== host) {
    if (activeHost !== null) {
      resizeObserver.unobserve(activeHost);
    }
    resizeObserver.observe(host);
    activeHost = host;
  }
  activePaint = paint;
  paint();
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      if (activePaint === paint) {
        paint();
      }
    });
  }
}
