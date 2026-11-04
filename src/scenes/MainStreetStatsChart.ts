/**
 * Main Street: End-of-game stats chart wrapper (thin, Phaser-light)
 *
 * Isolates the external charting library (Chart.js — producer decision Q3 = B
 * on MS-0MVAMU6OM008GJPV) behind a minimal create/destroy pair so the rest of
 * the game never imports it directly:
 *
 * - {@link createStatsChart} — dynamically imports Chart.js and renders one
 *   line chart into a dedicated DOM `<canvas>` positioned over the Phaser
 *   canvas at the requested overlay coordinates.
 * - {@link destroyStatsChart} — idempotently tears a chart down and removes its
 *   canvas.
 *
 * Guardrails (MS-0MVSHZ131002ZF3O):
 * - **Lazy** — Chart.js is imported with a dynamic `import()`, so headless
 *   (Monte-Carlo) and replay entry points never resolve the library.
 * - **Headless/replay safe** — returns `null` (and creates no DOM node) when
 *   `scene.replayMode` is true or `document` is unavailable.
 * - **Stateless w.r.t. the game** — no game-state import and no Phaser scene
 *   mutation; the wrapper only reads the Phaser canvas geometry to position
 *   its own DOM layer.
 * - **Reduced-motion safe** — charts are created with `animation: false` and no
 *   rAF/tween loop of their own.
 *
 * @module src/scenes/MainStreetStatsChart
 */

/** Rectangle of a chart within the game's design (1280×720) coordinate space. */
export interface StatsChartGeometry {
  /** Left edge in game-design coordinates. */
  x: number;
  /** Top edge in game-design coordinates. */
  y: number;
  /** Width in game-design coordinates. */
  width: number;
  /** Height in game-design coordinates. */
  height: number;
}

/** One line chart's data and presentation. */
export interface StatsChartSpec {
  /** Axis/legend label shown above and inside the chart. */
  title: string;
  /** X-axis labels (one per value), e.g. turn numbers as strings. */
  labels: string[];
  /** Y values, one per label. */
  values: number[];
  /** Optional line colour (CSS colour string). */
  color?: string;
}

/** Opaque handle returned by {@link createStatsChart}. */
export interface StatsChartHandle {
  /** The DOM canvas the chart renders into. */
  readonly canvas: HTMLCanvasElement;
  /** Idempotently destroy the chart and remove its canvas from the DOM. */
  destroy(): void;
}

/** Minimal structural view of the scene the wrapper needs (no Phaser import). */
interface StatsChartScene {
  /** True in headless/replay mode — the chart layer must be skipped. */
  replayMode?: boolean;
  /** Phaser game instance (only `canvas` is read). */
  game?: { canvas?: HTMLCanvasElement | null } | null;
  /** Scene layout in design coordinates, when available. */
  layout?: { gameW?: number; gameH?: number } | null;
}

const DEFAULT_GAME_WIDTH = 1280;
const DEFAULT_GAME_HEIGHT = 720;
const DEFAULT_LINE_COLOUR = '#ffcc44';
const AXIS_COLOUR = '#ddccbb';
const GRID_COLOUR = 'rgba(255, 255, 255, 0.08)';

/**
 * Maps a {@link StatsChartGeometry} (game-design coordinates) to CSS pixel
 * coordinates over the real Phaser canvas, and creates the DOM canvas.
 *
 * Pure DOM sizing/positioning — no chart library involved, so it can be unit
 * tested with a stubbed `document`.
 */
