import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import type { Focus } from '../render/camera.js';
import type { CaptionEvent, VoiceoverEvent } from '../render/captions.js';
import type { ClickMark, PageKey, Shot, Timeline } from '../render/timeline.js';
import type { NormalizedStep, ParsedScript } from '../script/types.js';
import { boxCenter, clamp, createRng, easeInOutCubic, type Box, type Point } from '../util/math.js';
import { planCursorMove, type CursorMove } from './cursor.js';
import { CURSOR_ELEMENT_ID, overlayScript } from './overlay.js';
import { typingSchedule } from './typing.js';

export interface RunOptions {
  /** Directory where screenshots are stored. */
  workDir: string;
  fps: number;
  speed: number;
  seed: number;
  deviceScaleFactor: number;
  /** Selectors (Playwright syntax) whose elements are blurred in the video. */
  blur: string[];
  /** Show the browser window and play the demo in real time. */
  headed?: boolean;
  /** Timeout for finding elements and page loads (ms). */
  timeout?: number;
  /** Called before each step runs. */
  onStep?: (step: NormalizedStep, index: number, total: number) => void;
  /** Where to save a screenshot if a step fails. */
  errorScreenshot?: string;
}

export class StepError extends Error {
  constructor(
    readonly step: NormalizedStep,
    cause: Error,
  ) {
    super(`Step ${step.index + 1} (${step.label}) failed: ${cause.message.split('\n')[0]}`, { cause });
    this.name = 'StepError';
  }
}

const BLUR_ATTR = 'data-scriptreel-blur';

/** Timing constants in ms at speed 1. */
const T = {
  intro: 700,
  outro: 1300,
  beforeClick: 90,
  afterClick: 450,
  clickFade: 220,
  afterType: 350,
  hover: 500,
  afterWait: 450,
  waitFade: 250,
  gotoHold: 700,
  zoomHold: 2200,
  zoomTransition: 700,
};

export async function launchBrowser(headed: boolean): Promise<Browser> {
  try {
    return await chromium.launch({ headless: !headed });
  } catch (err) {
    const message = (err as Error).message;
    if (/Executable doesn't exist|browserType\.launch/i.test(message) && /install/i.test(message)) {
      throw new Error('Chromium is not installed for Playwright. Run: npx playwright install chromium', { cause: err });
    }
    throw err;
  }
}

/** Run a demo script in Chromium and record a timeline of screenshots and cursor events. */
export async function runScript(script: ParsedScript, options: RunOptions): Promise<Timeline> {
  const browser = await launchBrowser(Boolean(options.headed));
  try {
    const context = await browser.newContext({
      viewport: script.viewport,
      deviceScaleFactor: options.deviceScaleFactor,
    });
    const recorder = new Recorder(context, script, options);
    return await recorder.run();
  } finally {
    await browser.close().catch(() => {});
  }
}

class Recorder {
  private page!: Page;
  private t = 0;
  private cursor: Point;
  private readonly rng: () => number;
  private readonly shots: Shot[] = [];
  private readonly pages: PageKey[] = [];
  private readonly moves: CursorMove[] = [];
  private readonly clicks: ClickMark[] = [];
  private readonly focuses: Focus[] = [];
  private readonly captions: CaptionEvent[] = [];
  private readonly voiceovers: VoiceoverEvent[] = [];
  private lastShot: Buffer | null = null;
  private readonly timeout: number;
  private readonly screenshotStyle: string;

  constructor(
    private readonly context: BrowserContext,
    private readonly script: ParsedScript,
    private readonly options: RunOptions,
  ) {
    this.cursor = { x: script.viewport.width / 2, y: script.viewport.height / 2 };
    this.rng = createRng(options.seed);
    this.timeout = options.timeout ?? 15_000;
    this.screenshotStyle = [
      `#${CURSOR_ELEMENT_ID}{display:none!important}`,
      `[${BLUR_ATTR}]{filter:blur(9px)!important}`,
    ].join('\n');
  }

  private ms(base: number): number {
    return Math.round(base / this.options.speed);
  }

  async run(): Promise<Timeline> {
    await mkdir(this.options.workDir, { recursive: true });
    if (this.options.headed) await this.context.addInitScript(overlayScript);
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.timeout);
    await this.page.goto(this.script.url, { waitUntil: 'load', timeout: Math.max(this.timeout, 30_000) });
    await this.settle();
    await this.snap(0);
    await this.advance(T.intro);

