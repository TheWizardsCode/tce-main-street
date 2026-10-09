/**
 * Factory function to create a Phaser game instance for Main Street.
 * Used by both main.ts and browser tests.
 */
import { createCardGame } from '@ui/createCardGame';
import type { CardGameOptions } from '@ui/createCardGame';
import { MainStreetScene } from './scenes/MainStreetScene';
import { bootstrapMainStreetCardPacks } from './MainStreetCardPacks';

export type MainStreetGameOptions = Partial<Pick<CardGameOptions, 'parent' | 'width' | 'height' | 'type'>>;

/**
 * Create a Phaser game instance for Main Street.
 *
 * Synchronous — used by the browser test harness, which injects state and does
 * not need pack discovery. The standalone entry point
 * ({@link createMainStreetGameWithPacks}) awaits pack discovery first.
 */
export function createMainStreetGame(options: MainStreetGameOptions = {}): Phaser.Game {
  return createCardGame({
    backgroundColor: '#2a1a0a',
    scenes: [MainStreetScene],
    ...options,
  });
}

/**
 * Boot Main Street, awaiting card-pack discovery **before** scene setup
 * (F9 / CG-0MUZIS4KZ003R1HP).
 *
 * Discovers the packs installed for `main-street` in the launcher's content
 * directory, merges their CSV rows with the base pool, and applies the merged
 * pool to the live templates — so the first deal already includes pack cards.
 * Discovery never throws: with no content directory (browser / core-only
 * build) or on any failure it degrades to base content and the game still
 * starts.
 *
 * The scene lifecycle applies the same gate when the launcher starts the scene
 * directly (i.e. without going through this entry point), so both boot paths
 * complete discovery before setup.
 */
export async function createMainStreetGameWithPacks(
  options: MainStreetGameOptions = {},
): Promise<Phaser.Game> {
  await bootstrapMainStreetCardPacks();
  return createMainStreetGame(options);
}
