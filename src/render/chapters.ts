import type { CaptionEvent } from './captions.js';

export interface Chapter {
  /** Start time in ms. */
  start: number;
  title: string;
}

/** YouTube ignores chapters shorter than 10 seconds (and needs at least three of them). */
export const YOUTUBE_MIN_CHAPTER_MS = 10_000;

/**
 * Turn caption changes into chapters. The first chapter always starts at 0:00, repeated
 * captions are merged, and a chapter that would be shorter than `minLength` is folded into
 * the one before it (the last chapter too).
 */
export function buildChapters(events: readonly CaptionEvent[], totalDuration: number, minLength = 0): Chapter[] {
  const sorted = [...events].filter((e) => e.text?.trim() && e.t < totalDuration).sort((a, b) => a.t - b.t);
  const chapters: Chapter[] = [];
  for (const ev of sorted) {
    const title = (ev.text as string).replace(/\s+/g, ' ').trim();
    const prev = chapters.at(-1);
    if (prev && (prev.title === title || ev.t - prev.start < minLength)) continue;
    chapters.push({ start: prev ? ev.t : 0, title });
  }
  const last = chapters.at(-1);
  if (chapters.length > 1 && last && totalDuration - last.start < minLength) chapters.pop();
  return chapters;
}

/** `m:ss`, or `h:mm:ss` for videos an hour or longer, as YouTube expects. */
export function formatChapterTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Chapter list to paste into a YouTube description. */
export function toYouTubeChapters(chapters: readonly Chapter[]): string {
  return chapters.map((c) => `${formatChapterTime(c.start)} ${c.title}`).join('\n') + '\n';
}

/** ffmpeg metadata file that embeds the chapters in MP4/WebM output (shown by VLC, QuickTime, mpv…). */
export function toFfmetadata(chapters: readonly Chapter[], totalDuration: number): string {
  const escape = (s: string) => s.replace(/[=;#\\\n]/g, (c) => `\\${c}`);
  const blocks = chapters.map((c, i) => {
    const end = Math.round(chapters[i + 1]?.start ?? totalDuration);
    return `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(c.start)}\nEND=${end}\ntitle=${escape(c.title)}\n`;
  });
  return `;FFMETADATA1\n${blocks.join('')}`;
}
