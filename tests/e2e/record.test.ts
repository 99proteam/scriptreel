import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { record } from '../../src/record.js';
import { StepError } from '../../src/runner/recorder.js';
// @ts-expect-error plain JS helper without types
import { serveSite } from '../site/server.mjs';

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const ffprobe = (require('ffprobe-static') as { path: string }).path;
const outDir = join(dirname(fileURLToPath(import.meta.url)), 'output');

async function probe(file: string): Promise<{ duration: number; width: number; height: number; codec: string; frames: number }> {
  const { stdout } = await run(ffprobe, [
    '-v', 'error', '-select_streams', 'v:0', '-count_frames',
    '-show_entries', 'stream=codec_name,width,height,nb_read_frames:format=duration',
    '-of', 'json', file,
  ]);
  const data = JSON.parse(stdout) as {
    streams: Array<{ codec_name: string; width: number; height: number; nb_read_frames: string }>;
    format: { duration: string };
  };
  const stream = data.streams[0]!;
  return {
    duration: Number(data.format.duration),
    width: stream.width,
    height: stream.height,
    codec: stream.codec_name,
    frames: Number(stream.nb_read_frames),
  };
}

describe('record (end to end)', () => {
  let site: { url: string; close: () => Promise<void> };

  beforeAll(async () => {
    site = (await serveSite(0)) as typeof site;
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });
  });

  afterAll(async () => {
    await site?.close();
  });

  it('renders a short demo whose length matches the timeline', async () => {
    const output = join(outDir, 'short.mp4');
    const result = await record(
      {
        url: `${site.url}/login.html`,
        viewport: { width: 1024, height: 640 },
        steps: [
          { caption: 'Sign in', voiceover: 'We sign in with a demo account.' },
          { type: { selector: '#email', text: 'demo@example.com' } },
          { type: { selector: '#password', text: '${E2E_PASSWORD}', hidden: true } },
          { click: 'button[type=submit]' },
          { wait: { selector: '.dashboard' } },
          { zoom: { selector: '.revenue-chart', duration: 600 } },
        ],
      },
      {
        output: [output, join(outDir, 'short.gif')],
        size: '640x360',
        fps: 20,
        speed: 2,
        blur: ['.customer-email'],
        env: { E2E_PASSWORD: 'swordfish' },
      },
    );

    expect(result.outputs).toHaveLength(2);
    expect(result.frames).toBe(Math.ceil((result.duration / 1000) * 20));
    expect(result.timeline.shots.length).toBeGreaterThan(5);
    expect(result.timeline.clicks.length).toBe(3);
    expect(result.timeline.shots.at(-1)?.url).toContain('dashboard.html');

    const info = await probe(output);
    expect(info.codec).toBe('h264');
    expect(info.width).toBe(640);
    expect(info.height).toBe(360);
    expect(Math.abs(info.duration - result.duration / 1000)).toBeLessThan(0.15);

    const gif = await probe(join(outDir, 'short.gif'));
    expect(gif.codec).toBe('gif');
    expect(gif.width).toBe(640);
    expect(gif.frames / 15).toBeGreaterThan(result.duration / 1000 - 0.3);

    expect(result.subtitles).toBeDefined();
    const srt = await readFile(result.subtitles!, 'utf8');
    expect(srt).toContain('We sign in with a demo account.');
    expect(srt).toMatch(/^1\n00:00:00,\d{3} --> 00:00:0\d,\d{3}\n/);
  }, 180_000);

  it('writes WebM output', async () => {
    const output = join(outDir, 'scroll.webm');
    const result = await record(
      {
        url: `${site.url}/index.html`,
        viewport: { width: 960, height: 600 },
        steps: [{ scroll: { to: '#pricing' } }, { pause: 300 }],
      },
      { output, size: '480x270', fps: 15, captions: false },
    );
    const info = await probe(output);
    expect(info.codec).toBe('vp9');
    expect(Math.abs(info.duration - result.duration / 1000)).toBeLessThan(0.2);
    // Smooth scrolling takes one screenshot per frame.
    expect(result.timeline.shots.length).toBeGreaterThan(8);
  }, 180_000);

  it('reports which step failed and saves a screenshot', async () => {
    const output = join(outDir, 'broken.mp4');
    const promise = record(
      { url: `${site.url}/login.html`, steps: [{ click: '#does-not-exist' }] },
      { output, size: '480x270', timeout: 1500 },
    );
    await expect(promise).rejects.toThrow(StepError);
    await expect(promise).rejects.toThrow(/Step 1 \(click "#does-not-exist"\) failed/);
    expect(existsSync(join(outDir, 'broken.error.png'))).toBe(true);
    expect(existsSync(output)).toBe(false);
  }, 60_000);
});
