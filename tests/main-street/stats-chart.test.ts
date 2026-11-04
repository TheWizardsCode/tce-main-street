/**
 * Main Street: Stats chart wrapper (MS-0MVSHZ131002ZF3O AC3/AC5)
 *
 * Unit tests for `MainStreetStatsChart` with Chart.js mocked:
 * - replay mode returns `null`, constructs no chart and creates no DOM node;
 * - a missing `document` (headless/Node) does the same;
 * - the happy path creates one chart into a dedicated canvas with
 *   `animation: false` and `responsive: false`, and `destroy()` removes it.
 *
 * The wrapper is Phaser-free by design, so no scene needs booting here; the
 * browser suite exercises the real Chart.js + Phaser canvas integration.
 *
 * @module tests/main-street/stats-chart
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const chartMock = vi.hoisted(() => ({
  count: 0,
  configs: [] as Array<Record<string, unknown>>,
  destroyed: 0,
}));

vi.mock('chart.js/auto', () => {
  class FakeChart {
    constructor(_context: unknown, config: Record<string, unknown>) {
      chartMock.count += 1;
      chartMock.configs.push(config);
    }
    destroy(): void {
      chartMock.destroyed += 1;
    }
  }
  return { default: FakeChart };
});

import { createStatsChart, destroyStatsChart } from '../../src/scenes/MainStreetStatsChart';

interface FakeCanvas {
  width: number;
  height: number;
  style: Record<string, string>;
  parentNode: FakeBody | null;
  setAttribute: (name: string, value: string) => void;
  getContext: () => Record<string, unknown>;
  remove: () => void;
}

interface FakeBody {
  appendChild: (node: FakeCanvas) => FakeCanvas;
  removeChild: (node: FakeCanvas) => void;
}

function installFakeDocument(): { appended: FakeCanvas[] } {
  const appended: FakeCanvas[] = [];
  const body: FakeBody = {
    appendChild(node) {
      node.parentNode = body;
      appended.push(node);
      return node;
    },
    removeChild(node) {
      node.parentNode = null;
      const index = appended.indexOf(node);
      if (index >= 0) appended.splice(index, 1);
    },
  };
  (globalThis as Record<string, unknown>).document = {
    createElement(): FakeCanvas {
      return {
        width: 0,
        height: 0,
        style: {},
        parentNode: null,
        setAttribute: () => {},
        getContext: () => ({}),
        remove: () => {},
      };
    },
    body,
  };
  return { appended };
}

const geometry = { x: 10, y: 20, width: 200, height: 100 };
const spec = { title: 'Profit per turn', labels: ['1', '2'], values: [5, 12] };

afterEach(() => {
  delete (globalThis as Record<string, unknown>).document;
  chartMock.count = 0;
  chartMock.configs.length = 0;
  chartMock.destroyed = 0;
  vi.restoreAllMocks();
});

describe('createStatsChart', () => {
  it('returns null and does nothing in replay mode', async () => {
    const { appended } = installFakeDocument();
    const handle = await createStatsChart({ replayMode: true }, geometry, spec);

    expect(handle).toBeNull();
    expect(chartMock.count).toBe(0);
    expect(appended).toHaveLength(0);
  });

  it('returns null and does nothing when there is no document', async () => {
    // No fake document installed: typeof document === 'undefined'.
    const handle = await createStatsChart({ replayMode: false }, geometry, spec);

    expect(handle).toBeNull();
    expect(chartMock.count).toBe(0);
  });

  it('creates one animated-free chart in a dedicated canvas', async () => {
    const { appended } = installFakeDocument();
    const handle = await createStatsChart({ replayMode: false }, geometry, spec);

    expect(handle).not.toBeNull();
    expect(chartMock.count).toBe(1);
    expect(appended).toHaveLength(1);

    const config = chartMock.configs[0]!;
    const options = config.options as Record<string, unknown>;
    expect(options.animation).toBe(false);
    expect(options.responsive).toBe(false);
    expect((config.data as { labels: string[] }).labels).toEqual(['1', '2']);
    const dataset = (config.data as { datasets: Array<{ data: number[] }> }).datasets[0]!;
    expect(dataset.data).toEqual([5, 12]);
  });

  it('destroy() removes the canvas and is idempotent', async () => {
    const { appended } = installFakeDocument();
    const handle = await createStatsChart({ replayMode: false }, geometry, spec);

    expect(appended).toHaveLength(1);
    handle!.destroy();
    expect(appended).toHaveLength(0);
    expect(chartMock.destroyed).toBe(1);

    handle!.destroy();
    expect(chartMock.destroyed).toBe(1); // no second teardown
  });

  it('destroyStatsChart tolerates null and undefined', () => {
    expect(() => destroyStatsChart(null)).not.toThrow();
    expect(() => destroyStatsChart(undefined)).not.toThrow();
  });
});
