/**
 * Guard: a browser-test wait budget may never be shorter than the production
 * cap it races (MS-0MVLINWV10005H2P).
 *
 * ## The budget model — nominal cap + starvation margin
 *
 * A browser test that waits on work paced by a *production* timing cap cannot
 * use a hand-guessed poll timeout. The production work is paced by the cap, but
 * on a CPU-loaded host its animation frames (`requestAnimationFrame`) are
 * starved, so it legitimately finishes *later* than the nominal cap. A budget
 * equal to (or barely above) the cap then turns a green scene into a red test,
 * and the retry runner does **not** retry `waitForCondition` timeouts — one
 * starvation spike fails the gate.
 *
 * The shared helper (`@core-tests/helpers/waitForCondition`) therefore derives
 * the budget from the cap it races:
 *
 * ```
 * budget = max(round(capMs * starvationFactor), capMs + floorMs)
 * ```
 *
 * and enforces `budget > capMs` in code, throwing when a caller configures a
 * poll that is not strictly longer than the cap it documents as racing.
 *
 * ## Why this guard exists
 *
 * That code-level invariant only holds if callers pass the **real production
 * constants**. A hand-copied number silently stops tracking production the
 * moment the cap is retuned, and the failure mode is a load-sensitive test, not
 * a compile error. This guard closes that gap cheaply, in the node `unit`
 * project (no browser, no scene boot), by deriving each budget from the
 * imported production cap and asserting:
 *
 * 1. the derived budget is strictly greater than the cap it races;
 * 2. no option set can derive a budget at or below the cap (the helper fails
 *    closed on the real constants, so raising a cap past its margin fails the
 *    build rather than silently under-budgeting);
 * 3. the derived budget plus the documented scene-boot allowance still fits
 *    inside the browser project's `testTimeout` (read from `vite.config.ts`,
 *    not restated), so a slow wait reports its own labelled timeout instead of
 *    being killed by the hook timeout.
 *
 * No wait *budget* literal is restated here: every budget comes from
 * `resolveWaitBudget` applied to an imported production cap.
 *
 * ## Precedent waits this model generalises
 *
 * - `tests/main-street/incident-reveal.browser.test.ts` — `REVEAL_WAIT_MS =
 *   4_000 + 16_000` (the incident reveal cap plus a fixed margin);
 * - `tests/main-street/income-collection.browser.test.ts` —
 *   `PHASED_SHOW_WAIT_MS = PHASED_SHOW_MS + 16000`.
 *
 * Both hand-roll "cap + margin"; adopting the helper replaces the hand-rolled
 * arithmetic with a derivation that cannot drop below the cap.
 *
 * ## Scope note
 *
 * This file holds the cap-derived invariant only. The per-wait source scan of
 * `MainStreetScene.browser.test.ts` (asserting each documented wait passes
 * `capMs:` and no `timeoutMs` literal) is added by the adoption child,
 * MS-0MVLINX9D002AHX7.
 *
 * @module tests/tooling/wait-budget-guard
 */
import { describe, expect, it } from 'vitest';

import { resolveWaitBudget } from '@core-tests/helpers/waitForCondition';

import { DRAG_TRANSFER_DURATION_MAX_MS } from '../../src/scenes/MainStreetConstants';
import { INCOME_COLLECTION_CAP_MS } from '../../src/scenes/MainStreetAnimatorTiming';
import viteConfig from '../../vite.config';

/**
 * Scene-boot allowance a browser test spends before its budgeted wait starts.
 *
 * Mirrors the default of `waitForScene` (`core/tests/helpers/waitForScene.ts`),
 * which every browser scene test calls first to wait for asset-heavy scenes in
 * headless Chromium. That helper is not importable here: it evaluates Phaser at
 * module load (a `window` dependency) and keeps its default module-private.
 * The allowance is therefore the one documented figure restated in this guard —
 * it is a *boot* budget, not a wait budget derived from a production cap.
 */
const SCENE_BOOT_ALLOWANCE_MS = 20_000;

/** A production cap, paired with the wait label it paces, for assertions. */
interface ProductionCap {
  /** Human-readable wait the cap paces (used in failure messages). */
  readonly paces: string;
  /** The production cap constant imported by the tests that race it. */
  readonly capMs: number;
}

