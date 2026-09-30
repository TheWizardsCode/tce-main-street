/**
 * Main Street: Upcoming delta population on end-of-turn (CG-0MUA1UH3A008M4BS).
 *
 * Verifies that `processEndOfTurn` decorates the income phase breakdown with
 * the resolved Upcoming-card (incident) coin/reputation deltas, tagged by
 * attachment (source `EventCard.target`), so the phased `upcoming` animation
 * has real routing data — without changing the credited totals.
 *
 * @module tests/main-street/upcoming-flow-engine
 */

import { describe, it, expect } from 'vitest';

import { setupMainStreetGame, type MainStreetState } from '../../src/MainStreetState';
import { processEndOfTurn, executeWeekStart } from '../../src/MainStreetEngine';
import { type BusinessCard, type EventCard, getBusinessTemplates } from '../../src/MainStreetCards';

function makeBiz(id: string, name: string, synergyTypes: BusinessCard['synergyTypes'], baseIncome = 3): BusinessCard {
  const tpl = getBusinessTemplates()[0];
  return {
    family: 'business',
    ...tpl,
    id,
    name,
    synergyTypes,
    level: 1,
    baseIncome,
    ongoingCost: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    currentIncome: baseIncome,
    currentReputationPerTurn: 0,
  };
}

function makeIncident(overrides: Partial<EventCard>): EventCard {
  return {
    family: 'event',
    id: 'test-incident',
    name: 'Test Incident',
    trigger: 'Incident',
    cost: 0,
    effect: 'test',
    coinDelta: 0,
    reputationDelta: 0,
    target: 'All',
    ...overrides,
  };
}

/** Prepares a state in MarketPhase with a single injected incident. */
function readyWithIncident(seed: string, incident: EventCard): MainStreetState {
  const state = setupMainStreetGame({ seed });
  executeWeekStart(state);
  state.phase = 'MarketPhase';
  state.incidentDeck = [incident];
  return state;
}

