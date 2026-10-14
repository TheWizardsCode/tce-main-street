/**
 * Main Street: Competitive HUD Seat-Colour Rendering Tests
 *
 * Feature F5 (MS-0MV34NFRO0061MXE) of epic MS-0MUWNTN8W006C7EF — verify that
 * the competitive scoreboard/HUD draws every seat in that seat's persisted
 * colour, resolved through the shared lookup, and no longer falls back to the
 * old hard-coded active/human/AI hex colours.
 *
 * These tests run in the Node unit environment, so Phaser and the browser-only
 * `@ui` modules are mocked. They exercise the public
 * `renderCompetitiveScoreboard` API with a recording mock scene and assert the
 * rendered text colour for each seat, the active-seat indicator colour, and
 * that single-player (no roster) renders nothing. Real Phaser pixel output is
 * covered by `MainStreetCompetitiveHud.browser.test.ts`.
 *
 * @module tests/main-street/competitive-hud-colour
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('@ui', () => ({
  FONT_FAMILY: 'sans-serif',
  markHudTransient: (obj: unknown) => obj,
}));

import { renderCompetitiveScoreboard } from '../../src/scenes/MainStreetRendererCompetitiveHud';
import { resolveSeatColour } from '../../src/MainStreetAdjacencyOwner';
import {
  createCompetitiveState,
  setupMainStreetGame,
  type CompetitiveOpponentConfig,
  type MainStreetState,
} from '../../src/MainStreetState';

const OPPONENTS: CompetitiveOpponentConfig[] = [
  { strategy: 'Random', difficulty: 'Easy' },
  { strategy: 'Greedy', difficulty: 'Medium' },
];

function competitiveState(): MainStreetState {
  return createCompetitiveState({ seed: 'hud-colour', playerCount: 3, opponents: OPPONENTS });
}

/** The three hex colours F5 removes from the HUD renderer. */
const REMOVED_HARDCODED = ['#aaffaa', '#ffcc44', '#88bbff'];

interface RecordedText {
  text: string;
  style: Record<string, unknown>;
  name?: string;
  data: Record<string, unknown>;
}

/**
 * A minimal recording `MainStreetRendererContext` scene: captures every text
 * object `renderCompetitiveScoreboard` creates together with its style options
 * and `setData` tags, mirroring the real Phaser API surface the renderer uses.
 */
function createHarness(state: MainStreetState) {
  const texts: RecordedText[] = [];

  const scene = {
    state,
    layout: { hudLeft: 100, hudWidth: 600, hudY: 500 },
    add: {
      text: vi.fn((_x: number, _y: number, text: string, style: Record<string, unknown>) => {
        const obj: RecordedText = { text, style, data: {} };
        const chain = {
          setOrigin: () => chain,
          setName: (name: string) => {
            obj.name = name;
            return chain;
          },
          setData: (key: string, value: unknown) => {
            obj.data[key] = value;
            return chain;
          },
        };
        texts.push(obj);
        return chain;
      }),
    },
    hudContainer: { add: vi.fn((obj: unknown) => obj) },
  };

  return { renderer: { scene } as never, scene, texts };
}

/** Rendered texts keyed by their tagged `playerId`. */
function byPlayer(texts: RecordedText[]): Map<number, RecordedText> {
  return new Map(texts.map((text) => [text.data.playerId as number, text]));
}

describe('renderCompetitiveScoreboard seat colours (F5)', () => {
  it('renders each seat cell in that seat’s persisted colour', () => {
    const state = competitiveState();
    const { renderer, texts } = createHarness(state);

    renderCompetitiveScoreboard(renderer);

    const rows = byPlayer(texts);
    expect(rows.size).toBe(3);
    for (const [playerId, text] of rows) {
      expect(text.style.color).toBe(state.players![playerId].colour);
      expect(text.style.color).toBe(resolveSeatColour(state, playerId));
    }
  });

  it('keeps every seat a distinct colour in the rendered HUD', () => {
    const state = competitiveState();
    const { renderer, texts } = createHarness(state);

    renderCompetitiveScoreboard(renderer);

    const colours = texts.map((text) => text.style.color);
    expect(new Set(colours).size).toBe(colours.length);
  });

  it('draws the active row in the active seat’s colour', () => {
    const state = competitiveState();
    state.activePlayerId = 2;
    const { renderer, texts } = createHarness(state);

    renderCompetitiveScoreboard(renderer);

    const active = byPlayer(texts).get(2)!;
    expect(active.style.color).toBe(state.players![2].colour);
    expect(active.style.fontStyle).toBe('bold');
  });

  it('no longer uses the removed hard-coded seat hex colours', () => {
    const state = competitiveState();
    const { renderer, texts } = createHarness(state);

    renderCompetitiveScoreboard(renderer);

    for (const text of texts) {
      expect(REMOVED_HARDCODED).not.toContain(String(text.style.color).toLowerCase());
    }
  });

  it('renders nothing for a single-player state (no roster)', () => {
    const single = setupMainStreetGame({ seed: 'hud-colour-single' });
    const { renderer, texts } = createHarness(single);

    renderCompetitiveScoreboard(renderer);

    expect(texts).toHaveLength(0);
  });
});
