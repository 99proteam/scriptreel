import { describe, expect, it } from 'vitest';
import {
  buildCaptionSegments,
  buildSubtitleCues,
  captionAt,
  formatSrtTime,
  readingTime,
  toSrt,
} from '../../src/render/captions.js';

describe('caption timing', () => {
  it('shows each caption until the next one', () => {
    const segments = buildCaptionSegments(
      [
        { t: 0, text: 'First' },
        { t: 3000, text: 'Second' },
      ],
      8000,
    );
    expect(segments).toEqual([
      { start: 0, end: 3000, text: 'First' },
      { start: 3000, end: 8000, text: 'Second' },
    ]);
  });

  it('hides captions on null and after an explicit duration', () => {
    const segments = buildCaptionSegments(
      [
        { t: 500, text: 'Hello', duration: 1000 },
        { t: 4000, text: 'World' },
        { t: 6000, text: null },
      ],
      9000,
    );
    expect(segments).toEqual([
      { start: 500, end: 1500, text: 'Hello' },
      { start: 4000, end: 6000, text: 'World' },
    ]);
  });

  it('sorts events and clips to the video length', () => {
    const segments = buildCaptionSegments(
      [
        { t: 5000, text: 'Late' },
        { t: 1000, text: 'Early' },
      ],
      6000,
    );
    expect(segments.map((s) => s.text)).toEqual(['Early', 'Late']);
    expect(segments[1]?.end).toBe(6000);
  });

  it('fades in and out at the edges', () => {
    const segments = [{ start: 1000, end: 3000, text: 'Hi' }];
    expect(captionAt(segments, 999)).toBeNull();
    expect(captionAt(segments, 1000)?.opacity).toBe(0);
    expect(captionAt(segments, 1125)?.opacity).toBeCloseTo(0.5);
    expect(captionAt(segments, 2000)?.opacity).toBe(1);
    expect(captionAt(segments, 2875)?.opacity).toBeCloseTo(0.5);
    expect(captionAt(segments, 3000)).toBeNull();
  });

  it('shortens fades for very short captions', () => {
    const c = captionAt([{ start: 0, end: 200, text: 'x' }], 100, 250);
    expect(c?.opacity).toBe(1);
  });
});

describe('subtitles (.srt)', () => {
  it('formats timestamps', () => {
    expect(formatSrtTime(0)).toBe('00:00:00,000');
    expect(formatSrtTime(3_723_456)).toBe('01:02:03,456');
    expect(formatSrtTime(59_999.6)).toBe('00:01:00,000');
  });

  it('gives each line enough reading time without overlapping the next', () => {
    const cues = buildSubtitleCues(
      [
        { start: 0, end: 500, text: 'Short line.' },
        { start: 1000, end: 2000, text: 'A much longer line of narration that needs more time to read.' },
        { start: 9000, end: 9500, text: 'Last' },
      ],
      10_000,
    );
    expect(cues[0]).toEqual({ start: 0, end: 1000, text: 'Short line.' });
    expect(cues[1]?.end).toBe(1000 + readingTime(cues[1]!.text));
    expect(cues[2]?.end).toBe(10_000);
  });

  it('writes valid SRT', () => {
    const srt = toSrt([
      { start: 0, end: 1500, text: 'Hello' },
      { start: 2000, end: 3500, text: 'World' },
    ]);
    expect(srt).toBe('1\n00:00:00,000 --> 00:00:01,500\nHello\n\n2\n00:00:02,000 --> 00:00:03,500\nWorld\n');
  });
});
