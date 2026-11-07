#!/usr/bin/env node
/**
 * GDD staff consistency CLI entry point (MS-0MW2XKTR50062OFL).
 *
 * Usage:
 *   npm run validate:gdd                              # human report
 *   npm run validate:gdd -- --json                    # machine-readable report
 *   npm run validate:gdd -- --project-root ../other   # check another checkout
 *
 * Exits 0 when the staff documentation is internally consistent and agrees
 * with the shipped card data, 1 otherwise. Runs under `vite-node` because the
 * card model imports card-data.csv via Vite's `?raw` query, which plain
 * `tsx`/Node cannot resolve.
 *
 * @module
 */
import { runGddConsistencyCli } from './gdd-staff-consistency';

process.exitCode = runGddConsistencyCli();
