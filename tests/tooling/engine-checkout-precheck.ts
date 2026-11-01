/**
 * Engine-checkout preflight: gate every Vitest run on the composed engine
 * (MS-0MVO26G5H0054SNV).
 *
 * Every test invocation in this repo — `npm test`, the changed-scope gate's
 * `npx vitest run <files>`, and the dev-push browser gate — composes
 * whatever `./core` happens to be checked out. Worktrees created by the
 * implement tooling run `git submodule update --init --recursive` at
 * creation time, which checks out the gitlink recorded by the commit the
 * worktree was forked from — a commit that can silently *predate* the engine
 * pin in `configs/engine-pin.json`. A green suite then never saw the pinned
 * engine code.
 *
 * This module is the fails-loudly half of that fix (the refresh-at-creation
 * half is out of this repo's boundary — it lives in the framework's
 * `implement.py`). It is wired as the Vitest root `test.globalSetup` (a
 * documented LOCAL SURGICAL ADDITION to the engine-owned auto-generated
 * `vite.config.ts`, held in place by
 * `tests/main-street/vite-config-engine-check-guard.test.ts`) and exposed as
 * `npm run engine:check` for manual/CI use.
 *
 * ## Rules
 *
 * - **Pass:** `./core` HEAD equals the pin, or is a *descendant* of the pin
 *   (the post-`npm run build` / `engine:sync` checkout the dev workflow
 *   deliberately creates). Acceptance is decided from the **local commit
 *   graph only** (`git merge-base --is-ancestor`), never from a branch tip:
 *   the check never fetches, never contacts a remote and never consults a
 *   cached `origin/dev` ref, so airgapped worktrees with stale refs still
 *   gate correctly.
 * - **Fail loudly:** `./core` behind the pin or diverged from it, the pin
 *   commit absent from the local `./core` clone, an unreadable pin file, or
 *   an uninitialised/empty `./core`. The failure message names the composed
 *   SHA, the pin SHA and the `npm run engine:sync` remediation.
 * - **Warn only (never fail):** a dirty `./core`. Composition is still
 *   identifiable; the never-clobber guard belongs to
 *   `engine:sync` / `engine:verify`.
 * - **Bypass:** `ENGINE_CHECKOUT_CHECK=warn|off` downgrades (warn) or
 *   suppresses (off) the failure; every use is logged.
 *
 * ## Reuse
 *
 * The git and pin primitives come from the engine-owned
 * `core/scripts/engine-sync.mjs` (`readPin`, `submoduleIsDirty`,
 * `resolveShaFull`, `runGit`, `DEFAULT_*_REL`) — this module never
 * re-parses `configs/engine-pin.json` or re-implements `git status`. The
 * reusable surface is loaded from the *repo being checked* (a fresh worktree
 * carries its own `core`), so a worktree whose `./core` is missing the
 * engine tooling is reported as an uninitialised checkout instead of dying
 * with a resolver error.
 *
 * @module tests/tooling/engine-checkout-precheck
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type * as EngineSyncModule from '../../core/scripts/engine-sync.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Repository root for the runtime path (this file lives at `<root>/tests/tooling/`). */
const REPO_ROOT = path.resolve(HERE, '..', '..');

/**
 * The engine-sync API consumed by the precheck. Mirrors the exported surface
 * of `core/scripts/engine-sync.mjs` (typed by `engine-sync.d.mts`); kept
 * minimal so the loader can substitute a fixture copy.
 */
export interface EngineSyncApi {
  readPin: (repoRoot: string, pinRel?: string) => string;
  runGit: (
    cwd: string,
    args: string[],
    env?: Record<string, string>,
  ) => EngineSyncModule.GitResult;
  resolveShaFull: (repoRoot: string, coreRel: string, sha: string) => string | null;
  submoduleIsDirty: (repoRoot: string, coreRel?: string) => boolean;
  DEFAULT_CORE_REL: string;
  DEFAULT_PIN_REL: string;
}

/** Loads the engine-sync module from a repo, or null when it is absent. */
export type EngineSyncLoader = (repoRoot: string, coreRel: string) => Promise<EngineSyncApi | null>;

