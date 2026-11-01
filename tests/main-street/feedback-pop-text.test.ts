/**
 * Main Street: transient feedback toast (unit)
 *
 * Contract for the persistent-instruction-line replacement (parent
 * MS-0MVKTB6WS000VLWK AC4/AC6, item MS-0MVPWQK3U003DIR6) and its readability
 * rework (MS-0MVRDBD3P0026CXH). Former hint-line messages are routed through
 * `flashFeedback`:
 *
 *   - refusals/errors and confirmations → a readable toast
 *   - phase-teaching guidance and self-resolving progress lines → dropped
 *
 * The toast fades/scales in, holds fully opaque for `words × 500 ms`, then
 * fades out — always above every Main Street layer and lifted clear of the
 * hand-card band. Reduced motion shows the same static hold with no tweens.
 * Only one toast is live per scene; a new message replaces the previous one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FEEDBACK_TOAST_DEPTH,
  FEEDBACK_TOAST_FADE_IN_MS,
  FEEDBACK_TOAST_FADE_OUT_MS,
  FEEDBACK_TOAST_MARGIN_PX,
  FEEDBACK_TOAST_MAX_WIDTH,
  FEEDBACK_WORD_HOLD_MS,
} from '../../src/scenes/MainStreetConstants';
import {
  feedbackAnchor,
  feedbackHoldMs,
  flashConfirmation,
  flashError,
  flashFeedback,
} from '../../src/scenes/MainStreetFeedback';

// ── Fake Phaser plumbing ───────────────────────────────────

interface FakeTween {
  config: any;
  stopped: boolean;
}

interface FakeTimer {
  ms: number;
  cb: () => void;
  removed: boolean;
}

interface FakeText {
  x: number;
  y: number;
  text: string;
  style: any;
  alpha: number;
  scaleX: number;
  scaleY: number;
  depth: number;
  originX: number;
  originY: number;
  wordWrapWidth: number | null;
  destroyed: boolean;
  interactive: boolean;
  setOrigin: (x: number, y?: number) => FakeText;
  setDepth: (depth: number) => FakeText;
  setAlpha: (alpha: number) => FakeText;
  setScale: (scale: number) => FakeText;
  setWordWrapWidth: (width: number) => FakeText;
  setInteractive: () => FakeText;
  destroy: () => void;
}

function makeFakeText(text: string, style: any): FakeText {
  const obj: FakeText = {
    x: 0,
    y: 0,
    text,
    style,
    alpha: 1,
    scaleX: 1,
    scaleY: 1,
    depth: 0,
    originX: 0.5,
    originY: 0.5,
    wordWrapWidth: null,
    destroyed: false,
    interactive: false,
    setOrigin: (x: number, y?: number) => {
      obj.originX = x;
      obj.originY = y ?? x;
      return obj;
    },
    setDepth: (depth: number) => {
      obj.depth = depth;
      return obj;
    },
    setAlpha: (alpha: number) => {
      obj.alpha = alpha;
      return obj;
    },
    setScale: (scale: number) => {
      obj.scaleX = scale;
      obj.scaleY = scale;
      return obj;
    },
    setWordWrapWidth: (width: number) => {
      obj.wordWrapWidth = width;
      return obj;
    },
    setInteractive: () => {
      obj.interactive = true;
      return obj;
    },
    destroy: () => {
      obj.destroyed = true;
    },
  };
  return obj;
}

function makeScene(overrides: Record<string, any> = {}): any {
  const created: FakeText[] = [];
  const tweens: FakeTween[] = [];
  const timers: FakeTimer[] = [];
  const events: Record<string, Array<() => void>> = {};

  const scene: any = {
    layout: { logX: 820, handY: 620, handCardW: 140, handCardH: 80, gameW: 1280, gameH: 720 },
    settingsPanel: { reducedMotion: false },
    add: {
      text: (x: number, y: number, text: string, style: any) => {
        const obj = makeFakeText(text, style);
        obj.x = x;
        obj.y = y;
        created.push(obj);
        return obj;
      },
    },
    tweens: {
      add: (config: any) => {
        const tween: FakeTween = { config, stopped: false };
        tweens.push(tween);
        return {
          stop: () => {
            tween.stopped = true;
          },
        };
      },
    },
    time: {
      delayedCall: (ms: number, cb: () => void) => {
        const timer: FakeTimer = { ms, cb, removed: false };
        timers.push(timer);
        return {
          remove: () => {
            timer.removed = true;
          },
        };
      },
    },
    events: {
      once: (name: string, cb: () => void) => {
        (events[name] ??= []).push(cb);
      },
    },
    ...overrides,
  };

  scene.__created = created;
  scene.__tweens = tweens;
  scene.__timers = timers;
  scene.__events = events;
  return scene;
}

/** Apply a tween's target values and run its `onComplete` (fake time step). */
function completeTween(tween: FakeTween): void {
  const { targets, alpha, scaleX, scaleY } = tween.config;
  if (targets) {
    if (alpha !== undefined) targets.alpha = alpha;
    if (scaleX !== undefined) targets.scaleX = scaleX;
    if (scaleY !== undefined) targets.scaleY = scaleY;
  }
  tween.config.onComplete?.();
}

