import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname } from 'node:path';

export type VideoFormat = 'mp4' | 'webm' | 'gif';

export const VIDEO_FORMATS: readonly VideoFormat[] = ['mp4', 'webm', 'gif'];

export function formatFromPath(file: string): VideoFormat {
  const ext = extname(file).slice(1).toLowerCase();
  if ((VIDEO_FORMATS as readonly string[]).includes(ext)) return ext as VideoFormat;
  throw new Error(`Unsupported output "${file}". Use a .mp4, .webm or .gif file name.`);
}

/** Locate ffmpeg: SCRIPTREEL_FFMPEG, then the bundled ffmpeg-static binary, then `ffmpeg` on PATH. */
export function ffmpegPath(): string {
  const fromEnv = process.env.SCRIPTREEL_FFMPEG;
  if (fromEnv) return fromEnv;
  try {
    const require = createRequire(import.meta.url);
    const bundled = require('ffmpeg-static') as string | null;
    if (bundled && existsSync(bundled)) return bundled;
  } catch {
    // fall through
  }
  return 'ffmpeg';
}

export interface EncodeSettings {
  width: number;
  height: number;
  fps: number;
}

/** Codec arguments for each output format. */
export function codecArgs(format: VideoFormat, settings: EncodeSettings): string[] {
  switch (format) {
    case 'mp4':
      return ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
    case 'webm':
      return [
        '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-row-mt', '1',
        '-deadline', 'good', '-cpu-used', '4', '-pix_fmt', 'yuv420p',
      ];
    case 'gif': {
      const fps = Math.min(settings.fps, 15);
      const width = Math.min(settings.width, 960);
      return [
        '-vf',
        `fps=${fps},scale=${width}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
        '-loop', '0',
      ];
    }
  }
}

function run(args: string[], stdin = false): { child: ChildProcessWithoutNullStreams; done: Promise<void> } {
  const child = spawn(ffmpegPath(), args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });
  if (!stdin) child.stdin.end();
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', (err) => reject(new Error(`Could not start ffmpeg (${ffmpegPath()}): ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}:\n${stderr.trim()}`));
    });
  });
  return { child, done };
}

/** Streams raw RGBA frames into ffmpeg. */
export class FrameEncoder {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly done: Promise<void>;
  private failed: Error | null = null;

  constructor(output: string, settings: EncodeSettings) {
    const format = formatFromPath(output);
    const args = [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'rawvideo', '-pix_fmt', 'rgba',
      '-s', `${settings.width}x${settings.height}`,
      '-r', String(settings.fps),
      '-i', '-',
      ...codecArgs(format, settings),
      '-r', String(format === 'gif' ? Math.min(settings.fps, 15) : settings.fps),
      output,
    ];
    const { child, done } = run(args, true);
    this.child = child;
    this.done = done;
    this.done.catch((err: Error) => {
      this.failed = err;
    });
    child.stdin.on('error', () => {
      // Reported through `done` when ffmpeg exits.
    });
  }

  async write(frame: Buffer): Promise<void> {
    if (this.failed) throw this.failed;
    if (!this.child.stdin.write(frame)) {
      await new Promise<void>((resolve, reject) => {
        const onDrain = () => {
          this.child.off('close', onClose);
          resolve();
        };
        const onClose = () => {
          this.child.stdin.off('drain', onDrain);
          reject(this.failed ?? new Error('ffmpeg closed unexpectedly'));
        };
        this.child.stdin.once('drain', onDrain);
        this.child.once('close', onClose);
      });
    }
  }

  async finish(): Promise<void> {
    this.child.stdin.end();
    await this.done;
  }

  abort(): void {
    this.child.kill('SIGKILL');
  }
}

/** Convert an existing video into another format. */
export async function transcode(input: string, output: string, settings: EncodeSettings): Promise<void> {
  const format = formatFromPath(output);
  await run(['-y', '-hide_banner', '-loglevel', 'error', '-i', input, ...codecArgs(format, settings), output]).done;
}