/**
 * Load `core/scripts/engine-sync.mjs` from the *checked* repository. Returns
 * null (never throws) when the file is missing or unreadable, so an
 * uninitialised `./core` produces the precheck's own failure message.
 */
export const defaultEngineSyncLoader: EngineSyncLoader = async (repoRoot, coreRel) => {
  const entry = path.join(repoRoot, coreRel, 'scripts', 'engine-sync.mjs');
  if (!fs.existsSync(entry)) return null;
  try {
    return (await import(pathToFileURL(entry).href)) as unknown as EngineSyncApi;
  } catch {
    return null;
  }
};

/** Diagnosis of the composed engine relative to the pin. */
export type EngineCheckoutReason =
  | 'at-pin'
  | 'ahead-of-pin'
  | 'behind-pin'
  | 'diverged'
  | 'pin-missing'
  | 'pin-unreadable'
  | 'core-uninitialised';

export interface EngineCheckoutResult {
  /** Effective verdict after any `ENGINE_CHECKOUT_CHECK` bypass. */
  ok: boolean;
  /** Full composed engine SHA (`./core` HEAD), or null when unavailable. */
  composedSha: string | null;
  /** Full pinned engine SHA (resolved in the local clone), or null. */
  pinSha: string | null;
  /** `git describe --tags` of the composed engine, when a tag exists. */
  describe: string | null;
  reason: EngineCheckoutReason;
  /** True when `./core` has uncommitted changes (warn-only). */
  dirty: boolean;
  bypass: 'warn' | 'off' | null;
  /** Human-readable line(s) for the log / failure message. */
  message: string;
}

/** Injectable seams for tests (defaults come from the repo's engine-sync.mjs). */
export interface EngineCheckoutDeps {
  coreRel?: string;
  pinRel?: string;
  readPin?: (repoRoot: string, pinRel?: string) => string;
  runGit?: (
    cwd: string,
    args: string[],
    env?: Record<string, string>,
  ) => EngineSyncModule.GitResult;
  resolveShaFull?: (repoRoot: string, coreRel: string, sha: string) => string | null;
  submoduleIsDirty?: (repoRoot: string, coreRel?: string) => boolean;
  loadEngineSync?: EngineSyncLoader;
}

export interface EngineCheckoutOptions {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
  deps?: EngineCheckoutDeps;
}

const FAILING_REASONS: readonly EngineCheckoutReason[] = [
  'behind-pin',
  'diverged',
  'pin-missing',
  'pin-unreadable',
  'core-uninitialised',
];

function isFailingReason(reason: EngineCheckoutReason): boolean {
  return FAILING_REASONS.includes(reason);
}

function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 7) : '(unavailable)';
}

interface MessageInput {
  reason: EngineCheckoutReason;
  composedFull: string | null;
  pinFull: string | null;
  /** Raw pin SHA from the pin file (named even when it cannot be resolved in the clone). */
  pinRaw: string | null;
  describe: string | null;
  dirty: boolean;
  bypass: 'warn' | 'off' | null;
  invalidBypass: string | null;
  pinReadError: string;
}

