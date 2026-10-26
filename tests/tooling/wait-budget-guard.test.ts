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
 * The first two describes pin the cap-derived *budget* invariant on the
 * production constants. The last one adds the missing per-wait link: it scans
 * `tests/main-street/MainStreetScene.browser.test.ts` (added by the adoption
 * child, MS-0MVLINX9D002AHX7) and asserts every documented wait passes
 * `capMs: <the production constant it races>` to the shared helper and no raw
 * `timeoutMs` literal — so `timeoutMs: 15_000` / `timeoutMs: 6000` cannot be
 * reintroduced for those waits, and a mismatched cap constant fails here.
 *
 * @module tests/tooling/wait-budget-guard
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

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

// ─────────────────────────────────────────────────────────────────────────────
// Source scan: the documented waits in the MainStreetScene browser suite
// ─────────────────────────────────────────────────────────────────────────────

/** Repository root (`vitest` runs with the repository root as its cwd). */
const REPO_ROOT = process.cwd();

/** Browser suite that owns the waits this scan pins. */
const SCENE_BROWSER_TEST = 'tests/main-street/MainStreetScene.browser.test.ts';

/** Shared helper whose `capMs` option derives a load-tolerant budget. */
const CAPPED_HELPER = 'waitForCondition';

/**
 * The browser suite's own raw-timeout poll helper. It cannot express a cap
 * derivation, so a documented (cap-paced) wait that still routes through it is
 * a regression even when its literal happens to look generous.
 */
const LEGACY_HELPER = 'waitForConditionLegacy';

/** A browser wait whose budget must be derived from a production cap. */
interface DocumentedWait {
  /** The `label` the wait passes (also the triage grep target). */
  readonly label: string;
  /** Production cap constant the wait must pass as `capMs`. */
  readonly capConstant: string;
  /** Value of that constant, for the runtime budget assertion. */
  readonly capMs: number;
}

/**
 * Waits the adoption child (MS-0MVLINX9D002AHX7) moved onto the shared helper.
 *
 * Each label below must appear at least once, and *every* wait carrying that
 * label must pass the matching cap constant and no raw `timeoutMs` literal.
 */
const DOCUMENTED_WAITS: readonly DocumentedWait[] = [
  {
    label: 'turn to advance after end-of-turn presentation',
    capConstant: 'INCOME_COLLECTION_CAP_MS',
    capMs: INCOME_COLLECTION_CAP_MS,
  },
  {
    // Turn Summary gate (MS-0MVP46Q8X003419R): the deferred closing presents
    // the summary dialog only after the income choreography finishes
    // collecting, so this wait races the same income-collection cap as the
    // turn-advance wait it precedes.
    label: 'Turn Summary dialog after end-of-turn presentation',
    capConstant: 'INCOME_COLLECTION_CAP_MS',
    capMs: INCOME_COLLECTION_CAP_MS,
  },
  {
    label: 'business bought to hand',
    capConstant: 'DRAG_TRANSFER_DURATION_MAX_MS',
    capMs: DRAG_TRANSFER_DURATION_MAX_MS,
  },
  {
    label: 'first business bought to hand',
    capConstant: 'DRAG_TRANSFER_DURATION_MAX_MS',
    capMs: DRAG_TRANSFER_DURATION_MAX_MS,
  },
  {
    // Converted by the soak child (MS-0MVLINY2Q004V33L): the imposed-load soak
    // caught this 6 000 ms hand-guess timing out while the cap-derived transfer
    // waits completed, so it now derives from the same transfer cap.
    label: 'second business materialized in hand',
    capConstant: 'DRAG_TRANSFER_DURATION_MAX_MS',
    capMs: DRAG_TRANSFER_DURATION_MAX_MS,
  },
  {
    // Same class and same soak finding as the business transfer above.
    label: 'event materialized',
    capConstant: 'DRAG_TRANSFER_DURATION_MAX_MS',
    capMs: DRAG_TRANSFER_DURATION_MAX_MS,
  },
];

