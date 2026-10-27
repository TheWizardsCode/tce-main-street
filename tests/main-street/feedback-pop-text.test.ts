/**
 * Main Street: transient feedback channel (unit)
 *
 * Contract for the persistent-instruction-line replacement (parent
 * MS-0MVKTB6WS000VLWK AC4/AC6, item MS-0MVPWQK3U003DIR6). Former hint-line
 * messages are routed through `flashFeedback`:
 *
 *   - refusals/errors and confirmations → short-lived pop text
 *   - phase-teaching guidance and self-resolving progress lines → dropped
 *
 * The anchor is derived from layout values (above the hand band), so it
 * follows the hand when the hand bottom-anchoring item moves it — no
 * hard-coded pixel position.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { popTextOrIconMock } = vi.hoisted(() => ({
  popTextOrIconMock: vi.fn((_opts?: any) => Promise.resolve()),
}));

vi.mock('@ui/popTextOrIcon', () => ({ popTextOrIcon: popTextOrIconMock }));

import {
  feedbackAnchor,
  flashConfirmation,
  flashError,
  flashFeedback,
} from '../../src/scenes/MainStreetFeedback';

interface FakeText {
  text: string;
  destroyed: boolean;
  setOrigin: () => FakeText;
  setDepth: () => FakeText;
  destroy: () => void;
}

function makeScene(overrides: Record<string, any> = {}): any {
  const created: FakeText[] = [];
  const delayed: Array<{ ms: number; cb: () => void }> = [];
  const scene: any = {
    layout: { logX: 820, handY: 620, handCardW: 140, handCardH: 80, gameW: 1280, gameH: 720 },
    settingsPanel: { reducedMotion: false },
    add: {
      text: (_x: number, _y: number, text: string) => {
        const obj: FakeText = {
          text,
          destroyed: false,
          setOrigin: () => obj,
          setDepth: () => obj,
          destroy: () => { obj.destroyed = true; },
        };
        created.push(obj);
        return obj;
      },
    },
    time: {
      delayedCall: (ms: number, cb: () => void) => { delayed.push({ ms, cb }); return {}; },
    },
    ...overrides,
  };
  (scene as any).__created = created;
  (scene as any).__delayed = delayed;
  return scene;
}

beforeEach(() => {
  popTextOrIconMock.mockClear();
});

describe('flashFeedback classification', () => {
  it('pops refusals/errors and records them', () => {
    const scene = makeScene();
    flashError(scene, 'Not enough coins to place Bakery.');

    expect(scene.lastFeedback).toEqual({
      text: 'Not enough coins to place Bakery.',
      kind: 'error',
    });
    expect(scene.feedbackHistory).toEqual([
      { text: 'Not enough coins to place Bakery.', kind: 'error' },
    ]);
    expect(popTextOrIconMock).toHaveBeenCalledTimes(1);
    expect(popTextOrIconMock.mock.calls[0][0]).toMatchObject({
      scene,
      label: 'Not enough coins to place Bakery.',
      x: 410, // logX / 2
      y: 600, // handY − 20 (above the hand band)
    });
  });

  it('pops confirmations and records them', () => {
    const scene = makeScene();
    flashConfirmation(scene, 'Applied "Bookshop" to slot 2 (listed price)');

    expect(scene.lastFeedback.kind).toBe('confirmation');
    expect(popTextOrIconMock).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Applied "Bookshop" to slot 2 (listed price)' }),
    );
  });

  it('drops guidance and progress lines instead of resurrecting them as pop text', () => {
    const scene = makeScene();
    flashFeedback(scene, 'Click an empty slot to place "Bakery"', { kind: 'guidance' });
    flashFeedback(scene, 'Placing "Bakery"...', { kind: 'progress' });

    expect(scene.lastFeedback).toBeUndefined();
    expect(scene.feedbackHistory).toBeUndefined();
    expect(popTextOrIconMock).not.toHaveBeenCalled();
  });

  it('ignores empty messages', () => {
    const scene = makeScene();
    flashError(scene, '');
    flashError(scene, undefined);
    flashConfirmation(scene, null);

    expect(scene.lastFeedback).toBeUndefined();
    expect(popTextOrIconMock).not.toHaveBeenCalled();
  });
});

describe('feedbackAnchor', () => {
  it('sits above the hand band using layout values', () => {
    expect(feedbackAnchor({ logX: 820, handY: 620, gameW: 1280, gameH: 720 }))
      .toEqual({ x: 410, y: 600 });
  });

  it('follows the hand when the hand anchoring moves (no hard-coded position)', () => {
    expect(feedbackAnchor({ logX: 820, handY: 630, gameW: 1280, gameH: 720 }))
      .toEqual({ x: 410, y: 610 });
  });

  it('falls back safely when layout metrics are missing', () => {
    expect(feedbackAnchor({ logX: NaN, handY: NaN, gameW: 1280, gameH: 720 }))
      .toEqual({ x: 640, y: 680 });
  });
});

describe('reduced-motion path', () => {
  it('surfaces a static, no-tween message rather than dropping it', () => {
    const scene = makeScene({ settingsPanel: { reducedMotion: true } });
    flashError(scene, 'Hand full: place or sell a card first.');

    // The message is surfaced and recorded…
    expect(scene.lastFeedback.text).toBe('Hand full: place or sell a card first.');
    // …as a real text object created at the anchor (not a movement tween)…
    expect(scene.__created).toHaveLength(1);
    expect(scene.__created[0].text).toBe('Hand full: place or sell a card first.');
    // …and it is torn down after a bounded hold.
    expect(scene.__delayed).toHaveLength(1);
    expect(scene.__delayed[0].ms).toBeGreaterThan(0);
    scene.__delayed[0].cb();
    expect(scene.__created[0].destroyed).toBe(true);
    // No animated pop tween.
    expect(popTextOrIconMock).not.toHaveBeenCalled();
  });
});