function buildMessage(input: MessageInput): string {
  const { reason, composedFull, pinFull, pinRaw, describe, dirty, bypass, invalidBypass, pinReadError } =
    input;
  const composedShort = shortSha(composedFull);
  const displayPin = pinFull ?? pinRaw;
  const pinShort = shortSha(displayPin);
  const describePart = describe ? ` (${describe})` : '';
  const bypassSuffix = bypass
    ? bypass === 'warn'
      ? ' [ENGINE_CHECKOUT_CHECK=warn: the gate is downgraded to a warning]'
      : ' [ENGINE_CHECKOUT_CHECK=off: the gate is disabled]'
    : '';
  const invalidSuffix = invalidBypass
    ? ` [ENGINE_CHECKOUT_CHECK=${invalidBypass} is not a recognised value (warn|off) — the gate stayed on]`
    : '';
  const dirtyNote = dirty
    ? `\nengine:check WARNING: ./core has uncommitted changes (composition core@${composedShort} is still identifiable; engine:sync / engine:verify will refuse to clobber or sync it).`
    : '';

  if (reason === 'at-pin' || reason === 'ahead-of-pin') {
    const state = reason === 'at-pin' ? 'at pin' : 'ahead of pin';
    return (
      `engine:check: composed core@${composedShort}${describePart}, pin ${pinShort} — OK (${state})` +
      bypassSuffix +
      invalidSuffix +
      dirtyNote
    );
  }

  const failures: Record<Exclude<EngineCheckoutReason, 'at-pin' | 'ahead-of-pin'>, string> = {
    'behind-pin': `composed core@${composedShort} is BEHIND the pin ${pinShort}: the composed commit is an ancestor of the pinned engine, so this run never sees the pinned engine code.`,
    diverged: `composed core@${composedShort} has DIVERGED from the pin ${pinShort}: neither commit is an ancestor of the other.`,
    'pin-missing': `the pinned engine commit ${pinShort} is not present in this ./core clone — the checkout is behind, or the pin's history was rewritten upstream.`,
    'pin-unreadable': `configs/engine-pin.json could not be read: ${pinReadError || 'unknown error'}`,
    'core-uninitialised': `./core is not an initialised engine checkout (no .git / no HEAD) — test runs would compose no engine at all.`,
  };

  return (
    `engine:check FAIL: ${failures[reason]}\n` +
    `  composed: core@${composedShort}${describePart}  (${composedFull ?? 'unavailable'})\n` +
    `  pin:      ${pinShort}  (${displayPin ?? 'unavailable'}, configs/engine-pin.json)\n` +
    `  Run \`npm run engine:sync\` to advance ./core to the pinned engine, then re-run the tests (needs network).\n` +
    `  Deliberate bypass: ENGINE_CHECKOUT_CHECK=warn|off (logged every time it is used).` +
    bypassSuffix +
    invalidSuffix +
    dirtyNote
  );
}

/**
 * Pure, offline engine-checkout check. Decides pass/fail from the local
 * commit graph only — `rev-parse` + `git merge-base --is-ancestor` + a
 * `git describe` — and never fetches or consults `origin/dev`.
 */
export async function checkEngineCheckout(options: EngineCheckoutOptions): Promise<EngineCheckoutResult> {
  const { repoRoot, env } = options;
  const deps = options.deps ?? {};

  const bypassRaw = String(env?.ENGINE_CHECKOUT_CHECK ?? process.env.ENGINE_CHECKOUT_CHECK ?? '')
    .trim()
    .toLowerCase();
  const bypass: EngineCheckoutResult['bypass'] =
    bypassRaw === 'warn' ? 'warn' : bypassRaw === 'off' ? 'off' : null;
  const invalidBypass = bypassRaw !== '' && bypass === null ? bypassRaw : null;

  const explicitApi =
    deps.runGit && deps.readPin && deps.resolveShaFull && deps.submoduleIsDirty
      ? ({
          runGit: deps.runGit,
          readPin: deps.readPin,
          resolveShaFull: deps.resolveShaFull,
          submoduleIsDirty: deps.submoduleIsDirty,
          DEFAULT_CORE_REL: 'core',
          DEFAULT_PIN_REL: 'configs/engine-pin.json',
        } satisfies EngineSyncApi)
      : null;
  const api = explicitApi ?? (await (deps.loadEngineSync ?? defaultEngineSyncLoader)(repoRoot, 'core'));

  const coreRel = deps.coreRel ?? api?.DEFAULT_CORE_REL ?? 'core';
  const pinRel = deps.pinRel ?? api?.DEFAULT_PIN_REL ?? 'configs/engine-pin.json';
  const coreDir = path.join(repoRoot, coreRel);

  // Pin (a repo-root file — readable even before ./core is initialised).
  let pinSha: string | null = null;
  let pinRaw: string | null = null;
  let pinReadError = '';
  if (api) {
    try {
      pinRaw = api.readPin(repoRoot, pinRel);
      pinSha = pinRaw;
    } catch (err) {
      pinReadError = err instanceof Error ? err.message : String(err);
    }
  } else {
    pinReadError = 'core/scripts/engine-sync.mjs (the engine tooling) is not present — ./core is not an initialised checkout';
  }

  // Composed engine: `./core` HEAD.
  const headRes = api ? api.runGit(coreDir, ['rev-parse', 'HEAD']) : undefined;
  const composedFull = headRes?.ok ? headRes.stdout.split(/\s+/)[0] ?? null : null;
  const isRepo = Boolean(api && headRes?.ok && composedFull && fs.existsSync(path.join(coreDir, '.git')));

  let pinFull: string | null = null;
  let reason: EngineCheckoutReason;
  if (!isRepo) {
    reason = 'core-uninitialised';
  } else if (pinSha === null) {
    reason = 'pin-unreadable';
  } else {
    const resolved = api!.resolveShaFull(repoRoot, coreRel, pinSha);
    if (resolved === null) {
      reason = 'pin-missing';
    } else {
      pinFull = resolved;
      if (composedFull === pinFull) {
        reason = 'at-pin';
      } else if (api!.runGit(coreDir, ['merge-base', '--is-ancestor', pinFull, composedFull!]).ok) {
        reason = 'ahead-of-pin';
      } else {
        reason = api!.runGit(coreDir, ['merge-base', '--is-ancestor', composedFull!, pinFull]).ok
          ? 'behind-pin'
          : 'diverged';
      }
    }
  }

  let describe: string | null = null;
  let dirty = false;
  if (isRepo) {
    const describeRes = api!.runGit(coreDir, ['describe', '--tags']);
    describe = describeRes.ok && describeRes.stdout ? describeRes.stdout : null;
    dirty = api!.submoduleIsDirty(repoRoot, coreRel);
  }

  const ok = !isFailingReason(reason) || bypass !== null;
  const message = buildMessage({
    reason,
    composedFull,
    pinFull,
    pinRaw,
    describe,
    dirty,
    bypass,
    invalidBypass,
    pinReadError,
  });

  return { ok, composedSha: composedFull, pinSha: pinFull, describe, reason, dirty, bypass, message };
}

