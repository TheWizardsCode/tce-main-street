/**
 * Render the storyline graph as one SVG per storyline (one parent box per
 * page) plus a compact standalone-incident index (MS-0MUNB54KU005084C).
 *
 * The combined graph is unreadable: 71 nodes, only 11 of them connected (the
 * five storyline chains). Mermaid lays the 60 isolated incidents out in a
 * single horizontal row, producing a ~13,000px-wide strip of tiny boxes. This
 * module instead renders:
 *
 *  - `docs/main-street/assets/storyline-graph-<slug>.svg` — one diagram per
 *    storyline (its parent incident and chain), at a readable size, with a
 *    brief description and game-state impact in each box;
 *  - `docs/main-street/storylines/<slug>.md` — one document per storyline
 *    (its diagram plus a per-event detail table); and
 *  - `docs/main-street/storyline-incident-index.md` — the standalone incidents
 *    as a compact index/table rather than boxes.
 *
 * `storylines.md` keeps the canonical reference and links to the per-storyline
 * documents. All artefacts are derived from the committed manifest
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

/** Directory holding the committed docs. */
const DOCS_DIR = 'docs/main-street';

/** Directory holding rendered SVG assets. */
export const ASSETS_DIR = `${DOCS_DIR}/assets`;

/** Directory holding the per-storyline documents. */
export const STORYLINES_DIR = `${DOCS_DIR}/storylines`;

/** Committed standalone-incident index document. */
export const INCIDENT_INDEX_PATH = `${DOCS_DIR}/storyline-incident-index.md`;

/** Canonical doc that indexes the per-storyline documents. */
export const DOC_PATH = `${DOCS_DIR}/storylines.md`;

/** Marker key for the generated storyline-document index in `DOC_PATH`. */
export const DOC_INDEX_KEY = 'storyline-doc-index';

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
  /** Repo-relative path of the committed SVG asset. */
  readonly svgRelPath: string;
  /** Repo-relative path of the committed per-storyline document. */
  readonly docRelPath: string;
}

/** Builds the BEGIN/END markers for a generated section. */
function sectionMarkers(key: string): { begin: string; end: string } {
  return {
    begin: `<!-- BEGIN GENERATED: ${key} -->`,
    end: `<!-- END GENERATED: ${key} -->`,
  };
}

/**
 * Replaces the content between a generated-section's markers, leaving all
 * hand-written prose untouched.
 *
 * @param doc     The current doc contents.
 * @param key     The generated-section key.
 * @param content The generated Markdown.
 * @returns The updated doc.
 */
export function spliceGeneratedSection(doc: string, key: string, content: string): string {
  const { begin, end } = sectionMarkers(key);
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
      svgRelPath: `${ASSETS_DIR}/storyline-graph-${slug}.svg`,
      docRelPath: `${STORYLINES_DIR}/${slug}.md`,
    };
  });
}

/**
 * Renders the full Markdown document for one storyline: its diagram (from the
 * assets folder) and its per-event detail table.
 *
 * @param page         The storyline page.
 * @param detailsTable The generated per-event detail table.
 * @returns The Markdown document (trailing newline).
 */
export function renderStorylineDoc(page: StorylinePage, detailsTable: string): string {
  return [
    `# ${page.title}`,
    '',
    `> Storyline \`${page.storylineId}\`. Part of the [Main Street storylines](../storylines.md) reference.`,
    '',
    `![${page.title} storyline](../assets/storyline-graph-${page.slug}.svg)`,
    '',
    '## Events',
    '',
    detailsTable.trimEnd(),
    '',
  ].join('\n');
}

/**
 * Renders the generated index of per-storyline documents for `storylines.md`.
 *
 * @param manifest The full storyline manifest.
 * @param pages    The storyline pages.
 * @returns A deterministic Markdown table (trailing newline).
 */
export function renderStorylineDocIndex(
  manifest: StorylineManifest,
  pages: readonly StorylinePage[],
): string {
  const lines = ['| Storyline | Events | Document |', '|-----------|--------|----------|'];
  for (const page of pages) {
    const count = manifest.nodes.filter((node) => node.storylineId === page.storylineId).length;
    lines.push(
      `| ${page.title} (\`${page.storylineId}\`) | ${count} | [\`storylines/${page.slug}.md\`](./storylines/${page.slug}.md) |`,
    );
  }
  return `${lines.join('\n')}\n`;
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
  const docIndex = renderStorylineDocIndex(manifest, pages);

  const rendered = await renderMermaidBatch(
    Object.fromEntries(pages.map((page) => [page.slug, page.mermaid])),
  );

  const drift: string[] = [];

  const writeOrCheck = (relPath: string, content: string): void => {
    const outPath = repoPath(relPath);
    if (check) {
      if (!existsSync(outPath) || readFileSync(outPath, 'utf-8') !== content) drift.push(relPath);
      return;
    }
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, content, 'utf-8');
    process.stdout.write(`render-storyline-graph: wrote ${relPath}\n`);
  };

  for (const page of pages) {
    // SVG asset (viewable without a Mermaid renderer).
    writeOrCheck(page.svgRelPath, rendered[page.slug]);
    // Per-storyline document: diagram + per-event detail table.
    writeOrCheck(
      page.docRelPath,
      renderStorylineDoc(page, renderStorylineDetailsMarkdown(manifest, page.storylineId)),
    );
  }

  // Standalone-incident index.
  writeOrCheck(INCIDENT_INDEX_PATH, indexMarkdown);

  // Splice the generated per-storyline index into the canonical doc (only the
  // marked region is replaced, so hand-written prose is preserved).
  const docPath = repoPath(DOC_PATH);
  const committedDoc = readFileSync(docPath, 'utf-8');
  const expectedDoc = spliceGeneratedSection(committedDoc, DOC_INDEX_KEY, docIndex);
  if (check) {
    if (expectedDoc !== committedDoc) drift.push(DOC_PATH);
  } else if (expectedDoc !== committedDoc) {
    writeFileSync(docPath, expectedDoc, 'utf-8');
    process.stdout.write(`render-storyline-graph: updated the storyline index in ${DOC_PATH}\n`);
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
      `render-storyline-graph: ${pages.length} storyline pages, their documents, the incident index and the doc index are up to date\n`,
    );
  }
  return 0;
}
