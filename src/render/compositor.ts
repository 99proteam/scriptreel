import { readFile } from 'node:fs/promises';
import { createCanvas, loadImage, type Canvas, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import type { FrameTheme } from '../script/types.js';
import { cursorAt } from '../runner/cursor.js';
import { clamp, easeOutCubic, type Box } from '../util/math.js';
import { buildCameraTrack, cameraAt, type Keyframe } from './camera.js';
import { buildCaptionSegments, captionAt, type CaptionSegment } from './captions.js';
import type { Background, Layout } from './layout.js';
import { pageAt, type Timeline } from './timeline.js';

export interface CompositorOptions {
  layout: Layout;
  theme: FrameTheme;
  background: Background;
  captions: boolean;
  /** Maximum automatic zoom (1 = off). */
  zoom: number;
}

const FONT = '"Segoe UI", "SF Pro Text", Inter, "Helvetica Neue", Helvetica, Arial, "DejaVu Sans", sans-serif';

const THEMES = {
  light: {
    window: '#ffffff',
    titleBar: '#f1f5f9',
    titleBorder: '#e2e8f0',
    address: '#ffffff',
    addressBorder: '#e2e8f0',
    addressText: '#64748b',
    shadow: 'rgba(15, 23, 42, 0.35)',
  },
  dark: {
    window: '#0b1120',
    titleBar: '#1e293b',
    titleBorder: '#0f172a',
    address: '#0f172a',
    addressBorder: '#334155',
    addressText: '#94a3b8',
    shadow: 'rgba(0, 0, 0, 0.55)',
  },
} as const;

/** The cursor arrow outline, tip at (0, 0), about 18 units tall. */
const ARROW: Array<[number, number]> = [
  [0, 0],
  [0, 16.2],
  [4.1, 12.6],
  [6.9, 18.6],
  [9.5, 17.4],
  [6.8, 11.6],
  [12, 11.6],
];

const CLICK_RIPPLE_MS = 550;
const CURSOR_SIZE = 26; // page pixels

/** Draws output frames from a recorded timeline. */
export class Compositor {
  readonly canvas: Canvas;
  private readonly ctx: SKRSContext2D;
  private readonly base: Canvas;
  private readonly camera: Keyframe[];
  private readonly captionSegments: CaptionSegment[];
  private readonly images = new Map<number, Image>();

  constructor(
    private readonly timeline: Timeline,
    private readonly options: CompositorOptions,
  ) {
    const { output } = options.layout;
    this.canvas = createCanvas(output.width, output.height);
    this.ctx = this.canvas.getContext('2d');
    this.base = this.drawBase();
    this.camera = buildCameraTrack(timeline.focuses, {
      viewport: timeline.viewport,
      maxScale: options.zoom,
    });
    this.captionSegments = options.captions ? buildCaptionSegments(timeline.captions, timeline.duration) : [];
  }

  /** Render the frame at time `t` (ms) and return raw RGBA pixels. */
  async render(t: number): Promise<Buffer> {
    const { ctx } = this;
    const { layout } = this.options;
    const { content } = layout;
    const { viewport } = this.timeline;

    ctx.drawImage(this.base, 0, 0);
    const page = pageAt(this.timeline.pages, t);
    const shot = page ? this.timeline.shots[page.shot] : undefined;
    if (shot) this.drawAddress(shot.url);

    const cam = cameraAt(this.camera, t, viewport);
    const viewW = viewport.width / cam.scale;
    const viewH = viewport.height / cam.scale;
    const viewX = cam.cx - viewW / 2;
    const viewY = cam.cy - viewH / 2;
    const k = content.width / viewW;

    ctx.save();
    roundedRect(ctx, content, [0, 0, layout.radius, layout.radius]);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (page) {
      if (page.from) {
        this.drawShot(await this.image(page.from.shot), viewX, viewY, viewW, viewH);
        ctx.globalAlpha = clamp(page.from.alpha, 0, 1);
      }
      this.drawShot(await this.image(page.shot), viewX, viewY, viewW, viewH);
      ctx.globalAlpha = 1;
    }

    // Cursor and click ripples, in page coordinates mapped through the camera.
    const toOut = (x: number, y: number) => ({ x: content.x + (x - viewX) * k, y: content.y + (y - viewY) * k });
    let press = 1;
    for (const click of this.timeline.clicks) {
      const dt = t - click.t;
      if (dt >= 0 && dt < CLICK_RIPPLE_MS) this.drawRipple(toOut(click.x, click.y), dt / CLICK_RIPPLE_MS, k);
      if (dt > -70 && dt < 160) press = Math.min(press, 0.82 + 0.18 * Math.abs(dt < 0 ? dt / 70 : dt / 160));
    }
    const pos = cursorAt(this.timeline.cursorStart, this.timeline.moves, t);
    this.drawCursor(toOut(pos.x, pos.y), CURSOR_SIZE * k * press);
    ctx.restore();

    const caption = captionAt(this.captionSegments, t);
    if (caption) this.drawCaption(caption.text, caption.opacity, caption.enter);

    return this.canvas.data();
  }

  private drawShot(img: Image, x: number, y: number, w: number, h: number): void {
    const { content } = this.options.layout;
    const s = img.width / this.timeline.viewport.width;
    this.ctx.drawImage(img, x * s, y * s, w * s, h * s, content.x, content.y, content.width, content.height);
  }

  private async image(index: number): Promise<Image> {
    const cached = this.images.get(index);
    if (cached) return cached;
    const shot = this.timeline.shots[index];
    if (!shot) throw new Error(`Missing screenshot #${index}`);
    const img = await loadImage(await readFile(shot.file));
    this.images.set(index, img);
    // Keep only a few decoded images in memory; frames move forward through time.
    if (this.images.size > 4) {
      const oldest = this.images.keys().next().value as number;
      this.images.delete(oldest);
    }
    return img;
  }

  private drawBase(): Canvas {
    const { layout, background, theme } = this.options;
    const { output, window: win, unit } = layout;
    const colors = THEMES[theme];
    const canvas = createCanvas(output.width, output.height);
    const ctx = canvas.getContext('2d');

    if (background.type === 'solid') {
      ctx.fillStyle = background.color;
    } else {
      // CSS gradient angles: 0deg points up, 90deg points right.
      const rad = (background.angle * Math.PI) / 180;
      const dx = Math.sin(rad);
      const dy = -Math.cos(rad);
      const half = (Math.abs(output.width * dx) + Math.abs(output.height * dy)) / 2;
      const cx = output.width / 2;
      const cy = output.height / 2;
      const g = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
      background.stops.forEach((c, i) => g.addColorStop(i / (background.stops.length - 1), c));
      ctx.fillStyle = g;
    }
    ctx.fillRect(0, 0, output.width, output.height);

    // Window with a soft shadow.
    ctx.save();
    ctx.shadowColor = colors.shadow;
    ctx.shadowBlur = 70 * unit;
    ctx.shadowOffsetY = 24 * unit;
    ctx.fillStyle = colors.window;
    roundedRect(ctx, win, layout.radius);
    ctx.fill();
    ctx.restore();

    // Title bar.
    ctx.save();
    roundedRect(ctx, { ...win, height: layout.titleBarHeight }, [layout.radius, layout.radius, 0, 0]);
    ctx.fillStyle = colors.titleBar;
    ctx.fill();
    ctx.fillStyle = colors.titleBorder;
    ctx.fillRect(win.x, win.y + layout.titleBarHeight - Math.max(1, unit), win.width, Math.max(1, unit));
    const dotY = win.y + layout.titleBarHeight / 2;
    ['#ff5f57', '#febc2e', '#28c840'].forEach((color, i) => {
      ctx.beginPath();
      ctx.arc(win.x + 22 * unit + i * 20 * unit, dotY, 6.5 * unit, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });
    ctx.restore();
    return canvas;
  }

  private addressBox(): Box {
    const { window: win, titleBarHeight, unit } = this.options.layout;
    const width = Math.min(win.width * 0.5, 720 * unit);
    const height = titleBarHeight * 0.64;
    return { x: win.x + (win.width - width) / 2, y: win.y + (titleBarHeight - height) / 2, width, height };
  }

  private drawAddress(url: string): void {
    const { ctx } = this;
    const { unit } = this.options.layout;
    const colors = THEMES[this.options.theme];
    const box = this.addressBox();
    ctx.save();
    roundedRect(ctx, box, box.height / 2);
    ctx.fillStyle = colors.address;
    ctx.fill();
    ctx.lineWidth = Math.max(1, unit);
    ctx.strokeStyle = colors.addressBorder;
    ctx.stroke();
    ctx.fillStyle = colors.addressText;
    ctx.font = `${Math.round(15 * unit)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = fitText(ctx, displayUrl(url), box.width - 24 * unit);
    ctx.fillText(text, box.x + box.width / 2, box.y + box.height / 2 + unit);
    ctx.restore();
  }

  private drawCursor(at: { x: number; y: number }, size: number): void {
    const { ctx } = this;
    const s = size / 18;
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.scale(s, s);
    ctx.beginPath();
    ARROW.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 4 * s;
    ctx.shadowOffsetY = 1.5 * s;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#111111';
    ctx.fill();
    ctx.restore();
  }

  private drawRipple(at: { x: number; y: number }, progress: number, k: number): void {
    const { ctx } = this;
    const e = easeOutCubic(progress);
    const radius = (8 + 30 * e) * k;
    ctx.save();
    ctx.beginPath();
    ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(59, 130, 246, ${0.28 * (1 - progress)})`;
    ctx.fill();
    ctx.lineWidth = 2.5 * k;
    ctx.strokeStyle = `rgba(59, 130, 246, ${0.75 * (1 - progress)})`;
    ctx.stroke();
    ctx.restore();
  }

  private drawCaption(text: string, opacity: number, enter: number): void {
    const { ctx } = this;
    const { layout } = this.options;
    const { unit, output } = layout;
    const fontSize = Math.round(30 * unit);
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.font = `600 ${fontSize}px ${FONT}`;
    const lines = wrapText(ctx, text, output.width * 0.8);
    const lineHeight = fontSize * 1.3;
    const padX = 30 * unit;
    const padY = 14 * unit;
    const width = Math.max(...lines.map((l) => ctx.measureText(l).width)) + padX * 2;
    const height = lines.length * lineHeight + padY * 2;
    const slide = (1 - easeOutCubic(enter)) * 12 * unit;
    const cy = Math.min(layout.captionY, output.height - height / 2 - 12 * unit);
    const box = { x: (output.width - width) / 2, y: cy - height / 2 + slide, width, height };
    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowBlur = 24 * unit;
    ctx.shadowOffsetY = 6 * unit;
    roundedRect(ctx, box, Math.min(height / 2, 28 * unit));
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((line, i) => {
      ctx.fillText(line, output.width / 2, box.y + padY + lineHeight * (i + 0.5) + unit);
    });
    ctx.restore();
  }
}

function roundedRect(ctx: SKRSContext2D, box: Box, radius: number | number[]): void {
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.width, box.height, radius);
}

export function displayUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === 'about:') return url;
    const path = u.pathname === '/' ? '' : u.pathname;
    return `${u.host}${path}${u.search}`;
  } catch {
    return url;
  }
}

function fitText(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

function wrapText(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines.slice(0, 3);
}