/** Per-process identity-line dedupe (AC2): several Vitest projects each
 * inherit the root globalSetup via `extends: true`; the identity line is
 * emitted once per process. */
export interface PreflightState {
  reported: boolean;
}

const STATE_KEY = '__msEngineCheckoutPreflightState__';

function defaultPreflightState(): PreflightState {
  const g = globalThis as Record<string, unknown>;
  if (!g[STATE_KEY] || typeof g[STATE_KEY] !== 'object') {
    g[STATE_KEY] = { reported: false };
  }
  return g[STATE_KEY] as PreflightState;
}

export interface EngineCheckoutPreflightOptions {
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
  deps?: EngineCheckoutDeps;
  logger?: (line: string) => void;
  state?: PreflightState;
}

/**
 * Run the preflight the way the Vitest globalSetup does: log the identity
 * line once per process on a pass, log every use of a bypass, and throw on
 * a genuine failure (which aborts the whole Vitest run).
 */
export async function runEngineCheckoutPreflight(
  options: EngineCheckoutPreflightOptions = {},
): Promise<EngineCheckoutResult> {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const logger = options.logger ?? ((line: string) => console.log(line));
  const state = options.state ?? defaultPreflightState();
  const result = await checkEngineCheckout({ repoRoot, env: options.env, deps: options.deps });

  if (result.bypass !== null) {
    // Bypasses are logged every time they are used.
    logger(result.message);
  } else if (result.ok) {
    if (!state.reported) {
      state.reported = true;
      logger(result.message);
    }
  } else {
    // Fail loudly: a throwing globalSetup aborts the entire run.
    throw new Error(result.message);
  }
  return result;
}

/**
 * Vitest root `test.globalSetup` (wired in `vite.config.ts`). Runs once per
 * project; the identity-logging dedupe keeps the output to one identical
 * line per process (AC2).
 */
export default async function engineCheckoutGlobalSetup(): Promise<void> {
  await runEngineCheckoutPreflight();
}

/**
 * CLI entry (`npm run engine:check`): the same preflight as the Vitest gate,
 * exit 0 on pass, 1 on failure — for manual and CI diagnostics.
 */
async function main(): Promise<number> {
  try {
    await runEngineCheckoutPreflight();
    return 0;
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

// Entry-point guard: run only when executed as a script, so the pure helpers
// can be imported by tests and by the Vitest globalSetup without side effects.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
