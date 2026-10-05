#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { Command, InvalidArgumentError, Option } from 'commander';
import pc from 'picocolors';
import { record } from './record.js';
import { VIDEO_FORMATS } from './render/encode.js';
import { BACKGROUND_PRESETS, SIZE_PRESETS } from './render/layout.js';
import { redact } from './script/env.js';
import { loadScript } from './script/parse.js';
import type { VideoSettings } from './script/types.js';
import { INIT_TEMPLATE } from './template.js';

const version = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
})();

const toNumber = (name: string) => (value: string) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new InvalidArgumentError(`${name} must be a positive number`);
  return n;
};

const collect = (value: string, previous: string[] = []) => [...previous, value];

const rel = (file: string) => relative(process.cwd(), file) || file;

/** Values from environment variables, hidden in every message we print. */
let secrets: readonly string[] = [];

const program = new Command()
  .name('scriptreel')
  .description('Turn a simple script into a polished product demo video of your web app.')
  .version(version);

program
  .command('init')
  .description('create an example demo.yml')
  .argument('[file]', 'where to write the script', 'demo.yml')
  .option('-f, --force', 'overwrite an existing file')
  .action(async (file: string, opts: { force?: boolean }) => {
    if (existsSync(file) && !opts.force) {
      console.error(pc.red(`${file} already exists. Use --force to overwrite it.`));
      process.exitCode = 1;
      return;
    }
    await writeFile(file, INIT_TEMPLATE, 'utf8');
    console.log(`${pc.green('✔')} Created ${pc.bold(file)}`);
    console.log(`\nNext:\n  ${pc.cyan(`npx scriptreel record ${file} -o demo.mp4`)}`);
    console.log(pc.dim('\nFirst run? Install the browser once with: npx playwright install chromium'));
  });

program
  .command('validate')
  .description('check a script for errors without recording')
  .argument('<script>', 'demo script (.yml, .yaml, .json, .ts, .js)')
  .action(async (file: string) => {
    const script = await loadScript(file);
    console.log(`${pc.green('✔')} ${file} is valid: ${script.steps.length} steps, ${script.url}`);
    for (const step of script.steps) console.log(pc.dim(`  ${step.index + 1}. ${redact(step.label, script.secrets)}`));
  });