/**
 * Waits that deliberately keep a raw `timeoutMs`: nothing in production paces
 * them (they wait on a UI transition), so there is no cap to derive from.
 *
 * The `MainStreetScene` adoption explicitly left this one alone; pinning it
 * keeps the exclusion deliberate instead of letting the scan slowly grow.
 */
const UNCAPPED_LABELS: readonly string[] = ['hand card selected for placement'];

/** A `waitForCondition`-family call lifted out of the browser-test source. */
interface WaitCall {
  /** Callee name, e.g. `waitForCondition` or `waitForConditionLegacy`. */
  readonly callee: string;
  /** Full call text, arguments included. */
  readonly callSource: string;
  /** Label passed via `label: '…'`, when present. */
  readonly label: string | undefined;
}

/** Matches the head of a `waitForCondition`-family call (or its declaration). */
const WAIT_CALL_HEAD = /\b(waitForCondition(?:Legacy)?)\s*\(/g;

/**
 * Find the `)` that closes the `(` at `openIndex`, skipping string literals so a
 * paren inside a label cannot unbalance the scan.
 *
 * @returns the closing paren index, or `-1` when the source is unbalanced.
 */
function findMatchingParen(source: string, openIndex: number): number {
  let depth = 0;
  let quote: string | null = null;

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];

    if (quote !== null) {
      if (char === '\\') {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char;
    } else if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

/**
 * Lift every `waitForCondition`-family call out of `source`.
 *
 * @throws {Error} when a call's parentheses cannot be balanced — a silently
 *   skipped call would let a regression through, so the scan fails loudly.
 */
function extractWaitCalls(source: string): WaitCall[] {
  const calls: WaitCall[] = [];

  for (const match of source.matchAll(WAIT_CALL_HEAD)) {
    const callStart = match.index;
    const callee = match[1];

    // Skip the helper's own declaration: `async function waitForConditionLegacy(`.
    if (/(?:function|const|let|var)\s+$/.test(source.slice(0, callStart))) continue;

    const openIndex = callStart + match[0].length - 1;
    const closeIndex = findMatchingParen(source, openIndex);
    if (closeIndex === -1) {
      throw new Error(
        `unbalanced parentheses in the ${callee} call at offset ${callStart} of ${SCENE_BROWSER_TEST}`,
      );
    }

    const callSource = source.slice(callStart, closeIndex + 1);
    calls.push({
      callee,
      callSource,
      label: /label:\s*'([^']*)'/.exec(callSource)?.[1],
    });
  }

  return calls;
}

/** The text passed to `capMs:`, trimmed (a constant name or a literal). */
function capArgumentOf(callSource: string): string | undefined {
  return /capMs:\s*([^,}\n]+)/.exec(callSource)?.[1]?.trim();
}

/**
 * The text passed to `floorMs:`, trimmed, when the call overrides the helper's
 * default starvation margin (the browser suite sizes one margin per cap class).
 */
function floorArgumentOf(callSource: string): string | undefined {
  return /floorMs:\s*([^,}\n]+)/.exec(callSource)?.[1]?.trim();
}

/** True when the call passes a raw timeout budget. */
function passesRawTimeout(callSource: string): boolean {
  return /\btimeoutMs\b/.test(callSource);
}

/**
 * Every way a documented wait violates the cap-derived budget contract.
 *
 * @returns an empty array when the wait is correct, otherwise one message per
 *   violation (so a failure names the label and the offending option).
 */
function documentedWaitViolations(
  calls: readonly WaitCall[],
  wait: DocumentedWait,
): string[] {
  const labelled = calls.filter((call) => call.label === wait.label);
  if (labelled.length === 0) {
    return [`no wait labelled '${wait.label}' found in ${SCENE_BROWSER_TEST}`];
  }

  const violations: string[] = [];
  for (const call of labelled) {
    if (call.callee !== CAPPED_HELPER) {
      violations.push(
        `'${wait.label}' uses ${call.callee}() instead of the shared ${CAPPED_HELPER}()`,
      );
    }

    const capArgument = capArgumentOf(call.callSource);
    if (capArgument !== wait.capConstant) {
      violations.push(
        `'${wait.label}' passes capMs: ${capArgument ?? '<none>'} instead of ${wait.capConstant}`,
      );
    }

    if (passesRawTimeout(call.callSource)) {
      violations.push(`'${wait.label}' still passes a raw timeoutMs budget`);
    }
  }

  return violations;
}

