/**
 * Main Street: New Game Overlay
 *
 * Blocking pre-game "New Game" overlay (child MS-0MUTU8INS009MRR1 of epic
 * MS-0MUTTVR5K002ZDUP). Presents the Single-player vs Competitive choice, the
 * opponent count (1–3) and a per-opponent strategy/difficulty control.
 *
 * The overlay is a thin view over the pure {@link NewGameSelection} model:
 * all selection mapping/validation lives in `MainStreetNewGameSelection`, so
 * this class only manages Phaser objects and the confirm callback.
 *
 * Mirrors the established blocking-overlay pattern (TutorialOfferModal /
 * resume overlay): a full-screen input-blocking backdrop with a centred box.
 *
 * @module
 */

import {
  createOverlayButton,
  createOverlayDialog,
  type OverlayDialogHandle,
} from '@ui';
import {
  MAX_AI_OPPONENTS,
  MIN_AI_OPPONENTS,
  createOpponentSelection,
  defaultNewGameSelection,
  type NewGameSelection,
  type OpponentSelection,
} from './MainStreetNewGameSelection';

/** Callbacks the overlay invokes when the player starts a game. */
export interface MainStreetNewGameOverlayCallbacks {
  /** Called with the validated selection when the player confirms. */
  onConfirm: (selection: NewGameSelection) => void;
}

/**
 * Scene flag marking that the boot-time New Game selector has already been
 * presented for the current boot.
 */
export interface NewGameSelectionFlagHolder {
  newGameSelectionMade?: boolean;
}

/**
 * Clears the boot-time selector flag so a scene restart (e.g. "Play Again"
 * after game-over, or menu round-trip) presents the New Game selector again.
 *
 * Phaser reuses the scene instance across `scene.restart()` / `scene.start()`,
 * so instance properties persist and must be reset in `create()`
 * (MS-0MUTTVR5K002ZDUP).
 */
export function resetNewGameSelectionFlag(scene: NewGameSelectionFlagHolder): void {
  scene.newGameSelectionMade = false;
}

const STRATEGIES = ['Random', 'Greedy', 'BankingGreedy'] as const;
const DIFFICULTIES = ['Easy', 'Medium', 'Hard'] as const;

const ACTIVE_COLOR = '#aaffaa';
const HOVER_COLOR = '#ffffff';
const BODY_COLOR = '#ddccbb';
const BOX_WIDTH = 520;
const BOX_HEIGHT = 420;

export class MainStreetNewGameOverlay {
  private dialog: OverlayDialogHandle | null = null;
  private selection: NewGameSelection;
  private dynamicObjects: Phaser.GameObjects.GameObject[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    initial: NewGameSelection = defaultNewGameSelection(),
  ) {
    this.selection = initial;
  }

  /** True while the overlay is visible (input is blocked). */
  get isVisible(): boolean {
    return this.dialog !== null;
  }

  /** A defensive copy of the current selection (for tests/inspection). */
  getSelection(): NewGameSelection {
    return {
      mode: this.selection.mode,
      opponents: this.selection.opponents.map((o) => ({ ...o })),
    };
  }

  /**
   * Shows the overlay. The callback fires once, when the player confirms a
   * valid selection; the overlay dismisses itself first.
   */
  show(callbacks: MainStreetNewGameOverlayCallbacks): void {
    if (this.dialog) return;
    this.dialog = createOverlayDialog(this.scene, {
      title: 'New Game',
      width: BOX_WIDTH,
      height: BOX_HEIGHT,
      boxColor: 0x16213e,
      scrollable: false,
    });
    this.render(callbacks);
  }

  /** Dismisses the overlay and destroys its objects. */
  hide(): void {
    for (const object of this.dynamicObjects) {
      try { object.destroy(); } catch { /* already destroyed */ }
    }
    this.dynamicObjects = [];
    this.dialog?.close();
    this.dialog = null;
  }

  // ── Rendering ─────────────────────────────────────────────

  /**
   * Registers a dynamic overlay object for cleanup AND parents it into
   * `scene.hudContainer`. The latter is required: `createOverlayDialog`
   * parents its box/title into the HUD container, so objects left on the
   * scene root render *below* the box and are hidden (MS-0MUU24A3A005A7NW).
   * Mirrors the `MainStreetOverlayContent` parenting convention.
   */
  private track<T extends Phaser.GameObjects.GameObject>(object: T): T {
    this.dynamicObjects.push(object);
    try {
      const hud = (this.scene as unknown as {
        hudContainer?: { add?: (o: Phaser.GameObjects.GameObject) => unknown };
      }).hudContainer;
      if (hud && typeof hud.add === 'function') hud.add(object);
    } catch { /* headless: no HUD container */ }
    return object;
  }

