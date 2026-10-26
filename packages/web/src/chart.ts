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

const SVG_NS = "http://www.w3.org/2000/svg";

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

export function mountChart(
  host: HTMLElement,
  input: {
    readonly candles: readonly Candle[];
    readonly lines: readonly ChartLine[];
    readonly label: string;
    readonly formatPrice: (price: number) => string;
  },
): void {
  const width = 640;
  const height = 360;
  const padLeft = 12;
  const padRight = 72;
  const padTop = 16;
  const padBottom = 16;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const prices: number[] = [];
  for (const candle of input.candles) {
    prices.push(candle.high, candle.low);
  }
  for (const line of input.lines) {
    if (Number.isFinite(line.price)) {
      prices.push(line.price);
    }
  }
  const low = prices.length === 0 ? 0 : Math.min(...prices);
  const high = prices.length === 0 ? 1 : Math.max(...prices);
  const span = high - low || 1;
  const yMin = low - span * 0.08;
  const yMax = high + span * 0.08;
  const yOf = (price: number): number => {
    const ratio = (price - yMin) / (yMax - yMin);
    return padTop + (1 - ratio) * plotHeight;
  };

  const root = svg("svg", {
    class: "chart-svg",
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": input.label,
  });

  const count = Math.max(input.candles.length, 1);
  const slot = plotWidth / count;
  input.candles.forEach((candle, index) => {
    const previous = index === 0 ? candle.open : input.candles[index - 1]?.close;
    const up = candle.close >= (previous ?? candle.open);
    const x = padLeft + index * slot + slot / 2;
    root.append(
      svg("line", {
        class: "wick",
        x1: String(x),
        x2: String(x),
        y1: String(yOf(candle.high)),
        y2: String(yOf(candle.low)),
      }),
    );
    const bodyTop = yOf(Math.max(candle.open, candle.close));
    const bodyBottom = yOf(Math.min(candle.open, candle.close));
    const bodyHeight = Math.max(1, bodyBottom - bodyTop);
    root.append(
      svg("rect", {
        class: up ? "candle-up" : "candle-down",
        x: String(x - Math.max(2, slot * 0.28)),
        y: String(bodyTop),
        width: String(Math.max(4, slot * 0.56)),
        height: String(bodyHeight),
        rx: "1",
      }),
    );
  });

  for (const line of input.lines) {
    if (!Number.isFinite(line.price)) {
      continue;
    }
    const y = yOf(line.price);
    root.append(
      svg("line", {
        class: lineClass(line.kind),
        x1: String(padLeft),
        x2: String(padLeft + plotWidth),
        y1: String(y),
        y2: String(y),
      }),
    );
    const label = svg("text", {
      class: "chart-label",
      x: String(padLeft + plotWidth + 6),
      y: String(y + 4),
    });
    label.textContent = input.formatPrice(line.price);
    root.append(label);
  }

  host.replaceChildren(root);
}
