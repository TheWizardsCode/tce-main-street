/**
 * Main Street story-line content adapter (cross-repo child of CG-0MVNE47TC0048WZ9).
 *
 * Proves Main Street's `card-data.csv` loads through the **core** story-line
 * content pipeline with {@link MAIN_STREET_CONTENT_ADAPTER}: the committed
 * story-line rows form the expected 5 arcs, their `options` encoding decodes
 * into graph edges, and every non-storyline card (businesses, upgrades, staff,
 * community spaces) lands in the editor's "Ungrouped" bucket — so pointing the
 * editor at the whole file never drops or mis-groups a row.
 *
 * The file is read from disk rather than through Vite's `?raw` import so the
 * test exercises exactly what the core editor CLI reads.
 *
 * @module
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseCsv } from '@story-line/content/csv';
import {
  buildStorylineManifestFromCsv,
  type StorylineManifest,
} from '@story-line/content/manifest';
import {
  buildEditorViewModel,
  UNGROUPED_STORYLINE_TITLE,
  type EditorStorylineGroup,
} from '@story-line/editor/view-model';
import {
  MAIN_STREET_CONTENT_ADAPTER,
  MAIN_STREET_EVENT_COLUMNS,
} from '../../src/MainStreetStorylineContentAdapter';

/** The committed content CSV, read the same way the core editor CLI reads it. */
const CARD_DATA_CSV = fileURLToPath(new URL('../../src/card-data.csv', import.meta.url));

/** The committed story-line arcs and their member card ids. */
const EXPECTED_ARCS: Readonly<Record<string, readonly string[]>> = {
  'storyline-tax': ['evt-tax', 'evt-tax-error', 'evt-tax-inquiry'],
  'storyline-health': ['evt-flu-outbreak', 'evt-pandemic'],
  'storyline-economy': ['evt-recession', 'evt-depression'],
  'storyline-labor': ['evt-strike-service', 'evt-general-strike'],
  'storyline-restaurant': ['evt-popular-menu', 'evt-farm-table'],
};

/** Reads the shipped content CSV text. */
function readCardDataCsv(): string {
  return readFileSync(CARD_DATA_CSV, 'utf-8');
}

/** Builds the manifest from the shipped content through the adapter. */
function buildManifest(): StorylineManifest {
  return buildStorylineManifestFromCsv(readCardDataCsv(), MAIN_STREET_CONTENT_ADAPTER);
}

/** Finds one story-line group by id (fails loudly when absent). */
function groupById(manifest: StorylineManifest, storylineId: string | null): EditorStorylineGroup {
  const group = buildEditorViewModel(manifest).storylines.find(
    (candidate) => candidate.storylineId === storylineId,
  );
  if (!group) throw new Error(`no story-line group for ${String(storylineId)}`);
  return group;
}