function createOverlayCanvas(
  scene: StatsChartScene,
  geometry: StatsChartGeometry,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const gameCanvas = scene.game?.canvas ?? null;
  const gameW = scene.layout?.gameW ?? DEFAULT_GAME_WIDTH;
  const gameH = scene.layout?.gameH ?? DEFAULT_GAME_HEIGHT;

  let left = geometry.x;
  let top = geometry.y;
  let width = geometry.width;
  let height = geometry.height;

  if (gameCanvas && typeof gameCanvas.getBoundingClientRect === 'function') {
    const rect = gameCanvas.getBoundingClientRect();
    const scaleX = gameW > 0 ? rect.width / gameW : 1;
    const scaleY = gameH > 0 ? rect.height / gameH : 1;
    const scrollX = typeof window !== 'undefined' ? window.scrollX : 0;
    const scrollY = typeof window !== 'undefined' ? window.scrollY : 0;
    left = rect.left + scrollX + geometry.x * scaleX;
    top = rect.top + scrollY + geometry.y * scaleY;
    width = geometry.width * scaleX;
    height = geometry.height * scaleY;
  }

  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  canvas.style.position = 'absolute';
  canvas.style.left = `${left}px`;
  canvas.style.top = `${top}px`;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.style.pointerEvents = 'none'; // never steal input from the Phaser UI
  canvas.setAttribute('data-main-street-stats-chart', 'true');

  document.body.appendChild(canvas);
  return canvas;
}

/**
 * Creates one line chart over the Phaser canvas.
 *
 * Returns `null` (and touches neither the DOM nor Chart.js) in replay mode or
 * when no DOM is available, so headless and Monte-Carlo runs are unaffected.
 *
 * @param scene    The overlay's scene (only `replayMode`, `game.canvas` and
 *                 `layout` are read — the scene is never mutated).
 * @param geometry Chart rectangle in game-design coordinates.
 * @param spec     Series data and title.
 * @returns A handle whose `destroy()` removes the chart and its canvas, or
 *          `null` when the chart layer is skipped.
 */
export async function createStatsChart(
  scene: StatsChartScene,
  geometry: StatsChartGeometry,
  spec: StatsChartSpec,
): Promise<StatsChartHandle | null> {
  // Headless/replay: never resolve Chart.js, never create a DOM node.
  if (!scene || scene.replayMode === true) return null;
  if (typeof document === 'undefined') return null;

  // Dynamic import keeps Chart.js out of headless/Monte-Carlo/replay bundles.
  // Use the `chart.js/auto` entry so every controller/scale/element is
  // registered automatically (the bare `chart.js` entry is tree-shakeable and
  // throws `"category" is not a registered scale` unless components are
  // registered manually). The unit test mocks this module path.
  const chartModule = await import('chart.js/auto');
  const ChartCtor = (chartModule.default
    ?? (chartModule as unknown as { Chart: typeof chartModule.default }).Chart);

  const canvas = createOverlayCanvas(scene, geometry);
  const context = canvas.getContext('2d');
  if (!context) {
    canvas.remove();
    return null;
  }

  let chart: { destroy(): void };
  try {
    chart = new ChartCtor(context, {
      type: 'line',
      data: {
        labels: spec.labels,
        datasets: [
          {
            label: spec.title,
            data: spec.values,
            borderColor: spec.color ?? DEFAULT_LINE_COLOUR,
            backgroundColor: 'transparent',
            pointRadius: 2,
            tension: 0.2,
          },
        ],
      },
      options: {
        // Reduced-motion safe: no animation loop of our own.
        animation: false,
        responsive: false,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, labels: { color: AXIS_COLOUR, boxWidth: 12 } },
          title: { display: true, text: spec.title, color: DEFAULT_LINE_COLOUR },
        },
        scales: {
          x: { ticks: { color: AXIS_COLOUR }, grid: { color: GRID_COLOUR } },
          y: { ticks: { color: AXIS_COLOUR }, grid: { color: GRID_COLOUR } },
        },
      },
    }) as { destroy(): void };
  } catch (error) {
    // Never leak the DOM canvas when Chart.js refuses to construct.
    canvas.remove();
    throw error;
  }

  let destroyed = false;
  return {
    canvas,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      // Remove the DOM canvas first so an error inside Chart.js teardown can
      // never leave a stray canvas behind (the browser no-leak test depends on
      // this ordering).
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      try {
        // Chart.js teardown also clears its own rAF/resize listeners.
        chart.destroy();
      } catch {
        /* teardown is best-effort; the canvas is already detached */
      }
    },
  };
}

/**
 * Destroys a chart handle produced by {@link createStatsChart}.
 *
 * Safe to call with `null`/`undefined` and idempotent, so overlay teardown can
 * call it unconditionally.
 */
export function destroyStatsChart(
  handle: StatsChartHandle | null | undefined,
): void {
  handle?.destroy();
}
