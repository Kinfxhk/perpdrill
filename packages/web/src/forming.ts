/**
 * Visual forming for one practice candle.
 *
 * A candle is four prints of prices it already has: the open, the adverse
 * extreme (low when the close is at or above the open, otherwise the high),
 * the favourable extreme, then the real bar. Nothing is interpolated between
 * those prices. The engine still closes the practice bar on its own OHLC;
 * these snapshots are paint only.
 *
 * The first paint is immediate. The other `paintCount - 1` gaps share the whole
 * budget (`budget / (paintCount - 1)`). There is no 16ms floor and no 140ms cap.
 */

export const FORMING_PARTS = 4;

/** One forward step. Play uses the speed interval as the budget instead. */
export const FORMING_STEP_BUDGET_MS = 420;

export type FormingBar = {
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
};

export type FormingState = {
  readonly cursor: number;
  /** Paints already shown for the next bar. `null` when that bar is not previewing. */
  readonly part: number | null;
  readonly playing: boolean;
};

type PrintDirection = "up" | "down";

function printDirection(bar: FormingBar): PrintDirection {
  return bar.close >= bar.open ? "up" : "down";
}

function extremePrice(bar: FormingBar, direction: PrintDirection): number {
  switch (direction) {
    case "up":
      return bar.low;
    case "down":
      return bar.high;
    default: {
      const unexpected: never = direction;
      return unexpected;
    }
  }
}

/** The other end of the bar: the high on an up bar, the low on a down bar. */
function farExtremePrice(bar: FormingBar, direction: PrintDirection): number {
  switch (direction) {
    case "up":
      return bar.high;
    case "down":
      return bar.low;
    default: {
      const unexpected: never = direction;
      return unexpected;
    }
  }
}

function openPrint(bar: FormingBar): FormingBar {
  const open = bar.open;
  return { open, high: open, low: open, close: open };
}

function extremePrint(bar: FormingBar): FormingBar {
  const open = bar.open;
  const extreme = extremePrice(bar, printDirection(bar));
  return {
    open,
    high: Math.max(open, extreme),
    low: Math.min(open, extreme),
    close: extreme,
  };
}

/** Both wicks on screen: the adverse extreme stays, the close reaches the far one. */
function farExtremePrint(bar: FormingBar): FormingBar {
  const first = extremePrint(bar);
  const far = farExtremePrice(bar, printDirection(bar));
  return {
    open: first.open,
    high: Math.max(first.high, far),
    low: Math.min(first.low, far),
    close: far,
  };
}

function fullPrint(bar: FormingBar): FormingBar {
  return { open: bar.open, high: bar.high, low: bar.low, close: bar.close };
}

function formingPrints(bar: FormingBar): readonly FormingBar[] {
  return [openPrint(bar), extremePrint(bar), farExtremePrint(bar), fullPrint(bar)];
}

function aggregatePrints(prints: readonly FormingBar[]): FormingBar {
  const first = prints[0];
  if (first === undefined) {
    throw new RangeError("forming aggregate needs a print");
  }
  let high = first.high;
  let low = first.low;
  let close = first.close;
  for (let index = 1; index < prints.length; index += 1) {
    const print = prints[index];
    if (print === undefined) {
      continue;
    }
    high = Math.max(high, print.high);
    low = Math.min(low, print.low);
    close = print.close;
  }
  return { open: first.open, high, low, close };
}

/** Playing budget is the speed interval. A forward step uses {@link FORMING_STEP_BUDGET_MS}. */
export function formingBudgetMs(playing: boolean, speedMs: number): number {
  if (playing) {
    return speedMs;
  }
  return FORMING_STEP_BUDGET_MS;
}

/**
 * Gap between forming paints. `paintCount - 1` gaps cover `budgetMs` exactly.
 * A single paint has no gap to spend; the divisor stays at least 1 so the
 * formula matches `budget / max(1, paintCount - 1)`.
 */
export function formingGapMs(budgetMs: number, paintCount: number): number {
  if (!Number.isFinite(budgetMs) || budgetMs < 0) {
    throw new RangeError("budget must be a non-negative finite number");
  }
  if (!Number.isInteger(paintCount) || paintCount < 1) {
    throw new RangeError("paint count must be a positive integer");
  }
  return budgetMs / Math.max(1, paintCount - 1);
}

/** Paint times from the start of the bar. The last paint lands on the budget. */
export function formingPaintTimes(
  budgetMs: number,
  paintCount: number = FORMING_PARTS,
): readonly number[] {
  const gap = formingGapMs(budgetMs, paintCount);
  const times: number[] = [];
  for (let index = 0; index < paintCount; index += 1) {
    times.push(index * gap);
  }
  return times;
}

/**
 * Candle after `partsPainted` prints (1 = open, 2 = adverse extreme, 3 = favourable
 * extreme, 4 = the bar). The last snapshot is the bar's own OHLC.
 */
export function formingSnapshot(bar: FormingBar, partsPainted: number): FormingBar {
  if (!Number.isInteger(partsPainted) || partsPainted < 1 || partsPainted > FORMING_PARTS) {
    throw new RangeError(`parts painted must be an integer from 1 to ${FORMING_PARTS}`);
  }
  return aggregatePrints(formingPrints(bar).slice(0, partsPainted));
}

/** Start a preview of `cursor + 1`. A preview already on screen keeps its part. */
export function formingStart(
  state: FormingState,
  lastIndex: number,
  playing: boolean,
): FormingState {
  if (state.cursor >= lastIndex) {
    return { cursor: state.cursor, part: state.part, playing: false };
  }
  if (state.part !== null) {
    return { cursor: state.cursor, part: state.part, playing };
  }
  return { cursor: state.cursor, part: 1, playing };
}

/**
 * One gap elapsed. Parts before the last leave the cursor on the closed bar.
 * The last part closes that next bar. Play starts the following preview immediately.
 */
export function formingStep(state: FormingState, lastIndex: number): FormingState {
  if (state.part === null) {
    return state;
  }
  const nextPart = state.part + 1;
  if (nextPart < FORMING_PARTS) {
    return { cursor: state.cursor, part: nextPart, playing: state.playing };
  }
  const cursor = Math.min(lastIndex, state.cursor + 1);
  const playing = state.playing && cursor < lastIndex;
  return {
    cursor,
    part: playing ? 1 : null,
    playing,
  };
}

/** Forward asks for one bar. A preview already running just stops the chain. */
export function formingRequestStep(state: FormingState, lastIndex: number): FormingState {
  if (state.part !== null) {
    return { cursor: state.cursor, part: state.part, playing: false };
  }
  return formingStart({ cursor: state.cursor, part: null, playing: false }, lastIndex, false);
}

/** Drop an unclosed preview. The cursor stays on the last closed bar. */
export function formingCancel(state: FormingState): FormingState {
  return { cursor: state.cursor, part: null, playing: false };
}