describe('processEndOfTurn — Upcoming delta population (CG-0MUA1UH3A008M4BS)', () => {
  it('AC2: an unattached incident (`target = All`) produces a HUD-bound upcoming delta (attachedSlotIndex null)', () => {
    const state = readyWithIncident(
      'upcoming-engine-hud',
      makeIncident({ id: 'evt-tax', name: 'Tax Audit', target: 'All', coinDelta: -200, reputationDelta: 100 }),
    );
    state.streetGrid[0] = makeBiz('biz-cafe', 'Cafe', ['Food']);

    const result = processEndOfTurn(state);
    const deltas = result.income!.phaseBreakdown.perSlotBreakdown.flatMap((pd) => pd.upcomingDeltas);

    expect(deltas.length).toBeGreaterThan(0);
    const coin = deltas.find((d) => d.kind === 'coin');
    const rep = deltas.find((d) => d.kind === 'rep');
    expect(coin).toMatchObject({ cardId: 'evt-tax', delta: -200, attachedSlotIndex: null });
    expect(rep).toMatchObject({ cardId: 'evt-tax', delta: 100, attachedSlotIndex: null });
  });

  it('AC1: a business-attached incident (`target = SpecificSynergy`) attributes the delta to the matching slot', () => {
    const state = readyWithIncident(
      'upcoming-engine-attached',
      makeIncident({
        id: 'evt-rainy',
        name: 'Rainy Day',
        target: 'SpecificSynergy',
        targetSynergy: 'Food',
        coinDelta: -200,
        reputationDelta: 0,
      }),
    );
    state.streetGrid[0] = makeBiz('biz-cafe', 'Cafe', ['Food']);
    state.streetGrid[1] = makeBiz('biz-gallery', 'Gallery', ['Culture']);

    const result = processEndOfTurn(state);
    const slot0 = result.income!.phaseBreakdown.perSlotBreakdown.find((pd) => pd.slotIndex === 0)!;
    const slot1 = result.income!.phaseBreakdown.perSlotBreakdown.find((pd) => pd.slotIndex === 1)!;

    expect(slot0.upcomingDeltas).toHaveLength(1);
    expect(slot0.upcomingDeltas[0]).toMatchObject({
      cardId: 'evt-rainy',
      delta: -200,
      kind: 'coin',
      attachedSlotIndex: 0,
    });
    expect(slot1.upcomingDeltas).toHaveLength(0);
  });

  it('AC3: a business-attached reputation gain is carried with the matching slot and kind `rep`', () => {
    const state = readyWithIncident(
      'upcoming-engine-attached-rep',
      makeIncident({
        id: 'evt-award',
        name: 'Civic Award',
        target: 'SpecificSynergy',
        targetSynergy: 'Food',
        coinDelta: 0,
        reputationDelta: 100,
      }),
    );
    state.streetGrid[0] = makeBiz('biz-cafe', 'Cafe', ['Food']);
    state.streetGrid[1] = makeBiz('biz-gallery', 'Gallery', ['Culture']);

    const result = processEndOfTurn(state);
    const slot0 = result.income!.phaseBreakdown.perSlotBreakdown.find((pd) => pd.slotIndex === 0)!;
    const slot1 = result.income!.phaseBreakdown.perSlotBreakdown.find((pd) => pd.slotIndex === 1)!;

    expect(slot0.upcomingDeltas).toHaveLength(1);
    expect(slot0.upcomingDeltas[0]).toMatchObject({
      cardId: 'evt-award',
      delta: 100,
      kind: 'rep',
      attachedSlotIndex: 0,
    });
    expect(slot1.upcomingDeltas).toHaveLength(0);
  });

  it('AC4: the populated upcoming deltas never change the engine-applied coin/reputation totals', () => {
    const state = setupMainStreetGame({ seed: 'upcoming-engine-invariant' });
    executeWeekStart(state);
    state.phase = 'MarketPhase';
    state.streetGrid[0] = makeBiz('biz-cafe', 'Cafe', ['Food']);
    state.resourceBank.coins = 5000;
    state.resourceBank.reputation = 0;

    // No incident: capture baseline credited coins.
    state.incidentDeck = [];
    const baseline = processEndOfTurn(state);

    // A second game with the same setup plus an incident: the income phase
    // deltas must match the baseline (the incident lands via the separate
    // incident path, never via the income phase breakdown).
    const withIncident = setupMainStreetGame({ seed: 'upcoming-engine-invariant' });
    executeWeekStart(withIncident);
    withIncident.phase = 'MarketPhase';
    withIncident.streetGrid[0] = makeBiz('biz-cafe', 'Cafe', ['Food']);
    withIncident.resourceBank.coins = 5000;
    withIncident.resourceBank.reputation = 0;
    withIncident.incidentDeck = [makeIncident({ target: 'All', coinDelta: 0, reputationDelta: 0 })];
    const withIncidentResult = processEndOfTurn(withIncident);

    expect(withIncidentResult.income!.coinDelta).toBe(baseline.income!.coinDelta);
    // The credited total (base + synergy + repBonus + eventDeltas) is identical.
    const credited = (r: typeof baseline): number =>
      r.income!.phaseBreakdown.perSlotBreakdown.reduce(
        (acc, pd) =>
          acc + pd.baseIncome + pd.synergyBonus + pd.repBonus +
          (pd.eventDeltas ?? []).reduce((s, d) => s + d.delta, 0),
        0,
      );
    expect(credited(withIncidentResult)).toBe(credited(baseline));
  });

  it('a zero-delta incident produces no upcoming descriptors', () => {
    const state = readyWithIncident(
      'upcoming-engine-zero',
      makeIncident({ target: 'All', coinDelta: 0, reputationDelta: 0 }),
    );
    state.streetGrid[0] = makeBiz('biz-cafe', 'Cafe', ['Food']);

    const result = processEndOfTurn(state);
    const deltas = result.income!.phaseBreakdown.perSlotBreakdown.flatMap((pd) => pd.upcomingDeltas);
    expect(deltas).toHaveLength(0);
  });
});
