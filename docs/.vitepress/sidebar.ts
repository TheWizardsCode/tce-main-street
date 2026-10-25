/**
 * Sidebar navigation for the local VitePress docs site (MS-0MUYK064P0032374).
 *
 * The sidebar is **derived from the Markdown files on disk** rather than being
 * a hand-maintained list, so a newly added document can never become orphaned
 * (AC2): adding `docs/game/foo.md` immediately produces a sidebar entry, and
 * `tests/main-street/docs-site-nav.test.ts` asserts that every top-level
 * document in both audience trees is reachable from the sidebar.
 *
 * The module is deliberately free of VitePress imports so that it can be
 * imported directly by unit tests (no browser, no site build) and reused by
 * `docs/.vitepress/config.ts`.
 *
 * @module
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/** A single navigable document. */
export interface SidebarLink {
  text: string;
  link: string;
}

/** A nested (collapsible) group of documents, e.g. `docs/game/storylines/`. */
export interface SidebarGroup {
  text: string;
  collapsed: boolean;
  items: SidebarLink[];
}

/** A top-level sidebar section with its (possibly nested) entries. */
export interface SidebarSection {
  text: string;
  items: Array<SidebarLink | SidebarGroup>;
}

const DOC_EXTENSION = '.md';
const SIDEBAR_REFERENCE_TITLE = 'Documentation index';

/** Convert a document path (relative to `docs/`) into its site link. */
export function docPathToLink(relativePath: string): string {
  const posix = relativePath.split(path.sep).join('/');
  const withoutExtension = posix.endsWith(DOC_EXTENSION)
    ? posix.slice(0, -DOC_EXTENSION.length)
    : posix;
  return `/${withoutExtension}`;
}

/** Read the first `# ` heading of a Markdown file, falling back to its stem. */
export function readDocTitle(file: string): string {
  let contents = '';
  try {
    contents = fs.readFileSync(file, 'utf-8');
  } catch {
    contents = '';
  }
  const heading = /^#\s+(.+?)\s*#*\s*$/m.exec(contents);
  if (!heading) {
    return path.basename(file, DOC_EXTENSION);
  }
  return (
    heading[1]
      // Strip the inline markup that would otherwise show verbatim in the nav.
      .replace(/[`*_]/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .trim() || path.basename(file, DOC_EXTENSION)
  );
}

/** `storylines` → `Storylines`, `monte-carlo-evidence` → `Monte carlo evidence`. */
function humaniseDirName(name: string): string {
  const words = name.replace(/[-_]+/g, ' ').trim();
  if (words === '') return name;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function listMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(DOC_EXTENSION))
    .map((entry) => entry.name)
    // `README.md` is the tree's own index; it is surfaced separately.
    .filter((name) => name.toLowerCase() !== 'readme.md')
    .sort((a, b) => a.localeCompare(b));
}

function listSubdirectories(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function toSidebarLink(docsRoot: string, absolutePath: string): SidebarLink {
  return {
    text: readDocTitle(absolutePath),
    link: docPathToLink(path.relative(docsRoot, absolutePath)),
  };
}

/**
 * Build one audience section: its top-level documents first (alphabetical),
 * then one collapsible group per sub-directory that contains documents.
 */
function buildSection(docsRoot: string, tree: 'game' | 'dev', text: string): SidebarSection {
  const treeDir = path.join(docsRoot, tree);
  const items: Array<SidebarLink | SidebarGroup> = listMarkdownFiles(treeDir).map((name) =>
    toSidebarLink(docsRoot, path.join(treeDir, name)),
  );

  for (const dirName of listSubdirectories(treeDir)) {
    const subDir = path.join(treeDir, dirName);
    const docs = listMarkdownFiles(subDir);
    if (docs.length === 0) continue;
    items.push({
      text: humaniseDirName(dirName),
      collapsed: true,
      items: docs.map((name) => toSidebarLink(docsRoot, path.join(subDir, name))),
    });
  }

  return { text, items };
}

/**
 * Build the complete docs-site sidebar from the Markdown tree under
 * `docsRoot` (the repository's `docs/` directory).
 */
export function buildSidebar(docsRoot: string): SidebarSection[] {
  const sections: SidebarSection[] = [];
  const reference = path.join(docsRoot, 'README.md');

  if (fs.existsSync(reference)) {
    sections.push({
      text: SIDEBAR_REFERENCE_TITLE,
      items: [{ text: 'Where does X go?', link: docPathToLink('README.md') }],
    });
  }

  sections.push(buildSection(docsRoot, 'game', 'Gameplay reference'));
  sections.push(buildSection(docsRoot, 'dev', 'Development, balance & evidence'));
  return sections;
}

/** Flatten a sidebar (or any section list) into its document links. */
export function flattenSidebar(
  sidebar: ReadonlyArray<SidebarSection | SidebarGroup | SidebarLink>,
): SidebarLink[] {
  const links: SidebarLink[] = [];
  for (const entry of sidebar) {
    if ('link' in entry) {
      links.push(entry);
    } else {
      links.push(...flattenSidebar(entry.items as Array<SidebarGroup | SidebarLink>));
    }
  }
  return links;
}