/** Read the browser suite from the checkout this run belongs to. */
function readSceneBrowserTest(): string {
  return fs.readFileSync(path.join(REPO_ROOT, SCENE_BROWSER_TEST), 'utf8');
}

/**
 * Resolve a numeric argument that may be written as a literal (`12_000`) or as
 * a module-level constant declared in the same source (`const X = 12_000;`).
 *
 * @throws {Error} when the argument is neither — a silently skipped override
 *   would let an over-budget margin through the headroom assertion.
 */
function resolveNumericArgument(source: string, argument: string): number {
  const numeric = /^(?:\d[\d_]*)$/.test(argument);
  if (numeric) return Number(argument.replace(/_/g, ''));

  const declaration = new RegExp(
    `(?:const|let|var)\\s+${argument}\\s*=\\s*(\\d[\\d_]*)\\s*;`,
  ).exec(source);
  if (!declaration) {
    throw new Error(`cannot resolve the numeric margin '${argument}' in ${SCENE_BROWSER_TEST}`);
  }

  return Number(declaration[1].replace(/_/g, ''));
}

describe('the MainStreetScene browser waits derive their budgets from the caps they race', () => {
  const source = readSceneBrowserTest();
  const calls = extractWaitCalls(source);

  it('lifts the waits out of the suite (scanner sanity check)', () => {
    // If the extractor silently found (almost) nothing, every per-label
    // assertion below would report "missing label" instead of a real
    // regression signal. Every documented and deliberately-uncapped label must
    // be represented, and the per-file helper's calls must be lifted too.
    expect(calls.length).toBeGreaterThanOrEqual(
      DOCUMENTED_WAITS.length + UNCAPPED_LABELS.length,
    );
    expect(calls.map((call) => call.callee)).toContain(LEGACY_HELPER);
    expect(calls.map((call) => call.callee)).toContain(CAPPED_HELPER);
  });

  it.each(DOCUMENTED_WAITS.map((wait) => [wait.label, wait] as const))(
    "derives the '%s' wait from its production cap",
    (_label, wait) => {
      expect(documentedWaitViolations(calls, wait)).toEqual([]);
      // The helper's invariant applied to the cap the wait reads: the derived
      // budget is strictly longer than the cap, so no literal can be
      // reintroduced at or below it.
      expect(resolveWaitBudget({ capMs: wait.capMs })).toBeGreaterThan(wait.capMs);
    },
  );

  it.each(DOCUMENTED_WAITS.map((wait) => [wait.label, wait] as const))(
    "keeps the '%s' wait inside the browser testTimeout after any margin override",
    (_label, wait) => {
      // The suite may widen the helper's fixed starvation margin per cap class
      // (the soak proved the default too tight under imposed load). A widened
      // margin must still let the wait fail with its own label rather than the
      // hook's timeout, so re-derive the *effective* budget from the call site.
      const labelled = calls.filter((call) => call.label === wait.label);
      for (const call of labelled) {
        const floorArgument = floorArgumentOf(call.callSource);
        const budgetMs = resolveWaitBudget({
          capMs: wait.capMs,
          ...(floorArgument === undefined
            ? {}
            : { floorMs: resolveNumericArgument(source, floorArgument) }),
        });

        expect(budgetMs + SCENE_BOOT_ALLOWANCE_MS).toBeLessThanOrEqual(
          resolveBrowserTestTimeoutMs(),
        );
      }
    },
  );

  it('caps only the waits this guard documents', () => {
    // A cap-derived wait outside DOCUMENTED_WAITS would skip the constant check
    // above, so adding one must be a deliberate one-line update here.
    const undocumented = calls
      .filter((call) => capArgumentOf(call.callSource) !== undefined)
      .filter(
        (call) => !DOCUMENTED_WAITS.some((wait) => wait.label === call.label),
      )
      .map((call) => call.label ?? '<unlabelled>');

    expect(
      undocumented,
      `add these labels to DOCUMENTED_WAITS: ${undocumented.join(', ')}`,
    ).toEqual([]);
  });

  it.each(UNCAPPED_LABELS)(
    "keeps the '%s' wait on a raw timeout (no production cap paces it)",
    (label) => {
      const labelled = calls.filter((call) => call.label === label);
      expect(labelled.length).toBeGreaterThan(0);
      for (const call of labelled) {
        expect(capArgumentOf(call.callSource)).toBeUndefined();
      }
    },
  );
});

