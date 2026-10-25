/**
 * Main Street: Grand Opening card copy / tooltip / doc consistency
 * (MS-0MVCS8E390019SP3, parent MS-0MV8KSPFK006HTXG).
 *
 * Test-first contract for the Feature-4 copy change (implementing child
 * MS-0MVCS8EBG003RXDN): once Grand Opening Sale pays out against the synergy
 * of the card placed THIS turn (Features 1–3), no player-facing surface may
 * keep describing it as a fixed "Commerce promotion".
 *
 * Acceptance Criteria (child MS-0MVCS8E390019SP3):
 *  1. Tooltip text for `evt-grand-opening` no longer contains
 *     "Commerce promotion".
 *  2. Card catalog / analysis doc copy no longer claims a fixed Commerce
 *     promotion.
 *  3. Existing tooltip plumbing still renders the card's effect text
 *     verbatim (so the copy change reaches the tooltip).
 *  4. Full project suite passes.
 *
 * Red-phase convention (repo test-first tracer bullet, follow
 * MS-0MVCS7LMP001QYPM / MS-0MVCS89X70034IPI): the copy cases below were
 * authored `it.fails` against the old copy (`+450 coins from a Commerce
 * promotion.`) and have been flipped to plain `it` by the implementing child
 * (MS-0MVCS8EBG003RXDN) once the copy change landed. The guards that must
 * hold both before and after the copy change stayed plain `it` throughout.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

import { buildCardTooltipInfo } from '../../src/MainStreetFormatting';
import { MEDIUM_PRESET } from '../../src/MainStreetDifficulty';
import { getEventTemplates } from '../../src/MainStreetCards';

const REPO_ROOT = process.cwd();

/** The shipped `evt-grand-opening` template parsed from `src/card-data.csv`. */
function grandOpeningTemplate() {
  const event = getEventTemplates().find((e) => e.id === 'evt-grand-opening');
  if (!event) throw new Error('Missing event template evt-grand-opening');
  return event;
}

function tooltipForGrandOpening(): string {
  return buildCardTooltipInfo(grandOpeningTemplate(), MEDIUM_PRESET, {
    includeEventDetail: true,
  });
}

/** Raw `src/card-data.csv` row for `evt-grand-opening`, split into columns. */
function grandOpeningCsvRow(): string[] {
  const csv = fs.readFileSync(path.join(REPO_ROOT, 'src/card-data.csv'), 'utf8');
  const row = csv
    .split(/\r?\n/)
    .find((line) => line.startsWith('event,evt-grand-opening,'));
  if (!row) throw new Error('Missing evt-grand-opening row in src/card-data.csv');
  return row.split(',');
}

// ── AC1: card-data / tooltip copy ────────────────────────────

describe('AC1: Grand Opening copy drops the fixed-Commerce framing', () => {
  it('card-data.csv effect text describes the placed-synergy payout, not a Commerce promotion', () => {
    const effect = grandOpeningCsvRow()[14]; // column 15 (1-based) = effect
    expect(effect).not.toMatch(/commerce promotion/i);
    expect(effect).toMatch(/synerg/i);
  });

  it('the live tooltip for evt-grand-opening no longer says "Commerce promotion"', () => {
    const tooltip = tooltipForGrandOpening();
    expect(tooltip).not.toMatch(/commerce promotion/i);
    expect(tooltip).toMatch(/Effect: .*synerg/i);
  });
});

// ── AC2: catalog + analysis docs ─────────────────────────────

describe('AC2: catalog and analysis docs drop the fixed-Commerce claim', () => {
  it('card-catalog.md Grand Opening entry describes the placed-synergy payout', () => {
    const catalog = fs.readFileSync(
      path.join(REPO_ROOT, 'docs/game/card-catalog.md'),
      'utf8',
    );
    const row = catalog
      .split(/\r?\n/)
      .find((line) => line.startsWith('| `evt-grand-opening` |'));
    expect(row, 'card-catalog.md Grand Opening row').toBeDefined();
    expect(row!).not.toMatch(/commerce promotion/i);
    expect(row!).toMatch(/synerg/i);
  });

  it('community-space-event-repricing.md documents the placed-synergy payout', () => {
    const doc = fs.readFileSync(
      path.join(REPO_ROOT, 'docs/dev/analysis/community-space-event-repricing.md'),
      'utf8',
    );
    // The analysis must not repeat the old fixed-promotion framing, and it
    // must note that the payout now follows the synergy placed this turn.
    expect(doc).not.toMatch(/commerce promotion/i);
    expect(doc).toMatch(/grand opening[^\n]*placed[^\n]*synerg/i);
  });
});

// ── AC3 + constraints: guards that hold before and after the edit ─

describe('AC3: tooltip plumbing and static relevance are preserved', () => {
  it('renders the card-data effect text verbatim, so the copy change reaches the tooltip', () => {
    const event = grandOpeningTemplate();
    expect(tooltipForGrandOpening()).toContain(`Effect: ${event.effect}`);
  });

  it('keeps the static targetSynergy: Commerce so market-refill relevance is unchanged', () => {
    const columns = grandOpeningCsvRow();
    expect(columns[15]).toBe('SpecificSynergy'); // column 16 = target
    expect(columns[16]).toBe('Commerce'); // column 17 = targetSynergy
    expect(columns[17]).toBe('450'); // column 18 = coinDelta (integer economy)
  });
});
