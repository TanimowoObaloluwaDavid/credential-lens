"use strict";

const OB3_CONTEXT = "https://w3id.org/vc/ob/vocab.html";
const OB1_CONTEXT = "https://openbadgespec.org/v1";

const PENALTY = { error: 12, warning: 5, info: 0 };

/** Highest score an invalid credential can reach, so bands stay honest. */
const INVALID_CEILING = 59;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const asArray = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

function hasType(node, wanted) {
  return asArray(node && node.type).some(
    (t) => typeof t === "string" && (t === wanted || t.endsWith("/" + wanted))
  );
}

/** Reads an OB/VC date, which may be a bare string or a { type: "Date", id } node. */
function readDate(node) {
  if (!node) return null;
  if (typeof node === "string") return node.trim() || null;
  if (isObj(node)) {
    for (const key of ["id", "value", "date"]) {
      if (typeof node[key] === "string" && node[key].trim()) return node[key].trim();
    }
  }
  return null;
}

function parseDay(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return !!new URL(value).protocol;
  } catch {
    return false;
  }
}

const PLACEHOLDER = /\b(demo|example|placeholder|changeme|change[-_]me|todo|xxxx+|dummy|fake|lorem|sample|insert|your|foo|bar|abc123|notreal|test123)\b|notreal|^z?[0]{6,}/i;

const DAY_MS = 86400000;

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Validates an Open Badges 3.0 / W3C Verifiable Credential.
 *
 * @param {unknown} input Parsed JSON credential.
 * @param {{ now?: Date }} [options] Injectable clock, so results are deterministic in tests.
 * @returns {{
 *   valid: boolean, score: number, band: string, findings: object[],
 *   counts: { error: number, warning: number, info: number },
 *   signatureVerified: false, credential: unknown, checkedAt: string
 * }}
 */
