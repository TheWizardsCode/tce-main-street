# Deployment

This document describes how the Main Street web build is published, how to set
it up for the first time, how to verify a release, and how to reproduce the
production build locally.

## Production URL

The site is published to GitHub Pages at:

**https://thewizardscode.github.io/tce-main-street/**

GitHub Pages serves a project site under the repository path (`/tce-main-street/`),
not at the domain root, which is why the production base path is a first-class
concern below.

## Release path

Publishing is **automatic on every push to `main`**, via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml):

1. `dev` is promoted to `main` by the release process (the ship skill's
   `dev → main` merge). Agents never push to `main` directly.
2. The push to `main` triggers the workflow, which runs the quality gates and
   then deploys.

> **Never push to `main` directly.** All work lands on `dev`; `main` is only
> advanced by the release process. The workflow runs only on a push to `main`
> (there is no `workflow_dispatch` or pull-request trigger), so unreleased work
> can never be published.

### What the workflow does

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs on
`ubuntu-latest` with a `pages` concurrency group (`cancel-in-progress: true`,
so only one deployment runs at a time):

1. **Checkout** the repository with submodules — this composes `./core` over
   HTTPS (see [No stored credentials](#no-stored-credentials)).
2. **Setup Node.js** 20 with the npm cache.
3. **Install dependencies** — `npm ci`.
4. **Test** — `npm test` (unit suite).
5. **Build** — `npm run build` (`tsc --noEmit && vite build` → `dist/`).
6. **Configure Pages** — `actions/configure-pages@v5`.
7. **Upload artifact** — `actions/upload-pages-artifact@v3`, `path: dist`.
8. **Deploy to GitHub Pages** — `actions/deploy-pages@v4`, exposing
   `page_url`.

Because the tests and build run **before** the upload, a failing test or build
blocks deployment and publishes nothing.

### No stored credentials

The build composes the `./core` submodule from the public Tableau Card Engine
repository over **HTTPS**. `actions/checkout@v4` rewrites the SSH submodule URL
declared in [`.gitmodules`](.gitmodules) to HTTPS when no `ssh-key` is supplied,
so the workflow needs **no SSH keys and no repository secrets**. The contract
test `tests/deploy/deploy-workflow.test.ts` fails if any `secrets.` reference or
`ssh-key` input is introduced.

### Single-game content

The build uses this repository's single-game preset (`configs/game.json`),
selected by the game-discovery plugin's default. The published launcher
therefore contains exactly **Main Street** plus the core-owned **Gym**; no
sibling `tce-<game>` repository is composed and the all-games preset is never
used.

## First-time setup

GitHub Pages must be enabled once for this repository by an administrator:

1. Open **Settings → Pages** for
   [`TheWizardsCode/tce-main-street`](https://github.com/TheWizardsCode/tce-main-street/settings/pages).
2. Under **Build and deployment → Source**, choose **GitHub Actions**.

Until this is done, the workflow's deploy step fails; once set, the next push to
`main` publishes the site. (If the organisation restricts project Pages, an
administrator must also allow it for the repository.)

## Verify a deployment

1. **Watch the run** — open the repository's **Actions** tab and confirm the
   latest **Deploy to GitHub Pages** run for the `main` push succeeded
   (`.github/workflows/deploy.yml`). The job summary links the deployed
   `page_url`.
2. **Load the site** — visit
   <https://thewizardscode.github.io/tce-main-street/>, start **Main Street**
   from the launcher, and confirm the browser console shows no 404s for the
   JavaScript/CSS entry bundle, card art or audio.

## Reproduce the production build locally

```bash
npm ci
npm test          # unit suite
npm run build     # tsc --noEmit && vite build -> dist/
npm run preview   # serves dist/ at http://localhost:4173/tce-main-street/
```

`npm run preview` runs `vite preview --host`, which serves the production bundle
under the configured Pages base, so the URL includes the project path:
**http://localhost:4173/tce-main-street/**. Open that URL (not the bare
`localhost:4173/`) and confirm the launcher boots with no 404s in the console.

## Base-path contract

GitHub Pages serves this project under `/tce-main-street/`, so the Vite `base`
option is set per mode in [`vite.config.ts`](vite.config.ts):

| Mode | `base` | Why |
|------|--------|-----|
| Production (`npm run build`) | Derived from the `package.json` name (last path segment → `/tce-main-street/`) | The Pages project site lives under the repository path. |
| Development (`npm run dev`) | `/` | The dev server serves from the domain root. |
| Electron (`vite build --mode electron`) | `./` | The bundle is loaded over `file://`, so assets must be relative. |

The production base is **derived, not hard-coded**: the last segment of the
`package.json` `name` is used (so a scoped package name resolves to its final
segment), and a **`PAGES_BASE`** environment variable overrides it for forks or
custom domains, e.g.:

```bash
PAGES_BASE=/my-fork/ npm run build
```

The build-output tests in `tests/deploy/` assert the derived base, the
`PAGES_BASE` override, and that the client-side 404 guard resolves under the
Pages base.
