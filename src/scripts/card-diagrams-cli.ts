#!/usr/bin/env node
/**
 * Card diagrams CLI entry point.
 *
 * Usage:
 *   npm run docs:diagrams                              # all registered diagrams
 *   npm run docs:diagrams -- --diagram synergies        # one domain
 *   npm run docs:diagrams -- --format json              # on-demand manifest
 *   npm run docs:diagrams -- --check                    # drift guard
 *
 * Runs under `vite-node` because the card model imports card-data.csv via
 * Vite's `?raw` query, which plain `tsx`/Node cannot resolve.
 *
 * @module
 */
import { runDiagramCli } from './card-diagrams';

process.exitCode = runDiagramCli();
