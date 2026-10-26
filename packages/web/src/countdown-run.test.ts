import { describe, expect, it } from "vitest";
import {
  PRACTICE_INTRO_MS,
  cancelPracticeIntro,
  skipPracticeIntro,
  startPracticeIntro,
  stepPracticeIntro,
} from "./countdown-run.ts";

describe("practice intro", () => {
  it("counts 3, 2, 1 and then allows playback", () => {
    expect(PRACTICE_INTRO_MS).toBe(1_000);
    const intro = startPracticeIntro();
    expect(intro.number).toBe(3);

    let stepped = stepPracticeIntro(intro);
    expect(stepped.play).toBe(false);
    expect(stepped.intro.number).toBe(2);

    stepped = stepPracticeIntro(stepped.intro);
    expect(stepped.play).toBe(false);
    expect(stepped.intro.number).toBe(1);

    stepped = stepPracticeIntro(stepped.intro);
    expect(stepped.play).toBe(true);
    expect(stepped.intro.number).toBeNull();

    stepped = stepPracticeIntro(stepped.intro);
    expect(stepped.play).toBe(false);
    expect(stepped.intro.number).toBeNull();
  });

  it("skip starts playback from any visible number", () => {
    const skipped = skipPracticeIntro(startPracticeIntro());
    expect(skipped.play).toBe(true);
    expect(skipped.intro.number).toBeNull();
    expect(skipPracticeIntro(skipped.intro).play).toBe(false);
  });

  it("cancel ends the intro without a play signal", () => {
    const cancelled = cancelPracticeIntro(startPracticeIntro());
    expect(cancelled.number).toBeNull();
    expect(stepPracticeIntro(cancelled).play).toBe(false);
    expect(skipPracticeIntro(cancelled).play).toBe(false);
  });
});
