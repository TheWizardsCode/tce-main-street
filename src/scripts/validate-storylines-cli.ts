#!/usr/bin/env node
/**
 * Storyline validation CLI entry point.
 *
 * Runs the static validator against the bundled card-data.csv (or a `--csv`
 * fixture) and sets the process exit code (0 = valid, 1 = invalid).
 *
 * Usage:
 *   npm run validate:storylines
 *   npm run validate:storylines -- --json
 *   npm run validate:storylines -- --csv path/to/fixture.csv
 *   npm run validate:storylines -- --fail-on-cycle
 *
 * Runs under `vite-node` because the card model imports card-data.csv via
 * Vite's `?raw` query, which plain `tsx`/Node cannot resolve.
 *
 * @module
 */
import { runValidatorCli } from './validate-storylines';

process.exitCode = runValidatorCli();
