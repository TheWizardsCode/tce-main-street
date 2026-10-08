/**
 * Render the storyline graph as one SVG per storyline (one parent box per
 * page) plus a compact standalone-incident index (MS-0MUNB54KU005084C).
 *
 * The combined graph is unreadable: 71 nodes, only 11 of them connected (the
 * five storyline chains). Mermaid lays the 60 isolated incidents out in a
 * single horizontal row, producing a ~13,000px-wide strip of tiny boxes. This
 * module instead renders:
 *
 *  - `docs/main-street/storyline-graph-<slug>.svg` — one diagram per storyline
 *    (its parent incident and chain), at a readable size; and
 *  - `docs/main-street/storyline-incident-index.md` — the standalone incidents
 *    as a compact index/table rather than boxes.
 *
 * Both are derived from the committed Mermaid graph / manifest
 * (`docs/main-street/storyline-graph.mmd` remains the source of truth).
 *
 * The renderer is **dev-only**: the `mermaid` package is a devDependency and
 * never enters the game bundle. It reuses the already-installed Playwright
 * Chromium (no second download, no Puppeteer) by serving the local mermaid
 * ESM module over a short-lived loopback HTTP server.
 *
 * Determinism: the mermaid version is pinned in devDependencies, the input is
 * the committed model, and no timestamps or random ids are injected, so
 * re-running produces byte-identical output. The SVG layout (viewBox/width)
 * is derived from browser text metrics, so byte-stability additionally assumes
 * the same renderer/font environment; regenerate the committed SVGs when the
 * renderer or its fonts change (the drift test flags this).
 *
 * Usage:
 *   npm run storylines:graph:svg              # render SVG pages + index to disk
 *   npm run storylines:graph:svg -- --check   # drift guard: exit 1 on mismatch
 *
 * @module
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium } from 'playwright';

import {
  buildStandaloneIncidentIndex,
  buildStorylineManifest,
  filterManifestByStoryline,
  renderIncidentIndexMarkdown,
  renderMermaid,
  renderStorylineDetailsMarkdown,
  type StorylineManifest,
} from './storyline-graph';
import { getEventTemplates } from '../MainStreetCards';

/** Directory holding the committed rendered artefacts. */
const DOCS_DIR = 'docs/main-street';

/** Committed standalone-incident index document. */
export const INCIDENT_INDEX_PATH = `${DOCS_DIR}/storyline-incident-index.md`;

/** Canonical doc holding the generated per-event detail tables. */
export const DOC_PATH = `${DOCS_DIR}/storylines.md`;

/** One rendered storyline page. */
export interface StorylinePage {
  /** Storyline id, e.g. `storyline-tax`. */
  readonly storylineId: string;
  /** Short slug used in the file name, e.g. `tax`. */
  readonly slug: string;
  /** Human-readable storyline title, e.g. `Tax Troubles`. */
  readonly title: string;
  /** Mermaid source for this storyline (derived from the manifest). */
  readonly mermaid: string;
  /** Repo-relative path of the committed SVG. */
  readonly svgRelPath: string;
}

/** Builds the BEGIN/END markers for a storyline's generated detail table. */
function detailMarkers(slug: string): { begin: string; end: string } {
  return {
    begin: `<!-- BEGIN GENERATED: storyline-details-${slug} -->`,
    end: `<!-- END GENERATED: storyline-details-${slug} -->`,
  };
}

/**
 * Replaces the content between a storyline's generated-detail markers, leaving
 * all hand-written prose untouched.
 *
 * @param doc     The current doc contents.
 * @param slug    The storyline slug (e.g. `tax`).
 * @param content The generated Markdown table.
 * @returns The updated doc.
 */
export function spliceGeneratedDetails(doc: string, slug: string, content: string): string {
  const { begin, end } = detailMarkers(slug);
  const start = doc.indexOf(begin);
  const stop = doc.indexOf(end);
  if (start === -1 || stop === -1 || stop < start) {
    throw new Error(`render-storyline-graph: missing ${begin} / ${end} markers in ${DOC_PATH}`);
  }
  return `${doc.slice(0, start + begin.length)}\n${content}${doc.slice(stop)}`;
}

/** Resolves a path relative to the repository root (this file lives in src/scripts). */
function repoPath(...segments: string[]): string {
  return resolve(__dirname, '..', '..', ...segments);
}

/** Derives the file-name slug for a storyline id (`storyline-tax` → `tax`). */
export function slugForStoryline(storylineId: string): string {
  return storylineId.replace(/^storyline-/, '');
}

/**
 * Builds one renderable page per storyline, in the manifest's sorted order.
 *
 * @param manifest The full storyline manifest (defaults to the shipped cards).
 * @returns One page per storyline.
 */