const FIVE_WORDS = 'Not enough coins for Bakery';

beforeEach(() => {
  vi.clearAllMocks();
});

// ── AC1: word-based hold ───────────────────────────────────

describe('feedbackHoldMs', () => {
  it('holds one word for 500 ms', () => {
    expect(feedbackHoldMs('Refused')).toBe(FEEDBACK_WORD_HOLD_MS);
  });

  it('holds a 5-word refusal for 2.5 s', () => {
    expect(feedbackHoldMs(FIVE_WORDS)).toBe(5 * FEEDBACK_WORD_HOLD_MS);
    expect(feedbackHoldMs(FIVE_WORDS)).toBe(2500);
  });

  it('scales linearly: 10 words hold for 5 s', () => {
    expect(feedbackHoldMs('one two three four five six seven eight nine ten'))
      .toBe(10 * FEEDBACK_WORD_HOLD_MS);
    expect(feedbackHoldMs('one two three four five six seven eight nine ten')).toBe(5000);
  });

  it('collapses extra whitespace instead of counting it as words', () => {
    expect(feedbackHoldMs('  two\n\nwords\there  ')).toBe(3 * FEEDBACK_WORD_HOLD_MS);
  });

  it('returns 0 for empty and whitespace-only text (no toast)', () => {
    expect(feedbackHoldMs('')).toBe(0);
    expect(feedbackHoldMs('   \n\t ')).toBe(0);
  });
});

// ── AC2: animate → pause → fade ────────────────────────────

