# Remote pack catalogue hosting contract

This page is the written contract for **hosting Main Street card packs
remotely**. It is for distribution operators: it states where the files go, how
the catalogue manifest is signed, what the game does when it cannot verify or
reach the host, and which follow-ups are *not* part of this iteration. You
should not need to read the source to publish a pack.

A remote catalogue is an **additional** pack source, never a replacement: the
packs committed under [`packs/`](../../packs/README.md) stay bundled into the
web build and remain the offline story. The remote source is inert until a
build is configured for it.

- Implementation: `src/MainStreetRemotePackConfig.ts` (configuration and host
  allow-list), `src/MainStreetRemotePackManifest.ts` (signed envelope and
  canonical payload), `src/MainStreetRemotePackFetch.ts` (bounded, allow-listed
  read) and `src/MainStreetPackSources.ts` (`createRemotePackSource` plus
  composition).
- Authoring, building and gating a pack (bundled or remote) is covered by the
  [card-packs runbook](card-packs-runbook.md).

## 1. Configuration (build time)

A build reads its remote configuration from Vite environment variables. The
configuration is **build-time**: it is compiled into the JavaScript bundle, so
changing a URL, a key or the number of catalogues requires a **rebuild and a
redeploy** of the game. Nothing about the configuration can be changed at
runtime or from the launcher in this iteration.

### One catalogue

| Variable | Meaning |
|----------|---------|
| `VITE_REMOTE_PACK_URL` | Base URL the remote `packs/` tree is served from, for example `https://packs.example.com/main-street`. |
| `VITE_REMOTE_PACK_PUBLIC_KEY` | The **pinned** Ed25519 public key — the raw 32-byte key, standard padded base64. Every remote manifest signature must verify against it. |

Both variables must be set; setting only one is an invalid configuration and
composes no remote source. The URL must be absolute, use `http` or `https`,
carry a host, and carry no credentials. A trailing slash on the path is
normalised away, and the path prefix is preserved: a catalogue hosted under
`https://packs.example.com/main-street` resolves its files under
`https://packs.example.com/main-street/packs/…`, never at the origin root.

### Several catalogues

Several catalogues compose additively through one ordered JSON array:

```bash
VITE_REMOTE_PACK_SOURCES='[
  { "url": "https://packs.example.com/main-street", "publicKey": "<base64 key A>" },
  { "url": "https://partner.example.net/main-street", "publicKey": "<base64 key B>" }
]'
```

- The array must be non-empty; each entry supplies its own `url` and
  `publicKey`, validated exactly like the single-catalogue pair.
- **Order is precedence.** The list keeps the order you write it in, and the
  first catalogue listed wins a pack-id conflict between remote sources.
- One malformed entry is **skipped and reported** with a warning; its valid
  siblings still compose. Malformed JSON, a non-array value or an empty array
  composes no remote source at all.
- When `VITE_REMOTE_PACK_SOURCES` is set it replaces the single-catalogue pair;
  when it is unset the pair is used as a one-entry list.

### Precedence summary

1. **Bundled** packs (compiled in) always win a pack-id conflict.
2. Remote catalogues are consulted in the order declared, and the first
   registered catalogue wins a conflict between remote sources.
3. A pack file (`cards.csv`, asset) is read from the first source that carries
   it; the manifests of all sources are merged for the in-game listing.

Only the configured host — same scheme and same port — is ever requested. Any
other URL is refused **before** a request is made.

### Unconfigured builds

An unconfigured, blank or invalid configuration composes **no** remote source,
performs **no** remote request, and logs exactly one console warning. The
bundled packs keep working unchanged.

## 2. Hosting layout

Serve a `packs/` tree under the configured base URL. The game requests exactly
these paths:

```
<base>/packs/manifest.json                      the signed catalogue envelope
<base>/packs/<gameId>/<packId>/cards.csv        the pack's CSV fragment
<base>/packs/<gameId>/<packId>/assets/<file>    the pack's declared assets
```

A worked example tree for a base URL of
`https://packs.example.com/main-street`:

