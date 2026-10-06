import { afterEach, describe, expect, it } from 'vitest';

/** All synth factory keys shipped by the committed runtime module. */
const EXPECTED_KEYS = [
  'card-draw',
  'card-slide',
  'card-place',
  'card-discard',
  'card-coin-collect',
  'ui-notification-chime',
  'card-table-ambience',
  'construction-hammer',
  'construction-saw',
  'construction-lite-hammer',
  'construction-lite-saw',
  'crowd-cheer',
];

describe('mainStreet tf module loader', () => {
  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).__MAIN_STREET_TF_MODULE__;
    delete (globalThis as unknown as Record<string, unknown>).__MAIN_STREET_TF_MODULE_URL__;
  });

  it('returns an injected tf module immediately', async () => {
    const injected = { factories: { foo: () => ({ play: () => {} }) } };
    (globalThis as unknown as Record<string, unknown>).__MAIN_STREET_TF_MODULE__ = injected;

    const mod = await import('../../src/tf/mainStreetTfModule');

    expect(mod.getMainStreetTfModule()).toBe(injected);
    await expect(mod.loadMainStreetTfModule()).resolves.toBe(injected);
  });

  it('loads the committed runtime synth module without any generation step', async () => {
    const mod = await import('../../src/tf/mainStreetTfModule');

    const runtime = await mod.loadMainStreetTfModule();

    expect(runtime).toBeTruthy();
    expect(runtime?.getFactory).toBeInstanceOf(Function);
    for (const key of EXPECTED_KEYS) {
      expect(typeof runtime?.factories?.[key]).toBe('function');
    }
  });

  it('ignores the legacy module URL override (module is code-split, never fetched)', async () => {
    // Regression guard for CG-0MUL2G17U003C1N6: the previous implementation
    // dynamic-imported this URL, which made Vite throw because the target lived
    // in `public/`. The module is now imported with a static specifier, so the
    // override is inert.
    (globalThis as unknown as Record<string, unknown>).__MAIN_STREET_TF_MODULE_URL__ =
      'http://[::1]:1/nonexistent/module.mjs';

    const mod = await import('../../src/tf/mainStreetTfModule');
    const runtime = await mod.loadMainStreetTfModule();

    expect(runtime).toBeTruthy();
    expect(typeof runtime?.factories?.['card-place']).toBe('function');
  });
});
