/**
 * Per-seat income / HUD-anchor documentation contract guard
 * (MS-0MW083RFK001RXTF, parent MS-0MVWNS9L7007CTK9 AC7).
 *
 * The end-of-turn income presentation now resolves flight destinations by the
 * owning seat: `SlotPhaseBreakdown.ownerId` → `flightTargetFor`, with the
 * human seat on the shared `hudCoinAnchor` / `hudRepAnchor` and an AI seat on
 * its published competitive-scoreboard anchor (`scene.hudSeatAnchors`),
 * falling back to `hudSeatFallback`. That contract is written down in
 * `docs/game/ux-visual-audio.md` (§ *HUD resource anchors* and § *End-of-turn
 * income presentation*) and cross-referenced from
 * `docs/game/core-rules-and-mechanics.md`.
 *
 * This guard keeps the written contract and the code anchors it names from
 * drifting apart — mirroring `pedestrian-doc-contract.test.ts`. Runtime
 * behaviour is asserted by `income-owner-flight-routing.test.ts`,
 * `competitive-seat-anchors.test.ts` and the collection / reputation /
 * `upcoming` animator suites; nothing here replaces those behaviour tests.
 *
 * @module tests/main-street/per-seat-income-docs-contract
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PROJECT_ROOT = path.resolve(__dirname, '../..');

const UX_DOC = 'docs/game/ux-visual-audio.md';
const RULES_DOC = 'docs/game/core-rules-and-mechanics.md';
const ANIMATOR_CONTEXT = 'src/scenes/MainStreetAnimatorContext.ts';
const SCORING = 'src/MainStreetAdjacencyScoring.ts';
const SCOREBOARD_RENDERER = 'src/scenes/MainStreetRendererCompetitiveHud.ts';
const CONSTANTS = 'src/scenes/MainStreetConstants.ts';

function read(rel: string): string {
  return fs.readFileSync(path.join(PROJECT_ROOT, rel), 'utf-8');
}

/** Whitespace-normalised read so assertions survive markdown line wrapping. */
function norm(rel: string): string {
  return read(rel).replace(/\s+/g, ' ');
}

describe('docs/game/ux-visual-audio.md — per-seat income destination contract', () => {
  const doc = norm(UX_DOC);

  it('keeps both documented section headings the rest of the docs cross-reference', () => {
    expect(doc).toContain('HUD resource anchors — single source of truth for flight destinations');
    expect(doc).toContain('End-of-turn income presentation');
    expect(doc).toContain('Per-seat anchors and per-owner destination resolution');
  });

  it('names the per-owner resolver, the per-seat anchor store and its fallback — and all three exist in source', () => {
    for (const symbol of ['flightTargetFor', 'hudSeatAnchors', 'hudSeatFallback']) {
      expect(doc).toContain(symbol);
    }
    // The code anchors the doc names must still exist, or the written contract
    // has drifted from the implementation.
    const context = read(ANIMATOR_CONTEXT);
    expect(context).toContain('export function flightTargetFor(');
    expect(context).toContain('hudSeatAnchors?');
    expect(read(CONSTANTS)).toContain('export function hudSeatFallback(');
    expect(read(CONSTANTS)).toContain('export const HUD_FALLBACK_SEAT_COUNT');
    expect(doc).toContain('HUD_FALLBACK_SEAT_COUNT');
    // The scoreboard renderer is the publisher of the per-seat anchors.
    expect(doc).toContain('renderCompetitiveScoreboard');
    expect(read(SCOREBOARD_RENDERER)).toContain('s.hudSeatAnchors = seatAnchors');
  });

  it('states the AI summary-row stopgap and that a real AI bank replaces only the anchor source', () => {
    expect(doc).toMatch(/summary row/i);
    expect(doc).toMatch(/stopgap/i);
    expect(doc).toContain('only the anchor');
    expect(doc).toContain('never the animator');
    expect(doc).toMatch(/swappable/i);
  });

  it('links the separate Turn Summary dialog work instead of absorbing it', () => {
    expect(doc).toContain('MS-0MVRNV9Y8008IKGK');
  });

  it('documents the owner identity carrier and the per-owner routing of the three HUD-bound routes', () => {
    expect(doc).toContain('SlotPhaseBreakdown.ownerId');
    expect(doc).toContain('applyCompetitiveIncome');
    // The carrier field the doc names still exists on the breakdown type.
    expect(read(SCORING)).toContain('ownerId?: number;');
    for (const route of ['collectIncomeGrids', 'flyRepPips', 'flyCoinsToPoint']) {
      expect(doc).toContain(route);
    }
  });

  it('documents human-only HUD feedback gating and the per-owner landing pop', () => {
    expect(doc).toContain('ownsSharedHudFeedback');
    expect(read(ANIMATOR_CONTEXT)).toContain('export function ownsSharedHudFeedback(');
    expect(doc).toContain('displayedCoins');
    expect(doc).toContain('per owning seat');
    // Single-player parity is stated explicitly.
    expect(doc).toMatch(/single-player behaviour is identical/i);
  });
});

describe('docs/game/core-rules-and-mechanics.md — per-seat income cross-reference', () => {
  const rules = norm(RULES_DOC);

  it('cross-references the per-owner destination resolver from the IncomePhase description', () => {
    expect(rules).toContain('flightTargetFor');
    expect(rules).toContain('SlotPhaseBreakdown.ownerId');
    expect(rules).toContain('ux-visual-audio.md');
    expect(rules).toMatch(/presentation only/i);
  });
});
