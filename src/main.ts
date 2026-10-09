/**
 * Main Street - Tableau Card Engine (TCE)
 *
 * A single-player tableau card game where you build a thriving
 * Main Street by purchasing businesses, placing them strategically
 * for synergy bonuses, and managing resources. Games end when you
 * win (score threshold / all challenges) or lose (bankruptcy /
 * reputation collapse) — default presets impose no turn limit
 * (CG-0MSLXJCHH001DLIO).
 *
 * Boot awaits card-pack discovery before scene setup so installed pack cards
 * are available from the first deal (F9 / CG-0MUZIS4KZ003R1HP).
 */
import { createMainStreetGameWithPacks } from './createMainStreetGame';

void createMainStreetGameWithPacks().then((game) => {
  // Expose game instance for browser testing and debugging
  (window as unknown as Record<string, unknown>).__PHASER_GAME__ = game;
});
