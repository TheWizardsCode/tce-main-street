import type { TfGeneratedModule } from '@core-engine';

let cachedLoadedModule: TfGeneratedModule | undefined | null;
let lastLoadError: string | null = null;

/**
 * Read-only snapshot of the loader's diagnostic state.
 *
 * Exposed so the scene can forward it to
 * `SoundManager.setSynthDiagnostics()` and the debug indicator, and so tests
 * can pin the load-success / load-failure contracts without re-parsing console
 * output.
 */
export interface MainStreetTfDiagnostics {
  /** True when a usable tf module has been cached. */
  loaded: boolean;
  /** Factory count of the cached module (0 when nothing is loaded). */
  factoryCount: number;
  /** Last load/normalisation failure reason, or null. */
  lastLoadError: string | null;
}

/**
 * Runtime accessor used by scene wiring and tests.
 *
 * Once `loadMainStreetTfModule()` has settled, this returns the cached
 * normalised module. Tests can also provide a mocked tf module by setting
 * `globalThis.__MAIN_STREET_TF_MODULE__`, which takes precedence.
 */
export function getMainStreetTfModule(): TfGeneratedModule | null {
  const injected = (globalThis as unknown as Record<string, unknown>).__MAIN_STREET_TF_MODULE__;
  if (injected) return injected as TfGeneratedModule;
  return cachedLoadedModule ?? null;
}

/**
 * Read-only diagnostics for the runtime tf module loader.
 *
 * Unlike {@link getMainStreetTfModule}, this never reflects the test-injection
 * global — it reports the state of the real async load path.
 */
export function getMainStreetTfDiagnostics(): MainStreetTfDiagnostics {
  const factoryCount = cachedLoadedModule?.factories
    ? Object.keys(cachedLoadedModule.factories).length
    : 0;
  return {
    loaded: cachedLoadedModule != null,
    factoryCount,
    lastLoadError,
  };
}

/** Normalise a dynamically imported module into a `TfGeneratedModule`. */
function normaliseTfModule(mod: Record<string, unknown>): TfGeneratedModule | null {
  return (
    (mod.TF_RUNTIME_MODULE as TfGeneratedModule | undefined) ??
    (mod.default as TfGeneratedModule | undefined) ??
    (typeof mod.factories === 'object' ? (mod as TfGeneratedModule) : undefined) ??
    null
  );
}

/**
 * Load the committed ToneForge runtime synth module.
 *
 * The module is committed to the engine repo at
 * `src/core-engine/tf-runtime/main-street-runtime-synth.mjs` and imported here
 * with a **static specifier**, so Vite/Rollup code-splits it into its own lazy
 * chunk (keeping Tone.js out of the main bundle) and emits it for the dev
 * server, the production `dist/` and the Electron bundle alike.
 *
 * It is deliberately NOT placed under `public/`: Vite serves `public/` verbatim
 * and refuses to import a module from it ("This file is in /public and will be
 * copied as-is during build ... it can only be referenced via HTML tags").
 * See CG-0MUL2G17U003C1N6.
 *
 * A failure to import **or normalise** the module is loud: it emits a
 * `console.warn` naming the underlying reason and is retained in
 * {@link getMainStreetTfDiagnostics}. The function still resolves `null` so the
 * caller keeps its WAV/Phaser fallback — audio never breaks, but the failure is
 * no longer silent (CG-0MUU9PP9V000UOC3).
 *
 * Resolution order:
 * 1. `globalThis.__MAIN_STREET_TF_MODULE__` test/runtime injection
 * 2. the committed, code-split runtime synth module
 */
export async function loadMainStreetTfModule(): Promise<TfGeneratedModule | null> {
  const injected = getMainStreetTfModule();
  if (injected) return injected;

  if (cachedLoadedModule !== undefined) {
    return cachedLoadedModule;
  }

  try {
    const mod = await import('@core-engine/tf-runtime/main-street-runtime-synth.mjs');
    const normalised = normaliseTfModule(mod as unknown as Record<string, unknown>);
    if (!normalised) {
      lastLoadError =
        'module imported but did not normalise to a ToneForge tf module ' +
        '(no TF_RUNTIME_MODULE, default or factories export)';
      console.warn(`[mainStreet tf] ${lastLoadError}`);
      cachedLoadedModule = null;
      return cachedLoadedModule;
    }
    lastLoadError = null;
    cachedLoadedModule = normalised;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    lastLoadError = reason;
    console.warn(`[mainStreet tf] ToneForge runtime module failed to load: ${reason}`);
    cachedLoadedModule = null;
  }

  return cachedLoadedModule;
}
