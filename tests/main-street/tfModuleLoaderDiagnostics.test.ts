/**
 * Loader diagnostics contract (engine work item CG-0MUTU0MFE0077H0F, child
 * CG-0MUU9PP9V000UOC3; sibling tracking item MS-0MUU9QYQE006NLEZ).
 *
 * The loader previously swallowed every failure in a bare `catch`, so a
 * module that failed to resolve / import / normalise left `cachedLoadedModule`
 * `null` with no warning and no diagnostic state — the regression could only
 * be found by ear.
 *
 * These tests pin the contract that replaces it:
 *
 *  - a failure logs a clear `console.warn` including the underlying reason;
 *  - diagnostic state (load error, loaded flag, factory count) is retained and
 *    readable through exported accessors;
 *  - a successful load caches the normalised module and
 *    `getMainStreetTfModule()` exposes it (not only the test-injection global);
 *  - the WAV/Phaser fallback remains intact (the loader still resolves to
 *    `null` rather than throwing, so callers keep their fallback path).
 *
 * The loader's caching is module-scoped, so each case re-imports the module
 * with `vi.resetModules()` for isolation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type LoaderModule = typeof import('../../src/tf/mainStreetTfModule');

/** A minimal, normalisable tf module usable as a cached-load stand-in. */
function fakeTfModule(factoryKeys: string[] = ['card-draw', 'card-place']) {
  const factories = Object.fromEntries(
    factoryKeys.map((key) => [key, () => ({ play: () => {} })]),
  );
  return { factories, getFactory: (name: string) => factories[name as keyof typeof factories] };
}

describe('mainStreet tf module loader diagnostics', () => {
  beforeEach(() => {
    vi.resetModules();
    delete (globalThis as unknown as Record<string, unknown>).__MAIN_STREET_TF_MODULE__;
    delete (globalThis as unknown as Record<string, unknown>).__MAIN_STREET_TF_MODULE_URL__;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as unknown as Record<string, unknown>).__MAIN_STREET_TF_MODULE__;
  });

  it('exposes the cached module through getMainStreetTfModule() after a load', async () => {
    const mod: LoaderModule = await import('../../src/tf/mainStreetTfModule');

    // Before the load nothing is cached.
    expect(mod.getMainStreetTfModule()).toBeNull();

    const loaded = await mod.loadMainStreetTfModule();

    expect(loaded).toBeTruthy();
    // The cached module is exposed by the runtime accessor, not just the
    // test-injection global.
    expect(mod.getMainStreetTfModule()).toBe(loaded);
  });

  it('reports a null load error and the factory count on a successful load', async () => {
    const mod: LoaderModule = await import('../../src/tf/mainStreetTfModule');

    await mod.loadMainStreetTfModule();

    const diagnostics = mod.getMainStreetTfDiagnostics();
    expect(diagnostics.loaded).toBe(true);
    expect(diagnostics.lastLoadError).toBeNull();
    expect(diagnostics.factoryCount).toBeGreaterThan(0);
  });

  it('clears diagnostic state when a test-injected module is supplied', async () => {
    const injected = fakeTfModule();
    (globalThis as unknown as Record<string, unknown>).__MAIN_STREET_TF_MODULE__ = injected;

    const mod: LoaderModule = await import('../../src/tf/mainStreetTfModule');
    const loaded = await mod.loadMainStreetTfModule();

    expect(loaded).toBe(injected);
    expect(mod.getMainStreetTfModule()).toBe(injected);
    expect(mod.getMainStreetTfDiagnostics().lastLoadError).toBeNull();
  });

  it('logs a warning with the reason and retains diagnostic state on failure', async () => {
    // Force the dynamic import to reject with a recognisable reason. The
    // mock factory cannot throw directly (Vitest hoists it), so it returns a
    // namespace whose `TF_RUNTIME_MODULE` accessor throws — which surfaces as
    // an import-time error inside the loader's try/catch.
    vi.doMock('@core-engine/tf-runtime/main-street-runtime-synth.mjs', () => ({
      get TF_RUNTIME_MODULE() {
        throw new Error('synthetic module load failure');
      },
    }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mod: LoaderModule = await import('../../src/tf/mainStreetTfModule');
    const loaded = await mod.loadMainStreetTfModule();

    // Fallback contract preserved: the loader resolves null (never throws).
    expect(loaded).toBeNull();

    // The failure is loud: a warning naming the underlying reason.
    expect(warnSpy).toHaveBeenCalled();
    const warningText = warnSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(warningText).toContain('synthetic module load failure');
    expect(warningText.toLowerCase()).toContain('toneforge');

    // And diagnostic state is retained and readable.
    const diagnostics = mod.getMainStreetTfDiagnostics();
    expect(diagnostics.loaded).toBe(false);
    expect(diagnostics.lastLoadError).toContain('synthetic module load failure');

    vi.doUnmock('@core-engine/tf-runtime/main-street-runtime-synth.mjs');
  });

  it('warns when the imported module does not normalise to a tf module', async () => {
    // A module that imports fine but exposes no tf shape normalises to null.
    vi.doMock('@core-engine/tf-runtime/main-street-runtime-synth.mjs', () => ({
      notATfModule: true,
    }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mod: LoaderModule = await import('../../src/tf/mainStreetTfModule');
    const loaded = await mod.loadMainStreetTfModule();

    expect(loaded).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    const diagnostics = mod.getMainStreetTfDiagnostics();
    expect(diagnostics.loaded).toBe(false);
    expect(diagnostics.lastLoadError).toBeTruthy();

    vi.doUnmock('@core-engine/tf-runtime/main-street-runtime-synth.mjs');
  });
});
