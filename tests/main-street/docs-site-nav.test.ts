/**
 * Navigation coverage guard for the local VitePress docs site
 * (MS-0MUYK064P0032374, AC2 + AC5).
 *
 * The docs site is a local browsing layer over the two-tree documentation
 * (`docs/game/` + `docs/dev/`). Its sidebar is generated from the files on
 * disk, so the failure mode this guard protects against is a document that
 * silently drops out of the navigation (an orphan), or a nav entry that points
 * at a page that no longer exists.
 *
 * The suite is a pure config scan — it imports the real VitePress config (the
 * same object `vitepress dev docs` loads) and walks the Markdown tree. No
 * browser, no site build, so it stays fast and deterministic in the `unit`
 * project.
 *
 * @module
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import siteConfig, { docsSiteConfig } from '../../docs/.vitepress/config';
import { flattenSidebar, type SidebarLink, type SidebarSection } from '../../docs/.vitepress/sidebar';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DOCS_ROOT = path.join(PROJECT_ROOT, 'docs');
const AUDIENCE_TREES = ['game', 'dev'] as const;

function readProjectFile(relativePath: string): string {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf-8');
}

/** Every `.md` file directly inside an audience tree, sorted for determinism. */
function topLevelDocs(tree: string): string[] {
  return fs
    .readdirSync(path.join(DOCS_ROOT, tree), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

/** Site link (e.g. `/game/core-rules-and-mechanics`) → `docs/…` file path. */
function linkToDocFile(link: string): string {
  return path.join(DOCS_ROOT, `${link.replace(/^\//, '')}.md`);
}

function sidebarLinks(): SidebarLink[] {
  const sidebar = siteConfig.themeConfig?.sidebar as SidebarSection[];
  return flattenSidebar(sidebar);
}

describe('docs site navigation (AC2)', () => {
  it('has one sidebar section per documentation audience', () => {
    const sections = siteConfig.themeConfig?.sidebar as SidebarSection[];
    expect(sections.map((section) => section.text)).toEqual([
      'Documentation index',
      'Gameplay reference',
      'Development, balance & evidence',
    ]);
  });

  it('lists every top-level document under docs/game/ in the sidebar', () => {
    const targets = new Set(sidebarLinks().map((link) => link.link));
    const missing = topLevelDocs('game')
      .map((file) => `/game/${file.slice(0, -'.md'.length)}`)
      .filter((link) => !targets.has(link));
    expect(missing).toEqual([]);
  });

  it('lists every top-level document under docs/dev/ in the sidebar', () => {
    const targets = new Set(sidebarLinks().map((link) => link.link));
    const missing = topLevelDocs('dev')
      .map((file) => `/dev/${file.slice(0, -'.md'.length)}`)
      .filter((link) => !targets.has(link));
    expect(missing).toEqual([]);
  });

  it('lists every document in a nested docs sub-directory (storylines, analysis, evidence)', () => {
    const targets = new Set(sidebarLinks().map((link) => link.link));
    const nested: string[] = [];
    for (const tree of AUDIENCE_TREES) {
      for (const entry of fs.readdirSync(path.join(DOCS_ROOT, tree), { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const subDir = path.join(DOCS_ROOT, tree, entry.name);
        for (const file of fs.readdirSync(subDir)) {
          if (file.endsWith('.md')) {
            nested.push(`/${tree}/${entry.name}/${file.slice(0, -'.md'.length)}`);
          }
        }
      }
    }
    const missing = nested.filter((link) => !targets.has(link));
    expect(missing).toEqual([]);
  });

  it('points every sidebar entry at a document that exists on disk', () => {
    const dangling = sidebarLinks()
      .filter((link) => !fs.existsSync(linkToDocFile(link.link)))
      .map((link) => link.link);
    expect(dangling).toEqual([]);
  });

  it('gives every sidebar entry a human-readable label (no raw file names)', () => {
    const labels = sidebarLinks().map((link) => link.text);
    expect(labels.every((text) => text.trim() !== '' && !text.endsWith('.md'))).toBe(true);
  });

  it('includes the documentation index (docs/README.md)', () => {
    expect(sidebarLinks().map((link) => link.link)).toContain('/README');
  });
});

describe('docs site config (AC1, AC3, AC4)', () => {
  it('disables raw HTML in Markdown so generic type notation in docs compiles', () => {
    // `Grid<T>` in prose is otherwise parsed as an unclosed HTML element while
    // VitePress compiles the page as a Vue SFC (build failure).
    expect(docsSiteConfig.markdown?.html).toBe(false);
  });

  it('registers the Mermaid plugin so mermaid fences become diagrams (AC3)', async () => {
    const { createMarkdownRenderer } = await import('vitepress');
    const md = await createMarkdownRenderer(DOCS_ROOT, siteConfig.markdown ?? {}, '/');

    const mermaidHtml = md.render('```mermaid\nflowchart TD\n  Start --> Stop\n```\n');
    expect(mermaidHtml).toContain('<Mermaid');
    expect(mermaidHtml).toContain(encodeURIComponent('flowchart TD'));

    // Ordinary fences must keep rendering as code blocks, not as diagrams.
    const codeHtml = md.render('```ts\nconst a = 1;\n```\n');
    expect(codeHtml).not.toContain('<Mermaid');
    expect(codeHtml).toContain('language-ts');
  });

  it('keeps the committed storyline SVGs untouched and still linked from the docs (AC3)', () => {
    const svgs = fs
      .readdirSync(path.join(DOCS_ROOT, 'game', 'assets'))
      .filter((f) => f.endsWith('.svg'));
    expect(svgs.length).toBeGreaterThan(0);
    for (const svg of svgs) {
      expect(fs.statSync(path.join(DOCS_ROOT, 'game', 'assets', svg)).size).toBeGreaterThan(0);
    }
    const storylines = readProjectFile('docs/game/storylines.md');
    expect(storylines).toContain('assets/storyline-graph');
  });

  it('ignores the existing links that intentionally point outside the docs tree (AC4)', () => {
    // VitePress fails the build on links it cannot resolve inside the site
    // source. These documents reference engine sources, game sources,
    // deployment notes and directory listings; rewriting them is out of scope
    // (AC4), so the shapes must be ignored instead — otherwise `docs:build`
    // breaks.
    const ignored: RegExp[] = (siteConfig.ignoreDeadLinks ?? []) as RegExp[];
    const outsideDocsLinks = [
      './../../core/docs/DEVELOPER',
      './../../src/README',
      './../../packs/README',
      './../../DEPLOYMENT',
      './../dev/assets/storyline-graph.mmd',
      './storylines/index',
      './../README',
    ];
    const unmatched = outsideDocsLinks.filter((url) => !ignored.some((pattern) => pattern.test(url)));
    expect(unmatched).toEqual([]);
  });

  it('ignores the generated build output so `docs:build` never dirties git (AC1)', () => {
    const gitignore = readProjectFile('.gitignore');
    expect(gitignore).toContain('docs/.vitepress/dist/');
    expect(gitignore).toContain('docs/.vitepress/cache/');
  });
});

describe('docs site tooling is a local-only dev dependency (AC1, AC8, AC9)', () => {
  const pkg = JSON.parse(readProjectFile('package.json')) as {
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  it('exposes the local docs scripts', () => {
    expect(pkg.scripts.docs).toBe('vitepress dev docs');
    expect(pkg.scripts['docs:build']).toBe('vitepress build docs');
    expect(pkg.scripts['docs:preview']).toBe('vitepress preview docs');
  });

  it('keeps the docs toolchain out of the runtime bundle', () => {
    expect(pkg.dependencies.vitepress).toBeUndefined();
    expect(pkg.dependencies['vitepress-plugin-mermaid']).toBeUndefined();
    expect(pkg.devDependencies.vitepress).toMatch(/^\^?1\./);
    expect(pkg.devDependencies['vitepress-plugin-mermaid']).toMatch(/^\^?2\./);
  });

  it('adds no CI workflow for the docs site (local-only)', () => {
    const workflowDir = path.join(PROJECT_ROOT, '.github', 'workflows');
    if (!fs.existsSync(workflowDir)) return;
    const offenders = fs
      .readdirSync(workflowDir)
      .filter((file) => /\.ya?ml$/.test(file))
      .filter((file) =>
        /vitepress|docs:build|docs-site/.test(
          fs.readFileSync(path.join(workflowDir, file), 'utf-8'),
        ),
      );
    expect(offenders).toEqual([]);
  });

  it('exports a plugin-wired default config the site actually loads (AC3)', () => {
    // `withMermaid()` must extend the plain config (Markdown hook + Vite
    // plugins) rather than replacing the navigation the site serves.
    expect(typeof siteConfig.markdown?.config).toBe('function');
    expect((siteConfig.vite?.plugins ?? []).length).toBeGreaterThan(0);
    expect(siteConfig.themeConfig?.sidebar).toEqual(docsSiteConfig.themeConfig?.sidebar);
  });
});