```
https://packs.example.com/main-street/
  packs/
    manifest.json                               ← signed envelope (see §3)
    main-street/
      acme-summer-pack/
        cards.csv                               ← header matches src/card-data.csv
        assets/
          biz-acme-lemonade.png                 ← asset stem = card id
```

The **on-host layout is identical to the bundled layout** in
[`packs/README.md`](../../packs/README.md): the same `manifest.json` document
shape (`{ "version": 1, "packs": [ … ] }`, the same fields the bundled manifest
declares) plus the signature envelope described below. A pack you host
remotely is the same pack you would build into `packs/`.

Two hosting rules follow from the implementation:

- **Only declared roots are served.** After verification the game records every
  `<gameId>/<packId>/` root the catalogue declares, and it fetches files only
  under one of those roots. A path outside them is refused without a request.
- **Nothing is cached.** The catalogue manifest is fetched and verified once per
  boot (the verdict is memoised for the session), and each pack file is fetched
  from the host when it is read. A host must therefore be reachable at load
  time; there is no service worker, no local cache and no retry.

## 3. Signing contract

The remote `packs/manifest.json` is **not** the bare manifest. It is a
**signed envelope**:

```json
{
  "manifest": { "version": 1, "packs": [ … ] },
  "signature": "<base64 Ed25519 signature over canonical(manifest)>"
}
```

| Part | Rule |
|------|------|
| `manifest` | The pack-manifest document, identical in shape to the bundled `manifest.json`. |
| `signature` | Standard padded base64 of the raw **64-byte** Ed25519 signature over the canonical payload bytes. |
| Algorithm | **Ed25519**, verified through WebCrypto against the pinned public key. |
| Public key | The raw **32-byte** Ed25519 public key, standard padded base64, pinned at build time in `VITE_REMOTE_PACK_PUBLIC_KEY` (or the `publicKey` of a `VITE_REMOTE_PACK_SOURCES` entry). |

### Canonical payload rules

The signature covers the **canonical payload** of the `manifest` value:
`canonicalPackManifestPayload(manifest)` in
`src/MainStreetRemotePackManifest.ts`. An operator reproduces the exact signed
bytes by following these rules:

1. Serialise the `manifest` value as JSON.
2. **Sort object keys recursively**, by ascending UTF-16 code unit
   (`Object.keys(obj).sort()`). Arrays keep their written order.
3. Emit **no insignificant whitespace** — no spaces after `:` or `,`, no
   newlines, no indentation.
4. Strings use standard JSON escaping (`JSON.stringify`), numbers use the
   shortest JSON form, and non-finite numbers serialise as `null`.
5. Properties whose value is `undefined`, a function or a symbol are dropped
   from objects and serialise as `null` inside arrays (matching
   `JSON.stringify`).

Because keys are sorted recursively, reordering keys in the published
document never changes the payload and never invalidates a signature.

### Key separation rule

The **private signing key is held by the distribution operator and never ships
in the game**. Only the matching **public** key is pinned into the build; the
game can verify a catalogue but can never produce a signature. Keep the private
key out of the repository, out of the bundle and out of any build log. Rotating
the keypair means rebuilding and redeploying the game with the new pinned
public key.

### Worked example

The example below is complete and reproducible: the envelope, payload, public
key and signature are a matched set generated for this document. The private
key is a **throwaway example key — never use it for a real catalogue**.

The document you sign (key order is irrelevant; the canonical form sorts it):

```json
{
  "version": 1,
  "packs": [
    {
      "id": "acme-summer-pack",
      "gameId": "main-street",
      "title": "Acme Summer Pack",
      "description": "Three summer-themed businesses.",
      "version": "1.0.0",
      "coreEngineVersion": "^0.1.0",
      "cards": "cards.csv",
      "assets": ["assets/biz-acme-lemonade.png"]
    }
  ]
}
```

Its canonical payload is exactly this one line (note the sorted keys, no
whitespace and the array order preserved):

