/**
 * Pure 3-2-1 intro for a practice session.
 * The desk owns the timer and the overlay. Skip and the last step may start
 * playback. Cancel only ends the intro.
 */

export const PRACTICE_INTRO_MS = 1_000;

export interface PracticeIntro {
  /** 3, 2, or 1 while the intro is up. Null once it has ended. */
  readonly number: number | null;
}

export function idlePracticeIntro(): PracticeIntro {
  return { number: null };
}

export function startPracticeIntro(): PracticeIntro {
  return { number: 3 };
}

export function stepPracticeIntro(intro: PracticeIntro): { intro: PracticeIntro; play: boolean } {
  const number = intro.number;
  if (number === null) {
    return { intro, play: false };
  }
  if (number <= 1) {
    return { intro: idlePracticeIntro(), play: true };
  }
  return { intro: { number: number - 1 }, play: false };
}

/** End the intro and let playback start. */
export function skipPracticeIntro(intro: PracticeIntro): { intro: PracticeIntro; play: boolean } {
  if (intro.number === null) {
    return { intro, play: false };
  }
  return { intro: idlePracticeIntro(), play: true };
}

/** End the intro because the player left. Playback must not start. */
export function cancelPracticeIntro(intro: PracticeIntro): PracticeIntro {
  if (intro.number === null) {
    return intro;
  }
  return idlePracticeIntro();
}
