import { describe, expect, it } from 'vitest';
import { buildCameraTrack, cameraAt, clampCamera, fitCamera, type Camera, type Focus } from '../../src/render/camera.js';

const viewport = { width: 1440, height: 900 };
const button: Focus['box'] = { x: 1200, y: 20, width: 80, height: 40 };
const field: Focus['box'] = { x: 550, y: 400, width: 340, height: 48 };

function inBounds(cam: Camera) {
  const halfW = viewport.width / (2 * cam.scale);
  const halfH = viewport.height / (2 * cam.scale);
  return (
    cam.cx - halfW >= -1e-6 &&
    cam.cx + halfW <= viewport.width + 1e-6 &&
    cam.cy - halfH >= -1e-6 &&
    cam.cy + halfH <= viewport.height + 1e-6
  );
}

describe('fitCamera', () => {
  it('zooms to the requested level for small elements', () => {
    expect(fitCamera(field, viewport, 1.4).scale).toBe(1.4);
    expect(fitCamera(field, viewport, 2).scale).toBe(2);
  });

  it('never zooms so far that a large element is cut off', () => {
    const chart = { x: 100, y: 100, width: 1000, height: 500 };
    const cam = fitCamera(chart, viewport, 2);
    expect(cam.scale).toBeLessThan(2);
    expect(chart.width * cam.scale).toBeLessThanOrEqual(viewport.width);
  });

  it('keeps the view inside the page near the edges', () => {
    const cam = fitCamera(button, viewport, 2);
    expect(inBounds(cam)).toBe(true);
    expect(cam.cx).toBe(viewport.width - viewport.width / 4);
  });

  it('clampCamera never goes below 1x', () => {
    expect(clampCamera({ cx: 0, cy: 0, scale: 0.5 }, viewport)).toEqual({ cx: 720, cy: 450, scale: 1 });
  });
});

describe('buildCameraTrack', () => {
  it('stays at full view when zoom is off', () => {
    const keys = buildCameraTrack([{ start: 1000, end: 2000, box: field }], { viewport, maxScale: 1 });
    expect(keys).toHaveLength(1);
    expect(cameraAt(keys, 1500, viewport)).toEqual({ cx: 720, cy: 450, scale: 1 });
  });

  it('still honors explicit zoom steps when automatic zoom is off', () => {
    const keys = buildCameraTrack([{ start: 1000, end: 2000, box: field, explicit: true }], { viewport, maxScale: 1 });
    expect(cameraAt(keys, 1500, viewport).scale).toBeGreaterThan(1.5);
  });

  it('zooms in before the action, holds, then zooms back out', () => {
    const keys = buildCameraTrack([{ start: 2000, end: 3000, box: field }], { viewport, maxScale: 1.4, transition: 700 });
    expect(cameraAt(keys, 0, viewport).scale).toBe(1);
    expect(cameraAt(keys, 1300, viewport).scale).toBe(1); // transition starts at 1300
    const midIn = cameraAt(keys, 1650, viewport).scale;
    expect(midIn).toBeGreaterThan(1);
    expect(midIn).toBeLessThan(1.4);
    expect(cameraAt(keys, 2000, viewport).scale).toBeCloseTo(1.4);
    expect(cameraAt(keys, 2900, viewport).scale).toBeCloseTo(1.4);
    expect(cameraAt(keys, 3350, viewport).scale).toBeLessThan(1.4);
    expect(cameraAt(keys, 3700, viewport).scale).toBe(1);
    expect(cameraAt(keys, 10_000, viewport).scale).toBe(1);
  });

  it('pans directly between actions that are close together', () => {
    const focuses: Focus[] = [
      { start: 1000, end: 2000, box: field },
      { start: 2600, end: 3500, box: { ...field, y: 520 } },
    ];
    const keys = buildCameraTrack(focuses, { viewport, maxScale: 1.4, transition: 700 });
    for (let t = 1000; t <= 3500; t += 50) expect(cameraAt(keys, t, viewport).scale).toBeCloseTo(1.4);
    expect(cameraAt(keys, 3500, viewport).cy).toBeGreaterThan(cameraAt(keys, 1500, viewport).cy);
  });

  it('zooms out between actions that are far apart', () => {
    const focuses: Focus[] = [
      { start: 1000, end: 2000, box: field },
      { start: 8000, end: 9000, box: button },
    ];
    const keys = buildCameraTrack(focuses, { viewport, maxScale: 2, transition: 700 });
    expect(cameraAt(keys, 5000, viewport).scale).toBe(1);
    expect(cameraAt(keys, 8500, viewport).scale).toBeCloseTo(2);
  });

  it('produces non-decreasing keyframe times and an in-bounds camera at every moment', () => {
    const focuses: Focus[] = [
      { start: 100, end: 150, box: button },
      { start: 120, end: 900, box: field },
      { start: 950, end: 960, box: { x: 0, y: 860, width: 40, height: 40 } },
    ];
    const keys = buildCameraTrack(focuses, { viewport, maxScale: 2 });
    for (let i = 1; i < keys.length; i++) expect(keys[i]!.t).toBeGreaterThanOrEqual(keys[i - 1]!.t);
    for (let t = 0; t < 4000; t += 17) {
      const cam = cameraAt(keys, t, viewport);
      expect(inBounds(cam)).toBe(true);
      expect(Number.isFinite(cam.cx) && Number.isFinite(cam.cy)).toBe(true);
    }
  });

  it('moves smoothly without jumps between frames', () => {
    const focuses: Focus[] = [
      { start: 1000, end: 1800, box: button },
      { start: 2000, end: 3000, box: field },
    ];
    const keys = buildCameraTrack(focuses, { viewport, maxScale: 2 });
    let prev = cameraAt(keys, 0, viewport);
    for (let t = 33; t < 5000; t += 33) {
      const cam = cameraAt(keys, t, viewport);
      expect(Math.abs(cam.scale - prev.scale)).toBeLessThan(0.15);
      expect(Math.abs(cam.cx - prev.cx)).toBeLessThan(80);
      prev = cam;
    }
  });
});
