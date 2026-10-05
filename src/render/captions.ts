/** A caption change at time `t`: new text, or null to hide. */
export interface CaptionEvent {
  t: number;
  text: string | null;
  /** If set, the caption hides after this many ms. */
  duration?: number;
}

export interface CaptionSegment {
  start: number;
  end: number;
  text: string;
}

/** Turn caption events into non-overlapping display segments. */
export function buildCaptionSegments(events: readonly CaptionEvent[], totalDuration: number): CaptionSegment[] {
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const segments: CaptionSegment[] = [];
  sorted.forEach((ev, i) => {
    if (!ev.text) return;
    const next = sorted[i + 1];
    let end = next ? next.t : totalDuration;
    if (ev.duration !== undefined) end = Math.min(end, ev.t + ev.duration);
    end = Math.min(end, totalDuration);
    if (end > ev.t) segments.push({ start: ev.t, end, text: ev.text });
  });
  return segments;
}

export interface VisibleCaption {
  text: string;
  /** 0..1 opacity, fading in and out at the segment edges. */
  opacity: number;
  /** 0..1 progress of the fade-in, used for a small slide-up. */
  enter: number;
}

export function captionAt(segments: readonly CaptionSegment[], t: number, fade = 250): VisibleCaption | null {
  for (const s of segments) {
    if (t >= s.start && t < s.end) {
      const f = Math.max(1, Math.min(fade, (s.end - s.start) / 2));
      const enter = Math.min(1, (t - s.start) / f);
      const exit = Math.min(1, (s.end - t) / f);
      return { text: s.text, opacity: Math.min(enter, exit), enter };
    }
  }
  return null;
}

export interface VoiceoverEvent {
  start: number;
  /** End of the step the voice-over belongs to. */
  end: number;
  text: string;
}

/** How long a line of narration needs on screen (ms), about 160 words per minute. */
export function readingTime(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(8000, Math.max(1500, words * 375 + 500));
}

/** Compute subtitle cues: each lasts at least its reading time, but never overlaps the next. */
export function buildSubtitleCues(events: readonly VoiceoverEvent[], totalDuration: number): CaptionSegment[] {
  const sorted = [...events].sort((a, b) => a.start - b.start);
  return sorted
    .map((ev, i) => {
      const next = sorted[i + 1];
      let end = Math.max(ev.end, ev.start + readingTime(ev.text));
      if (next) end = Math.min(end, next.start);
      end = Math.min(end, totalDuration);
      return { start: ev.start, end, text: ev.text };
    })
    .filter((c) => c.end > c.start);
}

export function formatSrtTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const milli = total % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(milli, 3)}`;
}

export function toSrt(cues: readonly CaptionSegment[]): string {
  return cues.map((c, i) => `${i + 1}\n${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}\n${c.text}\n`).join('\n');
}
