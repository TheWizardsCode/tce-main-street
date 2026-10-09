/**
 * Pedestrian population — pure helper unit tests (MS-0MUYGFVVG009KONJ)
 *
 * Verifies the pure `pedestrianCount(reputation)` helper:
 *  - `floor(reputation / 50)`, floored at 0, uncapped
 *  - Guarded to return 0 for negative / NaN / non-finite inputs
 *
 * @module
 */

import { describe, it, expect } from 'vitest';

import { pedestrianCount } from '../../src/scenes/MainStreetPedestrians';

describe('pedestrianCount — pure helper (MS-0MUYGFVVG009KONJ)', () => {
  // ── Boundary values ──────────────────────────────────────────

  it('returns 0 when reputation is 0', () => {
    expect(pedestrianCount(0)).toBe(0);
  });

  it('returns 0 when reputation is just below one figure (49)', () => {
    expect(pedestrianCount(49)).toBe(0);
  });

  it('returns 1 at exactly one figure threshold (50)', () => {
    expect(pedestrianCount(50)).toBe(1);
  });

  it('returns 10 at reputation 500', () => {
    expect(pedestrianCount(500)).toBe(10);
  });

  it('scales linearly: 75 → 1, 100 → 2, 200 → 4', () => {
    expect(pedestrianCount(75)).toBe(1);
    expect(pedestrianCount(100)).toBe(2);
    expect(pedestrianCount(200)).toBe(4);
  });

  it('is uncapped at high reputation (1000 → 20, 5000 → 100)', () => {
    expect(pedestrianCount(1000)).toBe(20);
    expect(pedestrianCount(5000)).toBe(100);
  });

  // ── Fractional reputation (should floor, not round) ──────────

  it('floors fractional results: 99 → 1', () => {
    expect(pedestrianCount(99)).toBe(1);
  });

  it('floors fractional results: 149 → 2, 150 → 3', () => {
    expect(pedestrianCount(149)).toBe(2);
    expect(pedestrianCount(150)).toBe(3);
  });

  // ── Guard clauses ────────────────────────────────────────────

  it('returns 0 for negative reputation', () => {
    expect(pedestrianCount(-1)).toBe(0);
    expect(pedestrianCount(-50)).toBe(0);
    expect(pedestrianCount(-1000)).toBe(0);
  });

  it('returns 0 for NaN', () => {
    expect(pedestrianCount(NaN)).toBe(0);
  });

  it('returns 0 for Infinity', () => {
    expect(pedestrianCount(Infinity)).toBe(0);
  });

  it('returns 0 for -Infinity', () => {
    expect(pedestrianCount(-Infinity)).toBe(0);
  });
});
