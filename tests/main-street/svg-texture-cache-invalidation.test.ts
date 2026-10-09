import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import { MainStreetSvgTextureManager } from '../../src/scenes/MainStreetSvgTextureManager';
import { getActiveCsvChecksum, resetTemplatesToDefault, loadTemplatesFromCsv, getActiveCsvData } from '../../src/MainStreetCards';
import { checkForCsvMismatchAndRegenerate } from '../../src/scenes/MainStreetLifecycleManagerCampaign';
import { CARD_BACK_TEMPLATE } from '../../src/scenes/MainStreetConstants';

function setDevicePixelRatio(value: number): void {
  const globalAny = globalThis as any;
  if (!globalAny.window) {
    globalAny.window = {};
  }
  Object.defineProperty(globalAny.window, 'devicePixelRatio', {
    configurable: true,
    value,
  });
}

afterEach(() => {
  const globalAny = globalThis as any;
  if (globalAny.window && Object.prototype.hasOwnProperty.call(globalAny.window, 'devicePixelRatio')) {
    delete globalAny.window.devicePixelRatio;
  }
});

describe('MainStreetSvgTextureManager cache invalidation', () => {
  it('regenerates SVG sources from CSV without removing cached textures', () => {
    setDevicePixelRatio(1);

    const remove = vi.fn();
    const cardSvgSources = new Map<string, string>();
    // Pre-populate with stale SVGs for a couple of known template IDs
    cardSvgSources.set('biz-bakery', '<svg>stale bakery</svg>');
    cardSvgSources.set('biz-diner', '<svg>stale diner</svg>');

    const scene = {
      cardSvgSources,
      textures: {
        getTextureKeys: () => [
          'ms_card_biz-bakery_100x50@1',
          'ms_card_biz-diner_100x50@1',
        ],
        exists: vi.fn(() => true),
        remove,
      },
    };

    const manager = new MainStreetSvgTextureManager(scene);
    const count = manager.regenerateSvgSourcesFromCsv();

    // Should have regenerated SVGs for all CSV rows
    expect(count).toBeGreaterThan(0);

    // Should NOT remove textures — SVG source updates are separated from
    // texture lifecycle. Textures created by prewarm use the correct
    // CSV-fresh SVGs because regenerateSvgSourcesFromCsv() runs before
    // any prewarm call.
    expect(remove).not.toHaveBeenCalled();

    // SVG sources should be fresh
    const freshBakery = scene.cardSvgSources.get('biz-bakery');
    expect(freshBakery).toBeDefined();
    expect(freshBakery).not.toBe('<svg>stale bakery</svg>');
    expect(freshBakery).toContain('Bakery');
  });

  it('prewarm skips existing textures without removing them', async () => {
    setDevicePixelRatio(1);

    const remove = vi.fn();
    const exists = vi.fn(() => true); // All keys exist
    const cardSvgSources = new Map<string, string>();
    cardSvgSources.set('biz-bakery', '<svg>some bakery</svg>');

    const scene: any = {
      cardSvgSources,
      textures: {
        getTextureKeys: () => ['ms_card_biz-bakery_100x50@1'],
        exists,
        remove,
      },
      state: {
        market: { cards: [{ id: 'biz-bakery-0' }, ].filter(Boolean) },
        incidentDeck: [],
        streetGrid: [],
        hand: [],
      },
      layout: {
        marketCardW: 100,
        marketCardH: 50,
        slotW: 100,
        slotH: 50,
        handW: 80,
        handH: 40,
        queueCardW: 60,
        queueCardH: 30,
      },
    };

    const manager = new MainStreetSvgTextureManager(scene);
    // Regenerate SVG sources (no texture change)
    manager.regenerateSvgSourcesFromCsv();

    // Prewarm — textures already exist, so they should be skipped
    // (no removal, no rasterisation call that could yield)
    const prewarmPromise = manager.prewarmVisibleCardTextures();

    // Should NOT remove any textures — existing textures are kept
    expect(remove).not.toHaveBeenCalled();

    // SVG source should be fresh from CSV regeneration
    const freshSvg = scene.cardSvgSources.get('biz-bakery');
    expect(freshSvg).toBeDefined();
    expect(freshSvg).toContain('Bakery');

    await prewarmPromise;
  });

  it('replaces stale SVG sources with freshly generated ones from CSV', () => {
    setDevicePixelRatio(1);

    const cardSvgSources = new Map<string, string>();
    cardSvgSources.set('biz-bakery', '<svg>stale bakery</svg>');
    cardSvgSources.set('biz-diner', '<svg>stale diner</svg>');

    const scene = {
      cardSvgSources,
      textures: {
        getTextureKeys: () => ['ms_card_biz-bakery_100x50@1'],
        exists: vi.fn(() => true),
        remove: vi.fn(),
      },
    };

    const manager = new MainStreetSvgTextureManager(scene);
    manager.regenerateSvgSourcesFromCsv();

    // The stale SVGs should be replaced with fresh ones
    const freshBakery = scene.cardSvgSources.get('biz-bakery');
    expect(freshBakery).toBeDefined();
    expect(freshBakery).not.toBe('<svg>stale bakery</svg>');
    expect(freshBakery).toContain('Bakery');
    expect(freshBakery).toContain('</svg>');

    const freshDiner = scene.cardSvgSources.get('biz-diner');
    expect(freshDiner).toBeDefined();
    expect(freshDiner).not.toBe('<svg>stale diner</svg>');
    expect(freshDiner).toContain('Diner');
    expect(freshDiner).toContain('</svg>');
  });

  it('does not invalidate textures when DPR is unchanged', () => {
    setDevicePixelRatio(1);

    const remove = vi.fn();
    const scene = {
      textures: {
        getTextureKeys: () => ['ms_card_biz-a_100x50@1', 'other_texture'],
        remove,
      },
    };

    const manager = new MainStreetSvgTextureManager(scene);
    const result = manager.syncDisplayMetrics();

    expect(result).toEqual({ dprChanged: false, removedTextureCount: 0 });
    expect(remove).not.toHaveBeenCalled();
  });

  it('invalidates only ms_card_ textures when DPR changes', () => {
    setDevicePixelRatio(1);

    const remove = vi.fn();
    const scene = {
      textures: {
        getTextureKeys: () => [
          'ms_card_biz-a_100x50@1',
          'ms_card_evt-a_100x50@1',
          'ui_button',
        ],
        remove,
      },
    };

    const manager = new MainStreetSvgTextureManager(scene);
    setDevicePixelRatio(2);

    const result = manager.syncDisplayMetrics();

    expect(result).toEqual({ dprChanged: true, removedTextureCount: 2 });
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenNthCalledWith(1, 'ms_card_biz-a_100x50@1');
    expect(remove).toHaveBeenNthCalledWith(2, 'ms_card_evt-a_100x50@1');
  });
});