```text
{"packs":[{"assets":["assets/biz-acme-lemonade.png"],"cards":"cards.csv","coreEngineVersion":"^0.1.0","description":"Three summer-themed businesses.","gameId":"main-street","id":"acme-summer-pack","title":"Acme Summer Pack","version":"1.0.0"}],"version":1}
```

Pinned public key (raw 32-byte Ed25519, base64):

```text
MXDQ8f6eKg4+hwH1ra0GDjqz+H1mhh31LlWLF4crecM=
```

Signature of the canonical payload (raw 64-byte Ed25519, base64):

```text
rCjKMjVDk5wOy5YAS5GoOHc/H5I7XS3EYAX+Qd1+KzmYxyLwNUIbtQgyUibQ7W7rqqtTebKlOoJ3S5EaMgK1AA==
```

The file served as `<base>/packs/manifest.json` is therefore:

```json
{
  "manifest": {
    "version": 1,
    "packs": [
      {
        "id": "acme-summer-pack",
        "gameId": "main-street",
        "title": "Acme Summer Pack",
        "description": "Three summer-themed businesses.",
        "version": "1.0.0",
        "coreEngineVersion": "^0.1.0",
        "cards": "cards.csv",
        "assets": ["assets/biz-acme-lemonade.png"]
      }
    ]
  },
  "signature": "rCjKMjVDk5wOy5YAS5GoOHc/H5I7XS3EYAX+Qd1+KzmYxyLwNUIbtQgyUibQ7W7rqqtTebKlOoJ3S5EaMgK1AA=="
}
```

Reproduce it with Node 20+ (`node:crypto` and the canonicalisation rules above):

```js
const crypto = require('node:crypto');

// Same rules as canonicalPackManifestPayload: sorted keys, no whitespace.
function canonicalJson(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const parts = [];
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol') continue;
      parts.push(`${JSON.stringify(key)}:${canonicalJson(item)}`);
    }
    return `{${parts.join(',')}}`;
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return 'null';
}

const manifest = { /* the document above */ };
const payload = Buffer.from(canonicalJson(manifest), 'utf8');

// Example private key (PKCS#8 PEM). A real operator keeps this offline.
const privateKey = crypto.createPrivateKey(`-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIBrIReNlmtdYUwnbeqCXd2Ag/U5sK9xSDt8lRhpVkzFO
-----END PRIVATE KEY-----`);

const signature = crypto.sign(null, payload, privateKey).toString('base64');
console.log(signature);
// rCjKMjVDk5wOy5YAS5GoOHc/H5I7XS3EYAX+Qd1+KzmYxyLwNUIbtQgyUibQ7W7rqqtTebKlOoJ3S5EaMgK1AA==

// The raw 32-byte public key is the last 32 bytes of the SPKI DER encoding.
const rawPublicKey = crypto
  .createPublicKey(privateKey)
  .export({ type: 'spki', format: 'der' })
  .subarray(-32)
  .toString('base64');
console.log(rawPublicKey); // MXDQ8f6eKg4+hwH1ra0GDjqz+H1mhh31LlWLF4crecM=
```

After the signature verifies, the game also validates the enveloped document
with the core pack-manifest contract, so the fields documented in
[`packs/README.md`](../../packs/README.md) still apply. The catalogue
`version` must be `1`; any other version is rejected whole.

## 4. Verification outcomes

Verification is **total**: it never throws. Every outcome is one of these
discriminated statuses, and each maps to a distinct console warning so an
operator can tell a missing signature from an unreachable host.

| Status | Meaning | Operator action |
|--------|---------|-----------------|
| `ok` | The envelope is well formed and the signature verifies against the pinned key. | None — the catalogue is loaded (subject to the manifest contract and version checks below). |
| `missing-signature` | No signature at all, or a blank signature. | Sign the manifest and serve the signed envelope as `packs/manifest.json`. |
| `invalid-signature` | A signature is present but does not verify for the pinned key — a different keypair, a tampered body, or a signature that is not a base64 64-byte Ed25519 signature. | Re-sign with the key whose public half is pinned, and confirm the canonical payload rules. |
| `malformed-envelope` | The served document is not a well-formed signed envelope — empty, non-JSON, not a JSON object, `manifest` missing/not an object, or `signature` not a string. | Serve the envelope shape from §3 unchanged. |
| `unavailable` | Verification could not be attempted: WebCrypto Ed25519 is unavailable in the environment, or the pinned public key is not valid base64 / cannot be imported. | Check the pinned key is the raw 32-byte base64 Ed25519 public key. |

