/**
 * Main Street: Card test framework meta-tests.
 *
 * These tests prove the framework itself is not a green-but-useless suite:
 * a card with no definition is reported as a failure, and a definition with a
 * deliberately wrong expectation fails (rather than silently passing). They
 * also lock the CSV result-writer's backward-compatibility contract.
 *
 * @module
 */

import { describe, expect, it } from 'vitest';

import { CARD_DATA_RAW } from '../../../../src/MainStreetCards';
import type { CardRow } from '../CardTestTypes';
import { CardTestRegistry, createDefaultRegistry } from '../CardTestRegistry';
import {
  RESULT_COLUMNS,
  applyResultsToCsv,
  splitCsvLine,
} from '../CardTestResultWriter';

/** Builds a synthetic card row for registry unit tests. */
function makeRow(id: string, family: CardRow['family'] = 'business'): CardRow {
  return { id, family, name: id, row: { id, family, name: id } };
}

describe('CardTestRegistry discovery', () => {
  it('registers exactly one definition per discovered card', () => {
    const registry = createDefaultRegistry();
    const cards = registry.discoverCards();
    expect(cards.length).toBe(174);
    expect(registry.size).toBe(174);
    expect(registry.missingDefinitions(cards)).toEqual([]);
  });

  it('rejects duplicate definitions', () => {
    const registry = new CardTestRegistry();
    const definition = {
      cardId: 'biz-dup',
      family: 'business' as const,
      verifies: 'dup',
      run: () => undefined,
    };
    registry.register(definition);
    expect(() => registry.register(definition)).toThrow(/Duplicate card test definition/);
  });
});

describe('CardTestRegistry failure modes (green-but-useless guards)', () => {
  it('reports a card with no definition as a failure, never a skip', () => {
    const registry = new CardTestRegistry();
    const row = makeRow('biz-unregistered');
    expect(registry.missingDefinitions([row])).toEqual(['biz-unregistered']);
    const result = registry.runCard(row);
    expect(result.status).toBe('fail');
    expect(result.failReason).toMatch(/No test definition registered/);
  });

  it('fails when a definition expectation is deliberately wrong', () => {
    const registry = new CardTestRegistry();
    registry.register({
      cardId: 'biz-bakery',
      family: 'business',
      verifies: 'deliberately wrong',
      run: () => {
        throw new Error('expected 999, observed 300');
      },
    });
    const result = registry.runCard(makeRow('biz-bakery'));
    expect(result.status).toBe('fail');
    expect(result.failReason).toContain('expected 999, observed 300');
  });

  it('passes a correct definition and normalises the pass reason to empty', () => {
    const registry = new CardTestRegistry();
    registry.register({
      cardId: 'biz-bakery',
      family: 'business',
      verifies: 'correct',
      run: () => undefined,
    });
    const result = registry.runCard(makeRow('biz-bakery'));
    expect(result.status).toBe('pass');
    expect(result.failReason).toBe('');
  });
});

describe('CardTestResultWriter', () => {
  const baseCsv =
    'family,id,name,cost\nbusiness,biz-a,Alpha,300\nevent,evt-b,Beta,0\n';

  it('appends the result columns without disturbing existing columns or order', () => {
    const { csv } = applyResultsToCsv(baseCsv, []);
    const lines = csv.trimEnd().split('\n');
    const header = splitCsvLine(lines[0]);
    expect(header.slice(0, 4)).toEqual(['family', 'id', 'name', 'cost']);
    for (const column of RESULT_COLUMNS) {
      expect(header).toContain(column);
    }
    // Row order and original values preserved.
    expect(splitCsvLine(lines[1]).slice(0, 4)).toEqual(['business', 'biz-a', 'Alpha', '300']);
    expect(splitCsvLine(lines[2]).slice(0, 4)).toEqual(['event', 'evt-b', 'Beta', '0']);
  });

  it('records pass/fail status and quotes a reason containing a comma', () => {
    const { csv } = applyResultsToCsv(baseCsv, [
      { cardId: 'biz-a', status: 'pass', failReason: '' },
      { cardId: 'evt-b', status: 'fail', failReason: 'boom, bad value' },
    ]);
    const lines = csv.trimEnd().split('\n');
    const header = splitCsvLine(lines[0]);
    const statusIdx = header.indexOf('unitTestStatus');
    const reasonIdx = header.indexOf('unitTestFailReason');

    const passRow = splitCsvLine(lines[1]);
    expect(passRow[statusIdx]).toBe('pass');
    expect(passRow[reasonIdx]).toBe('');

    const failRow = splitCsvLine(lines[2]);
    expect(failRow[statusIdx]).toBe('fail');
    expect(failRow[reasonIdx]).toBe('boom, bad value');
  });

  it('is idempotent when results are unchanged', () => {
    const results = [
      { cardId: 'biz-a', status: 'pass' as const, failReason: '' },
      { cardId: 'evt-b', status: 'pass' as const, failReason: '' },
    ];
    const first = applyResultsToCsv(baseCsv, results);
    const second = applyResultsToCsv(first.csv, results);
    expect(second.changed).toBe(false);
  });

  it('updates previously written cells in place', () => {
    const first = applyResultsToCsv(baseCsv, [
      { cardId: 'biz-a', status: 'pass', failReason: '' },
    ]).csv;
    const second = applyResultsToCsv(first, [
      { cardId: 'biz-a', status: 'fail', failReason: 'regressed' },
    ]);
    expect(second.changed).toBe(true);
    const lines = second.csv.trimEnd().split('\n');
    const header = splitCsvLine(lines[0]);
    const row = splitCsvLine(lines[1]);
    expect(row[header.indexOf('unitTestStatus')]).toBe('fail');
    expect(row[header.indexOf('unitTestFailReason')]).toBe('regressed');
  });

  it('preserves the real card-data.csv values when adding the result columns', () => {
    const { csv } = applyResultsToCsv(CARD_DATA_RAW, []);
    const originalLines = CARD_DATA_RAW.trimEnd().split('\n');
    const newLines = csv.trimEnd().split('\n');
    expect(newLines.length).toBe(originalLines.length);
    // Every original field value (unescaped) must survive the round-trip.
    for (let i = 0; i < originalLines.length; i++) {
      const originalFields = splitCsvLine(originalLines[i]);
      const newFields = splitCsvLine(newLines[i]);
      expect(newFields.slice(0, originalFields.length)).toEqual(originalFields);
    }
  });
});