/**
 * Minimal scene shape used by the regeneration / fetch tests below. Only the
 * fields the manager actually touches are provided.
 */
function makeSourceScene(overrides: Record<string, unknown> = {}): any {
  return {
    cardSvgSources: new Map<string, string>(),
    cardSvgLoadPromise: Promise.resolve(),
    textures: {
      getTextureKeys: () => [],
      exists: vi.fn(() => false),
      remove: vi.fn(),
    },
    ...overrides,
  };
}

/** Counts manager "Regenerated … card SVGs" log lines on a console.info spy. */
function countRegeneratedLogs(spy: { mock: { calls: unknown[][] } }): number {
  return spy.mock.calls.filter((call) => String(call[0]).includes('Regenerated')).length;
}

describe('MainStreetSvgTextureManager single-regeneration contract', () => {
  beforeEach(() => {
    // Keep the active CSV at the bundled default so the memo key is stable
    // regardless of ordering with other test files.
    resetTemplatesToDefault();
  });

  it('regenerates once per CSV checksum and treats a second call as a cheap no-op', () => {
    setDevicePixelRatio(1);
    const scene = makeSourceScene();
    const manager = new MainStreetSvgTextureManager(scene);

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const first = manager.regenerateSvgSourcesFromCsv();
      const second = manager.regenerateSvgSourcesFromCsv();

      // First call runs the full generation pass…
      expect(first).toBeGreaterThan(0);
      // …the second call is memoised and performs no generation.
      expect(second).toBe(0);
      // …and logs the regeneration exactly once (AC1).
      expect(countRegeneratedLogs(infoSpy)).toBe(1);
    } finally {
      infoSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('re-runs regeneration when the active CSV checksum changes', () => {
    setDevicePixelRatio(1);
    const scene = makeSourceScene();
    const manager = new MainStreetSvgTextureManager(scene);

    const first = manager.regenerateSvgSourcesFromCsv();
    expect(first).toBeGreaterThan(0);

    // Simulate a CSV swap by reloading a checksum-distinct, but structurally
    // valid, copy of the active CSV (append a newline). The memo must notice
    // the changed checksum and re-run the generation pass, then restore the
    // default so other tests are unaffected.
    const originalCsv = getActiveCsvData();
    const bundledChecksum = getActiveCsvChecksum();
    loadTemplatesFromCsv(originalCsv + '\n');
    try {
      expect(getActiveCsvChecksum()).not.toBe(bundledChecksum);
      const afterChange = manager.regenerateSvgSourcesFromCsv();
      expect(afterChange).toBeGreaterThan(0);
    } finally {
      resetTemplatesToDefault();
      // Sanity: the default checksum is restored.
      expect(getActiveCsvChecksum()).toBe(bundledChecksum);
    }
  });

  it('does not overwrite populated cardSvgSources entries when static SVG fetches resolve (AC2)', async () => {
    setDevicePixelRatio(1);
    const scene = makeSourceScene();
    const csvFreshBakery = '<svg id="csv-bakery">Bakery from CSV</svg>';
    scene.cardSvgSources.set('biz-bakery', csvFreshBakery);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn((url: string) => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(`<svg>static ${url}</svg>`),
    })) as any;

    try {
      const manager = new MainStreetSvgTextureManager(scene);
      manager.loadCardSvgSources();
      await scene.cardSvgLoadPromise;

      // A pre-populated entry must survive the late-resolving static fetch.
      expect(scene.cardSvgSources.get('biz-bakery')).toBe(csvFreshBakery);
      // The non-CSV card back is still fetched and stored (guard is
      // template-agnostic — it only skips already-present keys).
      expect(scene.cardSvgSources.get(CARD_BACK_TEMPLATE)).toContain('static');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('keeps CSV-fresh sources after the async fetch chain completes (AC3)', async () => {
    setDevicePixelRatio(1);
    const scene = makeSourceScene();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve('<svg>static stale source</svg>'),
    })) as any;

    try {
      const manager = new MainStreetSvgTextureManager(scene);
      manager.loadCardSvgSources();
      const csvCount = manager.regenerateSvgSourcesFromCsv();
      expect(csvCount).toBeGreaterThan(0);

      await scene.cardSvgLoadPromise;

      // CSV templates must not have been clobbered by the static fetches.
      const bakery = scene.cardSvgSources.get('biz-bakery');
      expect(bakery).toBeDefined();
      expect(bakery).not.toBe('<svg>static stale source</svg>');
      expect(bakery).toContain('Bakery');
      // The non-CSV card back remains populated.
      expect(scene.cardSvgSources.get(CARD_BACK_TEMPLATE)).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('mismatch path does not re-run a full generation pass when sources are already fresh (AC5)', async () => {
    setDevicePixelRatio(1);
    const scene = makeSourceScene();
    const manager = new MainStreetSvgTextureManager(scene);
    scene.msSvgTextureManager = manager;

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      manager.regenerateSvgSourcesFromCsv();
      expect(countRegeneratedLogs(infoSpy)).toBe(1);

      // A saved checksum that differs from the current CSV triggers the
      // mismatch path — but the sources are already fresh for the active CSV,
      // so regeneration is a memoised no-op.
      await checkForCsvMismatchAndRegenerate({ scene } as any, 'a-different-saved-checksum');

      expect(countRegeneratedLogs(infoSpy)).toBe(1);
    } finally {
      infoSpy.mockRestore();
    }
  });
});
