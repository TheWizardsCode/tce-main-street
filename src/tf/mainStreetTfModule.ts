import type { TfGeneratedModule } from '@core-engine';

let cachedLoadedModule: TfGeneratedModule | undefined | null;

/**
 * Runtime accessor used by scene wiring and tests.
 *
 * Tests can provide a mocked tf module by setting
 * `globalThis.__MAIN_STREET_TF_MODULE__`.
 */
export function getMainStreetTfModule(): TfGeneratedModule | null {
  const injected = (globalThis as unknown as Record<string, unknown>).__MAIN_STREET_TF_MODULE__;
  if (injected) return injected as TfGeneratedModule;
  return null;
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
    cachedLoadedModule = normaliseTfModule(mod as unknown as Record<string, unknown>);
  } catch {
    cachedLoadedModule = null;
  }

  return cachedLoadedModule;
}
