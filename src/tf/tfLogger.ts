/**
 * Quiet ToneForge adapter logger for the Main Street wiring
 * (MS-0MV26MOWT004ZCQC).
 *
 * `createTfPlayer` warns through its `logger` for every key whose mapped
 * factory is absent. Main Street maps 16 logical SFX keys and the committed
 * runtime synth ships a factory for all of them (MS-0MV8PDNDT0033TH8), so no
 * Main Street key intentionally falls back to WAV any more. The suppression
 * mechanism is retained for any future intentional fallback: `createTfPlayer`
 * warns for every key whose mapped factory is absent, and the documented
 * factory-less list is the single place to declare an expected gap
 * (MS-0MV26MOWT004ZCQC).
 *
 * This logger suppresses the `[tfAdapter] Missing tf factory …` warning for
 * exactly the documented factory-less keys — whether reported under the
 * logical `sfx-` key or under its already-mapped factory key — and forwards
 * every other message unchanged. The detection is never removed: an
 * unexpected missing factory, or any other adapter warning (failed voice
 * creation), still reaches the console (AC3).
 *
 * @module
 */

import type { TfAdapterLogger } from '@core-engine';

import {
  MAIN_STREET_TF_FACTORYLESS_FACTORY_KEYS,
  MAIN_STREET_TF_FACTORYLESS_KEYS,
} from '../sfx-tf-mapping';

/** Matches the exact `tfAdapter` missing-factory warning shape. */
const MISSING_FACTORY_WARNING =
  /^\[tfAdapter\] Missing tf factory for key "([^"]+)" \(mapped: "([^"]+)"\)$/;

/**
 * Logical and mapped keys whose missing factory is a documented WAV fallback.
 * Built once from `sfx-tf-mapping.ts` so the two can never drift.
 */
const EXPECTED_FACTORYLESS_KEYS: ReadonlySet<string> = new Set([
  ...MAIN_STREET_TF_FACTORYLESS_KEYS,
  ...MAIN_STREET_TF_FACTORYLESS_FACTORY_KEYS,
]);

/**
 * Whether `message` is the adapter's missing-factory warning for one of the
 * documented factory-less Main Street mappings.
 *
 * The documented list is currently empty (every mapping ships a factory), so
 * this always returns `false` today; it remains the single suppression point
 * for any future intentional fallback.
 *
 * @param message The exact warning message produced by `createTfPlayer`.
 */
export function isExpectedFactorylessWarning(message: string): boolean {
  const match = MISSING_FACTORY_WARNING.exec(message);
  if (!match) return false;
  const [, logicalKey, mappedKey] = match;
  return (
    EXPECTED_FACTORYLESS_KEYS.has(logicalKey) ||
    EXPECTED_FACTORYLESS_KEYS.has(mappedKey)
  );
}

/**
 * Build the `TfAdapterLogger` used by the Main Street `createTfPlayer` wiring
 * (`loadMainStreetTfIntegration`).
 *
 * @param warn Sink for warnings that are **not** a documented factory-less
 *             fallback; defaults to `console.warn`. Injectable so tests can
 *             assert exactly which warnings are forwarded.
 */
export function createMainStreetTfLogger(
  warn: (message: string) => void = (message) => console.warn(message),
): TfAdapterLogger {
  return {
    warn: (message: string) => {
      if (isExpectedFactorylessWarning(message)) return;
      warn(message);
    },
  };
}