Two further rejections happen **after** a successful signature check, because a
valid signature does not make a document a valid catalogue:

| Rejection | Meaning | Operator action |
|-----------|---------|-----------------|
| Malformed manifest | The signed document does not pass the core pack-manifest contract (for example a missing field or duplicate pack id). | Fix the manifest so it matches the bundled shape, then re-sign. |
| Unsupported manifest version | The document declares a `version` other than `1`. | Serve `version: 1`; a build never interprets a document whose shape it does not know. |

A rejected catalogue logs exactly **one** warning and contributes **no** packs.
The signature verdict is memoised per boot, so one manifest fetch and one
verification happen per session, not one per pack file.

## 5. Degradation semantics

Remote discovery is **fetch and refuse only**. Every failure rejects that
source whole, logs a console warning, and leaves the rest of the game intact.

| Situation | Behaviour |
|-----------|-----------|
| Build not configured for remote packs | No remote source, no request, one warning. |
| Unreachable host, DNS failure, transport rejection | Source rejected, one warning; boot continues. |
| Slow or hung host | Each manifest/CSV read is bounded by a hard **≈3 s** timeout (3000 ms), enforced with an abort **and** a deadline race, so even a transport that ignores the abort cannot stall boot. One warning. |
| Non-2xx response or a failed body read | Source rejected, one warning. |
| Host not on the allow-list | Refused **before** any request, one warning. |
| Envelope not signed, badly signed or malformed | Source rejected with the matching status (§4), one warning. |
| Verified manifest is malformed or an unsupported version | Source rejected, one warning. |

The guarantees an operator can rely on:

- **Console warning only.** A remote failure is never shown in the UI, never
  blocks boot and never throws. The player sees no error dialog.
- **Bundled always wins.** Bundled packs (and base content) stay available and
  win any pack-id conflict, so a remote failure degrades to exactly the
  bundled game.
- **No UI change.** A successfully loaded remote pack appears in the same
  in-game **Card Packs** panel as a bundled pack; there is no separate remote
  section and no remote-specific badge.
- **No client-side caching.** Nothing is persisted between sessions and there is
  no service worker or retry. A remote pack requires its host at load time.
- **Bundled packs are the offline story.** Only the bundled packs work with no
  network connection.

## 6. Licence-clean requirement

Remote pack content must satisfy the **same licence requirements as bundled
packs**: all art must be project-generated (CC0) or otherwise
redistributable, licence-clean, and credited in the game's credits file. The
signature proves *who published* a catalogue; it says nothing about the rights
to the content, so the operator is responsible for the licence of every card
and asset hosted remotely.

## 7. Follow-ups (not available in this iteration)

The following are recorded as follow-ups and must **not** be treated as
available features:

- **Signing tooling.** There is no bundled signing CLI; operators sign with
  their own tooling (the Node example in §3) until the follow-up lands.
- **Client-side caching.** Remote packs are not cached between sessions, so
  they need their host at load time and add nothing to the offline story.
- **Runtime or launcher URL configuration.** The URL, key and catalogues are
  build-time only; there is no runtime, settings-screen or launcher override,
  and changing them requires a rebuild and redeploy.

## Related

- [`packs/README.md`](../../packs/README.md) — pack authoring, the bundled
  source and the on-host layout.
- [`DEPLOYMENT.md`](../../DEPLOYMENT.md) — the Pages release path and the
  build-time configuration summary.
- [card-packs runbook](card-packs-runbook.md) — authoring, building, installing,
  gating and verification of packs.
- Root [`README.md`](../../README.md) — repository overview.