function validate(input, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const today = startOfDay(now);
  const findings = [];

  const add = (severity, code, message, hint, pointer) =>
    findings.push({ severity, code, message, hint: hint || "", pointer: pointer || "/" });

  if (!isObj(input)) {
    add("error", "root.not-object", "The credential is not a JSON object.", "Parse the file and check the top level is {}.", "/");
    return finish(input, findings, now, today);
  }

  const c = input;

  /* ---------------------------------------------------------------- context */
  const contexts = asArray(c["@context"]).filter((x) => typeof x === "string");
  if (contexts.length === 0) {
    add("error", "context.missing", "@context is missing.", `Set "@context" to "${OB3_CONTEXT}".`, "/@context");
  } else if (contexts.includes(OB1_CONTEXT)) {
    add(
      "error",
      "context.legacy",
      "This uses the Open Badges 1.x context, which is no longer current.",
      "Migrate to Open Badges 3.0: swap to the v3 vocab context, rename issuer to awarder, and move the achievement into credentialSubject.achievement.",
      "/@context"
    );
  } else if (!contexts.includes(OB3_CONTEXT)) {
    add(
      "warning",
      "context.unexpected",
      `@context does not include the Open Badges 3.0 vocabulary.`,
      `Add "${OB3_CONTEXT}" to @context alongside any other vocabularies you need.`,
      "/@context"
    );
  }

  /* ------------------------------------------------------------------ types */
  const types = asArray(c.type);
  if (types.length === 0) {
    add("error", "type.missing", "type is missing.", 'Set type to ["VerifiableCredential", "OpenBadgeCredential"].', "/type");
  } else {
    if (!hasType(c, "VerifiableCredential")) {
      add("error", "type.not-vc", "type does not include VerifiableCredential.", 'Add "VerifiableCredential" to type.', "/type");
    }
    if (!hasType(c, "OpenBadgeCredential")) {
      add(
        "warning",
        "type.not-badge",
        "type does not include OpenBadgeCredential.",
        'Add "OpenBadgeCredential" so badge consumers recognise it. Drop this only if you are issuing a general Verifiable Credential, not a badge.',
        "/type"
      );
    }
  }

  /* -------------------------------------------------------------------- id */
  if (c.id === undefined) {
    add("warning", "id.missing", "The credential has no id.", "Give it a stable URL so holders and verifiers can reference it unambiguously.", "/id");
  } else if (!isUrl(c.id)) {
    add("warning", "id.not-url", "id is not a URL.", "Use a resolvable URL, ideally under a domain you control.", "/id");
  }

  /* ---------------------------------------------------------------- issuer */
  const awarder = c.awarder || c.issuer;
  if (!awarder) {
    add("error", "awarder.missing", "Neither awarder nor issuer is present.", "Add awarder with at least id and name so the credential can be attributed.", "/awarder");
  } else if (!isObj(awarder)) {
    add("error", "awarder.not-object", "awarder is not an object.", "Expected { id, type, name }.", "/awarder");
  } else {
    if (!awarder.name || typeof awarder.name !== "string") {
      add("error", "awarder.name-missing", "awarder.name is missing.", "Name the issuing organisation.", "/awarder/name");
    }
    if (!awarder.id) {
      add("warning", "awarder.id-missing", "awarder.id is missing.", "Point at your organisation's profile URL so verifiers can look you up.", "/awarder/id");
    } else if (!isUrl(awarder.id)) {
      add("warning", "awarder.id-not-url", "awarder.id is not a URL.", "Use a resolvable URL.", "/awarder/id");
    }
    if (!hasType(awarder, "Organization")) {
      add("info", "awarder.type", "awarder.type does not include Organization.", 'Use ["Profile", "Organization"] for an organisation.', "/awarder/type");
    }
  }
  if (c.issuer && !c.awarder) {
    add(
      "info",
      "awarder.uses-issuer-alias",
      "Using the deprecated issuer field instead of awarder.",
      "Open Badges 3.0 renamed issuer to awarder. Both are accepted today; prefer awarder going forward.",
      "/issuer"
    );
  }

  /* --------------------------------------------------------------- subject */
  const subject = c.credentialSubject;
  if (subject === undefined) {
    add("error", "subject.missing", "credentialSubject is missing.", "A credential must state who it was issued to.", "/credentialSubject");
  } else if (!isObj(subject)) {
    add("error", "subject.not-object", "credentialSubject is not an object.", "Expected an object, or an array of objects for group credentials.", "/credentialSubject");
  } else {
    if (hasType(subject, "AchievementSubject") && !subject.achievement) {
      add("error", "subject.achievement-missing", "AchievementSubject has no achievement.", "Move the course and criteria into credentialSubject.achievement.", "/credentialSubject/achievement");
    }
    if (!subject.id) {
      add("warning", "subject.id-missing", "The holder has no id, so the credential cannot be tied to a person.", "Use a DID or a profile URL as credentialSubject.id.", "/credentialSubject/id");
    } else if (!isUrl(subject.id)) {
      add("info", "subject.id-not-url", "credentialSubject.id is not a URL or DID.", "A did:... or https:... identifier lets the holder prove ownership.", "/credentialSubject/id");
    }
  }

  /* ----------------------------------------------------------- achievement */
  const achievement = isObj(subject) ? subject.achievement : undefined;
  if (achievement !== undefined) {
    if (!isObj(achievement)) {
      add("error", "achievement.not-object", "credentialSubject.achievement is not an object.", "Expected an Achievement object.", "/credentialSubject/achievement");
    } else {
      if (!hasType(achievement, "Achievement")) {
        add("error", "achievement.type-missing", "achievement.type does not include Achievement.", 'Add "Achievement" to the type array.', "/credentialSubject/achievement/type");
      }
      if (!achievement.name || typeof achievement.name !== "string") {
        add("error", "achievement.name-missing", "achievement.name is missing.", "Name the course or achievement.", "/credentialSubject/achievement/name");
      }
      if (!achievement.description || typeof achievement.description !== "string") {
        add("info", "achievement.description-missing", "achievement.description is missing.", "A short description helps a verifier understand what was studied.", "/credentialSubject/achievement/description");
      }

      const criteria = achievement.criteria;
      if (criteria === undefined || criteria === null) {
        add(
          "warning",
          "criteria.missing",
          "achievement has no criteria, so there is no stated standard for earning it.",
          "Add criteria.narrative describing what the learner had to do, or criteria.id linking to a published standard.",
          "/credentialSubject/achievement/criteria"
        );
      } else if (!isObj(criteria)) {
        add("error", "criteria.not-object", "achievement.criteria is not an object.", "Expected { narrative } or { id }.", "/credentialSubject/achievement/criteria");
      } else {
        const narrative = criteria.narrative;
        const criteriaId = criteria.id;
        if ((!narrative || typeof narrative !== "string" || !narrative.trim()) && !criteriaId) {
          add(
            "error",
            "criteria.empty",
            "criteria has neither a narrative nor an id.",
            "State what the learner had to achieve, in criteria.narrative.",
            "/credentialSubject/achievement/criteria"
          );
        } else if (!narrative && !isUrl(criteriaId)) {
          add("warning", "criteria.id-not-url", "criteria.id is not a URL.", "Link to a page describing the standard.", "/credentialSubject/achievement/criteria/id");
        } else if (narrative && typeof narrative === "string" && narrative.trim().length < 20) {
          add(
            "warning",
            "criteria.thin",
            "The criteria narrative is very short.",
            "Verifiers need enough detail to judge the standard. Aim for a sentence or two.",
            "/credentialSubject/achievement/criteria/narrative"
          );
        }
      }

      const alignment = asArray(achievement.alignment);
      if (alignment.length === 0) {
        add(
          "info",
          "alignment.missing",
          "No framework alignment is declared.",
          "Mapping to a framework such as EQF or a national skills framework makes the credential legible across institutions and borders.",
          "/credentialSubject/achievement/alignment"
        );
      }
    }
  }

  /* ------------------------------------------------------------------ proof */
  const proof = c.proof;
  if (proof === undefined || proof === null) {
    add(
      "error",
      "proof.missing",
      "No proof is present, so this credential is an unsigned JSON document.",
      "Sign it with a DataIntegrityProof (or Ed25519Signature2020). Without a proof anyone can edit it and it proves nothing.",
      "/proof"
    );
  } else if (!isObj(proof)) {
    add("error", "proof.not-object", "proof is not an object.", "Expected a proof object.", "/proof");
  } else {
    if (!proof.type || typeof proof.type !== "string") {
      add("error", "proof.type-missing", "proof.type is missing.", 'Use "DataIntegrityProof" for Ed25519 or ECDSA suites.', "/proof/type");
    }
    if (!proof.cryptosuite && !/Ed25519Signature|BbsBlsSignature/i.test(proof.type || "")) {
      add(
        "warning",
        "proof.cryptosuite-missing",
        "proof.cryptosuite is missing.",
        "Name the suite, for example eddsa-rdfc-2022, so verifiers know which algorithm to use.",
        "/proof/cryptosuite"
      );
    }
    if (!proof.verificationMethod) {
      add("error", "proof.verificationMethod-missing", "proof.verificationMethod is missing.", "Point at the issuer's public key so verifiers can fetch it.", "/proof/verificationMethod");
    } else if (!isUrl(proof.verificationMethod)) {
      add("warning", "proof.verificationMethod-not-url", "proof.verificationMethod is not a URL.", "Use a resolvable URL for the key.", "/proof/verificationMethod");
    }
    if (!proof.proofPurpose) {
      add("warning", "proof.proofPurpose-missing", "proof.proofPurpose is missing.", 'Set it to "assertionMethod".', "/proof/proofPurpose");
    }
    const value = proof.proofValue;
    if (!value || typeof value !== "string" || !value.trim()) {
      add("error", "proof.proofValue-missing", "proof.proofValue is missing.", "This is the actual signature. Without it there is no proof.", "/proof/proofValue");
    } else {
      const v = value.trim();
      if (PLACEHOLDER.test(v)) {
        add(
          "error",
          "proof.placeholder",
          "proof.proofValue looks like placeholder text rather than a real signature.",
          "A placeholder signature is worse than no signature, because it looks valid. Sign the credential with a real key.",
          "/proof/proofValue"
        );
      } else if (!/^[A-Za-z0-9_\-]+[A-Za-z0-9_\-=]*$/.test(v)) {
        add(
          "warning",
          "proof.encoding",
          "proof.proofValue contains characters outside base64url.",
          "Most suites use base64url. If yours uses another encoding that is fine, but check it is not truncated or HTML-escaped.",
          "/proof/proofValue"
        );
      } else if (v.length < 40) {
        add("warning", "proof.short", "proof.proofValue is unusually short.", "Ed25519 signatures are around 86 base64url characters. This may be truncated.", "/proof/proofValue");
      }
    }
  }

  /* ---------------------------------------------------------------- status */
  const statuses = asArray(c.credentialStatus);
  if (statuses.length === 0) {
    add(
      "warning",
      "status.missing",
      "No credentialStatus, so the credential cannot be revoked.",
      "Publish a status list endpoint and reference it. Without revocation a permanent badge outlives the course.",
      "/credentialStatus"
    );
  } else {
    const hasRevocation = statuses.some((s) => isObj(s) && s.statusPurpose === "revocation");
    if (!hasRevocation) {
      add(
        "warning",
        "status.no-revocation",
        "credentialStatus is present but has no entry with statusPurpose revocation.",
        "Add one so an issuer can withdraw a credential that was issued in error.",
        "/credentialStatus"
      );
    }
    for (const s of statuses) {
      if (isObj(s) && s.id && !isUrl(s.id)) {
        add("warning", "status.id-not-url", "A credentialStatus id is not a URL.", "Status entries are resolved over HTTP, so this must be a URL.", "/credentialStatus/id");
      }
    }
  }

  /* -------------------------------------------------------------- lifecycle */
  const issuedRaw = readDate(c.validFrom) || readDate(c.date);
  const expiresRaw = readDate(c.expirationDate) || readDate(c.validUntil);
  const issued = parseDay(issuedRaw);
  const expires = parseDay(expiresRaw);

  if (!issuedRaw) {
    add("error", "date.missing", "No issue date is present.", "Add date (or validFrom) as { type: \"Date\", id: \"YYYY-MM-DD\" }.", "/date");
  } else if (!issued) {
    add("error", "date.unparseable", "The issue date could not be parsed.", "Use an ISO 8601 date such as 2026-09-14.", "/date");
  } else if (issued > today) {
    add(
      "warning",
      "date.future",
      "The issue date is in the future.",
      "A credential dated ahead of today reads as broken or fabricated.",
      "/date"
    );
  }

  if (!expiresRaw) {
    add(
      "warning",
      "expiry.missing",
      "The credential never expires.",
      "An expiry lets you retire superseded or outdated credentials. Some frameworks require one.",
      "/expirationDate"
    );
  } else if (!expires) {
    add("error", "expiry.unparseable", "The expiry date could not be parsed.", "Use an ISO 8601 date.", "/expirationDate");
  } else if (issued && expires < issued) {
    add("error", "expiry.before-issue", "The expiry date is before the issue date.", "Fix the dates.", "/expirationDate");
  } else if (expires < today) {
    add(
      "error",
      "expiry.past",
      "This credential expired on " + expiresRaw + ".",
      "Expired credentials should not be presented as current. Re-issue if the holder still qualifies.",
      "/expirationDate"
    );
  } else if (issued && expires.getTime() - issued.getTime() > 3650 * DAY_MS) {
    add(
      "info",
      "expiry.long",
      "This credential is valid for more than ten years.",
      "Very long validity is hard to defend as skills decay. Prefer a shorter window with an explicit renewal path.",
      "/expirationDate"
    );
  }

  /* ------------------------------------------------------------------ done */
  return finish(c, findings, now, today);
}

