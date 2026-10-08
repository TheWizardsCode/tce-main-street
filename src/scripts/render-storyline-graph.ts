/**
 * Render the storyline graph Mermaid source to SVG using the `mermaid` JS
 * library in Playwright's headless Chromium (MS-0MUNB54KU005084C).
 *
 * Reads `docs/main-street/storyline-graph.mmd` and writes
 * `docs/main-street/storyline-graph.svg`.
 *
 * The renderer is **dev-only**: the `mermaid` package is a devDependency and
 * never enters the game bundle. It reuses the already-installed Playwright
 * Chromium (no second download, no Puppeteer) by serving the local mermaid
 * ESM module over a short-lived loopback HTTP server.
 *
 * Determinism: the mermaid version is pinned in devDependencies, the input is
 * the committed `.mmd`, and no timestamps or random ids are injected, so
 * re-running produces byte-identical output. The SVG layout (viewBox/width)
 * is derived from browser text metrics, so byte-stability additionally assumes
 * the same renderer/font environment; regenerate the committed SVG when the
 * renderer or its fonts change (the drift test flags this).
 *
 * Usage:
 *   npm run storylines:graph:svg              # render SVG to disk
 *   npm run storylines:graph:svg -- --check   # drift guard: exit 1 on mismatch
 *
 * @module
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium } from 'playwright';

const MERMAID_SOURCE = 'docs/main-street/storyline-graph.mmd';
const SVG_OUTPUT = 'docs/main-street/storyline-graph.svg';

/** Resolves a path relative to the repository root (this file lives in src/scripts). */
function repoPath(...segments: string[]): string {
  return resolve(__dirname, '..', '..', ...segments);
}

/** Reads the local mermaid ESM build and its chunks directory. */
function loadMermaidAssets(): { main: string; chunksDir: string } {
  const main = readFileSync(
    repoPath('node_modules', 'mermaid', 'dist', 'mermaid.esm.min.mjs'),
    'utf-8',
  );
  return { main, chunksDir: repoPath('node_modules', 'mermaid', 'dist', 'chunks') };
}

/** Builds the render page HTML. */
function buildHtml(graphDefinition: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
  <div id="graph"></div>
  <script type="module">
    (async () => {
      try {
        const mod = await import('/mermaid.esm.min.mjs');
        const mermaid = mod.default || mod;
        mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'default' });
        const result = await mermaid.render('storyline_graph', ${JSON.stringify(graphDefinition)});
        if (!result || !result.svg) {
          window.__status = 'no_svg';
          return;
        }
        window.__svg = result.svg;
        window.__status = 'ok';
      } catch (e) {
        window.__status = 'error';
        window.__error = (e && e.message) || String(e);
      }
    })();
  </script>
</body>
</html>`;
}

/**
 * Renders a Mermaid source string to an SVG string.
 *
 * @param graphDefinition - The committed Mermaid flowchart source.
 * @returns The rendered SVG string.
 */
export async function renderMermaidToSvg(graphDefinition: string): Promise<string> {
  const { main, chunksDir } = loadMermaidAssets();
  const html = buildHtml(graphDefinition);

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/' || url === '') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } else if (url === '/mermaid.esm.min.mjs') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(main);
    } else if (url.startsWith('/chunks/')) {
      try {
        const content = readFileSync(resolve(chunksDir, url.slice('/chunks/'.length)), 'utf-8');
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  await new Promise<void>((resolveListen, reject) => {
    server.listen(0, '127.0.0.1', () => resolveListen());
    server.on('error', reject);
  });
  const { port } = server.address() as AddressInfo;

  let svg: string | undefined;
  let status: string | undefined;
  let error: string | undefined;

  try {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
      await page
        .waitForFunction(() => (window as unknown as { __status?: string }).__status !== undefined, {
          timeout: 60_000,
        })
        .catch(() => undefined);
      ({ svg, status, error } = await page.evaluate(() => {
        const w = window as unknown as { __svg?: string; __status?: string; __error?: string };
        return { svg: w.__svg, status: w.__status, error: w.__error };
      }));
    } finally {
      await browser.close();
    }
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }

  if (!svg || status !== 'ok') {
    throw new Error(
      `render-storyline-graph: mermaid render failed (status=${status ?? 'none'}, error=${error ?? 'none'})`,
    );
  }
  return svg;
}

/**
 * CLI entry: render the storyline graph or check for drift.
 *
 * @returns Process exit code (0 = success, 1 = error/drift).
 */
export async function runRenderCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const sourcePath = repoPath(MERMAID_SOURCE);
  if (!existsSync(sourcePath)) {
    process.stderr.write(`render-storyline-graph: missing source ${MERMAID_SOURCE}\n`);
    return 1;
  }

  const mermaidSource = readFileSync(sourcePath, 'utf-8');
  const outputPath = repoPath(SVG_OUTPUT);
  const rendered = await renderMermaidToSvg(mermaidSource);

  if (argv.includes('--check')) {
    if (!existsSync(outputPath)) {
      process.stderr.write(
        `render-storyline-graph: committed SVG missing at ${SVG_OUTPUT} — run \`npm run storylines:graph:svg\`\n`,
      );
      return 1;
    }
    const committed = readFileSync(outputPath, 'utf-8');
    if (committed !== rendered) {
      process.stderr.write(
        `render-storyline-graph: drift detected in ${SVG_OUTPUT} — regenerate with \`npm run storylines:graph:svg\`\n`,
      );
      return 1;
    }
    process.stdout.write(`render-storyline-graph: ${SVG_OUTPUT} is up to date\n`);
    return 0;
  }

  writeFileSync(outputPath, rendered, 'utf-8');
  process.stdout.write(`render-storyline-graph: wrote ${SVG_OUTPUT}\n`);
  return 0;
}
