import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { EXPLICIT_ZOOM, ZOOM_LEVELS } from './render/camera.js';
import { buildSubtitleCues, toSrt } from './render/captions.js';
import { Compositor } from './render/compositor.js';
import { FrameEncoder, formatFromPath, transcode } from './render/encode.js';
import {
  DEFAULT_BACKGROUND,
  DEFAULT_SIZE,
  autoDeviceScaleFactor,
  computeLayout,
  parseBackground,
  parseSize,
} from './render/layout.js';
import { frameCount, type Timeline } from './render/timeline.js';
import { runScript } from './runner/recorder.js';
import { loadScript, parseScript } from './script/parse.js';
import type { DemoScript, FrameTheme, NormalizedStep, ParsedScript, VideoSettings, ZoomLevel } from './script/types.js';

export interface RecordOptions extends VideoSettings {
  /** Output file(s). The format comes from the extension (.mp4, .webm, .gif). Default `demo.mp4`. */
  output?: string | string[];
  /** Watch the demo run in a visible browser window. */
  headed?: boolean;
  /** Write voice-over text to an .srt file next to the video. Default true. */
  srt?: boolean;
  /** Keep the screenshot folder for debugging. */
  keepFrames?: boolean;
  /** Timeout for finding elements and loading pages, in ms. */
  timeout?: number;
  /** Environment for `${VAR}` placeholders when `script` is a file or object. */
  env?: Record<string, string | undefined>;
  onStep?: (step: NormalizedStep, index: number, total: number) => void;
  onPhase?: (phase: 'record' | 'render' | 'convert', detail?: string) => void;
  onFrame?: (frame: number, total: number) => void;
}

export interface ResolvedSettings {
  width: number;
  height: number;
  fps: number;
  zoom: ZoomLevel;
  theme: FrameTheme;
  background: string;
  captions: boolean;
  speed: number;
  seed: number;
  blur: string[];
  deviceScaleFactor: number | 'auto';
}

export interface RecordResult {
  outputs: string[];
  subtitles?: string;
  /** Video length in ms. */
  duration: number;
  frames: number;
  settings: ResolvedSettings;
  timeline: Timeline;
  framesDir?: string;
}

/** Merge settings: command-line options win over the script, which wins over defaults. */
export function resolveSettings(script: VideoSettings, options: VideoSettings): ResolvedSettings {
  const pick = <K extends keyof VideoSettings>(key: K): VideoSettings[K] => options[key] ?? script[key];
  const size = parseSize(pick('size') ?? DEFAULT_SIZE);
  const speed = pick('speed') ?? 1;
  if (!(speed > 0 && speed <= 10)) throw new Error('speed must be between 0 and 10');
  const fps = pick('fps') ?? 30;
  if (!(Number.isInteger(fps) && fps >= 1 && fps <= 120)) throw new Error('fps must be an integer between 1 and 120');
  const zoom = pick('zoom') ?? 'subtle';
  if (!(zoom in ZOOM_LEVELS)) throw new Error('zoom must be off, subtle or strong');
  const theme = pick('theme') ?? 'light';
  if (theme !== 'light' && theme !== 'dark') throw new Error('theme must be light or dark');
  return {
    ...size,
    fps,
    zoom,
    theme,
    background: pick('background') ?? DEFAULT_BACKGROUND,
    captions: pick('captions') ?? true,
    speed,
    seed: pick('seed') ?? 1,
    blur: [...(script.blur ?? []), ...(options.blur ?? [])],
    deviceScaleFactor: pick('deviceScaleFactor') ?? 'auto',
  };
}

function isParsed(script: unknown): script is ParsedScript {
  return typeof script === 'object' && script !== null && Array.isArray((script as ParsedScript).secrets);
}

/** Record a demo script to video. `script` may be a file path, a script object, or a parsed script. */
export async function record(script: string | DemoScript | ParsedScript, options: RecordOptions = {}): Promise<RecordResult> {
  const parsed = typeof script === 'string'
    ? await loadScript(script, { env: options.env })
    : isParsed(script)
      ? script
      : parseScript(script, { env: options.env });

  const settings = resolveSettings(parsed, options);
  const outputs = (Array.isArray(options.output) ? options.output : [options.output ?? 'demo.mp4']).map((o) => resolve(o));
  const formats = outputs.map(formatFromPath);
  const hasCaptions = settings.captions && parsed.steps.some((s) => s.kind === 'caption' && s.text);
  const layout = computeLayout({ width: settings.width, height: settings.height }, parsed.viewport, { captions: hasCaptions });
  const background = parseBackground(settings.background);
  const maxZoom = Math.max(ZOOM_LEVELS[settings.zoom], parsed.steps.some((s) => s.kind === 'zoom') ? EXPLICIT_ZOOM : 1);
  const deviceScaleFactor =
    settings.deviceScaleFactor === 'auto' ? autoDeviceScaleFactor(layout, parsed.viewport, maxZoom) : settings.deviceScaleFactor;

  const workDir = await mkdtemp(join(tmpdir(), 'scriptreel-'));
  try {
    options.onPhase?.('record');
    const firstOutput = outputs[0] as string;
    await mkdir(dirname(firstOutput), { recursive: true });
    const timeline = await runScript(parsed, {
      workDir,
      fps: settings.fps,
      speed: settings.speed,
      seed: settings.seed,
      deviceScaleFactor,
      blur: settings.blur,
      headed: options.headed,
      timeout: options.timeout,
      onStep: options.onStep,
      errorScreenshot: firstOutput.slice(0, -extname(firstOutput).length) + '.error.png',
    });

    // Render once to a master file, then convert to the other formats.
    const masterIndex = formats.indexOf('mp4');
    const master = masterIndex >= 0 ? (outputs[masterIndex] as string) : join(workDir, 'master.mp4');
    const encodeSettings = { width: settings.width, height: settings.height, fps: settings.fps };
    const total = frameCount(timeline.duration, settings.fps);
    options.onPhase?.('render', master);
    const compositor = new Compositor(timeline, {
      layout,
      theme: settings.theme,
      background,
      captions: hasCaptions,
      zoom: ZOOM_LEVELS[settings.zoom],
    });
    const encoder = new FrameEncoder(master, encodeSettings);
    try {
      for (let i = 0; i < total; i++) {
        await encoder.write(await compositor.render((i * 1000) / settings.fps));
        options.onFrame?.(i + 1, total);
      }
      await encoder.finish();
    } catch (err) {
      encoder.abort();
      throw err;
    }

    for (const output of outputs) {
      if (output === master) continue;
      await mkdir(dirname(output), { recursive: true });
      options.onPhase?.('convert', output);
      await transcode(master, output, encodeSettings);
    }

    let subtitles: string | undefined;
    const cues = buildSubtitleCues(timeline.voiceovers, timeline.duration);
    if (options.srt !== false && cues.length) {
      subtitles = firstOutput.slice(0, -extname(firstOutput).length) + '.srt';
      await writeFile(subtitles, toSrt(cues), 'utf8');
    }

    return {
      outputs,
      ...(subtitles && { subtitles }),
      duration: timeline.duration,
      frames: total,
      settings: { ...settings, deviceScaleFactor },
      timeline,
      ...(options.keepFrames && { framesDir: workDir }),
    };
  } finally {
    if (!options.keepFrames) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