describe('the documented-wait scan fails closed on a reintroduced literal', () => {
  /** Select a documented wait by label (positions shift as waits are added). */
  function documentedWait(label: string): DocumentedWait {
    const wait = DOCUMENTED_WAITS.find((entry) => entry.label === label);
    if (!wait) throw new Error(`no documented wait labelled '${label}'`);
    return wait;
  }

  const turnWait = documentedWait('turn to advance after end-of-turn presentation');
  const buyWait = documentedWait('business bought to hand');

  interface RegressionCase {
    /** What the synthetic source reintroduces. */
    readonly regression: string;
    /** Browser-test source exercising that regression. */
    readonly source: string;
    /** The documented wait the source is judged against. */
    readonly wait: DocumentedWait;
    /** The violation the scan must report. */
    readonly expected: RegExp;
  }

  const REGRESSIONS: readonly RegressionCase[] = [
    {
      regression: 'a raw timeoutMs budget on the shared helper',
      source: `await ${CAPPED_HELPER}(() => true, { timeoutMs: 15_000, label: '${turnWait.label}' });`,
      wait: turnWait,
      expected: /still passes a raw timeoutMs budget/,
    },
    {
      regression: 'a raw 6000 literal on the per-file helper',
      source: `await ${LEGACY_HELPER}(() => true, { timeoutMs: 6000, label: '${buyWait.label}' });`,
      wait: buyWait,
      expected: /uses waitForConditionLegacy\(\)/,
    },
    {
      regression: 'a mismatched cap constant',
      source: `await ${CAPPED_HELPER}(() => true, { capMs: INCOME_COLLECTION_CAP_MS, label: '${buyWait.label}' });`,
      wait: buyWait,
      expected:
        /passes capMs: INCOME_COLLECTION_CAP_MS instead of DRAG_TRANSFER_DURATION_MAX_MS/,
    },
    {
      regression: 'a bare numeric cap',
      source: `await ${CAPPED_HELPER}(() => true, { capMs: 6_000, label: '${buyWait.label}' });`,
      wait: buyWait,
      expected: /passes capMs: 6_000 instead of DRAG_TRANSFER_DURATION_MAX_MS/,
    },
    {
      regression: 'a missing label',
      source: `await ${CAPPED_HELPER}(() => true, { capMs: DRAG_TRANSFER_DURATION_MAX_MS, label: 'renamed' });`,
      wait: buyWait,
      expected: /no wait labelled 'business bought to hand'/,
    },
  ];

  it.each(REGRESSIONS)('detects $regression', ({ source, wait, expected }) => {
    const violations = documentedWaitViolations(extractWaitCalls(source), wait);

    expect(violations.join('\n')).toMatch(expected);
  });

  it('accepts the correct cap-derived form', () => {
    const source = `await ${CAPPED_HELPER}(() => true, { capMs: DRAG_TRANSFER_DURATION_MAX_MS, label: '${buyWait.label}' });`;

    expect(documentedWaitViolations(extractWaitCalls(source), buyWait)).toEqual([]);
  });
});
