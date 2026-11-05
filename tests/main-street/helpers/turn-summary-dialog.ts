/**
 * Turn Summary dialog — browser test helper (MS-0MVP46Q8X003419R).
 *
 * Browser tests that drive a real end-of-turn in normal single-player play
 * now hit the Turn Summary gate: the next day does not start until the
 * player clicks [ Next Turn ]. Tests whose subject is NOT the dialog itself
 * (income choreography, incident reveal, activity-log timing, banking hint,
 * Enter binding) dismiss it through these helpers so their existing
 * advance-waits keep working unchanged.
 *
 * The competitive per-seat Turn Summary panel (MS-0MVRNV9Y8008IKGK) uses the
 * same `[ Next Turn ]` button, so a browser test that drives a competitive
 * end-of-turn (not gated under reduced motion / replay / headless) dismisses
 * it through these helpers too — no mode-specific variant exists.
 */
import Phaser from 'phaser';

type SceneLike = Phaser.Scene & Record<string, any>;

/** The presented Turn Summary dialog's `[ Next Turn ]` button, or null. */
export function findTurnSummaryNextTurnButton(
  scene: SceneLike,
): Phaser.GameObjects.Text | null {
  const objects = (scene?.overlayObjects ?? []) as Phaser.GameObjects.GameObject[];
  const button = objects.find(
    (o) => o instanceof Phaser.GameObjects.Text && o.text === '[ Next Turn ]',
  ) as Phaser.GameObjects.Text | undefined;
  return button ?? null;
}

/**
 * Clicks the Turn Summary dialog's `[ Next Turn ]` when it is presented.
 *
 * No-op (returns `false`) when no dialog is up — e.g. tutorial / reduced
 * motion / replay auto-advance paths, or a turn that did not reach the gate.
 * The competitive panel (MS-0MVRNV9Y8008IKGK) is found by the same button
 * text, so one helper serves both modes.
 */
export function dismissTurnSummaryDialogIfPresent(scene: SceneLike): boolean {
  const button = findTurnSummaryNextTurnButton(scene);
  if (!button) return false;
  button.emit('pointerdown');
  return true;
}

/**
 * Waits (bounded) for the Turn Summary dialog and clicks `[ Next Turn ]`.
 *
 * The deferred closing presents the dialog only after the end-of-turn
 * animations complete, so call this AFTER the animation-related waits and
 * BEFORE the turn-advance wait. `true` when a dialog was dismissed.
 */
export async function dismissTurnSummaryDialog(
  scene: SceneLike,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const intervalMs = opts.intervalMs ?? 200;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (dismissTurnSummaryDialogIfPresent(scene)) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}
