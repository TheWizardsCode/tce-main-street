/**
 * Main Street logical SFX key -> ToneForge factory key mapping.
 *
 * These values are consumed by SoundManager + tfAdapter. Keep this list
 * in sync with keys used in MainStreetScene.
 *
 * All keys use the standard `sfx-` prefix per SFX_CONVENTION.md.
 */
export const MAIN_STREET_TF_SFX_MAPPING: Record<string, string> = {
  'sfx-deal': 'card-draw',
  'sfx-move-loop': 'card-slide',
  'sfx-place': 'card-place',
  'sfx-discard': 'card-discard',
  'sfx-coin-pop': 'card-coin-collect',
  'sfx-ui-click': 'ui-notification-chime',
  'sfx-bg-loop': 'card-table-ambience',
  'sfx-business-start': 'construction-hammer',
  'sfx-business-end': 'construction-saw',
  'sfx-upgrade-start': 'construction-lite-hammer',
  'sfx-upgrade-end': 'construction-lite-saw',
  'sfx-event-cheer': 'crowd-cheer',
  // The runtime synth ships a factory for all 16 of these mappings
  // (MS-0MV8PDNDT0033TH8). A mapped key whose factory is missing still falls
  // back to the WAV/Phaser path (engine contract CG-0MUU9PSWC009CW76), but no
  // Main Street key relies on that fallback any more.
  'sfx-income-positive': 'income-positive-chime',
  'sfx-income-negative': 'income-negative-chime',
  'sfx-income-neutral': 'income-neutral-chime',
  'sfx-challenge-complete': 'success-fanfare',
};

/**
 * Logical SFX keys that intentionally map to a factory the runtime module does
 * not ship.
 *
 * **Currently empty:** the committed runtime synth ships a factory for all 16
 * Main Street mappings (MS-0MV8PDNDT0033TH8), so every key plays through the
 * synth. The declaration is retained (rather than removed) so a future
 * intentional WAV fallback can be recorded here without reintroducing
 * per-play `[tfAdapter] Missing tf factory …` noise.
 *
 * Should a key ever be listed here it is not a silent drop: it falls back to
 * the WAV/Phaser path, and the Main Street tf logger suppresses the
 * otherwise-per-play warning for it while leaving every unexpected missing
 * factory loud (MS-0MV26MOWT004ZCQC).
 */
export const MAIN_STREET_TF_FACTORYLESS_KEYS: readonly string[] = [];

/**
 * The factory keys the {@link MAIN_STREET_TF_FACTORYLESS_KEYS} map to.
 *
 * `SoundManager` translates a logical key through the shared mapping before
 * calling the synth player, so `tfAdapter` emits the warning under the
 * already-mapped factory key. Derived from the mapping so the two can never
 * drift.
 */
export const MAIN_STREET_TF_FACTORYLESS_FACTORY_KEYS: readonly string[] =
  MAIN_STREET_TF_FACTORYLESS_KEYS.map((key) => MAIN_STREET_TF_SFX_MAPPING[key]);
