import type { Viewport } from '../script/types.js';
import type { Box } from '../util/math.js';

export interface Size {
  width: number;
  height: number;
}

export const SIZE_PRESETS: Record<string, Size> = {
  youtube: { width: 1920, height: 1080 },
  '1080p': { width: 1920, height: 1080 },
  '720p': { width: 1280, height: 720 },
  '4k': { width: 3840, height: 2160 },
  reel: { width: 1080, height: 1920 },
  story: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
};

export const DEFAULT_SIZE = 'youtube';

/** Parse `1920x1080` or a preset name. Dimensions are rounded down to even numbers (required by H.264). */
export function parseSize(input: string): Size {
  const key = input.trim().toLowerCase();
  const preset = SIZE_PRESETS[key];
  if (preset) return { ...preset };
  const m = /^(\d{2,5})\s*[x×*]\s*(\d{2,5})$/.exec(key);
  if (!m) {
    throw new Error(`Invalid size "${input}". Use WIDTHxHEIGHT or one of: ${Object.keys(SIZE_PRESETS).join(', ')}`);
  }
  const even = (n: number) => n - (n % 2);
  const width = even(Number(m[1]));
  const height = even(Number(m[2]));
  if (width < 64 || height < 64 || width > 7680 || height > 7680) {
    throw new Error(`Size "${input}" is out of range (64-7680 pixels per side).`);
  }
  return { width, height };
}

export type Background =
  | { type: 'solid'; color: string }
  | { type: 'linear'; angle: number; stops: string[] };

export const BACKGROUND_PRESETS: Record<string, Background> = {
  aurora: { type: 'linear', angle: 135, stops: ['#6366f1', '#a855f7', '#ec4899'] },
  ocean: { type: 'linear', angle: 135, stops: ['#0ea5e9', '#2563eb', '#4f46e5'] },
  sunset: { type: 'linear', angle: 135, stops: ['#f97316', '#ec4899', '#8b5cf6'] },
  mint: { type: 'linear', angle: 135, stops: ['#34d399', '#06b6d4', '#3b82f6'] },
  midnight: { type: 'linear', angle: 160, stops: ['#0f172a', '#1e293b', '#312e81'] },
  slate: { type: 'solid', color: '#e2e8f0' },
  charcoal: { type: 'solid', color: '#18181b' },
  white: { type: 'solid', color: '#ffffff' },
};

export const DEFAULT_BACKGROUND = 'aurora';

/** Split on commas that are not inside parentheses, e.g. `rgb(1,2,3), #fff`. */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of input) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * Parse a background: a preset name, a CSS color, a comma separated list of colors (diagonal gradient),
 * or `linear-gradient(<angle>deg, <color>, <color>...)`.
 */
export function parseBackground(input: string): Background {
  const value = input.trim();
  const preset = BACKGROUND_PRESETS[value.toLowerCase()];
  if (preset) return preset;
  const gradient = /^linear-gradient\((.*)\)$/i.exec(value);
  if (gradient) {
    const parts = splitTopLevel(gradient[1] as string);
    let angle = 180;
    const angleMatch = /^(-?\d+(?:\.\d+)?)deg$/i.exec(parts[0] ?? '');
    if (angleMatch) {
      angle = Number(angleMatch[1]);
      parts.shift();
    }
    if (parts.length < 2) throw new Error(`A gradient needs at least two colors: "${input}"`);
    return { type: 'linear', angle, stops: parts };
  }
  const parts = splitTopLevel(value);
  if (parts.length >= 2) return { type: 'linear', angle: 135, stops: parts };
  if (!value) throw new Error('Background cannot be empty');
  return { type: 'solid', color: value };
}

export interface Layout {
  output: Size;
  /** Unit that scales chrome (title bar, text) with the output size; 1 at 1080p. */
  unit: number;
  /** The whole browser window including its title bar. */
  window: Box;
  /** The page area inside the window. */
  content: Box;
  titleBarHeight: number;
  radius: number;
  /** Vertical center of the caption pill. */
  captionY: number;
}

/** Fit a browser window showing `viewport` inside the output frame, leaving room for captions. */
export function computeLayout(output: Size, viewport: Viewport, options: { captions: boolean }): Layout {
  const unit = Math.min(output.width, output.height) / 1080;
  const titleBarHeight = Math.round(40 * unit);
  const pad = Math.round(Math.min(output.width, output.height) * 0.055);
  const captionSpace = options.captions ? Math.round(70 * unit) : 0;
  const availW = output.width - pad * 2;
  const availH = output.height - pad * 2 - captionSpace;
  const aspect = viewport.width / viewport.height;
  let contentW = availW;
  let contentH = contentW / aspect;
  if (contentH + titleBarHeight > availH) {
    contentH = availH - titleBarHeight;
    contentW = contentH * aspect;
  }
  contentW = Math.round(contentW);
  contentH = Math.round(contentH);
  const winH = contentH + titleBarHeight;
  const x = Math.round((output.width - contentW) / 2);
  const y = Math.round(pad + (availH - winH) / 2);
  const window = { x, y, width: contentW, height: winH };
  const content = { x, y: y + titleBarHeight, width: contentW, height: contentH };
  const windowBottom = y + winH;
  const captionY = options.captions
    ? Math.round(Math.min(output.height - pad * 0.9 - 28 * unit, windowBottom + captionSpace / 2 - 4 * unit))
    : 0;
  return { output, unit, window, content, titleBarHeight, radius: Math.round(12 * unit), captionY };
}

/** Pick a screenshot scale so the page stays sharp at the strongest zoom. */
export function autoDeviceScaleFactor(layout: Layout, viewport: Viewport, maxZoom: number): number {
  const needed = (layout.content.width * Math.max(1, maxZoom)) / viewport.width;
  // Allow ~10% upscaling before paying for bigger screenshots.
  return Math.min(2, Math.max(1, Math.ceil((needed - 0.1) * 4) / 4));
}
