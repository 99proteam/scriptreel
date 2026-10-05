import { describe, expect, it } from 'vitest';
import { bezierPoint, cursorAt, cursorPointAt, moveDuration, planCursorMove } from '../../src/runner/cursor.js';
import { typingSchedule } from '../../src/runner/typing.js';
import { createRng, distance } from '../../src/util/math.js';

describe('cursor path', () => {
  const from = { x: 100, y: 100 };
  const to = { x: 900, y: 500 };

  it('starts and ends exactly at the endpoints', () => {
    const move = planCursorMove(from, to, 1000, { rng: createRng(1) });
    expect(move.t0).toBe(1000);
    expect(cursorPointAt(move, move.t0)).toEqual(from);
    const end = cursorPointAt(move, move.t1);
    expect(end.x).toBeCloseTo(to.x, 6);
    expect(end.y).toBeCloseTo(to.y, 6);
  });

  it('eases in and out: slow at the ends, fast in the middle', () => {
    const move = planCursorMove(from, to, 0, { rng: createRng(3) });
    const span = move.t1 - move.t0;
    const step = span / 20;
    const speedAt = (t: number) => distance(cursorPointAt(move, t), cursorPointAt(move, t + step));
    expect(speedAt(0)).toBeLessThan(speedAt(span / 2 - step / 2) / 3);
    expect(speedAt(span - step)).toBeLessThan(speedAt(span / 2 - step / 2) / 3);
  });

  it('curves gently instead of moving in a straight line, but stays close', () => {
    const move = planCursorMove(from, to, 0, { rng: createRng(5) });
    const mid = bezierPoint(move, 0.5);
    const straightMid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const offset = distance(mid, straightMid);
    expect(offset).toBeGreaterThan(5);
    expect(offset).toBeLessThan(distance(from, to) * 0.15);
  });

  it('is deterministic for the same seed', () => {
    const a = planCursorMove(from, to, 0, { rng: createRng(42) });
    const b = planCursorMove(from, to, 0, { rng: createRng(42) });
    const c = planCursorMove(from, to, 0, { rng: createRng(43) });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('takes longer for longer distances, within limits, and respects speed', () => {
    const short = moveDuration({ x: 0, y: 0 }, { x: 50, y: 0 });
    const long = moveDuration({ x: 0, y: 0 }, { x: 1400, y: 800 });
    expect(short).toBeGreaterThanOrEqual(300);
    expect(long).toBeGreaterThan(short);
    expect(long).toBeLessThanOrEqual(1100);
    expect(Math.abs(moveDuration({ x: 0, y: 0 }, { x: 1400, y: 800 }, 2) - long / 2)).toBeLessThanOrEqual(1);
    expect(moveDuration({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
  });

  it('follows a sequence of moves and holds between them', () => {
    const start = { x: 0, y: 0 };
    const m1 = planCursorMove(start, { x: 200, y: 0 }, 100);
    const m2 = planCursorMove(m1.p1, { x: 200, y: 300 }, m1.t1 + 500);
    expect(cursorAt(start, [m1, m2], 50)).toEqual(start);
    expect(cursorAt(start, [m1, m2], m1.t1 + 250)).toEqual({ x: 200, y: 0 });
    expect(cursorAt(start, [m1, m2], m2.t1 + 1000)).toEqual({ x: 200, y: 300 });
    const during = cursorAt(start, [m1, m2], (m2.t0 + m2.t1) / 2);
    expect(during.y).toBeGreaterThan(0);
    expect(during.y).toBeLessThan(300);
  });
});

describe('typing schedule', () => {
  it('produces one increasing time per character starting at 0', () => {
    const times = typingSchedule('hello world');
    expect(times).toHaveLength(11);
    expect(times[0]).toBe(0);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1] as number);
  });

  it('varies naturally but stays near the base delay', () => {
    const times = typingSchedule('abcdefghijklmnopqrstuvwxyz', { baseDelay: 70, jitter: 30 });
    const gaps = times.slice(1).map((t, i) => t - (times[i] as number));
    expect(new Set(gaps).size).toBeGreaterThan(5);
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(39);
      expect(gap).toBeLessThanOrEqual(101);
    }
  });

  it('pauses a little after punctuation and spaces', () => {
    const rng = () => 0.5; // no jitter
    const times = typingSchedule('ab, cd', { rng, baseDelay: 100 });
    const gaps = times.slice(1).map((t, i) => t - (times[i] as number));
    // gaps: a→b, b→',', ','→' ', ' '→c, c→d
    expect(gaps[2]).toBeGreaterThan(gaps[0] as number);
    expect(gaps[3]).toBeGreaterThan(gaps[0] as number);
  });

  it('is faster at higher speeds and deterministic', () => {
    const normal = typingSchedule('demo@example.com', { rng: createRng(1) });
    const fast = typingSchedule('demo@example.com', { rng: createRng(1), speed: 2 });
    expect(fast.at(-1)).toBeLessThan((normal.at(-1) as number) * 0.6);
    expect(typingSchedule('same', { rng: createRng(9) })).toEqual(typingSchedule('same', { rng: createRng(9) }));
  });
});