describe('animated toast sequence', () => {
  it('fades in, holds fully opaque for the word-based hold, then fades out and destroys', () => {
    const scene = makeScene();
    flashError(scene, FIVE_WORDS);

    expect(scene.__created).toHaveLength(1);
    const text = scene.__created[0];

    // Fade/scale in.
    expect(scene.__tweens).toHaveLength(1);
    const fadeIn = scene.__tweens[0];
    expect(fadeIn.config.targets).toBe(text);
    expect(fadeIn.config.alpha).toBe(1);
    expect(fadeIn.config.duration).toBe(FEEDBACK_TOAST_FADE_IN_MS);

    // Nothing is scheduled while the fade-in is still running.
    expect(scene.__timers).toHaveLength(0);

    completeTween(fadeIn);

    // Fully opaque, no further motion, hold timer scheduled for the word count.
    expect(text.alpha).toBe(1);
    expect(scene.__timers).toHaveLength(1);
    expect(scene.__timers[0].ms).toBe(5 * FEEDBACK_WORD_HOLD_MS);
    expect(scene.__tweens).toHaveLength(1); // no fade during the pause

    // Hold elapses → fade out begins.
    scene.__timers[0].cb();
    expect(scene.__tweens).toHaveLength(2);
    const fadeOut = scene.__tweens[1];
    expect(fadeOut.config.targets).toBe(text);
    expect(fadeOut.config.alpha).toBe(0);
    expect(fadeOut.config.duration).toBe(FEEDBACK_TOAST_FADE_OUT_MS);
    expect(text.destroyed).toBe(false);

    // Fade out completes → destruction.
    completeTween(fadeOut);
    expect(text.destroyed).toBe(true);
  });

  it('keeps alpha at 1 for the whole hold (no motion during the pause)', () => {
    const scene = makeScene();
    flashError(scene, 'Refused');
    completeTween(scene.__tweens[0]);

    const text = scene.__created[0];
    expect(text.alpha).toBe(1);
    expect(text.scaleX).toBe(1);
    expect(text.scaleY).toBe(1);
    expect(scene.__tweens.map((t: FakeTween) => t.config.duration)).toEqual([FEEDBACK_TOAST_FADE_IN_MS]);

    // Halfway through the hold nothing has changed.
    expect(scene.__timers[0].removed).toBe(false);
    expect(text.alpha).toBe(1);
    expect(text.destroyed).toBe(false);
  });

  it('honours an explicit hold override (holdMs) for tests/back-compat', () => {
    const scene = makeScene();
    flashError(scene, FIVE_WORDS, { holdMs: 120 });
    completeTween(scene.__tweens[0]);

    expect(scene.__timers).toHaveLength(1);
    expect(scene.__timers[0].ms).toBe(120);
  });
});

// ── AC3: always above, clear of the hand ───────────────────

describe('feedbackAnchor', () => {
  it('lifts clear of the hand-card band using layout values', () => {
    expect(feedbackAnchor({ logX: 820, handY: 620, handCardH: 80, gameW: 1280, gameH: 720 }))
      .toEqual({ x: 410, y: 620 - 80 / 2 - FEEDBACK_TOAST_MARGIN_PX });
  });

  it('follows the hand when the hand anchoring moves (no hard-coded position)', () => {
    expect(feedbackAnchor({ logX: 820, handY: 630, handCardH: 80, gameW: 1280, gameH: 720 }).y)
      .toBe(630 - 40 - FEEDBACK_TOAST_MARGIN_PX);
  });

  it('follows the hand-card height (taller cards lift the toast further)', () => {
    const short = feedbackAnchor({ logX: 820, handY: 620, handCardH: 80, gameW: 1280, gameH: 720 });
    const tall = feedbackAnchor({ logX: 820, handY: 620, handCardH: 160, gameW: 1280, gameH: 720 });
    expect(short.y - tall.y).toBe(40);
  });

  it('falls back to the plain lift when the hand-card height is missing', () => {
    expect(feedbackAnchor({ logX: 820, handY: 620, gameW: 1280, gameH: 720 }))
      .toEqual({ x: 410, y: 620 - FEEDBACK_TOAST_MARGIN_PX });
  });

  it('falls back safely when layout metrics are missing', () => {
    expect(feedbackAnchor({ logX: NaN, handY: NaN, gameW: 1280, gameH: 720 }))
      .toEqual({ x: 640, y: 680 });
  });

  it('renders the toast at the lifted anchor and the named top depth', () => {
    const scene = makeScene();
    flashError(scene, FIVE_WORDS);

    const text = scene.__created[0];
    expect(text.x).toBe(410);
    expect(text.y).toBe(620 - 40 - FEEDBACK_TOAST_MARGIN_PX);
    expect(text.depth).toBe(FEEDBACK_TOAST_DEPTH);
    expect(FEEDBACK_TOAST_DEPTH).toBeGreaterThan(1100); // stats button — the top layer
  });
});

