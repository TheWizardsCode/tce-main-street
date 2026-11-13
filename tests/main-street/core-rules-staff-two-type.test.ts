/**
 * Core-rules staff two-type contract (MS-0MW2XMAOY005Y0DC, parent AC4).
 *
 * The GDD's Staff System (Appendix D.4) commits to exactly two staff types —
 * **business staff** (employed at a single business, effects scoped to that
 * business) and **management-company staff** (employed by the player, effects
 * player/turn-scoped). `docs/game/core-rules-and-mechanics.md` owns the
 * action-economy, hand-capacity and hire/relocate rules, so it must describe
 * those mechanics in the two-type vocabulary:
 *
 *  - action points (`actionsPerTurn`) are a **management-company** effect and
 *    name every shipped action-granting staff member,
 *  - hand slots (`handSlotsAdded` / `maxHandSize`) are a
 *    **management-company** effect, and business staff never change them,
 *  - only **business staff** are placed and relocated (1 action), while
 *    management-company staff are never placed or relocated at all,
 *  - the superseded three-tier hand-capacity framing is gone, and
 *  - the cross-references to the GDD and the card catalogue resolve.
 *
 * The test derives the action-granting staff from the shipped
 * `src/card-data.csv` templates, so a new action-granting staff card that is
 * not documented here fails the guard.
 *
 * @module
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { getStaffCardTemplates } from '../../src/MainStreetCards';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CORE_RULES = path.join(PROJECT_ROOT, 'docs/game/core-rules-and-mechanics.md');

function read(file: string): string {
  return fs.readFileSync(file, 'utf-8');
}

/** Collapses markdown blockquote line breaks and whitespace runs into single spaces. */
function prose(text: string): string {
  return text
    .replace(/\s*\n>\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Returns the body of the markdown section that starts at `heading`, up to the
 * next heading of the same or higher level.
 */
function section(doc: string, heading: string): string {
  const start = doc.indexOf(heading);
  if (start < 0) throw new Error(`core-rules-and-mechanics.md has no \`${heading}\` section`);
  const rest = doc.slice(start + heading.length);
  const next = rest.search(/^#{1,3} /m);
  return next < 0 ? rest : rest.slice(0, next);
}

/** The `### 6.0 Action Economy` section — the action-budget rules, as prose. */
function actionEconomy(): string {
  return prose(section(read(CORE_RULES), '### 6.0 Action Economy'));
}

/** The bold "Relocating staff costs exactly one action" note body, as prose. */
function relocationNote(): string {
  const doc = read(CORE_RULES);
  const start = doc.indexOf('**Relocating staff costs exactly one action');
  expect(start, 'relocation note must exist').toBeGreaterThanOrEqual(0);
  const rest = doc.slice(start);
  const end = rest.indexOf('\n\n');
  return prose(end < 0 ? rest : rest.slice(0, end));
}

/** Shipped staff templates that grant a weekly action point. */
function actionGrantingStaff(): { id: string; name: string }[] {
  return getStaffCardTemplates()
    .filter(template => (template.actionsPerTurn ?? 0) > 0)
    .map(template => ({ id: template.id, name: template.name }));
}

describe('core-rules-and-mechanics.md staff two-type model', () => {
  it('describes action points as a management-company staff effect', () => {
    const economy = actionEconomy();
    expect(economy).toContain('management-company staff');
    expect(economy).toContain('actionsPerTurn');
    // The scope rule: action points are player-scope, so only management-company
    // staff grant them.
    expect(economy).toMatch(/only management-company staff grant them/i);
    expect(economy).toMatch(/business staff[^.]{0,160}never/i);
  });

  it('names every shipped action-granting staff member', () => {
    const economy = actionEconomy();
    const granting = actionGrantingStaff();
    expect(granting.length, 'card-data.csv must ship action-granting staff').toBeGreaterThan(0);
    for (const staff of granting) {
      expect(economy, `${staff.name} (${staff.id}) grants actionsPerTurn`).toContain(staff.name);
    }
  });

  it('describes hand slots as a management-company staff effect', () => {
    const doc = prose(read(CORE_RULES));
    expect(doc).toMatch(
      /maxHandSize: number; \/\/ starts at 3, growable via management-company staff/,
    );
    expect(actionEconomy()).toMatch(/only management-company staff grant them/i);
    expect(actionEconomy()).toMatch(
      /business staff[^.]{0,160}never change the weekly action budget or the hand capacity/i,
    );
  });

  it('scopes per-seat hand capacity to management-company staff', () => {
    const doc = prose(read(CORE_RULES));
    expect(doc).toMatch(
      /base 3 plus that seat's \*\*management-company\*\* staff `handSlotsAdded`/,
    );
    expect(doc).toMatch(
      /management-company staff card's hand-slot bonus applies \*\*only to the employing seat\*\*/,
    );
  });

  it('restricts placement and relocation to business staff', () => {
    const doc = prose(read(CORE_RULES));
    // The action table row and the dedicated note both scope relocation.
    expect(doc).toContain('| Relocate an employed **business staff** member | 1 action |');
    expect(doc).toMatch(/Management-company staff are never placed or relocated/);

    const note = relocationNote();
    expect(note).toMatch(/Only \*\*business staff\*\* can be relocated/);
    expect(note).toContain('1 action point');
    expect(note).toMatch(
      /management-company staff\*\*[^.]{0,120}never carry an `employedAtSlot`/,
    );
    // Employment capacity matches the engine (`getEmploymentCapacity`).
    expect(note).toContain('max(1, level + 1)');
  });

  it('states classification follows card type and effect scope keys on assignment', () => {
    const economy = actionEconomy();
    expect(economy).toContain('employedAtSlot');
    expect(economy).toMatch(/carrying an `employedAtSlot` is business staff/);
    // Assign-later model (MS-0MWE64C6B002V3SO): a business-type member with no
    // employedAtSlot is *unassigned business staff*, never management-company staff.
    expect(economy).toMatch(/unassigned business staff/);
    expect(economy).toMatch(/never management-company staff/);
  });

  it('drops the superseded three-tier hand-capacity framing', () => {
    const doc = read(CORE_RULES);
    expect(doc).not.toMatch(/three[- ]tier/i);
    expect(doc).not.toMatch(/hand-capacity tiers/i);
  });

  it('keeps the GDD and card-catalogue cross-references consistent', () => {
    const economy = actionEconomy();
    expect(economy).toContain('the-build-gdd.md');
    expect(economy).toContain('Appendix D.4');
    expect(economy).toContain('card-catalog.md');
    // The referenced targets must exist in this repo.
    expect(fs.existsSync(path.join(PROJECT_ROOT, 'docs/game/the-build-gdd.md'))).toBe(true);
    expect(fs.existsSync(path.join(PROJECT_ROOT, 'docs/game/card-catalog.md'))).toBe(true);
  });
});
