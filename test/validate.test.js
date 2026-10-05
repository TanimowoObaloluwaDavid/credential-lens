"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { validate, parse, readDate, hasType, isUrl, OB3_CONTEXT } = require("../src/validate");
const { samples } = require("../src/samples");
const { bar, sortFindings } = require("../src/format");

const NOW = new Date("2026-10-05T12:00:00Z");

const codes = (r) => r.findings.map((f) => f.code);
const has = (r, code) => codes(r).includes(code);

/** Minimal valid credential, overridable per test. */
function make(over = {}) {
  return {
    "@context": [OB3_CONTEXT],
    type: ["VerifiableCredential", "OpenBadgeCredential"],
    id: "https://example.org/credentials/1",
    awarder: { id: "https://example.org", type: ["Profile", "Organization"], name: "Example Org" },
    credentialSubject: {
      id: "did:key:z6MkExample",
      type: "AchievementSubject",
      achievement: {
        type: ["Achievement", "Course"],
        name: "Test Course",
        criteria: { narrative: "Completed all modules and passed the final assessment." },
      },
    },
    date: { type: "Date", id: "2026-01-01" },
    expirationDate: { type: "Date", id: "2029-01-01" },
    credentialStatus: { id: "https://example.org/status/1", type: "CredentialStatus", statusPurpose: "revocation" },
    proof: {
      type: "DataIntegrityProof",
      cryptosuite: "eddsa-rdfc-2022",
      created: "2026-01-01T00:00:00Z",
      verificationMethod: "https://example.org/keys/1#k",
      proofPurpose: "assertionMethod",
      proofValue: "z" + "A1b2C3d4".repeat(10) + "9",
    },
    ...over,
  };
}

/* -------------------------------------------------------------- primitives */

test("readDate handles strings and Date nodes", () => {
  assert.strictEqual(readDate("2026-01-01"), "2026-01-01");
  assert.strictEqual(readDate({ type: "Date", id: "2026-02-03" }), "2026-02-03");
  assert.strictEqual(readDate({ value: "2026-03-04" }), "2026-03-04");
  assert.strictEqual(readDate(undefined), null);
  assert.strictEqual(readDate({}), null);
});

test("hasType tolerates compact IRIs", () => {
  assert.ok(hasType({ type: ["https://w3id.org/vc/ob/Achievement"] }, "Achievement"));
  assert.ok(hasType({ type: "Achievement" }, "Achievement"));
  assert.ok(!hasType({ type: ["Course"] }, "Achievement"));
  assert.ok(!hasType(undefined, "Achievement"));
});

test("isUrl rejects non-URLs", () => {
  assert.ok(isUrl("https://example.org"));
  assert.ok(isUrl("did:key:z6Mk"));
  assert.ok(!isUrl("example.org"));
  assert.ok(!isUrl(""));
  assert.ok(!isUrl(42));
});

test("parse reports JSON errors without throwing", () => {
  assert.deepStrictEqual(parse('{"a":1}'), { ok: true, value: { a: 1 } });
  const bad = parse("{oops}");
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.error.length > 0);
});

/* ------------------------------------------------------------ happy path */

test("a well-formed credential is valid and scores high", () => {
  const r = validate(make(), { now: NOW });
  assert.strictEqual(r.valid, true, "errors: " + JSON.stringify(codes(r)));
  assert.strictEqual(r.counts.error, 0);
  assert.ok(r.score >= 90, "score was " + r.score);
  assert.strictEqual(r.band, "strong");
});

test("signatureVerified is always false and never implied as true", () => {
  const r = validate(make(), { now: NOW });
  assert.strictEqual(r.signatureVerified, false);
});

test("alignment is optional and only informational", () => {
  const r = validate(make(), { now: NOW });
  const info = r.findings.filter((f) => f.severity === "info").map((f) => f.code);
  assert.ok(info.includes("alignment.missing"));
  assert.strictEqual(r.valid, true);
});

/* ----------------------------------------------------------------- errors */

test("non-object input is reported, not thrown", () => {
  for (const input of [null, 42, "string", [], undefined]) {
    const r = validate(input, { now: NOW });
    assert.strictEqual(r.valid, false);
    assert.ok(has(r, "root.not-object"));
  }
});

test("missing proof is an error", () => {
  const cred = make();
  delete cred.proof;
  const r = validate(cred, { now: NOW });
  assert.ok(has(r, "proof.missing"));
  assert.strictEqual(r.valid, false);
});

test("placeholder signature is an error, not merely a warning", () => {
  const cred = make();
  cred.proof.proofValue = "zDemoProofValueNotReal";
  const r = validate(cred, { now: NOW });
  assert.ok(has(r, "proof.placeholder"));
  assert.strictEqual(r.valid, false);
});

test("expiry in the past is an error", () => {
  const cred = make();
  cred.date = { type: "Date", id: "2024-01-01" };
  cred.expirationDate = { type: "Date", id: "2025-01-01" };
  const r = validate(cred, { now: NOW });
  assert.ok(has(r, "expiry.past"), "expected expiry.past, got " + JSON.stringify(codes(r)));
  assert.strictEqual(r.valid, false);
});

test("expiry before issue date is an error", () => {
  const cred = make();
  cred.date = { type: "Date", id: "2026-06-01" };
  cred.expirationDate = { type: "Date", id: "2026-01-01" };
  const r = validate(cred, { now: NOW });
  assert.ok(has(r, "expiry.before-issue"));
});

test("legacy Open Badges 1.x is flagged with migration guidance", () => {
  const r = validate(samples["legacy-v1"].credential, { now: NOW });
  assert.ok(has(r, "context.legacy"));
  assert.strictEqual(r.valid, false);
});

