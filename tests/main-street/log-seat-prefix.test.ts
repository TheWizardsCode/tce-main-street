/**
 * Main Street: Activity-Log Seat Prefixes Tests
 *
 * Feature F3 (MS-0MV34M1QN007MOVB) of epic MS-0MUWNTN8W006C7EF — verify that
 * activity-log entries attributable to a seat carry the seat's canonical label
 * (`You`, `AI 1`, ...) and persisted colour, and that the rendered prefix
 * colour stays legible on the dark log panel against the gain/loss/neutral
 * line-type colours.
 *
 *   AC1/AC2 — AI/human entries carry the seat label + colour.
 *   AC3    — `resolveLogSeatColour` keeps the prefix legible and distinct.
 *   AC5    — the label comes from the shared `MainStreetAdjacencyOwner` source.
 *   AC6    — entry text and colour are correct for each seat type.
 */
import { describe, it, expect } from 'vitest';

import {
  addLog,
  createCompetitiveState,
  deserializeMainStreetState,
  resolveLogSeatColour,
  serializeMainStreetState,
  setupMainStreetGame,
  type CompetitiveOpponentConfig,
  type MainStreetState,
} from '../../src/MainStreetState';
import { getSeatDisplayLabel } from '../../src/MainStreetAdjacencyOwner';
import { SEAT_COLOUR_PALETTE } from '../../src/MainStreetSeatColours';
import { LOG_COLORS } from '../../src/scenes/MainStreetConstants';

const OPPONENTS: CompetitiveOpponentConfig[] = [
  { strategy: 'Random', difficulty: 'Easy' },
  { strategy: 'Greedy', difficulty: 'Medium' },
];

/** Fresh three-seat competitive state (human + two AI). */
function competitive(seed = 'log-seat-prefix'): MainStreetState {
  return createCompetitiveState({ seed, playerCount: 3, opponents: OPPONENTS });
}

// ── Colour maths (mirrors the helper's contract, independently) ──

type RGB = [number, number, number];

function parseHex(hex: string): RGB {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function relativeLuminance([r, g, b]: RGB): number {
  const linear = (channel: number): number => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function rgbDistance(a: RGB, b: RGB): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

/** The dark activity-log panel fill (`MainStreetRendererStreet`). */
const LOG_PANEL_BG = '#1a1408';

/** AC3 line-type colours that a seat prefix sits beside. */
const LINE_COLOURS = [LOG_COLORS.gain, LOG_COLORS.loss, LOG_COLORS.neutral];

// ── AC5 — shared label source ───────────────────────────────

describe('getSeatDisplayLabel (shared seat-label source)', () => {
  it('labels seat 0 as the human "You"', () => {
    expect(getSeatDisplayLabel(0)).toBe('You');
  });

  it('labels AI seats as "AI n"', () => {
    expect(getSeatDisplayLabel(1)).toBe('AI 1');
    expect(getSeatDisplayLabel(2)).toBe('AI 2');
  });
});

// ── AC1/AC2/AC6 — seat-attributed log entries ───────────────

describe('addLog seat prefixes', () => {
  it('prefixes an AI seat entry with its label and persisted colour', () => {
    const state = competitive();
    const ai = state.players![1];

    addLog(state, ai.playerId, 'Bought a business', 'loss');

    const entry = state.activityLog[state.activityLog.length - 1]!;
    expect(entry.text).toBe('Bought a business');
    expect(entry.seatId).toBe(1);
    expect(entry.seatLabel).toBe('AI 1');
    expect(entry.seatColour).toBe(ai.colour);
    expect(SEAT_COLOUR_PALETTE).toContain(entry.seatColour);
  });

  it('prefixes the human seat entry with "You" in its colour', () => {
    const state = competitive();
    const human = state.players![0];

    addLog(state, human.playerId, 'Collected income', 'gain');

    const entry = state.activityLog[state.activityLog.length - 1]!;
    expect(entry.seatId).toBe(0);
    expect(entry.seatLabel).toBe('You');
    expect(entry.seatColour).toBe(human.colour);
  });

  it('leaves the seat fields undefined for a plain (shared) entry', () => {
    const state = competitive();

    addLog(state, 'Turn 1 totals: 10 coins', 'neutral');

    const entry = state.activityLog[state.activityLog.length - 1]!;
    expect(entry.text).toBe('Turn 1 totals: 10 coins');
    expect(entry.seatId).toBeUndefined();
    expect(entry.seatLabel).toBeUndefined();
    expect(entry.seatColour).toBeUndefined();
  });

  it('does not prefix in single-player, keeping visuals unchanged', () => {
    const state = setupMainStreetGame({ seed: 'single-player-seat-prefix' });

    addLog(state, 0, 'Income: +5 coins', 'gain');

    const entry = state.activityLog[state.activityLog.length - 1]!;
    expect(entry.text).toBe('Income: +5 coins');
    expect(entry.seatLabel).toBeUndefined();
    expect(entry.seatColour).toBeUndefined();
  });

  it('round-trips seat fields through save/load', () => {
    const state = competitive('log-seat-prefix-round-trip');
    addLog(state, 1, 'AI action', 'neutral');

    const restored = deserializeMainStreetState(serializeMainStreetState(state));

    const entry = restored.activityLog[restored.activityLog.length - 1]!;
    expect(entry.seatLabel).toBe('AI 1');
    expect(entry.seatColour).toBe(state.players![1].colour);
  });
});

// ── AC3 — legible, distinct prefix colour ───────────────────

describe('resolveLogSeatColour', () => {
  it('returns an already-legible seat colour unchanged', () => {
    expect(resolveLogSeatColour('#F0E442', LOG_COLORS.gain)).toBe('#F0E442');
  });

  it('lightens the Okabe–Ito black to clear the panel contrast floor', () => {
    const resolved = resolveLogSeatColour('#000000', LOG_COLORS.loss);

    expect(resolved).not.toBe('#000000');
    expect(resolved).toMatch(/^#[0-9a-f]{6}$/);
    expect(contrastRatio(parseHex(resolved), parseHex(LOG_PANEL_BG))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps every palette colour legible against every gain/loss/neutral line', () => {
    for (const seat of SEAT_COLOUR_PALETTE) {
      for (const line of LINE_COLOURS) {
        const resolved = resolveLogSeatColour(seat, line);

        // Legible on the dark panel.
        expect(contrastRatio(parseHex(resolved), parseHex(LOG_PANEL_BG))).toBeGreaterThanOrEqual(4.5);
        // Clearly distinguishable from the line-type colour beside it.
        expect(rgbDistance(parseHex(resolved), parseHex(line))).toBeGreaterThanOrEqual(60);
      }
    }
  });

  it('falls back to the original colour for malformed input', () => {
    expect(resolveLogSeatColour('not-a-colour', LOG_COLORS.neutral)).toBe('not-a-colour');
  });
});
