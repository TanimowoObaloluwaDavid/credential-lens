"use strict";

/* End-to-end CLI tests: spawn bin/credlens.js and assert on output and exit code. */

const test = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CLI = path.resolve(__dirname, "..", "bin", "credlens.js");
const { samples } = require("../src/samples");

function run(args, opts = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    input: opts.input,
    cwd: path.resolve(__dirname, ".."),
  });
}

function withSampleFile(name, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "credlens-cli-"));
  const file = path.join(dir, name + ".json");
  fs.writeFileSync(file, JSON.stringify(samples[name].credential, null, 2));
  try {
    return fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ usage */

test("no arguments prints usage and exits 64", () => {
  const r = run([]);
  assert.strictEqual(r.status, 64);
  assert.match(r.stdout, /Usage/);
});

test("--help prints usage and exits 0", () => {
  for (const flag of ["--help", "-h"]) {
    const r = run([flag]);
    assert.strictEqual(r.status, 0, flag + " should exit 0");
    assert.match(r.stdout, /credlens - inspect and validate/);
  }
});

test("an unknown command exits 64", () => {
  const r = run(["frobnicate"]);
  assert.strictEqual(r.status, 64);
  assert.match(r.stderr, /Unknown command: frobnicate/);
});

test("a missing file exits 64 and names the path", () => {
  const r = run(["validate", "definitely-not-here.json"]);
  assert.strictEqual(r.status, 64);
  assert.match(r.stderr, /No such file/);
});

test("an unknown demo sample exits 64", () => {
  const r = run(["demo", "no-such-sample"]);
  assert.strictEqual(r.status, 64);
  assert.match(r.stderr, /Unknown sample/);
});

/* ------------------------------------------------------------------ exit codes */

test("the well-formed sample exits 0", () => {
  const r = run(["demo", "well-formed"]);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /VALID/);
  assert.match(r.stdout, /100\/100/);
});

test("invalid samples exit 2", () => {
  for (const name of ["no-proof", "placeholder-proof", "expired", "legacy-v1", "not-a-credential"]) {
    const r = run(["demo", name]);
    assert.strictEqual(r.status, 2, name + " should exit 2");
    assert.match(r.stdout, /INVALID/);
  }
});

test("demo over all samples exits 2 because some are invalid", () => {
  assert.strictEqual(run(["demo"]).status, 2);
  assert.strictEqual(run(["demo", "--all"]).status, 2);
});

test("list exits 0 and names every sample", () => {
  const r = run(["list"]);
  assert.strictEqual(r.status, 0);
  for (const name of Object.keys(samples)) {
    assert.ok(r.stdout.includes(name), "missing sample " + name);
  }
});

/* ---------------------------------------------------------------------- io */

test("stdin is validated with -", () => {
  const r = run(["validate", "-", "--brief"], {
    input: JSON.stringify(samples["well-formed"].credential),
  });
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /^valid 100\/100 strong/m);
});

test("unparseable stdin exits 2 and explains itself", () => {
  const r = run(["validate", "-"], { input: "{ nope" });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /not valid JSON/);
});

test("a credential file on disk is validated", () => {
  withSampleFile("expired", (file) => {
    const r = run(["validate", file, "--brief"]);
    assert.strictEqual(r.status, 2);
    assert.match(r.stdout, /invalid \d+\/100 weak/);
  });
});

/* -------------------------------------------------------------------- json */

test("--json emits a parseable result object", () => {
  withSampleFile("no-proof", (file) => {
    const r = run(["validate", file, "--json"]);
    assert.strictEqual(r.status, 2);
    const parsed = JSON.parse(r.stdout);
    assert.strictEqual(parsed.valid, false);
    assert.strictEqual(parsed.signatureVerified, false);
    assert.strictEqual(typeof parsed.score, "number");
    assert.ok(Array.isArray(parsed.findings));
    assert.ok(parsed.findings.length > 0);
    assert.strictEqual(
      parsed.findings.reduce((n, f) => n + (f.severity === "error" ? 1 : 0), 0),
      parsed.counts.error
    );
  });
});

test("--json reports a parse error instead of throwing", () => {
  const r = run(["validate", "-", "--json"], { input: "{ nope" });
  assert.strictEqual(r.status, 2);
  const parsed = JSON.parse(r.stdout);
  assert.strictEqual(parsed.valid, false);
  assert.ok(parsed.parseError.length > 0);
});

test("demo --json emits an object keyed by sample name", () => {
  const r = run(["demo", "--all", "--json"]);
  const parsed = JSON.parse(r.stdout);
  assert.deepStrictEqual(Object.keys(parsed).sort(), Object.keys(samples).sort());
});

/* -------------------------------------------------------------------- text */

test("--no-color strips ANSI escapes", () => {
  const r = run(["demo", "well-formed", "--no-color"]);
  // eslint-disable-next-line no-control-regex
  assert.ok(!/\u001b\[/.test(r.stdout), "output should contain no ANSI codes");
});

test("errors go to stderr, reports go to stdout", () => {
  const bad = run(["validate", "-"], { input: "{ nope" });
  assert.strictEqual(bad.stdout, "");
  assert.ok(bad.stderr.length > 0);

  const good = run(["demo", "well-formed"]);
  assert.ok(good.stdout.length > 0);
  assert.strictEqual(good.stderr, "");
});