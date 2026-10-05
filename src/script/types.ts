/** A Playwright locator string, e.g. `text=Log in`, `#email`, `role=button[name="Save"]`. */
export type Selector = string;

export interface Viewport {
  width: number;
  height: number;
}

export type ZoomLevel = 'off' | 'subtle' | 'strong';
export type FrameTheme = 'light' | 'dark';

/** Video settings that may be set in the script and overridden on the command line. */
export interface VideoSettings {
  /** Output size as `WIDTHxHEIGHT` or a preset name (youtube, reel, square). */
  size?: string;
  fps?: number;
  zoom?: ZoomLevel;
  theme?: FrameTheme;
  /** A color, a gradient (`#a, #b`, `linear-gradient(...)`) or a preset name. */
  background?: string;
  captions?: boolean;
  /** Playback speed multiplier for cursor movement, typing and pauses. */
  speed?: number;
  /** Selectors whose elements are blurred in every frame. */
  blur?: Selector[];
  /** Seed for the small random variations in cursor paths and typing. */
  seed?: number;
  /** Device scale factor for screenshots. `auto` picks one that stays sharp when zoomed. */
  deviceScaleFactor?: number | 'auto';
}

export interface DemoScript extends VideoSettings {
  url: string;
  viewport?: Viewport;
  steps: Step[];
}

/** Fields that may be added to any step. */
export interface StepModifiers {
  /** Voice-over text for this step, written to an .srt file next to the video. */
  voiceover?: string;
}

export type Step = Action & StepModifiers;

export type Action =
  | { caption: string | null | { text: string | null; duration?: number } }
  | { click: Selector | ClickOptions }
  | { hover: Selector | { selector: Selector } }
  | { type: TypeOptions }
  | { press: string }
  | { select: { selector: Selector; value: string | string[] } }
  | { wait: number | Selector | WaitOptions }
  | { zoom: Selector | ZoomOptions }
  | { scroll: Selector | number | ScrollOptions }
  | { pause: number }
  | { goto: string };

export interface ClickOptions {
  selector: Selector;
  button?: 'left' | 'right' | 'middle';
  double?: boolean;
}

export interface TypeOptions {
  selector?: Selector;
  text: string;
  /** Mask the typed value in the video and in logs. */
  hidden?: boolean;
  /** Clear the field before typing. Default true. */
  clear?: boolean;
  /** Press Enter after typing. */
  submit?: boolean;
}

export interface WaitOptions {
  selector?: Selector;
  url?: string;
  state?: 'load' | 'domcontentloaded' | 'networkidle';
  timeout?: number;
}

export interface ZoomOptions {
  selector: Selector;
  scale?: number;
  duration?: number;
}

export interface ScrollOptions {
  /** Scroll so this element sits near the top of the viewport. */
  to?: Selector;
  /** Scroll by this many pixels (negative scrolls up). */
  by?: number;
  /** Scroll to this absolute y position. */
  y?: number;
  /** Scroll inside this element instead of the page. */
  container?: Selector;
  duration?: number;
}

/** Normalized steps used internally after parsing. */
export type NormalizedStep = (
  | { kind: 'caption'; text: string | null; duration?: number }
  | { kind: 'click'; selector: Selector; button: 'left' | 'right' | 'middle'; double: boolean }
  | { kind: 'hover'; selector: Selector }
  | {
      kind: 'type';
      selector?: Selector;
      text: string;
      hidden: boolean;
      clear: boolean;
      submit: boolean;
    }
  | { kind: 'press'; key: string }
  | { kind: 'select'; selector: Selector; value: string[] }
  | { kind: 'wait'; ms?: number; selector?: Selector; url?: string; state?: WaitOptions['state']; timeout?: number }
  | { kind: 'zoom'; selector: Selector; scale?: number; duration?: number }
  | {
      kind: 'scroll';
      to?: Selector;
      by?: number;
      y?: number;
      container?: Selector;
      duration?: number;
    }
  | { kind: 'pause'; ms: number }
  | { kind: 'goto'; url: string }
) & { voiceover?: string; index: number; label: string };

export interface ParsedScript extends VideoSettings {
  url: string;
  viewport: Viewport;
  steps: NormalizedStep[];
  /** Values that came from environment variables; redacted in logs. */
  secrets: string[];
}
