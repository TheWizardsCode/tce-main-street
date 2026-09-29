/**
 * Main Street: Synergy Link Tooltip Content Tests
 *
 * Unit tests for the pure `buildSynergyLinkTooltipInfo()` builder in
 * `MainStreetFormatting` — the hover text for a persistent synergy line
 * between two adjacent cards. Runs headless in the Node unit environment
 * (no Phaser/scene dependency).
 *
 * Covers: the shared synergy type, per-endpoint coin-only and reputation
 * contributions, sold endpoints, zero-synergy opt-out, and the active
 * difficulty multiplier.
 *
 * @module tests/main-street/synergy-tooltip
 */
import { describe, it, expect } from 'vitest';

import {
  buildSynergyLinkTooltipInfo,
} from '../../src/MainStreetFormatting';
import { GRID_SIZE, type BusinessCard, type CommunitySpaceCard } from '../../src/MainStreetCards';
import type { SynergyFormatConfig } from '../../src/MainStreetFormatting';

// ── Helpers ─────────────────────────────────────────────────

function makeBiz(overrides: Partial<BusinessCard> = {}): BusinessCard {
  return {
    family: 'business',
    id: overrides.id ?? 'biz-test',
    name: overrides.name ?? 'Test Biz',
    cost: overrides.cost ?? 3,
    baseIncome: overrides.baseIncome ?? 2,
    synergyTypes: overrides.synergyTypes ?? ['Food'],
    synergyCoinBonus: overrides.synergyCoinBonus ?? 0.5,
    synergyRepBonus: overrides.synergyRepBonus ?? 0,
    maxLevel: overrides.maxLevel ?? 1,
    description: overrides.description ?? 'A test business',
    level: overrides.level ?? 0,
    incomeBonus: overrides.incomeBonus ?? 0,
    synergyRangeBonus: overrides.synergyRangeBonus ?? 0,
    reputationBonus: overrides.reputationBonus ?? 0,
    ongoingCost: overrides.ongoingCost ?? 0,
  };
}

function emptyGrid(): (BusinessCard | CommunitySpaceCard | null)[] {
  return new Array<BusinessCard | CommunitySpaceCard | null>(GRID_SIZE).fill(null);
}

const MULT_1: SynergyFormatConfig = { synergyBonusPerNeighbor: 1 };
const MULT_HALF: SynergyFormatConfig = { synergyBonusPerNeighbor: 0.5 };

// ── Tests ───────────────────────────────────────────────────

