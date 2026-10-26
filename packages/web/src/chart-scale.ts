/**
 * Visible-range math for the practice chart.
 *
 * Wheel and pinch zoom the time scale. A horizontal wheel or a drag pans it.
 * The view opens on the last 150 bars, with the logical range ending five bars
 * past the last one. Bar spacing changes by `scale * spacing / 10` around the
 * cursor, and a horizontal wheel scrolls by `deltaX * -80` pixels. Price stays
 * auto-scaled. Those are the lightweight-charts 5 time-scale rules.
 */

export type TimeViewport = {
  readonly barSpacing: number;
  readonly rightOffset: number;
};

/** Bars kept in view when the chart first opens, unless fewer are revealed. */
export const PRACTICE_RECENT_BARS = 150;

/** Empty bars after the last revealed bar in the opening range. */
export const PRACTICE_RIGHT_MARGIN_BARS = 5;

/** lightweight-charts default `minBarSpacing`. */
const MIN_BAR_SPACING = 0.5;

/** lightweight-charts `MinVisibleBarsCount`. */
const MIN_VISIBLE_BARS = 2;

const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

/** Horizontal wheel coefficient inside lightweight-charts `scrollChart`. */
const WHEEL_SCROLL_PIXELS = 80;

export type LogicalBorders = {
  readonly from: number;
  readonly to: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampViewport(
  plotWidth: number,
  barCount: number,
  view: TimeViewport,
): TimeViewport {
  if (plotWidth <= 0 || barCount <= 0 || !Number.isFinite(view.barSpacing)) {
    return view;
  }
  const barSpacing = clamp(view.barSpacing, MIN_BAR_SPACING, plotWidth * 0.5);
  const minOffset = -barCount + Math.min(MIN_VISIBLE_BARS, barCount);
  const maxOffset = plotWidth / barSpacing - Math.min(MIN_VISIBLE_BARS, barCount);
  return {
    barSpacing,
    rightOffset: clamp(view.rightOffset, minOffset, maxOffset),
  };
}

/** Initial practice view: last 150 bars, with 5 bars of space on the right. */
export function showRecentViewport(plotWidth: number, barCount: number): TimeViewport {
  if (barCount <= 0 || plotWidth <= 0) {
    return { barSpacing: 6, rightOffset: 8 };
  }
  const from = Math.max(0, barCount - PRACTICE_RECENT_BARS);
  const to = barCount + PRACTICE_RIGHT_MARGIN_BARS;
  const length = to - from + 1;
  return clampViewport(plotWidth, barCount, {
    barSpacing: plotWidth / length,
    rightOffset: to - (barCount - 1),
  });
}

export function logicalBorders(
  plotWidth: number,
  barCount: number,
  view: TimeViewport,
): LogicalBorders {
  const baseIndex = barCount - 1;
  const barsLength = plotWidth / view.barSpacing;
  const to = view.rightOffset + baseIndex;
  return { from: to - barsLength + 1, to };
}

export function lastBarVisible(plotWidth: number, barCount: number, view: TimeViewport): boolean {
  if (barCount <= 0 || plotWidth <= 0 || view.barSpacing <= 0) {
    return false;
  }
  const borders = logicalBorders(plotWidth, barCount, view);
  const baseIndex = barCount - 1;
  return Math.floor(borders.from) <= baseIndex && baseIndex <= Math.ceil(borders.to);
}

export function visibleIndexRange(
  plotWidth: number,
  barCount: number,
  view: TimeViewport,
): { readonly from: number; readonly to: number } {
  if (barCount <= 0 || plotWidth <= 0 || view.barSpacing <= 0) {
    return { from: 0, to: -1 };
  }
  const borders = logicalBorders(plotWidth, barCount, view);
  return {
    from: Math.max(0, Math.floor(borders.from)),
    to: Math.min(barCount - 1, Math.ceil(borders.to)),
  };
}

/**
 * Keep the same candles on screen when revealed history grows.
 * If the last bar is in view, the right offset stays put so playback follows
 * the new bar (`shiftVisibleRangeOnNewBar`). Otherwise the offset steps back
 * by the number of bars added.
 */
export function advanceViewport(
  plotWidth: number,
  previousCount: number,
  nextCount: number,
  addedBars: number,
  view: TimeViewport,
): TimeViewport {
  let rightOffset = view.rightOffset;
  if (addedBars > 0 && previousCount > 0 && !lastBarVisible(plotWidth, previousCount, view)) {
    rightOffset -= addedBars;
  }
  return clampViewport(plotWidth, nextCount, { barSpacing: view.barSpacing, rightOffset });
}

export function indexToCoordinate(
  plotWidth: number,
  barCount: number,
  view: TimeViewport,
  index: number,
): number {
  const baseIndex = Math.max(0, barCount - 1);
  const deltaFromRight = baseIndex + view.rightOffset - index;
  return plotWidth - (deltaFromRight + 0.5) * view.barSpacing - 1;
}

export function coordinateToFloatIndex(
  plotWidth: number,
  barCount: number,
  view: TimeViewport,
  x: number,
): number {
  const deltaFromRight = (plotWidth - 1 - x) / view.barSpacing;
  const index = Math.max(0, barCount - 1) + view.rightOffset - deltaFromRight;
  return Math.round(index * 1_000_000) / 1_000_000;
}

/** Zoom the time scale around `pointX`. Positive `scale` zooms in. */
export function zoomTime(
  plotWidth: number,
  barCount: number,
  view: TimeViewport,
  pointX: number,
  scale: number,
): TimeViewport {
  if (barCount <= 0 || plotWidth <= 0 || scale === 0 || view.barSpacing <= 0) {
    return view;
  }
  const x = Math.max(1, Math.min(pointX, plotWidth));
  const before = coordinateToFloatIndex(plotWidth, barCount, view, x);
  const spaced = clampViewport(plotWidth, barCount, {
    barSpacing: view.barSpacing + scale * (view.barSpacing / 10),
    rightOffset: view.rightOffset,
  });
  const after = coordinateToFloatIndex(plotWidth, barCount, spaced, x);
  return clampViewport(plotWidth, barCount, {
    barSpacing: spaced.barSpacing,
    rightOffset: spaced.rightOffset + (before - after),
  });
}

/** `scrollChart`: positive `pixelDelta` moves the view toward older bars. */
export function scrollChart(
  plotWidth: number,
  barCount: number,
  view: TimeViewport,
  pixelDelta: number,
): TimeViewport {
  if (barCount <= 0 || plotWidth <= 0 || view.barSpacing <= 0) {
    return view;
  }
  return clampViewport(plotWidth, barCount, {
    barSpacing: view.barSpacing,
    rightOffset: view.rightOffset - pixelDelta / view.barSpacing,
  });
}

/** Drag: `rightOffset` shifts by `(startX - x) / barSpacing`. */
export function scrollChartTo(
  plotWidth: number,
  barCount: number,
  barSpacing: number,
  startRightOffset: number,
  startX: number,
  x: number,
): TimeViewport {
  return scrollChart(
    plotWidth,
    barCount,
    { barSpacing, rightOffset: startRightOffset },
    x - startX,
  );
}

export function wheelSpeedAdjustment(
  deltaMode: number,
  windowsChrome: boolean,
  devicePixelRatio: number,
): number {
  if (deltaMode === DOM_DELTA_PAGE) {
    return 120;
  }
  if (deltaMode === DOM_DELTA_LINE) {
    return 32;
  }
  if (!windowsChrome) {
    return 1;
  }
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) {
    return 1;
  }
  return 1 / devicePixelRatio;
}

