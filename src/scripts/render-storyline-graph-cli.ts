/**
 * CLI entry point for rendering the storyline graph to SVG.
 *
 * Usage:
 *   npm run storylines:graph:svg
 *   npm run storylines:graph:svg -- --check
 *
 * @module
 */

import { runRenderCli } from './render-storyline-graph';

const code = await runRenderCli();
process.exitCode = code;
