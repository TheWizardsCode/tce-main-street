/**
 * GitHub Pages deploy workflow contract test
 * (parent MS-0MUQ1KXAS003FJ42, child MS-0MUQZH6BU002113D).
 *
 * Pins the observable wiring of `.github/workflows/deploy.yml`:
 *  - it publishes only on a push to `main`;
 *  - it is gated by unit tests and the production build before deploying;
 *  - it composes the `./core` submodule over HTTPS with no stored secret;
 *  - it uses the single-game preset (never `GAMES_CONFIG=full`);
 *  - its permissions, concurrency group and Pages steps are exactly right.
 *
 * This is a config-contract test: it fails if any of those pieces are removed
 * or reordered, which would silently ship unreleased or asset-404ing content.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const DEPLOY_WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'deploy.yml');

interface WorkflowStep {
  name: string;
  /** Raw YAML block for the step, from its `- name:` line to the next step. */
  body: string;
}

/** Split a workflow's `steps:` list into its named steps, in order. */
function parseSteps(workflow: string): WorkflowStep[] {
  const blocks = workflow.split(/\n(?=\s*-\s*name:)/);
  const steps: WorkflowStep[] = [];
  for (const block of blocks) {
    const name = block.match(/^\s*-\s*name:\s*(.+?)\s*$/m);
    if (name) steps.push({ name: name[1], body: block });
  }
  return steps;
}

function stepIndexByName(steps: WorkflowStep[], name: string): number {
  return steps.findIndex((s) => s.name === name);
}

const source = fs.readFileSync(DEPLOY_WORKFLOW, 'utf-8');
const steps = parseSteps(source);

describe('deploy workflow contract', () => {
  it('is triggered only by a push to main', () => {
    // An `on:` block whose push branch is main.
    expect(source).toMatch(/on:\s*\n\s*push:\s*\n\s*branches:\s*\[\s*main\s*\]/);
    // No unreleased trigger (workflow_dispatch / pull_request) that could publish.
    expect(source).not.toMatch(/pull_request\s*:/);
    expect(source).not.toMatch(/workflow_dispatch\s*:/);
  });

  it('orders install -> playwright browsers -> test -> build -> configure -> upload -> deploy', () => {
    const order = [
      'Install dependencies',
      'Install Playwright browsers',
      'Test',
      'Build',
      'Configure Pages',
      'Upload artifact',
      'Deploy to GitHub Pages',
    ];
    const indices = order.map((n) => stepIndexByName(steps, n));
    for (let i = 0; i < indices.length; i++) {
      expect(indices[i], `missing step: ${order[i]}`).toBeGreaterThanOrEqual(0);
    }
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i], `${order[i]} must come after ${order[i - 1]}`).toBeGreaterThan(
        indices[i - 1],
      );
    }
  });

  it('gates the deploy on unit tests and the production build', () => {
    const test = steps.find((s) => s.name === 'Test');
    expect(test, 'no Test step').toBeDefined();
    expect(test!.body).toMatch(/run:\s*npm test\b/);

    const build = steps.find((s) => s.name === 'Build');
    expect(build, 'no Build step').toBeDefined();
    expect(build!.body).toMatch(/run:\s*npm run build\b/);

    // The upload must come after both gates so a failure publishes nothing.
    const upload = stepIndexByName(steps, 'Upload artifact');
    expect(upload).toBeGreaterThan(stepIndexByName(steps, 'Test'));
    expect(upload).toBeGreaterThan(stepIndexByName(steps, 'Build'));
  });

  it('install the Playwright Chromium browsers before the test gate', () => {
    // `storyline-graph-svg.test.ts` runs in the unit project and launches
    // Playwright Chromium directly. Without this step the CI runner has no
    // browser binary and `npm test` fails before the build/deploy can run
    // (MS-0MV0SUA5J002AZ40).
    const install = steps.find((s) => s.name === 'Install Playwright browsers');
    expect(install, 'no Playwright browser install step').toBeDefined();
    expect(install!.body).toMatch(/run:\s*npx playwright install\b/);
    expect(install!.body).toMatch(/chromium\b/);
    // The browser install must precede the Test step or the gate still fails.
    expect(stepIndexByName(steps, 'Install Playwright browsers')).toBeLessThan(
      stepIndexByName(steps, 'Test'),
    );
  });

  it('composes the ./core submodule over HTTPS with no stored secret', () => {
    const checkout = steps.find((s) => s.name === 'Checkout');
    expect(checkout, 'no Checkout step').toBeDefined();
    expect(checkout!.body).toMatch(/submodules:\s*(true|recursive)/);
    // No SSH keys or repository secrets may be referenced anywhere.
    expect(source).not.toMatch(/ssh-key\s*:/);
    expect(source).not.toMatch(/secrets\./);
  });

  it('uses the single-game preset and never GAMES_CONFIG=full', () => {
    expect(source).not.toMatch(/GAMES_CONFIG\s*=\s*full/);
    // No sibling tce-<game> repository is cloned.
    expect(source).not.toMatch(/tce-(?!main-street)[a-z-]+/);
    expect(source).not.toMatch(/Compose sibling/);
  });

  it('declares the exact permissions, concurrency group and environment', () => {
    expect(source).toMatch(/permissions:\s*\n\s*contents:\s*read\s*\n\s*pages:\s*write\s*\n\s*id-token:\s*write/);
    expect(source).toMatch(/concurrency:\s*\n\s*group:\s*pages\s*\n\s*cancel-in-progress:\s*true/);
    expect(source).toMatch(/environment:\s*\n\s*name:\s*github-pages\s*\n\s*url:\s*\$\{\{\s*steps\.[^}]+\.outputs\.page_url\s*\}\}/);
  });

  it('uploads dist and pins the expected Pages action versions', () => {
    const upload = steps.find((s) => s.name === 'Upload artifact');
    expect(upload!.body).toMatch(/uses:\s*actions\/upload-pages-artifact@v3/);
    expect(upload!.body).toMatch(/path:\s*dist/);
    expect(steps.find((s) => s.name === 'Configure Pages')!.body).toMatch(
      /uses:\s*actions\/configure-pages@v5/,
    );
    expect(steps.find((s) => s.name === 'Deploy to GitHub Pages')!.body).toMatch(
      /uses:\s*actions\/deploy-pages@v4/,
    );
  });
});
