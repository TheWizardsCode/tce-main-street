#!/usr/bin/env node
/**
 * Storyline authoring helper CLI entry point.
 *
 * Usage:
 *   npm run storylines:author -- add-card --id evt-x --name "X" --effect "..." \
 *     [--coin-delta -100] [--reputation-delta 0] [--has-choices] \
 *     [--accept-next evt-y] [--reject-next evt-z] \
 *     [--storyline-id storyline-x] [--storyline-title "X Arc"] \
 *     [--csv src/card-data.csv] [--dry-run]
 *
 *   npm run storylines:author -- link --id evt-x --accept-next evt-y \
 *     [--reject-next evt-z] [--has-choices] [--storyline-id ...] \
 *     [--csv src/card-data.csv] [--dry-run]
 *
 * Every edit is validated before it is written; an invalid result leaves the
 * CSV untouched and exits non-zero.
 *
 * Runs under `vite-node` because the card model imports card-data.csv via
 * Vite's `?raw` query, which plain `tsx`/Node cannot resolve.
 *
 * @module
 */
import { runAuthorCli } from './storyline-author';

process.exitCode = runAuthorCli();