/**
 * Every production cap a browser-test wait may be derived from.
 *
 * The values are asserted below against the numbers the browser tests document
 * (`4_000 + 16_000`, `PHASED_SHOW_MS + 16000`, the 1 500 ms transfer cap), so a
 * retune fails here instead of silently invalidating those documented waits.
 */
const PRODUCTION_CAPS: readonly ProductionCap[] = [
  { paces: 'end-of-turn income collection', capMs: INCOME_COLLECTION_CAP_MS },
  { paces: 'buy transfer animation', capMs: DRAG_TRANSFER_DURATION_MAX_MS },
];

/**
 * The `testTimeout` of the `browser` Vitest project, resolved from the real
 * exported config (the same evaluation `vitest-cli-project-isolation.test.ts`
 * uses) rather than restated here.
 *
 * @throws {Error} when the browser project declares no `testTimeout` — the
 *   headroom assertion would be meaningless, so the guard fails loudly instead
 *   of silently passing.
 */
function resolveBrowserTestTimeoutMs(): number {
  const exported = viteConfig as unknown;
  const resolved =
    typeof exported === 'function'
      ? (
          exported as (env: { command: string; mode: string }) => {
            test?: { projects?: { test?: { name?: string; testTimeout?: number } }[] };
          }
        )({ command: 'serve', mode: 'test' })
      : (exported as {
          test?: { projects?: { test?: { name?: string; testTimeout?: number } }[] };
        });

  const browserProject = resolved.test?.projects?.find(
    (project) => project.test?.name === 'browser',
  );
  const testTimeout = browserProject?.test?.testTimeout;
  if (typeof testTimeout !== 'number' || testTimeout <= 0) {
    throw new Error(
      "the Vitest 'browser' project must declare a positive testTimeout so the " +
        'wait-budget headroom guard can assert against it',
    );
  }
  return testTimeout;
}

describe('browser wait budgets are derived from the production caps they race', () => {
  it.each(PRODUCTION_CAPS.map((cap) => [cap.paces, cap.capMs] as const))(
    'derives a budget strictly longer than the %s cap',
    (_paces, capMs) => {
      expect(resolveWaitBudget({ capMs })).toBeGreaterThan(capMs);
    },
  );

  it('imports the cap values the browser tests document', () => {
    // Assertion *inputs*, not budgets: the documented precedent waits encode
    // these numbers as literal margins, so a retune must fail here.
    expect(INCOME_COLLECTION_CAP_MS).toBe(16_000);
    expect(DRAG_TRANSFER_DURATION_MAX_MS).toBe(1_500);
  });

  it('cannot derive a budget at or below the cap for any option set', () => {
    // The "budget must be longer than the cap" guard fails closed on the real
    // constants: neutralising the starvation widening (factor 1, no floor)
    // lands exactly on the cap and must be rejected, not silently accepted.
    for (const { paces, capMs } of PRODUCTION_CAPS) {
      expect(
        () => resolveWaitBudget({ capMs, starvationFactor: 1, floorMs: 0 }),
        `${paces} cap ${capMs}ms accepted a budget equal to the cap`,
      ).toThrow(/not strictly greater/);
      expect(
        () => resolveWaitBudget({ capMs, starvationFactor: 0.5, floorMs: 0 }),
        `${paces} cap ${capMs}ms accepted a sub-cap budget`,
      ).toThrow(/not strictly greater/);
    }
  });
});

describe('derived budgets leave room for the scene boot inside the browser testTimeout', () => {
  it.each(PRODUCTION_CAPS.map((cap) => [cap.paces, cap.capMs] as const))(
    'fails its own labelled timeout, not the hook timeout, for the %s wait',
    (_paces, capMs) => {
      const budgetMs = resolveWaitBudget({ capMs });
      const testTimeoutMs = resolveBrowserTestTimeoutMs();

      expect(budgetMs + SCENE_BOOT_ALLOWANCE_MS).toBeLessThanOrEqual(testTimeoutMs);
    },
  );

  it('reads a browser testTimeout that a scene boot plus a cap-derived wait fits inside', () => {
    // Guards the guard: if the browser testTimeout were lowered below the boot
    // allowance, every budgeted wait would die in the hook instead of its label.
    const testTimeoutMs = resolveBrowserTestTimeoutMs();

    expect(testTimeoutMs).toBeGreaterThan(SCENE_BOOT_ALLOWANCE_MS);
  });
});
