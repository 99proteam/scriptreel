import { createRng } from '../util/math.js';

export interface TypingOptions {
  /** Average delay between keystrokes in ms. */
  baseDelay?: number;
  /** Maximum random variation (+/-) in ms. */
  jitter?: number;
  speed?: number;
  rng?: () => number;
}

/**
 * Times (ms, relative to the start of typing) at which each character appears.
 * Natural rhythm: random variation, short pauses after spaces and punctuation.
 */
export function typingSchedule(text: string, options: TypingOptions = {}): number[] {
  const base = options.baseDelay ?? 70;
  const jitter = options.jitter ?? 30;
  const speed = options.speed ?? 1;
  const rng = options.rng ?? createRng(7);
  const times: number[] = [];
  let t = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    const prev = i > 0 ? (text[i - 1] as string) : '';
    let delay = base + (rng() * 2 - 1) * jitter;
    if (prev === ' ') delay += base * 0.4;
    if (/[.,!?;:@]/.test(prev)) delay += base * 0.8;
    if (ch === ch.toUpperCase() && ch !== ch.toLowerCase()) delay += base * 0.25;
    t += i === 0 ? 0 : Math.max(15, delay) / speed;
    times.push(Math.round(t));
  }
  return times;
}
