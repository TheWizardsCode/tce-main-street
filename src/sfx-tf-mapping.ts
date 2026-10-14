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
  // The four entries below intentionally have NO ToneForge factory: the
  // committed runtime synth ships 12 of these 16 mappings, and these keys fall
  // back to the WAV/Phaser path (engine contract CG-0MUU9PSWC009CW76). They are
  // listed in MAIN_STREET_TF_FACTORYLESS_KEYS and their factories in
  // MAIN_STREET_TF_FACTORYLESS_FACTORY_KEYS, so the Main Street tf logger
  // keeps the expected fallback quiet (MS-0MV26MOWT004ZCQC).
  'sfx-income-positive': 'income-positive-chime',
  'sfx-income-negative': 'income-negative-chime',
  'sfx-income-neutral': 'income-neutral-chime',
  'sfx-challenge-complete': 'success-fanfare',
};

/**
 * Logical SFX keys that intentionally map to a factory the runtime module does
 * not ship.
 *
 * These keys are not silent drops: they fall back to the WAV/Phaser path, and
 * the fallback is the intended design (the synth factory for each is a larger,
 * separate effort). The Main Street tf logger suppresses the otherwise-per-play
 * `[tfAdapter] Missing tf factory …` warning for these known-benign keys while
 * leaving every unexpected missing factory loud (MS-0MV26MOWT004ZCQC).
 */
export const MAIN_STREET_TF_FACTORYLESS_KEYS: readonly string[] = [
  'sfx-income-positive',
  'sfx-income-negative',
  'sfx-income-neutral',
  'sfx-challenge-complete',
];

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
