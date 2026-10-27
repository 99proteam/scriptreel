import { describe, expect, it } from 'vitest';
import {
  buildChapters,
  formatChapterTime,
  toFfmetadata,
  toYouTubeChapters,
  YOUTUBE_MIN_CHAPTER_MS,
} from '../../src/render/chapters.js';
import { muxArgs } from '../../src/render/encode.js';

describe('buildChapters', () => {
  const events = [
    { t: 1200, text: 'Sign in' },
    { t: 4000, text: null },
    { t: 15_000, text: 'Create a project' },
    { t: 15_500, text: 'Create a project' },
    { t: 31_000, text: '  Invite   a teammate ' },
  ];

  it('starts at 0:00 and skips hidden and repeated captions', () => {
    expect(buildChapters(events, 60_000)).toEqual([
      { start: 0, title: 'Sign in' },
      { start: 15_000, title: 'Create a project' },
      { start: 31_000, title: 'Invite a teammate' },
    ]);
  });

  it('folds chapters shorter than the minimum into the previous one', () => {
    const quick = [
      { t: 0, text: 'One' },
      { t: 4000, text: 'Two' },
      { t: 12_000, text: 'Three' },
      { t: 25_000, text: 'Four' },
    ];
    expect(buildChapters(quick, 30_000, YOUTUBE_MIN_CHAPTER_MS).map((c) => c.title)).toEqual(['One', 'Three']);
  });

  it('ignores captions after the end of the video', () => {
    expect(buildChapters([{ t: 0, text: 'A' }, { t: 9000, text: 'B' }], 5000)).toEqual([{ start: 0, title: 'A' }]);
  });
});

describe('formatting', () => {
  it('formats YouTube timestamps', () => {
    expect(formatChapterTime(0)).toBe('0:00');
    expect(formatChapterTime(65_900)).toBe('1:05');
    expect(formatChapterTime(3_725_000)).toBe('1:02:05');
  });

  it('writes a YouTube description block', () => {
    expect(toYouTubeChapters([{ start: 0, title: 'Intro' }, { start: 75_000, title: 'Setup' }])).toBe('0:00 Intro\n1:15 Setup\n');
  });

  it('writes an ffmpeg metadata file with escaped titles', () => {
    const meta = toFfmetadata([{ start: 0, title: 'A=B; #1' }, { start: 2500, title: 'Next' }], 6000);
    expect(meta).toBe(
      ';FFMETADATA1\n' +
        '[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=2500\ntitle=A\\=B\\; \\#1\n' +
        '[CHAPTER]\nTIMEBASE=1/1000\nSTART=2500\nEND=6000\ntitle=Next\n',
    );
  });
});

describe('muxArgs', () => {
  it('copies the video and adds faded, looped music', () => {
    const args = muxArgs('in.mp4', 'out.mp4', { durationMs: 20_000, music: 'song.mp3', musicVolume: 0.5 });
    expect(args).toEqual(expect.arrayContaining(['-stream_loop', '-1', '-c:v', 'copy', '-c:a', 'aac', '-t', '20.000']));
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toBe('[1:a]volume=0.5,afade=t=in:st=0:d=1.000,afade=t=out:st=18.000:d=2.000[music]');
  });

  it('maps chapters from the metadata input', () => {
    const args = muxArgs('in.mp4', 'out.webm', { durationMs: 8000, music: 'a.wav', metadata: 'ch.txt' });
    expect(args.slice(args.indexOf('-map_metadata'), args.indexOf('-map_metadata') + 4)).toEqual(['-map_metadata', '2', '-map_chapters', '2']);
    expect(args).toContain('libopus');
    const chaptersOnly = muxArgs('in.mp4', 'out.mp4', { durationMs: 8000, metadata: 'ch.txt' });
    expect(chaptersOnly).not.toContain('-filter_complex');
    expect(chaptersOnly).toEqual(expect.arrayContaining(['-map_chapters', '1']));
  });
});
