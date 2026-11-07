/**
 * Remote pack hosting contract documentation guard (MS-0MVSFWGMD0082Z3E,
 * parent MS-0MV26X8T200852AC AC8).
 *
 * The documentation *is* this slice's deliverable, so the guard asserts the
 * shipped prose against the shipped behaviour rather than against a private
 * copy of the same words:
 *
 *   - the operator contract states the hosting layout (with a worked URL tree),
 *     the signed-envelope shape, the canonical payload rules, every verifier
 *     outcome, the degradation semantics, the key-separation rule, the
 *     licence-clean requirement and the recorded follow-ups;
 *   - `packs/README.md` documents the remote layout and that a hosted catalogue
 *     uses the same manifest shape as the bundled packs plus the signature;
 *   - `DEPLOYMENT.md` documents both build-time variables, the ordered
 *     multi-catalogue list and the rebuild-to-change rule;
 *   - the new page is reachable from the root README and the docs index;
 *   - the worked signing example is **reproducible**: the documented canonical
 *     payload equals the shipped canonicalisation of the documented manifest,
 *     and the documented signature verifies `ok` against the documented public
 *     key through the real verifier.
 *
 * Constants are imported from the implementation so a renamed environment
 * variable, timeout or signature length fails here instead of silently
 * drifting out of the operator documentation.
 *
 * @module
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  ED25519_PUBLIC_KEY_BYTES,
  REMOTE_PACK_PUBLIC_KEY_ENV_VAR,
  REMOTE_PACK_SOURCES_ENV_VAR,
  REMOTE_PACK_URL_ENV_VAR,
  decodeBase64Bytes,
} from '../../src/MainStreetRemotePackConfig';
import {
  ED25519_SIGNATURE_BYTES,
  canonicalPackManifestPayload,
  verifyPackManifestSignature,
} from '../../src/MainStreetRemotePackManifest';
import {
  DEFAULT_REMOTE_PACK_TIMEOUT_MS,
} from '../../src/MainStreetRemotePackFetch';
import {
  SUPPORTED_REMOTE_PACK_MANIFEST_VERSION,
} from '../../src/MainStreetPackSources';

const PROJECT_ROOT = path.resolve(__dirname, '../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf-8');
}

/** Collapses hard line breaks so phrase checks are wrap-insensitive. */
function normalise(text: string): string {
  return text
    .replace(/[*`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Every fenced block of the given language, without the fence markers. */
function fencedBlocks(doc: string, language: string): string[] {
  const pattern = new RegExp('```' + language + '\\n([\\s\\S]*?)```', 'g');
  const blocks: string[] = [];
  for (let match = pattern.exec(doc); match !== null; match = pattern.exec(doc)) {
    blocks.push(match[1]);
  }
  return blocks;
}

const HOSTING_DOC = 'docs/dev/remote-pack-hosting.md';
const PACKS_README = 'packs/README.md';
const DEPLOYMENT = 'DEPLOYMENT.md';
const ROOT_README = 'README.md';
const DOCS_INDEX = 'docs/README.md';

describe('remote pack hosting contract — configuration', () => {
  const doc = read(HOSTING_DOC);

  it('names both single-catalogue variables and the ordered multi-catalogue list', () => {
    for (const variable of [
      REMOTE_PACK_URL_ENV_VAR,
      REMOTE_PACK_PUBLIC_KEY_ENV_VAR,
      REMOTE_PACK_SOURCES_ENV_VAR,
    ]) {
      expect(doc).toContain(variable);
    }
  });

  it('states that configuration is build-time and changing it requires a rebuild', () => {
    const text = normalise(doc);
    expect(text).toContain('build-time');
    expect(text).toContain('requires a rebuild and a redeploy');
  });

  it('states the multiple-URL ordering rule', () => {
    const text = normalise(doc);
    expect(text).toContain('order is precedence');
    expect(text).toContain('first catalogue listed wins');
  });

  it('states the host allow-list (same scheme and port, nothing else requested)', () => {
    const text = normalise(doc);
    expect(text).toContain('same scheme and same port');
    expect(text).toContain('refused before a request is made');
  });
});

describe('remote pack hosting contract — hosting layout', () => {
  const doc = read(HOSTING_DOC);

  it('documents the exact URL paths the game requests', () => {
    expect(doc).toContain('<base>/packs/manifest.json');
    expect(doc).toContain('<base>/packs/<gameId>/<packId>/cards.csv');
    expect(doc).toContain('<base>/packs/<gameId>/<packId>/assets/<file>');
  });

  it('includes a worked example tree an operator can mirror', () => {
    const text = normalise(doc);
    expect(text).toContain('https://packs.example.com/main-street/');
    expect(text).toContain('acme-summer-pack');
    expect(text).toContain('cards.csv');
    expect(text).toContain('biz-acme-lemonade.png');
  });

  it('serves only declared pack roots and caches nothing', () => {
    const text = normalise(doc);
    expect(text).toContain('only declared roots are served');
    expect(text).toContain('no local cache and no retry');
  });
});

describe('remote pack hosting contract — signing', () => {
  const doc = read(HOSTING_DOC);

  it('documents the signed-envelope shape and both signature halves', () => {
    expect(doc).toContain('"signature"');
    expect(doc).toContain('"manifest"');
    expect(doc).toContain('Ed25519');
    expect(doc).toContain(`${ED25519_PUBLIC_KEY_BYTES}-byte`);
    expect(doc).toContain(`${ED25519_SIGNATURE_BYTES}-byte`);
  });

  it('documents the canonical payload rules an operator reproduces', () => {
    const text = normalise(doc);
    expect(text).toContain('sort object keys recursively');
    expect(text).toContain('no insignificant whitespace');
    expect(text).toContain('arrays keep their written order');
  });

  it('states the key-separation rule: private key never ships, only the public key is pinned', () => {
    const text = normalise(doc);
    expect(text).toContain('never ships in the game');
    expect(text).toContain('only the matching public key is pinned');
  });

  it('lists every verifier outcome with its meaning', () => {
    for (const status of [
      '`ok`',
      '`missing-signature`',
      '`invalid-signature`',
      '`malformed-envelope`',
      '`unavailable`',
    ]) {
      expect(doc).toContain(`| ${status} |`);
    }
  });

  it('documents the post-verification manifest-contract and version checks', () => {
    const text = normalise(doc);
    expect(text).toContain('malformed manifest');
    expect(text).toContain(`version: ${SUPPORTED_REMOTE_PACK_MANIFEST_VERSION}`);
    expect(text).toContain('unsupported manifest version');
  });

  it('publishes a reproducible worked example whose payload matches the shipped canonicaliser', () => {
    const jsonBlocks = fencedBlocks(doc, 'json')
      .map((block) => {
        try {
          return JSON.parse(block) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((value): value is Record<string, unknown> => value !== null);

    const manifest = jsonBlocks.find(
      (value) => Array.isArray(value.packs) && value.signature === undefined,
    );
    const envelope = jsonBlocks.find(
      (value) =>
        typeof value.signature === 'string' &&
        typeof value.manifest === 'object' &&
        value.manifest !== null,
    );
    expect(manifest, 'the doc publishes the bare documented manifest').toBeDefined();
    expect(envelope, 'the doc publishes the served signed envelope').toBeDefined();

    const textBlocks = fencedBlocks(doc, 'text').map((block) => block.trim());
    const payload = textBlocks.find((block) => block.startsWith('{"packs"'));
    const publicKey = textBlocks.find(
      (block) => decodeBase64Bytes(block)?.length === ED25519_PUBLIC_KEY_BYTES,
    );
    const signature = textBlocks.find(
      (block) => decodeBase64Bytes(block)?.length === ED25519_SIGNATURE_BYTES,
    );
    expect(payload, 'the doc publishes the canonical payload line').toBeDefined();
    expect(publicKey, 'the doc publishes the pinned public key').toBeDefined();
    expect(signature, 'the doc publishes the signature').toBeDefined();

    // The documented payload is exactly what the game canonicalises.
    expect(canonicalPackManifestPayload(manifest)).toBe(payload);
    // The served envelope is the documented manifest plus the documented signature.
    expect(envelope!.manifest).toEqual(manifest);
    expect(envelope!.signature).toBe(signature);
  });

  it('the documented signature verifies ok through the real verifier', async () => {
    const jsonBlocks = fencedBlocks(doc, 'json')
      .map((block) => {
        try {
          return JSON.parse(block) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((value): value is Record<string, unknown> => value !== null);
    const envelope = jsonBlocks.find(
      (value) =>
        typeof value.signature === 'string' &&
        typeof value.manifest === 'object' &&
        value.manifest !== null,
    );
    const textBlocks = fencedBlocks(doc, 'text').map((block) => block.trim());
    const publicKey = textBlocks.find(
      (block) => decodeBase64Bytes(block)?.length === ED25519_PUBLIC_KEY_BYTES,
    );
    expect(envelope).toBeDefined();
    expect(publicKey).toBeDefined();

    const verification = await verifyPackManifestSignature({
      envelopeText: JSON.stringify(envelope),
      publicKeyBase64: publicKey!,
    });
    expect(verification.status).toBe('ok');
    expect(verification.manifest).toEqual(envelope!.manifest);
  });
});

describe('remote pack hosting contract — degradation and policy', () => {
  const doc = read(HOSTING_DOC);

  it('documents the bounded timeout, console-only warning, bundled-wins and no-UI-change semantics', () => {
    expect(doc).toContain(`${DEFAULT_REMOTE_PACK_TIMEOUT_MS} ms`);
    const text = normalise(doc);
    expect(text).toContain('console warning only');
    expect(text).toContain('bundled always wins');
    expect(text).toContain('no ui change');
    expect(text).toContain('no client-side caching');
    expect(text).toContain('bundled packs are the offline story');
  });

  it('states the licence-clean requirement for remotely hosted content', () => {
    const text = normalise(doc);
    expect(text).toContain('same licence requirements as bundled packs');
    expect(text).toContain('licence-clean');
  });

  it('records the follow-ups as not available, not as shipped features', () => {
    const text = normalise(doc);
    expect(text).toContain('signing tooling');
    expect(text).toContain('client-side caching');
    expect(text).toContain('runtime or launcher url configuration');
    expect(text).toContain('must not be treated as available features');
  });
});

describe('remote pack hosting contract — reachability from the docs', () => {
  it('packs/README.md documents the remote layout and the shared manifest shape', () => {
    const doc = read(PACKS_README);
    expect(doc).toContain('<base>/packs/manifest.json');
    expect(doc).toContain('<base>/packs/<gameId>/<packId>/cards.csv');
    expect(doc).toContain('<base>/packs/<gameId>/<packId>/assets/<cardId>.png');
    expect(doc).toContain('same `manifest.json` shape as the bundled packs');
    expect(doc).toContain('Remote catalogue (signed hosting)');
    expect(doc).toContain('docs/dev/remote-pack-hosting.md');
    expect(normalise(doc)).toContain('valid signature proves who published a catalogue');
  });

  it('DEPLOYMENT.md documents the variables, ordering and the rebuild rule', () => {
    const doc = read(DEPLOYMENT);
    for (const variable of [
      REMOTE_PACK_URL_ENV_VAR,
      REMOTE_PACK_PUBLIC_KEY_ENV_VAR,
      REMOTE_PACK_SOURCES_ENV_VAR,
    ]) {
      expect(doc).toContain(variable);
    }
    const text = normalise(doc);
    expect(text).toContain('precedence order');
    expect(text).toContain('requires a rebuild');
    expect(doc).toContain('docs/dev/remote-pack-hosting.md');
  });

  it('the root README links the operator contract', () => {
    expect(read(ROOT_README)).toContain('docs/dev/remote-pack-hosting.md');
  });

  it('the documentation index lists the operator contract', () => {
    const doc = read(DOCS_INDEX);
    expect(doc).toContain('dev/remote-pack-hosting.md');
  });

  it('the runbook links the full contract instead of duplicating it', () => {
    const doc = read('docs/dev/card-packs-runbook.md');
    expect(doc).toContain('remote-pack-hosting.md');
  });
});
