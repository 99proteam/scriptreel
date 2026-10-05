import { describe, expect, it } from 'vitest';
import { displayUrl } from '../../src/render/compositor.js';
import { autoDeviceScaleFactor, computeLayout, parseBackground, parseSize } from '../../src/render/layout.js';
import { pageAt } from '../../src/render/timeline.js';
import { interpolateString, redact } from '../../src/script/env.js';
import { resolveSettings } from '../../src/record.js';

describe('sizes', () => {
  it('supports presets and custom sizes', () => {
    expect(parseSize('youtube')).toEqual({ width: 1920, height: 1080 });
    expect(parseSize('reel')).toEqual({ width: 1080, height: 1920 });
    expect(parseSize('square')).toEqual({ width: 1080, height: 1080 });
    expect(parseSize('1280x720')).toEqual({ width: 1280, height: 720 });
    expect(parseSize('1281X721')).toEqual({ width: 1280, height: 720 });
  });

  it('rejects invalid sizes', () => {
    expect(() => parseSize('big')).toThrow(/Invalid size/);
    expect(() => parseSize('10x10')).toThrow(/out of range/);
  });
});

describe('backgrounds', () => {
  it('parses presets, colors and gradients', () => {
    expect(parseBackground('aurora').type).toBe('linear');
    expect(parseBackground('#0f172a')).toEqual({ type: 'solid', color: '#0f172a' });
    expect(parseBackground('rgb(1, 2, 3)')).toEqual({ type: 'solid', color: 'rgb(1, 2, 3)' });
    expect(parseBackground('#6366f1, #ec4899')).toEqual({ type: 'linear', angle: 135, stops: ['#6366f1', '#ec4899'] });
    expect(parseBackground('linear-gradient(90deg, rgb(0,0,0), #fff)')).toEqual({
      type: 'linear',
      angle: 90,
      stops: ['rgb(0,0,0)', '#fff'],
    });
    expect(() => parseBackground('linear-gradient(#fff)')).toThrow(/two colors/);
  });
});

describe('layout', () => {
  const viewport = { width: 1440, height: 900 };

  it('fits the window inside the frame with the page aspect ratio', () => {
    for (const size of ['youtube', 'reel', 'square', '1280x720']) {
      const output = parseSize(size);
      const layout = computeLayout(output, viewport, { captions: true });
      const { window: win, content } = layout;
      expect(win.x).toBeGreaterThan(0);
      expect(win.y).toBeGreaterThan(0);
      expect(win.x + win.width).toBeLessThan(output.width);
      expect(win.y + win.height).toBeLessThan(output.height);
      expect(content.width / content.height).toBeCloseTo(1.6, 1);
      expect(layout.captionY).toBeGreaterThan(win.y);
      expect(layout.captionY).toBeLessThan(output.height);
    }
  });

  it('uses more room when there are no captions', () => {
    const output = parseSize('youtube');
    expect(computeLayout(output, viewport, { captions: false }).content.width).toBeGreaterThan(
      computeLayout(output, viewport, { captions: true }).content.width,
    );
  });

  it('chooses a sharp screenshot scale for the zoom level', () => {
    const layout = computeLayout(parseSize('youtube'), viewport, { captions: false });
    expect(autoDeviceScaleFactor(layout, viewport, 1)).toBe(1);
    expect(autoDeviceScaleFactor(layout, viewport, 2)).toBe(2);
    const small = computeLayout(parseSize('640x360'), viewport, { captions: false });
    expect(autoDeviceScaleFactor(small, viewport, 1.4)).toBe(1);
  });
});

describe('settings', () => {
  it('lets command-line options override the script', () => {
    const s = resolveSettings({ size: 'square', zoom: 'strong', blur: ['.a'] }, { zoom: 'off', blur: ['.b'], fps: 24 });
    expect(s).toMatchObject({ width: 1080, height: 1080, zoom: 'off', fps: 24, blur: ['.a', '.b'], captions: true });
  });

  it('validates values', () => {
    expect(() => resolveSettings({}, { speed: 0 })).toThrow(/speed/);
    expect(() => resolveSettings({}, { fps: 1000 })).toThrow(/fps/);
  });
});

describe('page timeline', () => {
  const pages = [
    { t: 0, shot: 0, fade: 0 },
    { t: 1000, shot: 1, fade: 200 },
    { t: 2000, shot: 2, fade: 0 },
  ];

  it('picks the latest screenshot and cross-fades', () => {
    expect(pageAt(pages, 500)).toEqual({ shot: 0 });
    expect(pageAt(pages, 1100)).toEqual({ shot: 1, from: { shot: 0, alpha: 0.5 } });
    expect(pageAt(pages, 1300)).toEqual({ shot: 1 });
    expect(pageAt(pages, 2000)).toEqual({ shot: 2 });
    expect(pageAt([], 0)).toBeNull();
  });
});

describe('helpers', () => {
  it('shows short URLs in the address bar', () => {
    expect(displayUrl('https://app.example.com/')).toBe('app.example.com');
    expect(displayUrl('http://127.0.0.1:4173/login.html?x=1')).toBe('127.0.0.1:4173/login.html?x=1');
    expect(displayUrl('about:blank')).toBe('about:blank');
  });

  it('redacts secrets from log output', () => {
    expect(redact('typing hunter2 now', ['hunter2'])).toBe('typing •••••• now');
    expect(interpolateString('${A}-${B:-b}', { A: 'a' })).toBe('a-b');
  });
});