program
  .command('record')
  .description('run a demo script and render the video')
  .argument('<script>', 'demo script (.yml, .yaml, .json, .ts, .js)')
  .option('-o, --output <file>', 'output file: .mp4, .webm or .gif (default: <script>.mp4)')
  .option('--format <list>', `extra formats to write next to the output, e.g. "webm,gif" (${VIDEO_FORMATS.join(', ')})`)
  .option('--size <size>', `video size: WIDTHxHEIGHT or ${Object.keys(SIZE_PRESETS).join(', ')} (default 1920x1080)`)
  .option('--fps <n>', 'frames per second (default 30)', toNumber('fps'))
  .addOption(new Option('--zoom <level>', 'automatic zoom (default subtle)').choices(['off', 'subtle', 'strong']))
  .addOption(new Option('--theme <theme>', 'browser frame theme (default light)').choices(['light', 'dark']))
  .option('--background <bg>', `color, "#a, #b" gradient, or ${Object.keys(BACKGROUND_PRESETS).join(', ')}`)
  .option('--no-captions', 'do not draw caption overlays')
  .option('--headed', 'show the browser window and watch the demo run')
  .option('--speed <n>', 'speed multiplier for cursor, typing and pauses (default 1)', toNumber('speed'))
  .option('--blur <selector>', 'blur matching elements (repeatable)', collect)
  .option('--seed <n>', 'seed for the natural variation in cursor paths and typing', toNumber('seed'))
  .option('--scale <n>', 'screenshot device scale factor (default: auto)', toNumber('scale'))
  .option('--timeout <ms>', 'timeout for finding elements and loading pages', toNumber('timeout'))
  .option('--no-srt', 'do not write an .srt file for voice-over text')
  .option('--keep-frames', 'keep the captured screenshots for debugging')
  .action(async (file: string, opts: Record<string, unknown>, command: Command) => {
    const fromCli = (key: string) => command.getOptionValueSource(key) === 'cli';
    const base = (opts.output as string | undefined) ?? join(dirname(file), `${basename(file, extname(file))}.mp4`);
    const outputs = [base];
    if (typeof opts.format === 'string') {
      for (const format of opts.format.split(',').map((f) => f.trim().toLowerCase()).filter(Boolean)) {
        if (!(VIDEO_FORMATS as readonly string[]).includes(format)) {
          throw new InvalidArgumentError(`Unknown format "${format}". Use ${VIDEO_FORMATS.join(', ')}.`);
        }
        const out = `${base.slice(0, -extname(base).length)}.${format}`;
        if (!outputs.some((o) => resolve(o) === resolve(out))) outputs.push(out);
      }
    }

    const settings: VideoSettings = {
      ...(opts.size !== undefined && { size: opts.size as string }),
      ...(opts.fps !== undefined && { fps: Math.round(opts.fps as number) }),
      ...(opts.zoom !== undefined && { zoom: opts.zoom as VideoSettings['zoom'] }),
      ...(opts.theme !== undefined && { theme: opts.theme as VideoSettings['theme'] }),
      ...(opts.background !== undefined && { background: opts.background as string }),
      ...(fromCli('captions') && { captions: opts.captions as boolean }),
      ...(opts.speed !== undefined && { speed: opts.speed as number }),
      ...(opts.blur !== undefined && { blur: opts.blur as string[] }),
      ...(opts.seed !== undefined && { seed: Math.round(opts.seed as number) }),
      ...(opts.scale !== undefined && { deviceScaleFactor: opts.scale as number }),
    };

    const script = await loadScript(file);
    secrets = script.secrets;
    const started = Date.now();
    console.log(`${pc.bold('scriptreel')} ${pc.dim(version)}  ${pc.cyan(file)} → ${outputs.map((o) => pc.cyan(o)).join(', ')}\n`);
    let lastFrameLog = 0;
    const result = await record(script, {
      ...settings,
      output: outputs,
      headed: Boolean(opts.headed),
      srt: opts.srt !== false,
      keepFrames: Boolean(opts.keepFrames),
      ...(opts.timeout !== undefined && { timeout: opts.timeout as number }),
      onStep: (step, i, total) => {
        console.log(`  ${pc.dim(`[${i + 1}/${total}]`)} ${redact(step.label, script.secrets)}`);
      },
      onPhase: (phase, detail) => {
        if (phase === 'record') console.log(pc.bold('Recording'));
        if (phase === 'render') console.log(`\n${pc.bold('Rendering')} ${pc.dim(rel(detail ?? ''))}`);
        if (phase === 'convert') console.log(`${pc.bold('Converting')} ${pc.dim(rel(detail ?? ''))}`);
      },
      onFrame: (frame, total) => {
        if (!process.stdout.isTTY) return;
        const now = Date.now();
        if (frame !== total && now - lastFrameLog < 100) return;
        lastFrameLog = now;
        const pct = Math.round((frame / total) * 100);
        const bar = '█'.repeat(Math.round(pct / 4)).padEnd(25, '░');
        process.stdout.write(`\r  ${bar} ${pct}% ${pc.dim(`frame ${frame}/${total}`)}`);
        if (frame === total) process.stdout.write('\n');
      },
    });

    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`\n${pc.green('✔')} Done in ${seconds}s — ${(result.duration / 1000).toFixed(1)}s video, ${result.frames} frames`);
    for (const output of result.outputs) console.log(`  ${pc.cyan(rel(output))}`);
    if (result.subtitles) console.log(`  ${pc.cyan(rel(result.subtitles))} ${pc.dim('(voice-over subtitles)')}`);
    if (result.framesDir) console.log(pc.dim(`  screenshots kept in ${result.framesDir}`));
  });

program.parseAsync().catch((err: Error) => {
  console.error(`\n${pc.red('✖')} ${redact(err.message, secrets)}`);
  if (process.env.DEBUG) console.error(redact(err.stack ?? '', secrets));
  process.exit(1);
});