test("a plain object that is not a credential fails on required fields", () => {
  const r = validate(samples["not-a-credential"].credential, { now: NOW });
  assert.strictEqual(r.valid, false);
  assert.ok(has(r, "context.missing"));
  assert.ok(has(r, "subject.missing"));
});

/* --------------------------------------------------------------- warnings */

test("missing expiry warns but does not invalidate", () => {
  const cred = make();
  delete cred.expirationDate;
  const r = validate(cred, { now: NOW });
  assert.ok(has(r, "expiry.missing"));
  assert.strictEqual(r.valid, true);
});

test("missing revocation status warns", () => {
  const cred = make();
  delete cred.credentialStatus;
  const r = validate(cred, { now: NOW });
  assert.ok(has(r, "status.missing"));
  assert.strictEqual(r.valid, true);
});

test("empty criteria is an error, thin criteria is a warning", () => {
  const empty = make();
  empty.credentialSubject.achievement.criteria = {};
  assert.ok(has(validate(empty, { now: NOW }), "criteria.empty"));

  const thin = make();
  thin.credentialSubject.achievement.criteria = { narrative: "Done." };
  const r = validate(thin, { now: NOW });
  assert.ok(has(r, "criteria.thin"));
  assert.strictEqual(r.valid, true);
});

test("future issue date warns", () => {
  const cred = make();
  cred.date = { type: "Date", id: "2027-01-01" };
  const r = validate(cred, { now: NOW });
  assert.ok(has(r, "date.future"));
  assert.strictEqual(r.valid, true);
});

test("validFrom is accepted as an alias for date", () => {
  const cred = make();
  cred.validFrom = { type: "Date", id: "2026-01-01" };
  delete cred.date;
  const r = validate(cred, { now: NOW });
  assert.ok(!has(r, "date.missing"), "validFrom should satisfy the issue date check");
  assert.strictEqual(r.valid, true);
});

test("issuer is accepted as a deprecated alias for awarder", () => {
  const cred = make();
  cred.issuer = cred.awarder;
  delete cred.awarder;
  const r = validate(cred, { now: NOW });
  assert.ok(!has(r, "awarder.missing"));
  assert.ok(has(r, "awarder.uses-issuer-alias"));
  assert.strictEqual(r.valid, true);
});

/* ---------------------------------------------------------------- scoring */

test("score is bounded to 0..100 and band tracks it", () => {
  assert.strictEqual(bar(100).length, 24);
  assert.strictEqual(bar(0).length, 24);
  assert.strictEqual(bar(150).length, 24);
  assert.ok(!/[^\#.]/.test(bar(63)), "bar should only contain # and .");

  const worst = validate({}, { now: NOW });
  assert.ok(worst.score >= 0);
  assert.strictEqual(worst.band, "poor");

  const best = validate(make(), { now: NOW });
  assert.ok(best.score <= 100);
});

test("more problems always means a lower score", () => {
  const good = validate(make(), { now: NOW });
  const bad = validate(make({ credentialStatus: undefined }), { now: NOW });
  assert.ok(bad.score < good.score, `${bad.score} !< ${good.score}`);
});

test("counts match the findings array", () => {
  const r = validate(samples.expired.credential, { now: NOW });
  assert.strictEqual(r.counts.error + r.counts.warning + r.counts.info, r.findings.length);
  assert.strictEqual(r.counts.error, r.findings.filter((f) => f.severity === "error").length);
});

test("every finding has a code, message and pointer", () => {
  const r = validate(samples["placeholder-proof"].credential, { now: NOW });
  for (const f of r.findings) {
    assert.ok(f.code && typeof f.code === "string");
    assert.ok(f.message && typeof f.message === "string");
    assert.ok(f.pointer && f.pointer.startsWith("/"));
    assert.ok(["error", "warning", "info"].includes(f.severity));
  }
});

/* ---------------------------------------------------------------- samples */

test("every bundled sample behaves as advertised", () => {
  for (const [name, s] of Object.entries(samples)) {
    const r = validate(s.credential, { now: new Date("2026-10-05T12:00:00Z") });
    if (s.expect === "valid") {
      assert.strictEqual(r.valid, true, `${name} should be valid, got ${JSON.stringify(codes(r))}`);
    } else {
      assert.strictEqual(r.valid, false, `${name} should be invalid`);
    }
  }
});

test("an invalid credential can never reach the acceptable band", () => {
  const unsigned = validate(make({ proof: undefined }), { now: NOW });
  assert.strictEqual(unsigned.valid, false);
  assert.ok(unsigned.score <= 59, "capped score was " + unsigned.score);
  assert.ok(["weak", "poor"].includes(unsigned.band), "band was " + unsigned.band);

  const expired = validate(samples.expired.credential, { now: NOW });
  assert.strictEqual(expired.valid, false);
  assert.ok(!["strong", "acceptable"].includes(expired.band));
});

test("a valid credential can still reach the top bands", () => {
  const r = validate(make(), { now: NOW });
  assert.strictEqual(r.band, "strong");
  assert.ok(r.score > 59);
});

test("the well-formed sample scores in the strong band", () => {
  const r = validate(samples["well-formed"].credential, { now: NOW });
  assert.strictEqual(r.band, "strong");
  assert.ok(r.score >= 90, "score " + r.score);
});

/* ----------------------------------------------------------------- format */

test("sortFindings orders errors first, then warnings, then info", () => {
  const sorted = sortFindings([
    { severity: "info", code: "c", pointer: "/a" },
    { severity: "error", code: "a", pointer: "/z" },
    { severity: "warning", code: "b", pointer: "/m" },
  ]);
  assert.deepStrictEqual(sorted.map((f) => f.severity), ["error", "warning", "info"]);
});