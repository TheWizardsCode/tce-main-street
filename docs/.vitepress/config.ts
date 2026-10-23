/**
 * VitePress configuration for the **local** docs site (MS-0MUYK064P0032374).
 *
 * The site is a developer/content-author convenience layer over the existing
 * two-tree documentation (`docs/game/` + `docs/dev/`): it adds sidebar
 * navigation and renders Mermaid fences, without moving, renaming or
 * rewriting a single document (AC4). It is local-only by design — there is no
 * CI job and no Pages publishing (AC8); `npm run docs` serves it,
 * `npm run docs:build` emits a static site under `docs/.vitepress/dist/`
 * (git-ignored).
 *
 * Sidebar entries are derived from the files on disk (see `./sidebar.ts`), so
 * every document in both trees is reachable and a new document can never be
 * orphaned (AC2).
 *
 * Mermaid: fences are rendered **client-side** in the browser by
 * `vitepress-plugin-mermaid` (MIT) on top of the existing `mermaid` dev
 * dependency. Build-time pre-rendering would need a headless-Chromium step in
 * `docs:build`; for a local navigation-first tool the client-side plugin keeps
 * the build simple and dependency-light, so that is the recorded choice for
 * this item's open question (see the work-item comment trail).
 *
 * Note the `markdown.html: false` setting: the documentation uses generic
 * type notation such as `Grid<T>` in prose, which VitePress would otherwise
 * parse as an unclosed HTML element while compiling the page as a Vue SFC.
 * Disabling raw HTML in Markdown makes those characters render as text. No
 * document relies on raw HTML blocks.
 *
 * @module
 */
import * as path from 'node:path';
import { defineConfig, type UserConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

import { buildSidebar } from './sidebar';

/** The repository's `docs/` directory (this file lives in `docs/.vitepress/`). */
const docsRoot = path.resolve(__dirname, '..');

/**
 * Plain (plugin-free) site configuration.
 *
 * Exported separately so unit tests can assert the navigation and Markdown
 * settings without booting the Mermaid plugin.
 */
export const docsSiteConfig: UserConfig = {
  title: 'Main Street docs',
  description:
    'Gameplay reference and development/balance documentation for the Main Street economic city builder.',
  lang: 'en-GB',
  cleanUrls: false,

  // Markdown is compiled to a Vue SFC, so raw angle brackets in prose (for
  // example generic type notation) must not be parsed as HTML elements.
  markdown: { html: false },

  /**
   * Existing documents intentionally reference material that lives *outside*
   * the docs tree (engine sources, game sources, deployment notes, `.mmd`
   * sources, and directory listings). Those links are valid when browsing the
   * repository on disk but cannot be served by the site, and AC4 forbids
   * rewriting them, so they are ignored rather than reported as dead links.
   */
  ignoreDeadLinks: [
    // Documentation that lives in the engine submodule or the game repo root.
    /core\/docs\//,
    /src\/README/,
    /packs\/README/,
    /DEPLOYMENT/,
    // Mermaid sources rendered separately (the site links the committed SVGs).
    /\.mmd$/,
    // Directory references: file browsers render a listing, the site has no
    // directory index page (`<dir>/index.md` does not exist by design).
    /\/index$/,
    // The repository root README (outside `docs/`).
    /^\.\.?\/.*README$/,
  ],

  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Gameplay', link: '/game/core-rules-and-mechanics' },
      { text: 'Development', link: '/dev/testing' },
    ],
    sidebar: buildSidebar(docsRoot),
    outline: { level: [2, 3] },
    docFooter: { prev: true, next: true },
  },
};

/**
 * The configuration VitePress actually loads: the plain site config wrapped by
 * the Mermaid plugin so `mermaid` fences become rendered diagrams.
 */
export default withMermaid(defineConfig(docsSiteConfig));