// ── AC4: one readable toast, wrapped ──────────────────────

describe('wrap width and legibility', () => {
  it('wraps long messages at the named max width on a 1280-wide viewport', () => {
    const scene = makeScene();
    flashError(scene, FIVE_WORDS);

    expect(scene.__created[0].wordWrapWidth).toBe(FEEDBACK_TOAST_MAX_WIDTH);
  });

  it('narrows the wrap width on a small viewport (gameW − 40)', () => {
    const scene = makeScene({ layout: { logX: 820, handY: 620, handCardH: 80, gameW: 600, gameH: 720 } });
    flashError(scene, FIVE_WORDS);

    expect(scene.__created[0].wordWrapWidth).toBe(600 - 40);
    expect(scene.__created[0].wordWrapWidth).toBeLessThan(FEEDBACK_TOAST_MAX_WIDTH);
  });

  it('uses the contract text style: 18px bold white with a dark stroke', () => {
    const scene = makeScene();
    flashError(scene, FIVE_WORDS);

    const style = scene.__created[0].style;
    expect(style.fontSize).toBe('18px');
    expect(style.fontStyle).toBe('bold');
    expect(style.color).toBe('#ffffff');
    expect(style.stroke).toBeTruthy();
    expect(style.strokeThickness).toBeGreaterThan(0);
  });

  it('is presentation-only: the toast never becomes interactive', () => {
    const scene = makeScene();
    flashError(scene, FIVE_WORDS);

    expect(scene.__created[0].interactive).toBe(false);
  });
});

describe('replacement (one live toast per scene)', () => {
  it('destroys the previous toast, cancels its fade-in and hold, and starts fresh', () => {
    const scene = makeScene();
    flashError(scene, FIVE_WORDS);
    const first = scene.__created[0];
    const firstFadeIn = scene.__tweens[0];
    completeTween(firstFadeIn);
    const firstHold = scene.__timers[0];

    flashConfirmation(scene, 'Applied "Bookshop" to slot 2');

    expect(scene.__created).toHaveLength(2);
    expect(first.destroyed).toBe(true);
    expect(firstFadeIn.stopped).toBe(true);
    expect(firstHold.removed).toBe(true);
    // A single live toast: exactly one fade-in tween in flight.
    expect(scene.__tweens.filter((t: FakeTween) => !t.stopped)).toHaveLength(1);
  });

  it('ignores late callbacks from a replaced toast (no ghost fade, new toast survives)', () => {
    const scene = makeScene();
    flashError(scene, FIVE_WORDS);
    const first = scene.__created[0];
    const firstFadeIn = scene.__tweens[0];
    completeTween(firstFadeIn);
    const firstHold = scene.__timers[0];

    flashConfirmation(scene, 'Applied "Bookshop" to slot 2');
    const second = scene.__created[1];
    const tweenCount = scene.__tweens.length;

    expect(first.destroyed).toBe(true);

    // A stale hold timer and stale fade-in completion must not touch the new toast.
    firstHold.cb();
    completeTween(firstFadeIn);

    expect(scene.__tweens).toHaveLength(tweenCount);
    expect(second.destroyed).toBe(false);
    expect(scene.__timers.filter((t: FakeTimer) => !t.removed && t !== firstHold)).toHaveLength(0);
  });

  it('cancels a fade-out already in progress when a new message arrives', () => {
    const scene = makeScene();
    flashError(scene, 'Refused');
    completeTween(scene.__tweens[0]);
    const first = scene.__created[0];
    scene.__timers[0].cb();
    const fadeOut = scene.__tweens[1];

    flashConfirmation(scene, 'Applied "Bookshop" to slot 2');
    const second = scene.__created[1];

    expect(fadeOut.stopped).toBe(true);
    expect(first.destroyed).toBe(true);

    // The replaced fade-out completing late must not destroy the new toast.
    completeTween(fadeOut);
    expect(second.destroyed).toBe(false);
  });

  it('cleans up timers and text on scene shutdown', () => {
    const scene = makeScene();
    flashError(scene, FIVE_WORDS);
    completeTween(scene.__tweens[0]);
    const text = scene.__created[0];
    const timer = scene.__timers[0];

    expect(scene.__events.shutdown?.length).toBeGreaterThan(0);
    for (const cb of scene.__events.shutdown) cb();

    expect(text.destroyed).toBe(true);
    expect(timer.removed).toBe(true);
  });
});

