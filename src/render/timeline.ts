import type { CursorMove } from '../runner/cursor.js';
import type { Viewport } from '../script/types.js';
import type { Point } from '../util/math.js';
import type { Focus } from './camera.js';
import type { CaptionEvent, VoiceoverEvent } from './captions.js';

/** A screenshot of the page. */
export interface Shot {
  file: string;
  url: string;
}

/** From time `t`, show `shot`, cross-fading from the previous shot over `fade` ms. */
export interface PageKey {
  t: number;
  shot: number;
  fade: number;
}

export interface ClickMark {
  t: number;
  x: number;
  y: number;
}

/**
 * Everything recorded from a run, on a virtual clock in milliseconds.
 * Rendering only depends on this data, so output is identical regardless of machine speed.
 */
export interface Timeline {
  viewport: Viewport;
  deviceScaleFactor: number;
  duration: number;
  shots: Shot[];
  pages: PageKey[];
  cursorStart: Point;
  moves: CursorMove[];
  clicks: ClickMark[];
  focuses: Focus[];
  captions: CaptionEvent[];
  voiceovers: VoiceoverEvent[];
}

export interface PageAt {
  shot: number;
  /** Previous shot to blend from, with the opacity of the current shot. */
  from?: { shot: number; alpha: number };
}

/** Which screenshot(s) are visible at time `t`. `pages` must be sorted by time. */
export function pageAt(pages: readonly PageKey[], t: number): PageAt | null {
  let index = -1;
  for (let i = 0; i < pages.length; i++) {
    if ((pages[i] as PageKey).t <= t) index = i;
    else break;
  }
  if (index < 0) return pages.length ? { shot: (pages[0] as PageKey).shot } : null;
  const key = pages[index] as PageKey;
  const prev = pages[index - 1];
  if (prev && key.fade > 0 && t < key.t + key.fade && prev.shot !== key.shot) {
    return { shot: key.shot, from: { shot: prev.shot, alpha: (t - key.t) / key.fade } };
  }
  return { shot: key.shot };
}

export function frameCount(duration: number, fps: number): number {
  return Math.max(1, Math.ceil((duration / 1000) * fps));
}