    const { steps } = this.script;
    for (const [i, step] of steps.entries()) {
      this.options.onStep?.(step, i, steps.length);
      const start = this.t;
      try {
        await this.runStep(step);
      } catch (err) {
        if (this.options.errorScreenshot) {
          await this.page.screenshot({ path: this.options.errorScreenshot }).catch(() => {});
        }
        throw new StepError(step, err as Error);
      }
      if (step.voiceover) this.voiceovers.push({ start, end: this.t, text: step.voiceover });
    }
    await this.advance(T.outro);

    return {
      viewport: this.script.viewport,
      deviceScaleFactor: this.options.deviceScaleFactor,
      duration: this.t,
      shots: this.shots,
      pages: this.pages,
      cursorStart: { x: this.script.viewport.width / 2, y: this.script.viewport.height / 2 },
      moves: this.moves,
      clicks: this.clicks,
      focuses: this.focuses,
      captions: this.captions,
      voiceovers: this.voiceovers,
    };
  }

  private async runStep(step: NormalizedStep): Promise<void> {
    switch (step.kind) {
      case 'caption': {
        this.captions.push({ t: this.t, text: step.text, ...(step.duration !== undefined && { duration: step.duration }) });
        if (step.text) {
          const words = step.text.split(/\s+/).length;
          await this.advance(clamp(500 + words * 160, 900, 2200));
        }
        return;
      }
      case 'click': {
        const locator = await this.locate(step.selector);
        const box = await this.bringIntoView(locator);
        const focusStart = this.t;
        await this.moveTo(boxCenter(box));
        await this.advance(T.beforeClick);
        this.clicks.push({ t: this.t, ...this.cursor });
        if (step.double) this.clicks.push({ t: this.t + this.ms(180), ...this.cursor });
        await locator.click({ button: step.button, clickCount: step.double ? 2 : 1 });
        await this.settle();
        await this.snap(T.clickFade);
        this.focuses.push({ start: focusStart, end: this.t + this.ms(300), box });
        await this.advance(T.afterClick);
        return;
      }
      case 'hover': {
        const locator = await this.locate(step.selector);
        const box = await this.bringIntoView(locator);
        await this.moveTo(boxCenter(box));
        await this.settle();
        await this.snap(150);
        await this.advance(T.hover);
        return;
      }
      case 'type':
        return this.type(step);
      case 'press': {
        await this.page.keyboard.press(step.key);
        await this.settle();
        await this.snap(T.clickFade);
        await this.advance(T.afterClick);
        return;
      }
      case 'select': {
        const locator = await this.locate(step.selector);
        const box = await this.bringIntoView(locator);
        const focusStart = this.t;
        await this.moveTo(boxCenter(box));
        await this.advance(T.beforeClick);
        this.clicks.push({ t: this.t, ...this.cursor });
        await locator.selectOption(step.value);
        await this.settle();
        await this.snap(150);
        this.focuses.push({ start: focusStart, end: this.t + this.ms(500), box });
        await this.advance(T.afterClick + 200);
        return;
      }
      case 'wait': {
        const timeout = step.timeout ?? Math.max(this.timeout, 30_000);
        if (step.selector) await this.page.locator(step.selector).first().waitFor({ state: 'visible', timeout });
        if (step.url) await this.page.waitForURL(step.url, { timeout });
        if (step.state) await this.page.waitForLoadState(step.state, { timeout });
        if (step.ms !== undefined) await this.page.waitForTimeout(step.ms);
        await this.settle();
        await this.snap(T.waitFade);
        await this.advance(T.afterWait);
        return;
      }
      case 'zoom': {
        const locator = await this.locate(step.selector);
        const box = await this.bringIntoView(locator);
        // The camera eases in over `zoomTransition` before the hold and back out after it.
        const hold = this.ms(step.duration ?? T.zoomHold);
        const transition = T.zoomTransition;
        this.focuses.push({
          start: this.t + transition,
          end: this.t + transition + hold,
          box,
          explicit: true,
          ...(step.scale !== undefined && { scale: step.scale }),
        });
        await this.advance(transition * 2 + hold, false);
        return;
      }
      case 'scroll':
        return this.scroll(step);
      case 'pause': {
        // Let the page finish whatever it was doing, then hold the frame.
        await this.page.waitForTimeout(Math.min(step.ms, 3000));
        await this.snap(250);
        await this.advance(step.ms);
        return;
      }
      case 'goto': {
        const url = new URL(step.url, this.page.url()).href;
        await this.page.goto(url, { waitUntil: 'load', timeout: Math.max(this.timeout, 30_000) });
        await this.settle();
        await this.snap(300);
        await this.advance(T.gotoHold);
        return;
      }
    }
  }

  private async type(step: Extract<NormalizedStep, { kind: 'type' }>): Promise<void> {
    let box: Box;
    const focusStart = this.t;
    if (step.selector) {
      const locator = await this.locate(step.selector);
      box = await this.bringIntoView(locator);
      await this.moveTo(boxCenter(box));
      await this.advance(T.beforeClick);
      this.clicks.push({ t: this.t, ...this.cursor });
      await locator.click();
      if (step.clear) await locator.fill('');
      if (step.hidden) {
        await locator.evaluate((el) => {
          if (!(el instanceof HTMLInputElement && el.type === 'password')) {
            el.style.setProperty('-webkit-text-security', 'disc');
          }
        });
      }
      await this.snap(120);
    } else {
      const rect = await this.page.evaluate(() => {
        const r = document.activeElement?.getBoundingClientRect();
        return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
      });
      box = rect ?? { x: 0, y: 0, width: this.script.viewport.width, height: this.script.viewport.height };
    }

    const schedule = typingSchedule(step.text, { rng: this.rng, speed: this.options.speed });
    const start = this.t + this.ms(180);
    const frame = 1000 / this.options.fps;
    const chars = [...step.text];
    for (let i = 0; i < chars.length; i++) {
      await this.page.keyboard.type(chars[i] as string);
      const at = start + (schedule[i] ?? 0);
      const next = schedule[i + 1];
      // Only take a screenshot when the next character lands in a later video frame.
      if (next === undefined || Math.floor((start + next) / frame) !== Math.floor(at / frame)) {
        this.t = at;
        await this.snap(0);
        if (this.options.headed) await this.page.waitForTimeout(next === undefined ? 0 : next - (schedule[i] ?? 0));
      }
    }
    this.t = start + (schedule[schedule.length - 1] ?? 0);
    await this.advance(T.afterType);
    if (step.submit) {
      await this.page.keyboard.press('Enter');
      await this.settle();
      await this.snap(T.clickFade);
      await this.advance(T.afterClick);
    }
    this.focuses.push({ start: focusStart, end: this.t, box });
  }

  private async scroll(step: Extract<NormalizedStep, { kind: 'scroll' }>): Promise<void> {
    const container = step.container ? await this.locate(step.container) : null;
    const current = container
      ? await container.evaluate((el) => el.scrollTop)
      : await this.page.evaluate(() => window.scrollY);
    let target: number;
    if (step.to) {
      const el = await this.locate(step.to);
      const box = await this.boxOf(el);
      if (container) {
        const cbox = await this.boxOf(container);
        target = current + box.y - cbox.y - 16;
      } else target = current + box.y - 80;
    } else if (step.by !== undefined) target = current + step.by;
    else target = step.y ?? current;
    await this.animateScroll(target, container, step.duration);
    await this.advance(350);
  }

  /** Smoothly scroll the page (or a container) to `target`, taking one screenshot per video frame. */
  private async animateScroll(target: number, container: Locator | null, duration?: number): Promise<void> {
    const max = container
      ? await container.evaluate((el) => el.scrollHeight - el.clientHeight)
      : await this.page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    const from = container
      ? await container.evaluate((el) => el.scrollTop)
      : await this.page.evaluate(() => window.scrollY);
    const to = clamp(Math.round(target), 0, Math.max(0, max));
    const distance = Math.abs(to - from);
    if (distance < 1) return;
    const ms = this.ms(duration ?? clamp(450 + distance * 0.55, 600, 1600));
    const frames = Math.max(1, Math.round((ms / 1000) * this.options.fps));
    const t0 = this.t;
    for (let i = 1; i <= frames; i++) {
      const y = from + (to - from) * easeInOutCubic(i / frames);
      if (container) await container.evaluate((el, top) => el.scrollTo({ top, behavior: 'instant' }), y);
      else await this.page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
      this.t = t0 + (ms * i) / frames;
      await this.snap(0);
    }
    this.t = t0 + ms;
  }

  private async locate(selector: string): Promise<Locator> {
    const locator = this.page.locator(selector).first();
    await locator.waitFor({ state: 'visible', timeout: this.timeout });
    return locator;
  }

  private async boxOf(locator: Locator): Promise<Box> {
    const box = await locator.boundingBox();
    if (!box) throw new Error('Element is not visible on the page');
    return box;
  }

  /** Make sure the element is visible in the viewport, scrolling smoothly if needed. Returns its box. */
  private async bringIntoView(locator: Locator): Promise<Box> {
    const box = await this.boxOf(locator);
    const { height } = this.script.viewport;
    const margin = 24;
    if (box.y >= margin && box.y + box.height <= height - margin) return box;
    const current = await this.page.evaluate(() => window.scrollY);
    const centerOffset = box.y + box.height / 2 - height * 0.45;
    await this.animateScroll(current + centerOffset, null);
    await this.advance(150);
    const after = await this.boxOf(locator);
    if (after.y + after.height < 0 || after.y > height) {
      // The element may live in a scrollable container; let Playwright handle it.
      await locator.scrollIntoViewIfNeeded();
      await this.snap(200);
      return this.boxOf(locator);
    }
    return after;
  }

  private async moveTo(point: Point): Promise<void> {
    const move = planCursorMove(this.cursor, point, this.t, { rng: this.rng, speed: this.options.speed });
    if (move.t1 > move.t0) {
      this.moves.push(move);
      if (this.options.headed) {
        await this.page
          .evaluate(
            ([m, ms]) => (window as unknown as { __scriptreel?: { move: (...a: unknown[]) => void } }).__scriptreel?.move(m.p0, m.c1, m.c2, m.p1, ms),
            [move, move.t1 - move.t0] as const,
          )
          .catch(() => {});
        await this.page.waitForTimeout(move.t1 - move.t0);
      }
      this.t = move.t1;
    }
    this.cursor = point;
    await this.page.mouse.move(point.x, point.y);
    await this.snap(120);
  }

  /** Wait for the page to finish reacting to the last action. */
  private async settle(): Promise<void> {
    const page = this.page;
    await page.waitForTimeout(80);
    await page.waitForLoadState('load', { timeout: this.timeout }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {});
    await page.evaluate(() => document.fonts?.ready.then(() => true)).catch(() => {});
    if (this.options.headed) {
      await page
        .evaluate(
          ([x, y]) => (window as unknown as { __scriptreel?: { set: (x: number, y: number) => void } }).__scriptreel?.set(x, y),
          [this.cursor.x, this.cursor.y] as const,
        )
        .catch(() => {});
    }
  }

  private async markBlurred(): Promise<void> {
    for (const selector of this.options.blur) {
      await this.page
        .locator(selector)
        .evaluateAll((els, attr) => els.forEach((el) => el.setAttribute(attr, '')), BLUR_ATTR)
        .catch(() => {});
    }
  }

  /** Take a screenshot and show it from the current time, cross-fading over `fade` ms. */
  private async snap(fade: number): Promise<void> {
    await this.markBlurred();
    const buffer = await this.screenshot();
    if (this.lastShot && buffer.equals(this.lastShot)) return;
    this.lastShot = buffer;
    const file = join(this.options.workDir, `shot-${String(this.shots.length).padStart(5, '0')}.png`);
    await writeFile(file, buffer);
    this.shots.push({ file, url: this.page.url() });
    const key = { t: this.t, shot: this.shots.length - 1, fade: this.ms(fade) };
    // Two screenshots at the same moment: the newer one wins.
    const last = this.pages[this.pages.length - 1];
    if (last && last.t >= this.t) this.pages[this.pages.length - 1] = { ...key, fade: last.fade };
    else this.pages.push(key);
  }

  private async screenshot(): Promise<Buffer> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.page.screenshot({
          type: 'png',
          animations: 'disabled',
          caret: 'hide',
          style: this.screenshotStyle,
          timeout: this.timeout,
        });
      } catch (err) {
        // A navigation can race with the screenshot; wait for it and retry.
        if (attempt >= 2) throw err;
        await this.page.waitForLoadState('load').catch(() => {});
      }
    }
  }

  /** Move the virtual clock forward. `ms` is divided by the speed unless `scale` is false. */
  private async advance(ms: number, scale = true): Promise<void> {
    const scaled = scale ? this.ms(ms) : Math.round(ms);
    if (this.options.headed && scaled > 0) await this.page.waitForTimeout(scaled);
    this.t += scaled;
  }
}
