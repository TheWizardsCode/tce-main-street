/**
 * Guard for the dev-session transcript-persistence wiring
 * (MS-0MVREB31W004F48D).
 *
 * Two contracts keep a `npm run dev` session's console free of
 * `[TranscriptStore] Disk persistence POST returned HTTP 404` noise and the
 * disk mirror actually working:
 *
 * 1. **Registration contract.** The real `vite.config.ts` factory registers
 *    the `transcript-persist` middleware for `command: 'serve'` runs only,
 *    and never when `process.env.VITEST` is set (the plugin writes to disk,
 *    so it must have no file-system side effects under test — see
 *    `core/docs/DEVELOPER.md` § Transcript Persistence). Mirrors
 *    `core/tests/vite-config.test.ts`.
 * 2. **Middleware smoke.** An in-process Vite dev server answering
 *    `POST /api/transcripts` with HTTP 200 and writing
 *    `data/transcripts/<gameType>/<gameType>-<timestamp>.json` under a temp
 *    `destRoot`, proving the wire-up the config performs is real.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import viteConfig from '../../vite.config';
import { transcriptPersistPlugin } from '../../core/scripts/vite-transcript-plugin';

type PluginLike = { name: string };

function extractPluginNames(plugins: unknown): string[] {
  if (!Array.isArray(plugins)) {
    return [];
  }
  return plugins.flatMap((plugin) => {
    if (Array.isArray(plugin)) {
      return extractPluginNames(plugin);
    }
    if (plugin && typeof plugin === 'object' && 'name' in plugin) {
      return [(plugin as PluginLike).name];
    }
    return [];
  });
}

describe('vite.config.ts — transcript-persist registration (serve vs VITEST)', () => {
  it('registers the middleware for a plain dev-serve run', () => {
    const originalVitest = process.env.VITEST;
    try {
      delete process.env.VITEST;
      const config = viteConfig({ command: 'serve', mode: 'development' });
      expect(extractPluginNames(config.plugins)).toContain('transcript-persist');
    } finally {
      if (originalVitest === undefined) delete process.env.VITEST;
      else process.env.VITEST = originalVitest;
    }
  });

  it('does not register the middleware under VITEST (no test-run side effects)', () => {
    const originalVitest = process.env.VITEST;
    try {
      process.env.VITEST = 'true';
      const config = viteConfig({ command: 'serve', mode: 'test' });
      expect(extractPluginNames(config.plugins)).not.toContain('transcript-persist');
    } finally {
      if (originalVitest === undefined) delete process.env.VITEST;
      else process.env.VITEST = originalVitest;
    }
  });

  it('does not register the middleware during a production build', () => {
    const originalVitest = process.env.VITEST;
    try {
      delete process.env.VITEST;
      const config = viteConfig({ command: 'build', mode: 'production' });
      expect(extractPluginNames(config.plugins)).not.toContain('transcript-persist');
    } finally {
      if (originalVitest === undefined) delete process.env.VITEST;
      else process.env.VITEST = originalVitest;
    }
  });
});

describe('in-process dev-server smoke — POST /api/transcripts', () => {
  let tmpDir: string;
  let server: ViteDevServer;
  let url: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-transcript-guard-'));
    server = await createServer({
      // Bare server on purpose: the smoke proves the *middleware* answers the
      // request and writes the file; the config-level registration is asserted
      // above. No repo config file (its VITEST gate would exclude the plugin).
      configFile: false,
      root: path.resolve(__dirname, '../..'),
      logLevel: 'silent',
      plugins: [transcriptPersistPlugin({ destRoot: tmpDir, minWriteIntervalMs: 0 })],
      server: { port: 0, strictPort: false },
    });
    await server.listen();
    if (server.resolvedUrls?.local?.[0]) {
      url = server.resolvedUrls.local[0].replace(/\/$/, '');
    } else {
      const addr = server.httpServer?.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      url = `http://127.0.0.1:${port}`;
    }
  }, 120_000);

  afterAll(async () => {
    await server?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('answers POST /api/transcripts with 200 and writes the JSON transcript file', async () => {
    const res = await fetch(`${url}/api/transcripts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameType: 'main-street',
        transcript: { version: 1, seed: 'guard', turns: [{ turn: 1 }] },
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; path: string };
    expect(body.success).toBe(true);

    // On-disk contract: data/transcripts/<gameType>/<gameType>-<ISO>.json,
    // resolved under the temp destRoot (the real dev root's data/ tree is
    // gitignored and must stay untouched by tests).
    expect(body.path).toContain(path.join(tmpDir, 'data', 'transcripts', 'main-street'));
    expect(fs.existsSync(body.path)).toBe(true);

    const saved = JSON.parse(fs.readFileSync(body.path, 'utf8')) as {
      seed: string;
    };
    expect(saved.seed).toBe('guard');

    const written = fs.readdirSync(
      path.join(tmpDir, 'data', 'transcripts', 'main-street'),
    );
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/^main-street-.*\.json$/);
  });
});
