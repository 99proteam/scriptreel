import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';
import { interpolateEnv } from './env.js';
import type { DemoScript, NormalizedStep, ParsedScript, Viewport, ZoomLevel, FrameTheme } from './types.js';

export class ScriptError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(issues.length ? `${message}\n${issues.map((i) => `  - ${i}`).join('\n')}` : message);
    this.name = 'ScriptError';
  }
}

export const ACTION_KEYS = [
  'caption',
  'click',
  'hover',
  'type',
  'press',
  'select',
  'wait',
  'zoom',
  'scroll',
  'pause',
  'goto',
] as const;
const MODIFIER_KEYS = ['voiceover'] as const;
const TOP_LEVEL_KEYS = [
  'url',
  'viewport',
  'steps',
  'size',
  'fps',
  'zoom',
  'theme',
  'background',
  'captions',
  'speed',
  'blur',
  'seed',
  'deviceScaleFactor',
] as const;

export const DEFAULT_VIEWPORT: Viewport = { width: 1440, height: 900 };

export interface ParseOptions {
  /** Environment used for `${VAR}` placeholders. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validate and normalize a demo script object (already parsed from YAML, JSON or a module). */
export function parseScript(input: unknown, options: ParseOptions = {}): ParsedScript {
  if (!isObj(input)) throw new ScriptError('The script must be an object with `url` and `steps`.');
  const { value: raw, secrets, missing } = interpolateEnv(input, options.env ?? process.env);
  if (missing.length) {
    throw new ScriptError('Missing environment variables used in the script:', missing.map((m) => `\${${m}} is not set`));
  }

  const issues: string[] = [];
  const unknown = Object.keys(raw).filter((k) => !(TOP_LEVEL_KEYS as readonly string[]).includes(k));
  for (const key of unknown) issues.push(`unknown top-level key "${key}"`);

  if (typeof raw.url !== 'string' || raw.url.trim() === '') issues.push('`url` is required and must be a string');

  let viewport = DEFAULT_VIEWPORT;
  if (raw.viewport !== undefined) {
    const v = raw.viewport;
    if (isObj(v) && isPositiveInt(v.width) && isPositiveInt(v.height)) viewport = { width: v.width, height: v.height };
    else issues.push('`viewport` must be { width, height } with positive integers');
  }

  if (raw.fps !== undefined && !(isPositiveInt(raw.fps) && raw.fps <= 120)) issues.push('`fps` must be an integer between 1 and 120');
  if (raw.zoom !== undefined && !['off', 'subtle', 'strong'].includes(raw.zoom as string))
    issues.push('`zoom` must be one of off, subtle, strong');
  if (raw.theme !== undefined && !['light', 'dark'].includes(raw.theme as string)) issues.push('`theme` must be light or dark');
  if (raw.size !== undefined && typeof raw.size !== 'string') issues.push('`size` must be a string like 1920x1080 or a preset');
  if (raw.background !== undefined && typeof raw.background !== 'string') issues.push('`background` must be a string');
  if (raw.captions !== undefined && typeof raw.captions !== 'boolean') issues.push('`captions` must be true or false');
  if (raw.speed !== undefined && !(typeof raw.speed === 'number' && raw.speed > 0)) issues.push('`speed` must be a positive number');
  if (raw.seed !== undefined && !Number.isInteger(raw.seed)) issues.push('`seed` must be an integer');
  if (
    raw.deviceScaleFactor !== undefined &&
    raw.deviceScaleFactor !== 'auto' &&
    !(typeof raw.deviceScaleFactor === 'number' && raw.deviceScaleFactor > 0 && raw.deviceScaleFactor <= 4)
  )
    issues.push('`deviceScaleFactor` must be "auto" or a number between 0 and 4');
  let blur: string[] | undefined;
  if (raw.blur !== undefined) {
    const list = typeof raw.blur === 'string' ? [raw.blur] : raw.blur;
    if (Array.isArray(list) && list.every((s) => typeof s === 'string' && s.length > 0)) blur = list as string[];
    else issues.push('`blur` must be a selector or a list of selectors');
  }

  const steps: NormalizedStep[] = [];
  if (!Array.isArray(raw.steps)) issues.push('`steps` is required and must be a list');
  else if (raw.steps.length === 0) issues.push('`steps` must contain at least one step');
  else raw.steps.forEach((step, i) => {
    const result = normalizeStep(step, i);
    if (typeof result === 'string') issues.push(`steps[${i}]: ${result}`);
    else steps.push(result);
  });

  if (issues.length) throw new ScriptError('Invalid demo script:', issues);

  return {
    url: (raw.url as string).trim(),
    viewport,
    steps,
    secrets,
    ...(raw.size !== undefined && { size: raw.size as string }),
    ...(raw.fps !== undefined && { fps: raw.fps as number }),
    ...(raw.zoom !== undefined && { zoom: raw.zoom as ZoomLevel }),
    ...(raw.theme !== undefined && { theme: raw.theme as FrameTheme }),
    ...(raw.background !== undefined && { background: raw.background as string }),
    ...(raw.captions !== undefined && { captions: raw.captions as boolean }),
    ...(raw.speed !== undefined && { speed: raw.speed as number }),
    ...(raw.seed !== undefined && { seed: raw.seed as number }),
    ...(raw.deviceScaleFactor !== undefined && { deviceScaleFactor: raw.deviceScaleFactor as number | 'auto' }),
    ...(blur && { blur }),
  };
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

function isNonNegative(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Turn one raw step into a normalized step, or return an error message. */
export function normalizeStep(step: unknown, index: number): NormalizedStep | string {
  if (!isObj(step)) return 'each step must be an object such as `click: "#save"`';
  const keys = Object.keys(step);
  const actions = keys.filter((k) => (ACTION_KEYS as readonly string[]).includes(k));
  const extra = keys.filter(
    (k) => !(ACTION_KEYS as readonly string[]).includes(k) && !(MODIFIER_KEYS as readonly string[]).includes(k),
  );
  if (extra.length) return `unknown key "${extra[0]}" (actions: ${ACTION_KEYS.join(', ')})`;
  if (actions.length === 0) return `missing an action (one of ${ACTION_KEYS.join(', ')})`;
  if (actions.length > 1) return `has more than one action (${actions.join(', ')}); split it into separate steps`;
  if (step.voiceover !== undefined && typeof step.voiceover !== 'string') return '`voiceover` must be a string';

  const action = actions[0] as (typeof ACTION_KEYS)[number];
  const v = step[action];
  const base = {
    index,
    ...(typeof step.voiceover === 'string' && step.voiceover.trim() && { voiceover: step.voiceover.trim() }),
  };

  switch (action) {
    case 'caption': {
      if (v === null || typeof v === 'string') return { ...base, kind: 'caption', text: v || null, label: `caption ${quote(v ?? '')}` };
      if (isObj(v) && (v.text === null || typeof v.text === 'string')) {
        if (v.duration !== undefined && !isNonNegative(v.duration)) return '`caption.duration` must be a number of milliseconds';
        return {
          ...base,
          kind: 'caption',
          text: (v.text as string | null) || null,
          ...(v.duration !== undefined && { duration: v.duration as number }),
          label: `caption ${quote((v.text as string) ?? '')}`,
        };
      }
      return '`caption` must be text, null, or { text, duration }';
    }
    case 'click': {
      if (str(v)) return { ...base, kind: 'click', selector: v, button: 'left', double: false, label: `click ${quote(v)}` };
      if (isObj(v) && str(v.selector)) {
        if (v.button !== undefined && !['left', 'right', 'middle'].includes(v.button as string))
          return '`click.button` must be left, right or middle';
        return {
          ...base,
          kind: 'click',
          selector: v.selector,
          button: (v.button as 'left' | 'right' | 'middle') ?? 'left',
          double: v.double === true,
          label: `${v.double ? 'double-click' : 'click'} ${quote(v.selector)}`,
        };
      }
      return '`click` needs a selector, e.g. click: "text=Log in"';
    }
    case 'hover': {
      const selector = str(v) ? v : isObj(v) && str(v.selector) ? v.selector : null;
      if (!selector) return '`hover` needs a selector';
      return { ...base, kind: 'hover', selector, label: `hover ${quote(selector)}` };
    }
    case 'type': {
      if (!isObj(v) || typeof v.text !== 'string') return '`type` must be { selector, text }';
      if (v.selector !== undefined && !str(v.selector)) return '`type.selector` must be a selector string';
      const hidden = v.hidden === true;
      return {
        ...base,
        kind: 'type',
        ...(str(v.selector) && { selector: v.selector }),
        text: v.text,
        hidden,
        clear: v.clear !== false,
        submit: v.submit === true,
        label: `type ${hidden ? '••••••' : quote(v.text)}${str(v.selector) ? ` into ${quote(v.selector)}` : ''}`,
      };
    }
    case 'press': {
      if (!str(v)) return '`press` needs a key such as "Enter" or "Control+A"';
      return { ...base, kind: 'press', key: v, label: `press ${v}` };
    }
    case 'select': {
      if (!isObj(v) || !str(v.selector)) return '`select` must be { selector, value }';
      const value = typeof v.value === 'string' ? [v.value] : v.value;
      if (!Array.isArray(value) || !value.every((x) => typeof x === 'string')) return '`select.value` must be a string or list of strings';
      return { ...base, kind: 'select', selector: v.selector, value: value as string[], label: `select ${quote(value.join(', '))}` };
    }
    case 'wait': {
      if (isNonNegative(v)) return { ...base, kind: 'wait', ms: v, label: `wait ${v}ms` };
      if (str(v)) return { ...base, kind: 'wait', selector: v, label: `wait for ${quote(v)}` };
      if (isObj(v)) {
        if (v.selector === undefined && v.url === undefined && v.state === undefined)
          return '`wait` needs a selector, url or state';
        if (v.selector !== undefined && !str(v.selector)) return '`wait.selector` must be a string';
        if (v.url !== undefined && !str(v.url)) return '`wait.url` must be a string';
        if (v.state !== undefined && !['load', 'domcontentloaded', 'networkidle'].includes(v.state as string))
          return '`wait.state` must be load, domcontentloaded or networkidle';
        if (v.timeout !== undefined && !isNonNegative(v.timeout)) return '`wait.timeout` must be milliseconds';
        const what = (v.selector ?? v.url ?? v.state) as string;
        return {
          ...base,
          kind: 'wait',
          ...(str(v.selector) && { selector: v.selector }),
          ...(str(v.url) && { url: v.url }),
          ...(v.state !== undefined && { state: v.state as 'load' }),
          ...(v.timeout !== undefined && { timeout: v.timeout as number }),
          label: `wait for ${quote(what)}`,
        };
      }
      return '`wait` must be milliseconds, a selector, or { selector | url | state }';
    }
    case 'zoom': {
      if (str(v)) return { ...base, kind: 'zoom', selector: v, label: `zoom ${quote(v)}` };
      if (isObj(v) && str(v.selector)) {
        if (v.scale !== undefined && !(typeof v.scale === 'number' && v.scale >= 1 && v.scale <= 4))
          return '`zoom.scale` must be between 1 and 4';
        if (v.duration !== undefined && !isNonNegative(v.duration)) return '`zoom.duration` must be milliseconds';
        return {
          ...base,
          kind: 'zoom',
          selector: v.selector,
          ...(v.scale !== undefined && { scale: v.scale as number }),
          ...(v.duration !== undefined && { duration: v.duration as number }),
          label: `zoom ${quote(v.selector)}`,
        };
      }
      return '`zoom` needs a selector';
    }
    case 'scroll': {
      if (str(v)) return { ...base, kind: 'scroll', to: v, label: `scroll to ${quote(v)}` };
      if (typeof v === 'number' && Number.isFinite(v)) return { ...base, kind: 'scroll', by: v, label: `scroll by ${v}px` };
      if (isObj(v)) {
        const targets = ['to', 'by', 'y'].filter((k) => v[k] !== undefined);
        if (targets.length !== 1) return '`scroll` needs exactly one of to, by or y';
        if (v.to !== undefined && !str(v.to)) return '`scroll.to` must be a selector';
        if (v.by !== undefined && typeof v.by !== 'number') return '`scroll.by` must be a number';
        if (v.y !== undefined && !isNonNegative(v.y)) return '`scroll.y` must be a non-negative number';
        if (v.container !== undefined && !str(v.container)) return '`scroll.container` must be a selector';
        if (v.duration !== undefined && !isNonNegative(v.duration)) return '`scroll.duration` must be milliseconds';
        const label = v.to !== undefined ? `scroll to ${quote(v.to as string)}` : v.by !== undefined ? `scroll by ${v.by}px` : `scroll to y=${v.y}`;
        return {
          ...base,
          kind: 'scroll',
          ...(v.to !== undefined && { to: v.to as string }),
          ...(v.by !== undefined && { by: v.by as number }),
          ...(v.y !== undefined && { y: v.y as number }),
          ...(v.container !== undefined && { container: v.container as string }),
          ...(v.duration !== undefined && { duration: v.duration as number }),
          label,
        };
      }
      return '`scroll` must be a selector, a pixel amount, or { to | by | y }';
    }
    case 'pause': {
      if (!isNonNegative(v)) return '`pause` must be a number of milliseconds';
      return { ...base, kind: 'pause', ms: v, label: `pause ${v}ms` };
    }
    case 'goto': {
      if (!str(v)) return '`goto` needs a URL';
      return { ...base, kind: 'goto', url: v, label: `go to ${v}` };
    }
  }
}

function quote(s: string): string {
  const short = s.length > 40 ? `${s.slice(0, 37)}...` : s;
  return `"${short}"`;
}

/** Parse YAML or JSON source text into a validated script. */
export function parseScriptSource(source: string, options: ParseOptions = {}): ParsedScript {
  let data: unknown;
  try {
    data = YAML.parse(source);
  } catch (err) {
    throw new ScriptError(`Could not parse YAML: ${(err as Error).message}`);
  }
  return parseScript(data, options);
}

/** Load a script from a .yml, .yaml, .json, .ts, .mts, .js or .mjs file. */
export async function loadScript(file: string, options: ParseOptions = {}): Promise<ParsedScript> {
  const path = resolve(file);
  const ext = extname(path).toLowerCase();
  if (['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'].includes(ext)) {
    const { createJiti } = await import('jiti');
    const jiti = createJiti(pathToFileURL(path).href, { interopDefault: true, moduleCache: false });
    const mod = await jiti.import<unknown>(path, { default: true });
    const data = typeof mod === 'function' ? await (mod as () => unknown)() : mod;
    return parseScript(data, options);
  }
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch {
    throw new ScriptError(`Cannot read script file: ${file}`);
  }
  return parseScriptSource(source, options);
}

/** Identity helper that gives type checking and autocompletion in .ts demo scripts. */
export function defineDemo<T extends DemoScript>(script: T): T {
  return script;
}