export function wheelChartDeltas(input: {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly windowsChrome: boolean;
  readonly devicePixelRatio: number;
}): { readonly deltaX: number; readonly deltaY: number } {
  const speed = wheelSpeedAdjustment(input.deltaMode, input.windowsChrome, input.devicePixelRatio);
  return {
    deltaX: (speed * input.deltaX) / 100,
    deltaY: -(speed * input.deltaY) / 100,
  };
}

/** Scale passed to `zoomTime` for one wheel notch. Clamped to ±1. */
export function wheelZoomScale(deltaY: number): number {
  return Math.sign(deltaY) * Math.min(1, Math.abs(deltaY));
}

/**
 * Pinch scale is the finger distance relative to the gesture start.
 * lightweight-charts applies `(scale - previousScale) * 5` on each move.
 */
export function pinchZoomScale(scale: number, previousScale: number): number {
  return (scale - previousScale) * 5;
}

/**
 * One wheel event after `wheelChartDeltas`: vertical delta zooms, horizontal
 * delta scrolls. Both can apply together (trackpad).
 */
export function viewportAfterWheel(
  plotWidth: number,
  barCount: number,
  view: TimeViewport,
  pointX: number,
  deltas: { readonly deltaX: number; readonly deltaY: number },
): TimeViewport {
  let next = view;
  if (deltas.deltaY !== 0) {
    next = zoomTime(plotWidth, barCount, next, pointX, wheelZoomScale(deltas.deltaY));
  }
  if (deltas.deltaX !== 0) {
    next = scrollChart(plotWidth, barCount, next, deltas.deltaX * -WHEEL_SCROLL_PIXELS);
  }
  return next;
}
