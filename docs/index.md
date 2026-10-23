# Main Street documentation

Main Street is an economic city builder: the player revitalises the commercial
hub of a city, one street grid at a time. This site is the browsable form of the
repository's `docs/` tree — gameplay reference for designers and content
authors, plus the engineering, balance and evidence material for maintainers.

Use the sidebar (or the grouped navigation) to move between the two audiences:

- **Gameplay reference** — core rules and turn structure, the card catalogue,
  storyline graphs, UX/audio, tutorial and localisation, playtest scenarios.
- **Development, balance & evidence** — balancing methodology and analysis
  APIs, PRD milestones, Monte-Carlo baselines and generated evidence, testing
  process, build/release and the card-packs runbook.

## Running the docs site locally

The docs site is a **local development tool** — it is not built or published by
CI, and the game bundle never depends on it (`vitepress` and its Mermaid plugin
are dev dependencies only).

```bash
npm run docs        # serve the docs site locally with hot reload
npm run docs:build  # build the static site into docs/.vitepress/dist/
npm run docs:preview # serve the built site (after docs:build)
```

Mermaid fences (for example in
[the core rules](game/core-rules-and-mechanics.md) and
[the build GDD](game/the-build-gdd.md)) are rendered in the browser by
`vitepress-plugin-mermaid`, on top of the repository's existing `mermaid`
dependency. The committed storyline SVGs under `game/assets/` stay as they are
and are still linked from the storyline documents.

Navigation is generated from the Markdown tree itself
(`docs/.vitepress/sidebar.ts`), so a new document placed under `docs/game/` or
`docs/dev/` appears in the sidebar automatically; the
`tests/main-street/docs-site-nav.test.ts` guard fails if any top-level document
is not reachable.

## Where the raw documentation starts

[The documentation index](README.md) explains the two-tree split and the
"where does X go?" rule for adding new documents.
