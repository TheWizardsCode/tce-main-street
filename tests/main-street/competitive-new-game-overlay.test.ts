/**
 * Main Street: New Game overlay rendering tests
 *
 * Regression coverage for MS-0MUU24A3A005A7NW: the overlay's dynamic
 * text/buttons must be parented into `scene.hudContainer` (like every other
 * overlay), otherwise the HUD-parented box covers them and the dialog renders
 * empty except for its title.
 *
 * The Phaser `@ui` layer is mocked, so this runs in the node unit suite while
 * asserting the observable parenting behaviour.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const shared = vi.hoisted(() => ({ created: [] as any[] }));

vi.mock('@ui', () => ({
  createOverlayDialog: (_scene: unknown, _options: unknown) => ({
    contentX: 10,
    contentY: 40,
    boxY: 20,
    boxHeight: 300,
    depthBase: 200,
    close: () => {},
  }),
  createOverlayButton: (
    _scene: unknown,
    x: number,
    y: number,
    label: string,
    depth: number,
    config: unknown,
  ) => {
    const button: any = {
      kind: 'button',
      x,
      y,
      label,
      depth,
      config,
      handlers: {},
      on(event: string, cb: () => void) {
        this.handlers[event] = cb;
        return this;
      },
      destroy() {
        this.destroyed = true;
      },
    };
    shared.created.push(button);
    return button;
  },
}));

import { MainStreetNewGameOverlay } from '../../src/scenes/MainStreetNewGameOverlay';

/** Fake scene exposing only what the overlay touches. */
function makeScene(): any {
  const hudContainer = {
    list: [] as any[],
    add(object: any) {
      this.list.push(object);
      return this;
    },
  };
  return {
    hudContainer,
    add: {
      text: (x: number, y: number, text: string, style: unknown) => {
        const object: any = {
          kind: 'text',
          x,
          y,
          text,
          style,
          setDepth() {
            return this;
          },
          destroy() {
            this.destroyed = true;
          },
        };
        shared.created.push(object);
        return object;
      },
    },
  };
}

/** Invokes the last-registered pointerdown handler on a button-like object. */
function click(object: any): void {
  object.handlers?.pointerdown?.();
}

/** Live (non-destroyed) button-like objects in the HUD container. */
function liveButtons(scene: any): any[] {
  return scene.hudContainer.list.filter((o: any) => o.kind === 'button' && !o.destroyed);
}

/** The single live button with the given label. */
function buttonWithLabel(scene: any, label: string): any {
  return liveButtons(scene).find((o: any) => o.label === label);
}

describe('MainStreetNewGameOverlay rendering', () => {
  beforeEach(() => {
    shared.created.length = 0;
  });

  it('parents every rendered overlay object into hudContainer', () => {
    const scene = makeScene();
    const overlay = new MainStreetNewGameOverlay(scene);
    overlay.show({ onConfirm: () => {} });

    expect(shared.created.length).toBeGreaterThan(0);
    for (const object of shared.created) {
      expect(scene.hudContainer.list).toContain(object);
    }
  });

  it('renders the mode controls and Start Game button for single-player', () => {
    const scene = makeScene();
    const overlay = new MainStreetNewGameOverlay(scene);
    overlay.show({ onConfirm: () => {} });

    const labels = liveButtons(scene).map((o: any) => o.label);
    expect(labels).toContain('[ Single-player ]');
    expect(labels).toContain('[ Competitive ]');
    expect(labels).toContain('[ Start Game ]');
  });

  it('reveals opponent count and per-opponent strategy/difficulty controls for competitive', () => {
    const scene = makeScene();
    const overlay = new MainStreetNewGameOverlay(scene);
    overlay.show({ onConfirm: () => {} });

    const competitive = buttonWithLabel(scene, '[ Competitive ]');
    expect(competitive).toBeDefined();
    click(competitive);

    const labels = liveButtons(scene).map((o: any) => o.label);
    expect(labels).toContain('[ - ]');
    expect(labels).toContain('[ + ]');
    // One opponent defaults to Greedy/Medium.
    expect(labels).toContain('[ Greedy ]');
    expect(labels).toContain('[ Medium ]');

    // Every newly created object is still parented into the HUD container.
    for (const object of shared.created) {
      expect(scene.hudContainer.list).toContain(object);
    }
  });

  it('confirms the validated selection with the current competitive config', () => {
    const scene = makeScene();
    const overlay = new MainStreetNewGameOverlay(scene);
    const onConfirm = vi.fn();
    overlay.show({ onConfirm });

    click(buttonWithLabel(scene, '[ Competitive ]'));
    // Cycle the opponent's strategy twice: Greedy -> BankingGreedy -> Random.
    const strategyButton = () =>
      liveButtons(scene).find((o: any) => /^\[ (Random|Greedy|BankingGreedy) \]$/.test(o.label));
    click(strategyButton());
    click(strategyButton());
    // Cycle difficulty once: Medium -> Hard.
    click(buttonWithLabel(scene, '[ Medium ]'));

    click(buttonWithLabel(scene, '[ Start Game ]'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({
      mode: 'competitive',
      opponents: [{ strategy: 'Random', difficulty: 'Hard' }],
    });
  });
});
