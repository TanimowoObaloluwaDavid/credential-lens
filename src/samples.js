"use strict";

/* Wrapped in a factory so its declarations stay out of the shared global scope
   when this file is loaded as a classic script next to validate.js in a browser. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./validate"));
  else root.CredentialLensSamples = factory(root.CredentialLens);
})(typeof window !== "undefined" ? window : globalThis, function (VL) {
  const OB3_CONTEXT = VL.OB3_CONTEXT;

  const issuer = {
    id: "https://learn.example-academy.org",
    type: ["Profile", "Organization"],
    name: "Example Academy",
    image: { id: "https://learn.example-academy.org/logo.png", type: "ImageObject" },
    key: "https://learn.example-academy.org/keys/1.jsonld#key-1",
  };

  const subject = (did) => ({ id: did, type: "AchievementSubject" });

  const base = (over = {}) => ({
    "@context": [OB3_CONTEXT],
    type: ["VerifiableCredential", "OpenBadgeCredential"],
    ...over,
  });

  const validKey = {
    "@context": ["https://w3id.org/security/data-integrity/v2"],
    id: issuer.key,
    type: "DataIntegrityKey",
    controller: issuer.id,
    publicKeyMultibase: "z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
  };

  const realLookingProof = (over = {}) => ({
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-rdfc-2022",
    created: "2026-09-14T10:00:00Z",
    verificationMethod: issuer.key,
    proofPurpose: "assertionMethod",
    proofValue:
      "z3s2Mf8yQd7p1nK9rV4wX6aB0cD2eF5gH7jL8kN1mP3qR5tU9vY2xA4bC6dE8fG0hJ2kL4mN6pQ8rS0tU1vW3yZ5xA7bC9dE",
    ...over,
  });

  /* ------------------------------------------------------------------ samples */

  const wellFormed = base({
    id: "https://learn.example-academy.org/credentials/EX-2026-000481",
    awarder: issuer,
    credentialSubject: {
      ...subject("did:key:z6MkhpExampleLearnerKeyMaterial000000000000000000000"),
      achievement: {
        id: "https://learn.example-academy.org/achievements/python-basics",
        type: ["Achievement", "Course"],
        name: "Foundations of Python Programming",
        description: "Core syntax, data structures, control flow, functions and file handling.",
        criteria: {
          narrative:
            "Completed all 14 modules and passed the 40-question capstone assessment with a score of 84% or higher.",
        },
        alignment: [
          {
            type: "Alignment",
            targetName: "European Qualifications Framework",
            targetCode: "EQF",
            targetDescription: "Level 4 — intermediate level, first cycle descriptor",
            targetFramework: { type: "Concept", name: "European Qualifications Framework", uri: "https://www.eqf.europa.eu/" },
          },
        ],
      },
    },
    date: { type: "Date", id: "2026-09-14" },
    expirationDate: { type: "Date", id: "2029-09-14" },
    credentialStatus: {
      id: "https://learn.example-academy.org/status/1",
      type: "CredentialStatus",
      statusPurpose: "revocation",
    },
    proof: realLookingProof(),
  });

  const noProof = base({
    id: "https://learn.example-academy.org/credentials/EX-2026-000602",
    awarder: issuer,
    credentialSubject: {
      ...subject("did:key:z6MkhpExampleLearnerKeyMaterial000000000000000000000"),
      achievement: {
        type: ["Achievement"],
        name: "Introduction to Data Visualisation",
        criteria: { narrative: "Completed four assessed visualisation projects reviewed by the teaching team." },
      },
    },
    date: { type: "Date", id: "2026-07-02" },
  });

  const placeholderProof = base({
    id: "https://learn.example-academy.org/credentials/EX-2026-000733",
    awarder: issuer,
    credentialSubject: {
      ...subject("did:key:z6MkhpExampleLearnerKeyMaterial000000000000000000000"),
      achievement: {
        type: ["Achievement", "Course"],
        name: "SQL and Relational Databases",
        criteria: { narrative: "Designed a normalised six-table schema and passed the practical assessment." },
      },
    },
    date: { type: "Date", id: "2026-08-11" },
    expirationDate: { type: "Date", id: "2028-08-11" },
    proof: realLookingProof({ proofValue: "zDemoProofValueNotReal" }),
  });

  const expiredAndNoStatus = base({
    id: "https://learn.example-academy.org/credentials/EX-2024-000114",
    awarder: issuer,
    credentialSubject: {
      ...subject("did:key:z6MkhpExampleLearnerKeyMaterial000000000000000000000"),
      achievement: {
        type: ["Achievement"],
        name: "Legacy Cloud Fundamentals",
        criteria: {},
      },
    },
    date: { type: "Date", id: "2024-01-15" },
    expirationDate: { type: "Date", id: "2025-01-15" },
    proof: realLookingProof(),
  });

  const legacyV1 = {
    "@context": "https://openbadgespec.org/v1",
    type: "BadgeAssertion",
    id: "https://learn.example-academy.org/legacy/0009",
    recipient: { id: "did:key:z6MkhpExampleLearnerKeyMaterial000000000000000000000" },
    badge: {
      id: "https://learn.example-academy.org/badges/intro-design",
      name: "Introduction to Interface Design",
      description: "Layout, hierarchy, colour and type fundamentals.",
      criteria: "https://learn.example-academy.org/badges/intro-design/criteria",
    },
    issuer: { id: "https://learn.example-academy.org", name: "Example Academy" },
    issuedOn: "2025-05-04",
    verify: { type: "hosted", url: "https://learn.example-academy.org/verify/0009" },
  };

  const notADocument = {
    note: "This is just a note, not a credential.",
    course: "Python basics",
    passed: true,
  };

  const samples = {
    "well-formed": { label: "Well-formed Open Badges 3.0", expect: "valid", credential: wellFormed },
    "no-proof": { label: "Unsigned — no proof at all", expect: "error", credential: noProof },
    "placeholder-proof": { label: "Placeholder signature", expect: "error", credential: placeholderProof },
    "expired": { label: "Expired, no revocation status", expect: "error", credential: expiredAndNoStatus },
    "legacy-v1": { label: "Legacy Open Badges 1.x", expect: "error", credential: legacyV1 },
    "not-a-credential": { label: "Not a credential at all", expect: "error", credential: notADocument },
  };

  return { samples, validKey, realLookingProof, issuer, subject };
});