export function buildStorylinePages(
  manifest: StorylineManifest = buildStorylineManifest(getEventTemplates()),
): StorylinePage[] {
  return manifest.storylineIds.map((storylineId) => {
    const filtered = filterManifestByStoryline(manifest, storylineId);
    const slug = slugForStoryline(storylineId);
    const title = filtered.nodes.find((node) => node.storylineTitle)?.storylineTitle ?? storylineId;
    return {
      storylineId,
      slug,
      title,
      mermaid: renderMermaid(filtered),
      svgRelPath: `${DOCS_DIR}/storyline-graph-${slug}.svg`,
    };
  });
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
 * Renders several Mermaid sources to SVG, reusing a single Playwright browser
 * and loopback HTTP server.
 *
 * @param sources Mermaid sources keyed by an arbitrary identifier.
 * @returns Rendered SVGs keyed by the same identifiers.
 */
export async function renderMermaidBatch(
  sources: Readonly<Record<string, string>>,
): Promise<Record<string, string>> {
  const entries = Object.entries(sources);
  if (entries.length === 0) return {};

  const { main, chunksDir } = loadMermaidAssets();
  let currentHtml = buildHtml(entries[0][1]);

  const server = http.createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    if (url === '/' || url === '') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(currentHtml);
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

  const rendered: Record<string, string> = {};
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (let i = 0; i < entries.length; i++) {
      const [key, mermaid] = entries[i];
      currentHtml = buildHtml(mermaid);
      // A unique query string avoids the browser serving a cached document.
      await page.goto(`http://127.0.0.1:${port}/?i=${i}`, { waitUntil: 'networkidle' });
      await page
        .waitForFunction(() => (window as unknown as { __status?: string }).__status !== undefined, {
          timeout: 60_000,
        })
        .catch(() => undefined);
      const { svg, status, error } = await page.evaluate(() => {
        const w = window as unknown as { __svg?: string; __status?: string; __error?: string };
        return { svg: w.__svg, status: w.__status, error: w.__error };
      });
      if (!svg || status !== 'ok') {
        throw new Error(
          `render-storyline-graph: mermaid render failed for "${key}" (status=${status ?? 'none'}, error=${error ?? 'none'})`,
        );
      }
      rendered[key] = svg;
    }
  } finally {
    await browser.close();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }

  return rendered;
}

/**
 * Renders a single Mermaid source string to an SVG string.
 *
 * @param graphDefinition - The Mermaid flowchart source.
 * @returns The rendered SVG string.
 */
export async function renderMermaidToSvg(graphDefinition: string): Promise<string> {
  const rendered = await renderMermaidBatch({ single: graphDefinition });
  return rendered.single;
}

/**
 * CLI entry: render the per-storyline SVG pages + incident index, or check
 * them for drift.
 *
 * @returns Process exit code (0 = success / no drift, 1 = error / drift).
 */
export async function runRenderCli(
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
  const check = argv.includes('--check');

  const manifest = buildStorylineManifest(getEventTemplates());
  const pages = buildStorylinePages(manifest);
  const indexMarkdown = renderIncidentIndexMarkdown(buildStandaloneIncidentIndex(manifest));

  const rendered = await renderMermaidBatch(
    Object.fromEntries(pages.map((page) => [page.slug, page.mermaid])),
  );

  const drift: string[] = [];

  for (const page of pages) {
    const svg = rendered[page.slug];
    const outPath = repoPath(page.svgRelPath);
    if (check) {
      if (!existsSync(outPath) || readFileSync(outPath, 'utf-8') !== svg) {
        drift.push(page.svgRelPath);
      }
    } else {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, svg, 'utf-8');
      process.stdout.write(`render-storyline-graph: wrote ${page.svgRelPath}\n`);
    }
  }

  const indexPath = repoPath(INCIDENT_INDEX_PATH);
  if (check) {
    if (!existsSync(indexPath) || readFileSync(indexPath, 'utf-8') !== indexMarkdown) {
      drift.push(INCIDENT_INDEX_PATH);
    }
  } else {
    writeFileSync(indexPath, indexMarkdown, 'utf-8');
    process.stdout.write(`render-storyline-graph: wrote ${INCIDENT_INDEX_PATH}\n`);
  }

  // Splice the per-event detail tables into the canonical doc (only the marked
  // regions are replaced, so hand-written prose is preserved).
  const docPath = repoPath(DOC_PATH);
  const committedDoc = readFileSync(docPath, 'utf-8');
  let expectedDoc = committedDoc;
  for (const page of pages) {
    expectedDoc = spliceGeneratedDetails(
      expectedDoc,
      page.slug,
      renderStorylineDetailsMarkdown(manifest, page.storylineId),
    );
  }
  if (check) {
    if (expectedDoc !== committedDoc) drift.push(DOC_PATH);
  } else if (expectedDoc !== committedDoc) {
    writeFileSync(docPath, expectedDoc, 'utf-8');
    process.stdout.write(`render-storyline-graph: updated detail tables in ${DOC_PATH}\n`);
  }

  if (check) {
    if (drift.length > 0) {
      process.stderr.write(
        'render-storyline-graph: drift detected — regenerate with `npm run storylines:graph:svg`:\n',
      );
      for (const path of drift) process.stderr.write(`  - ${path}\n`);
      return 1;
    }
    process.stdout.write(
      `render-storyline-graph: ${pages.length} storyline pages and the incident index are up to date\n`,
    );
  }
  return 0;
}
