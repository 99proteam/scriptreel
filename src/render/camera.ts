import type { Viewport } from '../script/types.js';
import { clamp, easeInOutSine, lerp, type Box } from '../util/math.js';

/** Camera state in page (CSS pixel) coordinates: the point at the center of the view and the zoom factor. */
export interface Camera {
  cx: number;
  cy: number;
  scale: number;
}

/** A time range during which the camera should focus on a box. */
export interface Focus {
  start: number;
  end: number;
  box: Box;
  /** Override the zoom factor for this focus. */
  scale?: number;
  /** Requested by a `zoom` step: applies even when automatic zoom is off. */
  explicit?: boolean;
}

export interface Keyframe {
  t: number;
  cam: Camera;
}

export interface CameraOptions {
  viewport: Viewport;
  /** Maximum zoom factor (1 disables zoom). */
  maxScale: number;
  /** Duration of zoom in/out transitions (ms). */
  transition?: number;
  /** Shortest transition allowed when actions follow each other quickly (ms). */
  minTransition?: number;
  /** If the next focus starts within this many ms, pan directly instead of zooming out. */
  mergeGap?: number;
}

export const ZOOM_LEVELS = { off: 1, subtle: 1.4, strong: 2 } as const;

/** Default zoom factor for `zoom` steps. */
export const EXPLICIT_ZOOM = 1.8;

export function fullView(viewport: Viewport): Camera {
  return { cx: viewport.width / 2, cy: viewport.height / 2, scale: 1 };
}

/** Keep the visible area inside the page viewport. */
export function clampCamera(cam: Camera, viewport: Viewport): Camera {
  const scale = Math.max(1, cam.scale);
  const halfW = viewport.width / (2 * scale);
  const halfH = viewport.height / (2 * scale);
  return {
    scale,
    cx: clamp(cam.cx, halfW, viewport.width - halfW),
    cy: clamp(cam.cy, halfH, viewport.height - halfH),
  };
}

/** Camera that frames a box: zoomed up to `maxScale`, but never so far that the box is cut off. */
export function fitCamera(box: Box, viewport: Viewport, maxScale: number): Camera {
  const fit = Math.min(
    (viewport.width * 0.85) / Math.max(1, box.width),
    (viewport.height * 0.85) / Math.max(1, box.height),
  );
  const scale = clamp(Math.min(maxScale, fit), 1, Math.max(1, maxScale));
  return clampCamera({ cx: box.x + box.width / 2, cy: box.y + box.height / 2, scale }, viewport);
}

/** Build camera keyframes from focus ranges. Between keyframes the camera eases smoothly. */
export function buildCameraTrack(focuses: readonly Focus[], options: CameraOptions): Keyframe[] {
  const { viewport } = options;
  const full = fullView(viewport);
  const keys: Keyframe[] = [{ t: 0, cam: full }];
  const active = focuses.filter((f) => options.maxScale > 1 || f.explicit);
  if (active.length === 0) return keys;

  const transition = options.transition ?? 700;
  const minTransition = Math.min(options.minTransition ?? 450, transition);
  const mergeGap = options.mergeGap ?? transition * 2 + 400;
  const sorted = [...active].sort((a, b) => a.start - b.start);

  let lastT = 0;
  let lastCam = full;
  sorted.forEach((focus, i) => {
    const scale = focus.scale ?? (focus.explicit ? Math.max(options.maxScale, EXPLICIT_ZOOM) : options.maxScale);
    const target = fitCamera(focus.box, viewport, scale);
    const inStart = Math.max(lastT, focus.start - transition);
    const inEnd = Math.max(focus.start, inStart + minTransition);
    keys.push({ t: inStart, cam: lastCam }, { t: inEnd, cam: target });
    const holdEnd = Math.max(focus.end, inEnd);
    keys.push({ t: holdEnd, cam: target });
    lastT = holdEnd;
    lastCam = target;
    const next = sorted[i + 1];
    if (!next || next.start - holdEnd >= mergeGap) {
      lastT = holdEnd + transition;
      lastCam = full;
      keys.push({ t: lastT, cam: full });
    }
  });
  return keys;
}

function mix(a: Camera, b: Camera, u: number): Camera {
  // Zoom geometrically so zooming in and out feels equally fast.
  const scale = Math.exp(lerp(Math.log(a.scale), Math.log(b.scale), u));
  return { cx: lerp(a.cx, b.cx, u), cy: lerp(a.cy, b.cy, u), scale };
}

/** Sample the camera at time `t` (ms). */
export function cameraAt(keys: readonly Keyframe[], t: number, viewport: Viewport): Camera {
  if (keys.length === 0) return fullView(viewport);
  let prev = keys[0] as Keyframe;
  if (t <= prev.t) return clampCamera(prev.cam, viewport);
  for (let i = 1; i < keys.length; i++) {
    const next = keys[i] as Keyframe;
    if (t < next.t) {
      const span = next.t - prev.t;
      const u = span <= 0 ? 1 : easeInOutSine((t - prev.t) / span);
      return clampCamera(mix(prev.cam, next.cam, u), viewport);
    }
    prev = next;
  }
  return clampCamera(prev.cam, viewport);
}
