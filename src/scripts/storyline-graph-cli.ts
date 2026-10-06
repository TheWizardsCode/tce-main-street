#!/usr/bin/env node
/**
 * Storyline graph/manifest export CLI entry point.
 *
 * Usage:
 *   npm run storylines:graph -- --format mermaid
 *   npm run storylines:graph -- --format json
 *   npm run storylines:graph -- --format json --check   # drift guard
 *
 * Runs under `vite-node` because the card model imports card-data.csv via
 * Vite's `?raw` query, which plain `tsx`/Node cannot resolve.
 *
 * @module
 */
import { runGraphCli } from './storyline-graph';

process.exitCode = runGraphCli();