  /** Rebuilds the dynamic content (called on every selection change). */
  private render(callbacks: MainStreetNewGameOverlayCallbacks): void {
    const dialog = this.dialog;
    if (!dialog) return;

    for (const object of this.dynamicObjects) {
      try { object.destroy(); } catch { /* already destroyed */ }
    }
    this.dynamicObjects = [];

    const x = dialog.contentX;
    let y = dialog.contentY;
    const addText = (text: string, size = '15px', color = BODY_COLOR): Phaser.GameObjects.Text => {
      const t = this.scene.add.text(x, y, text, { fontSize: size, color, fontFamily: 'Arial, sans-serif' });
      t.setDepth(dialog.depthBase + 3);
      return this.track(t);
    };

    addText('Choose how you want to play:', '16px');
    y += 30;

    // Mode row.
    const singleActive = this.selection.mode === 'single-player';
    const single = createOverlayButton(this.scene, x + 90, y + 8, '[ Single-player ]', dialog.depthBase + 3, {
      color: singleActive ? ACTIVE_COLOR : BODY_COLOR,
      hoverColor: HOVER_COLOR,
    });
    single.on('pointerdown', () => {
      this.selection.mode = 'single-player';
      this.selection.opponents = [];
      this.render(callbacks);
    });
    this.track(single);

    const competitiveActive = this.selection.mode === 'competitive';
    const competitive = createOverlayButton(this.scene, x + 280, y + 8, '[ Competitive ]', dialog.depthBase + 3, {
      color: competitiveActive ? ACTIVE_COLOR : BODY_COLOR,
      hoverColor: HOVER_COLOR,
    });
    competitive.on('pointerdown', () => {
      this.selection.mode = 'competitive';
      if (this.selection.opponents.length === 0) {
        this.selection.opponents = [createOpponentSelection()];
      }
      this.render(callbacks);
    });
    this.track(competitive);
    y += 44;

    if (this.selection.mode === 'competitive') {
      // Opponent count row.
      addText(`Opponents: ${this.selection.opponents.length}`, '15px', ACTIVE_COLOR);
      const minus = createOverlayButton(this.scene, x + 180, y + 8, '[ - ]', dialog.depthBase + 3, { color: BODY_COLOR });
      minus.on('pointerdown', () => {
        if (this.selection.opponents.length > MIN_AI_OPPONENTS) {
          this.selection.opponents.pop();
          this.render(callbacks);
        }
      });
      this.track(minus);
      const plus = createOverlayButton(this.scene, x + 240, y + 8, '[ + ]', dialog.depthBase + 3, { color: BODY_COLOR });
      plus.on('pointerdown', () => {
        if (this.selection.opponents.length < MAX_AI_OPPONENTS) {
          this.selection.opponents.push(createOpponentSelection());
          this.render(callbacks);
        }
      });
      this.track(plus);
      y += 40;

      // Per-opponent strategy/difficulty controls.
      this.selection.opponents.forEach((opponent, index) => {
        addText(`AI ${index + 1}:`, '15px');
        const cycle = <T extends string>(values: readonly T[], current: T): T => {
          const next = (values.indexOf(current) + 1) % values.length;
          return values[next];
        };
        const strategyBtn = createOverlayButton(this.scene, x + 200, y + 8, `[ ${opponent.strategy} ]`, dialog.depthBase + 3, {
          color: ACTIVE_COLOR,
          hoverColor: HOVER_COLOR,
        });
        strategyBtn.on('pointerdown', () => {
          opponent.strategy = cycle(STRATEGIES, opponent.strategy as (typeof STRATEGIES)[number]);
          this.render(callbacks);
        });
        this.track(strategyBtn);

        const difficultyBtn = createOverlayButton(this.scene, x + 360, y + 8, `[ ${opponent.difficulty} ]`, dialog.depthBase + 3, {
          color: ACTIVE_COLOR,
          hoverColor: HOVER_COLOR,
        });
        difficultyBtn.on('pointerdown', () => {
          opponent.difficulty = cycle(DIFFICULTIES, opponent.difficulty as (typeof DIFFICULTIES)[number]);
          this.render(callbacks);
        });
        this.track(difficultyBtn);
        y += 40;
      });
    }

    // Confirm.
    const start = createOverlayButton(this.scene, x + 120, dialog.boxY + dialog.boxHeight - 34, '[ Start Game ]', dialog.depthBase + 3, {
      color: ACTIVE_COLOR,
      hoverColor: HOVER_COLOR,
    });
    start.on('pointerdown', () => {
      const selection = this.getSelection();
      this.hide();
      callbacks.onConfirm(selection);
    });
    this.track(start);
  }
}

/** Exposed for the overlay's own unit-free reuse of the default selection. */
export type { OpponentSelection };