// ── AC2: reduced motion ────────────────────────────────────

describe('reduced-motion path', () => {
  it('shows a static toast at the top depth for the same hold, with no tweens', () => {
    const scene = makeScene({ settingsPanel: { reducedMotion: true } });
    flashError(scene, FIVE_WORDS);

    expect(scene.__created).toHaveLength(1);
    const text = scene.__created[0];
    expect(text.text).toBe(FIVE_WORDS);
    expect(text.alpha).toBe(1);
    expect(text.depth).toBe(FEEDBACK_TOAST_DEPTH);
    expect(scene.__tweens).toHaveLength(0);

    expect(scene.__timers).toHaveLength(1);
    expect(scene.__timers[0].ms).toBe(5 * FEEDBACK_WORD_HOLD_MS);

    scene.__timers[0].cb();
    expect(text.destroyed).toBe(true);
  });

  it('replaces the previous reduced-motion toast rather than stacking', () => {
    const scene = makeScene({ settingsPanel: { reducedMotion: true } });
    flashError(scene, FIVE_WORDS);
    const first = scene.__created[0];
    const firstHold = scene.__timers[0];

    flashConfirmation(scene, 'Applied "Bookshop" to slot 2');

    expect(first.destroyed).toBe(true);
    expect(firstHold.removed).toBe(true);
    expect(scene.__created).toHaveLength(2);
  });
});

// ── AC5: existing feedback contract unchanged ──────────────

describe('flashFeedback classification', () => {
  it('surfaces and records refusals/errors', () => {
    const scene = makeScene();
    flashError(scene, FIVE_WORDS);

    expect(scene.lastFeedback).toEqual({ text: FIVE_WORDS, kind: 'error' });
    expect(scene.feedbackHistory).toEqual([{ text: FIVE_WORDS, kind: 'error' }]);
    expect(scene.__created).toHaveLength(1);
  });

  it('surfaces and records confirmations', () => {
    const scene = makeScene();
    flashConfirmation(scene, 'Applied "Bookshop" to slot 2 (listed price)');

    expect(scene.lastFeedback).toEqual({
      text: 'Applied "Bookshop" to slot 2 (listed price)',
      kind: 'confirmation',
    });
    expect(scene.__created).toHaveLength(1);
  });

  it('drops guidance and progress lines instead of resurrecting them as toast', () => {
    const scene = makeScene();
    flashFeedback(scene, 'Click an empty slot to place "Bakery"', { kind: 'guidance' });
    flashFeedback(scene, 'Placing "Bakery"...', { kind: 'progress' });

    expect(scene.lastFeedback).toBeUndefined();
    expect(scene.feedbackHistory).toBeUndefined();
    expect(scene.__created).toHaveLength(0);
  });

  it('ignores empty and whitespace-only messages', () => {
    const scene = makeScene();
    flashError(scene, '');
    flashError(scene, undefined);
    flashConfirmation(scene, null);
    flashError(scene, '   ');

    expect(scene.lastFeedback).toBeUndefined();
    expect(scene.__created).toHaveLength(0);
  });

  it('does not throw when the scene has no layout (headless/replay)', () => {
    const scene = makeScene({ layout: undefined });
    expect(() => flashError(scene, FIVE_WORDS)).not.toThrow();
    expect(scene.lastFeedback?.text).toBe(FIVE_WORDS);
    expect(scene.__created).toHaveLength(0);
  });
});