describe('MainStreetStorylineContentAdapter', () => {
  it('maps the generic story-line fields and exposes the event columns as editable', () => {
    expect(MAIN_STREET_CONTENT_ADAPTER.gameId).toBe('main-street');
    expect(MAIN_STREET_CONTENT_ADAPTER.fields).toEqual({
      id: 'id',
      name: 'name',
      effect: 'effect',
      options: 'options',
      storylineId: 'storylineId',
      storylineTitle: 'storylineTitle',
    });

    // Every declared column must exist in the shipped header — an invented
    // column would silently read as an empty cell.
    const header = parseCsv(readCardDataCsv()).header;
    for (const column of MAIN_STREET_CONTENT_ADAPTER.columns) {
      expect(header, `adapter column "${column}" missing from card-data.csv`).toContain(column);
    }

    for (const column of MAIN_STREET_EVENT_COLUMNS) {
      expect(MAIN_STREET_CONTENT_ADAPTER.editableColumns).toContain(column);
    }

    // A new card row starts from Main Street's event defaults, not blanks.
    expect(MAIN_STREET_CONTENT_ADAPTER.newCardDefaults).toMatchObject({
      trigger: 'Incident',
      target: 'All',
      coinDelta: '0',
      reputationDelta: '0',
      storylineId: '',
    });
  });

  it('groups the 11 shipped story-line rows under their 5 arcs', () => {
    const manifest = buildManifest();
    const viewModel = buildEditorViewModel(manifest);

    expect(manifest.gameId).toBe('main-street');
    expect(manifest.storylineIds).toEqual(Object.keys(EXPECTED_ARCS).sort());

    const storylineGroups = viewModel.storylines.filter((group) => group.storylineId !== null);
    expect(storylineGroups).toHaveLength(5);
    for (const [storylineId, memberIds] of Object.entries(EXPECTED_ARCS)) {
      expect(groupById(manifest, storylineId).nodeIds).toEqual([...memberIds].sort());
    }

    // Every story-line row is a node carrying its arc metadata.
    const storylineNodes = manifest.nodes.filter((node) => node.storylineId !== null);
    expect(storylineNodes).toHaveLength(11);
    expect(storylineNodes.map((node) => node.id).sort()).toEqual(
      Object.values(EXPECTED_ARCS).flat().sort(),
    );
    expect(
      storylineNodes.every((node) => (node.storylineTitle ?? '') !== ''),
      'every story-line node carries its arc title',
    ).toBe(true);
  });

  it('decodes the options encoding into successor edges', () => {
    const manifest = buildManifest();

    // `Accept|;Reject|evt-tax-inquiry` — Accept ends the chain, Reject
    // continues. The tax arc cycles (inquiry → error → tax), so the reject
    // edge is marked as participating in a cycle.
    const taxEdges = manifest.edges.filter((edge) => edge.from === 'evt-tax');
    expect(taxEdges).toEqual([
      { from: 'evt-tax', label: 'Accept', to: null, random: false, candidateIndex: 0, cycle: false, effectPolicy: 'apply' },
      { from: 'evt-tax', label: 'Reject', to: 'evt-tax-inquiry', random: false, candidateIndex: 0, cycle: true, effectPolicy: 'apply' },
    ]);

    // The three-card tax arc is reported as a cycle (paths of base ids).
    expect(manifest.cycles).toEqual([['evt-tax', 'evt-tax-error', 'evt-tax-inquiry']]);

    // A random branch keeps one edge per candidate, in declaration order.
    const recessionReject = manifest.edges.filter(
      (edge) => edge.from === 'evt-recession' && edge.label === 'Reject',
    );
    expect(recessionReject).toEqual([
      { from: 'evt-recession', label: 'Reject', to: 'evt-depression', random: true, candidateIndex: 0, cycle: false, effectPolicy: 'apply' },
      { from: 'evt-recession', label: 'Reject', to: 'evt-general-strike', random: true, candidateIndex: 1, cycle: false, effectPolicy: 'apply' },
    ]);

    // The two funded arcs are linked; the terminal arcs end at their last card.
    expect(manifest.edges.filter((edge) => edge.from === 'evt-flu-outbreak').map((edge) => edge.to)).toContain(
      'evt-pandemic',
    );
    expect(manifest.edges.filter((edge) => edge.from === 'evt-general-strike')).toEqual([]);
  });

  it('keeps every non-story-line card in the ungrouped bucket (no dropped row)', () => {
    const csv = readCardDataCsv();
    const dataRows = parseCsv(csv).rows.length;
    const manifest = buildManifest();
    const viewModel = buildEditorViewModel(manifest);

    // One node per CSV row: nothing is dropped when the whole file is loaded.
    expect(manifest.nodes).toHaveLength(dataRows);

    const ungrouped = groupById(manifest, null);
    expect(ungrouped.title).toBe(UNGROUPED_STORYLINE_TITLE);
    expect(ungrouped.nodeIds).toHaveLength(dataRows - 11);
    expect(ungrouped.nodeIds).not.toContain('evt-tax');

    // A representative business card survives as an ungrouped node.
    expect(viewModel.nodes.map((node) => node.id)).toContain('biz-cafe');
  });

  it('surfaces Main Street event columns and a readable impact in each node', () => {
    const manifest = buildManifest();
    const byId = new Map(manifest.nodes.map((node) => [node.id, node]));

    expect(byId.get('evt-flu-outbreak')?.fields).toMatchObject({
      trigger: 'Incident',
      effectType: 'income-multiplier',
      multiplier: '0.8',
      duration: '5',
    });
    expect(byId.get('evt-flu-outbreak')?.impact).toBe('80% income for 5 turns');

    // A proportional loss leads with the percentage, not the nominal delta.
    expect(byId.get('evt-tax')?.impact).toBe('−45% coins · −300 coins');

    expect(byId.get('evt-farm-table')?.impact).toBe('+400 coins · +65 reputation');
    expect(byId.get('evt-general-strike')?.isChoice).toBe(false);
    expect(byId.get('evt-tax')?.isChoice).toBe(true);
    expect(byId.get('evt-tax')?.optionCount).toBe(2);
  });
});