function finish(credential, findings, now, today) {
  const counts = { error: 0, warning: 0, info: 0 };
  let score = 100;
  for (const f of findings) {
    counts[f.severity] += 1;
    score -= PENALTY[f.severity] || 0;
  }
  score = Math.max(0, Math.min(100, score));

  // A credential with any error is not "acceptable" in any meaningful sense, so
  // cap it below the acceptable band. Errors are structural, not cosmetic.
  if (counts.error > 0 && score > INVALID_CEILING) score = INVALID_CEILING;

  let band = "poor";
  if (score >= 90) band = "strong";
  else if (score >= 70) band = "acceptable";
  else if (score >= 40) band = "weak";

  return {
    valid: counts.error === 0,
    score,
    band,
    findings,
    counts,
    signatureVerified: false,
    credential,
    checkedAt: today.toISOString().slice(0, 10),
  };
}

/** Parses JSON without throwing, returning a structured result. */
function parse(input) {
  try {
    return { ok: true, value: JSON.parse(input) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

const API = {
  validate,
  parse,
  readDate,
  hasType,
  isUrl,
  OB3_CONTEXT,
  OB1_CONTEXT,
  PENALTY,
  INVALID_CEILING,
};

/* CommonJS for the CLI. In a browser this file is loaded as a classic script and
   publishes the same API on window, so web/ can use it without a build step. */
if (typeof module === "object" && module.exports) module.exports = API;
if (typeof window !== "undefined") window.CredentialLens = API;