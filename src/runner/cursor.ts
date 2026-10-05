import { clamp, createRng, distance, easeInOutCubic, lerp, type Point } from '../util/math.js';

/** A cubic Bezier cursor movement between two points over a time range (ms). */
export interface CursorMove {
  t0: number;
  t1: number;
  p0: Point;
  c1: Point;
  c2: Point;
  p1: Point;
}

export interface CursorPathOptions {
  /** Random generator used to vary the curve. */
  rng?: () => number;
  /** Playback speed multiplier (2 = twice as fast). */
  speed?: number;
}

/** Duration of a cursor move in milliseconds, based on distance (Fitts-like, clamped). */
export function moveDuration(from: Point, to: Point, speed = 1): number {
  const d = distance(from, to);
  if (d < 1) return 0;
  const ms = 280 + 110 * Math.log2(1 + d / 40);
  return Math.round(clamp(ms, 300, 1100) / speed);
}

/** Build a gently curved path from `from` to `to`, starting at time `t0`. */
export function planCursorMove(from: Point, to: Point, t0: number, options: CursorPathOptions = {}): CursorMove {
  const rng = options.rng ?? createRng(1);
  const d = distance(from, to);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  // Perpendicular unit vector.
  const nx = d > 0 ? -dy / d : 0;
  const ny = d > 0 ? dx / d : 0;
  // Bend the path sideways by up to ~12% of the distance, always to one side so it reads as an arc.
  const side = rng() < 0.5 ? -1 : 1;
  const bend = d * (0.06 + rng() * 0.06) * side;
  const c1 = { x: from.x + dx * 0.3 + nx * bend, y: from.y + dy * 0.3 + ny * bend };
  const c2 = { x: from.x + dx * 0.75 + nx * bend * 0.6, y: from.y + dy * 0.75 + ny * bend * 0.6 };
  return { t0, t1: t0 + moveDuration(from, to, options.speed ?? 1), p0: from, c1, c2, p1: to };
}

export function bezierPoint(m: CursorMove, u: number): Point {
  const t = clamp(u, 0, 1);
  const a = lerp(m.p0.x, m.c1.x, t);
  const b = lerp(m.c1.x, m.c2.x, t);
  const c = lerp(m.c2.x, m.p1.x, t);
  const d = lerp(m.p0.y, m.c1.y, t);
  const e = lerp(m.c1.y, m.c2.y, t);
  const f = lerp(m.c2.y, m.p1.y, t);
  const ab = lerp(a, b, t);
  const bc = lerp(b, c, t);
  const de = lerp(d, e, t);
  const ef = lerp(e, f, t);
  return { x: lerp(ab, bc, t), y: lerp(de, ef, t) };
}

/** Position along a move at absolute time `t` (ms), with ease-in-out timing. */
export function cursorPointAt(m: CursorMove, t: number): Point {
  if (m.t1 <= m.t0) return t < m.t0 ? m.p0 : m.p1;
  return bezierPoint(m, easeInOutCubic((t - m.t0) / (m.t1 - m.t0)));
}

/** Cursor position at time `t` given the start position and a sorted list of moves. */
export function cursorAt(start: Point, moves: readonly CursorMove[], t: number): Point {
  let pos = start;
  for (const m of moves) {
    if (t < m.t0) return pos;
    if (t <= m.t1) return cursorPointAt(m, t);
    pos = m.p1;
  }
  return pos;
}
