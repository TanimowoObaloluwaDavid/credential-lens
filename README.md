# credential-lens

Inspect and validate **Open Badges 3.0** and **W3C Verifiable Credentials**.

Most people issuing credentials get the cryptography right and the document wrong:
a fake signature value shipped to production, a legacy 1.x badge that no verifier
recognises, an award that never expires and cannot be revoked. credential-lens
finds those problems before they reach a learner.

- **Zero dependencies.** No install step, no lockfile, no supply chain.
- **Works offline.** The web UI is static files and runs from `file://`.
- **Same engine everywhere.** The CLI and the browser load the same `src/validate.js`.
- **Honest about its limits.** It never claims to have verified a signature.

## Install

```bash
npm install -g credential-lens
```

Or run it without installing:

```bash
npx credential-lens validate badge.json
```

## CLI

```bash
credlens validate badge.json          # human-readable report
credlens validate badge.json --json   # machine-readable, for CI
credlens validate -                   # read from stdin
credlens demo                         # validate every bundled sample
credlens demo no-proof                # one sample
credlens list                         # sample names
```

### Exit codes

| Code | Meaning |
| ---- | ------- |
| `0`  | valid, no warnings |
| `1`  | valid, but warnings were found |
| `2`  | invalid, or the JSON did not parse |
| `64` | bad usage |

A credential with warnings is still structurally sound, so warnings do not
break the build. Anything that makes the document structurally wrong does.

### In a pipeline

```yaml
- name: Validate the issued credential
  run: credlens validate ./build/latest.json --json > result.json

- name: Fail on anything invalid
  run: credlens validate ./build/latest.json --no-color
```

## Web UI

```bash
npm run samples     # optional: writes samples/ for the file picker
```

Then open `web/index.html` directly, or serve the folder. Nothing is uploaded —
validation happens in the page.

If you serve the repo root with any static server, the page is at `/web/`.

## What it checks

| Area | Checks |
| ---- | ------ |
| Structure | `@context`, `type`, `id`, `awarder`, `credentialSubject`, `achievement`, `criteria` |
| Proof | `proof.type`, `cryptosuite`, `verificationMethod`, `proofPurpose`, `proofValue` |
| Placeholder signatures | catches `zDemoProofValue`, `changeme`, `xxxx`, `000000` and similar |
| Lifecycle | issue and expiry dates, expiry before issue, already-expired credentials |
| Revocation | presence of a `credentialStatus` with `statusPurpose: revocation` |
| Legacy | flags Open Badges 1.x and explains the 3.0 migration |
| Substance | criteria narrative quality, framework alignment |
| Hygiene | identifiers that are not resolvable URLs |

Every finding carries a JSON Pointer (`/proof/proofValue`), a plain-English
message, and a concrete fix.

## Scoring

Start at 100. Each finding deducts:

| Severity | Penalty |
| -------- | ------- |
| error    | −12 |
| warning  | −5  |
| info     | 0   |

A credential with **any** error is capped at 59, so an invalid credential can
never be described as "acceptable" or "strong".

| Band | Range |
| ---- | ----- |
| strong     | 90–100 |
| acceptable | 70–89  |
| weak       | 40–69  |
| poor       | 0–39   |

The score is a triage aid, not a grade. A credential can score 100 and still be
worthless, because structure says nothing about whether the achievement was real.

## What it does not do

It does **not** verify signatures.

`signatureVerified` is hardcoded to `false` in the output and will stay that way
until you supply an issuer key to check against. Structural validity and
authenticity are different questions, and conflating them is how fake
credentials pass as real ones.

It also does not dereference URLs, fetch status lists, or resolve DIDs. Every
check is local and offline by design.

## Samples

Six fixtures ship with the tool, and each is asserted against in the test suite:

| Name | Expects |
| ---- | ------- |
| `well-formed` | valid |
| `no-proof` | unsigned, treated as invalid |
| `placeholder-proof` | fake signature, treated as invalid |
| `expired` | lapsed, and no revocation status |
| `legacy-v1` | Open Badges 1.x, migration flagged |
| `not-a-credential` | a plain object that is not a credential |

```bash
npm run samples        # write them to samples/*.json
credlens demo          # run them all
```

## Use as a library

```js
const { validate } = require("credential-lens");

const result = validate(credential, { now: new Date("2026-10-05") });

console.log(result.valid);            // false
console.log(result.score);            // 59
console.log(result.findings[0].code); // "proof.missing"
```

`options.now` exists so results are deterministic in tests. In the browser the
same module publishes `window.CredentialLens`.

## Development

```bash
npm test         # 46 tests: node:test unit + end-to-end CLI
npm run test:web # 44 checks in real headless Chrome over the DevTools Protocol
npm run test:all
```

No test framework is installed. The browser test uses Node's built-in
`WebSocket` to drive Chrome directly.

## Standards

- Open Badges 3.0 — <https://www.imsglobal.org/spec/ob/v3p0/>
- Verifiable Credentials Data Model 2.0 — <https://www.w3.org/TR/vc-data-model-2.0/>
- Data Integrity Proofs — <https://www.w3.org/TR/vc-di-eddsa/>

## Licence

MIT. See [LICENSE](LICENSE).