describe('buildSynergyLinkTooltipInfo', () => {
  it('names the shared synergy type and both endpoints', () => {
    const grid = emptyGrid();
    grid[0] = makeBiz({ id: 'biz-bakery', name: 'Bakery', synergyTypes: ['Food'] });
    grid[1] = makeBiz({ id: 'biz-diner', name: 'Diner', synergyTypes: ['Food'] });

    const info = buildSynergyLinkTooltipInfo(grid, 0, 1, 'Food', MULT_1);

    expect(info).toBe(
      [
        'Food synergy',
        'Bakery  ⟷  Diner',
        'Bakery: +1 coins/turn from this link',
        'Diner: +1 coins/turn from this link',
      ].join('\n'),
    );
  });

  it('reports coin-only links per endpoint with no reputation line', () => {
    const grid = emptyGrid();
    grid[0] = makeBiz({ id: 'biz-a', name: 'Biz A', synergyCoinBonus: 0.5, synergyRepBonus: 0 });
    grid[1] = makeBiz({ id: 'biz-b', name: 'Biz B', synergyCoinBonus: 0.5, synergyRepBonus: 0 });

    const info = buildSynergyLinkTooltipInfo(grid, 0, 1, 'Food', MULT_1);

    expect(info).toContain('Biz A: +1 coins/turn from this link');
    expect(info).toContain('Biz B: +1 coins/turn from this link');
    expect(info).not.toContain('rep/turn');
  });

  it('reports reputation synergy flowing from the neighbour to each endpoint', () => {
    const grid = emptyGrid();
    // A carries the reputation synergy; B (and A) gain it from their neighbour.
    grid[0] = makeBiz({ id: 'biz-a', name: 'Biz A', synergyRepBonus: 5 });
    grid[1] = makeBiz({ id: 'biz-b', name: 'Biz B', synergyRepBonus: 0 });

    const info = buildSynergyLinkTooltipInfo(grid, 0, 1, 'Food', MULT_1);

    // A gains no reputation from this link (B has none to give)...
    expect(info).toContain('Biz A: +1 coins/turn from this link');
    // ...while B gains A's reputation bonus.
    expect(info).toContain('Biz B: +1 coins/turn, +5 rep/turn from this link');
  });

  it('represents a sold endpoint as earning nothing while still anchoring the synergy', () => {
    const grid = emptyGrid();
    grid[0] = makeBiz({ id: 'biz-a', name: 'Biz A' });
    grid[1] = makeBiz({ id: 'biz-b', name: 'Biz B' });
    const sold = [true, false];

    const info = buildSynergyLinkTooltipInfo(grid, 0, 1, 'Food', MULT_1, sold);

    expect(info).toContain('Biz A (sold): earns nothing, but still anchors this synergy');
    // The non-sold neighbour still benefits from the link.
    expect(info).toContain('Biz B: +1 coins/turn from this link');
  });

  it('still anchors reputation for the neighbour when the sold endpoint carries a rep bonus', () => {
    const grid = emptyGrid();
    grid[0] = makeBiz({ id: 'biz-a', name: 'Biz A', synergyRepBonus: 4 });
    grid[1] = makeBiz({ id: 'biz-b', name: 'Biz B' });
    const sold = [true, false];

    const info = buildSynergyLinkTooltipInfo(grid, 0, 1, 'Food', MULT_1, sold);

    expect(info).toContain('Biz B: +1 coins/turn, +4 rep/turn from this link');
  });

  it('returns an empty string when an endpoint opts out of synergy entirely (Pawn Shop)', () => {
    const grid = emptyGrid();
    grid[0] = makeBiz({ id: 'biz-hardware', name: 'Hardware' });
    grid[1] = makeBiz({
      id: 'biz-pawnshop',
      name: 'Pawn Shop',
      synergyCoinBonus: 0,
      synergyRepBonus: 0,
    });

    expect(buildSynergyLinkTooltipInfo(grid, 0, 1, 'Commerce', MULT_1)).toBe('');
  });

  it('scales the coin contribution by the active difficulty multiplier', () => {
    const grid = emptyGrid();
    grid[0] = makeBiz({ id: 'biz-a', name: 'Biz A' });
    grid[1] = makeBiz({ id: 'biz-b', name: 'Biz B' });

    const info = buildSynergyLinkTooltipInfo(grid, 0, 1, 'Food', MULT_HALF);

    // effectiveBase (2) × rate (0.5) × 0.5 = 0.5
    expect(info).toContain('Biz A: +0.5 coins/turn from this link');
    expect(info).toContain('Biz B: +0.5 coins/turn from this link');
  });

  it('applies the same-type base-income penalty to the per-link share', () => {
    const grid = emptyGrid();
    grid[0] = makeBiz({ id: 'biz-a-0', name: 'Biz A', baseIncome: 2 });
    grid[1] = makeBiz({ id: 'biz-b-0', name: 'Biz B', baseIncome: 2 });
    // A same-type sibling adjacent to slot 0 triggers the 0.6 base penalty for A
    // (slot 5 is vertically adjacent to slot 0 on the default 5-column grid).
    grid[5] = makeBiz({ id: 'biz-a-1', name: 'Biz A2', baseIncome: 2 });

    const info = buildSynergyLinkTooltipInfo(grid, 0, 1, 'Food', MULT_1);

    // roundInt(2 × 0.6) = 1, × rate 0.5 × multiplier 1 = 0.5
    expect(info).toContain('Biz A: +0.5 coins/turn from this link');
    // B has no same-type neighbour → full share (2 × 0.5 = 1)
    expect(info).toContain('Biz B: +1 coins/turn from this link');
  });

  it('returns an empty string when an endpoint slot is empty', () => {
    const grid = emptyGrid();
    grid[0] = makeBiz({ id: 'biz-a' });

    expect(buildSynergyLinkTooltipInfo(grid, 0, 1, 'Food', MULT_1)).toBe('');
  });

  it('keeps the shared synergy type label from the caller (not re-derived)', () => {
    const grid = emptyGrid();
    grid[0] = makeBiz({ id: 'biz-a', name: 'A', synergyTypes: ['Food', 'Culture'] });
    grid[1] = makeBiz({ id: 'biz-b', name: 'B', synergyTypes: ['Culture'] });

    const info = buildSynergyLinkTooltipInfo(grid, 0, 1, 'Culture', MULT_1);

    expect(info.split('\n')[0]).toBe('Culture synergy');
  });
});
