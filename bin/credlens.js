#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { validate, parse } = require("../src/validate");
const { formatReport } = require("../src/format");
const { samples } = require("../src/samples");

const EXIT_VALID = 0;
const EXIT_WARNINGS = 1;
const EXIT_INVALID = 2;
const EXIT_USAGE = 64;

const args = process.argv.slice(2);

function usage() {
  return `credlens - inspect and validate Open Badges 3.0 / W3C credentials

Usage
  credlens validate <file.json>     Validate a credential file
  credlens validate -               Read the credential from stdin
  credlens demo [sample]           Validate the bundled sample credentials
  credlens list                     List available sample names

Options
  --json            Print the machine-readable result
  --brief           Only print the score and counts
  --no-color        Disable ANSI colour
  --all             With demo, validate every sample

Exit codes
  0  valid, no warnings
  1  valid, but warnings were found
  2  invalid, at least one error
  64 bad usage

Notes
  This tool checks structure, required fields and proof presence. It does not
  verify signatures cryptographically, because that requires the issuer's
  public key. Treat a passing score as "well formed", not as "genuine".
`;
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function loadCredential(file) {
  if (file === "-") return { text: readStdin(), label: "stdin" };
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) {
    return { error: `No such file: ${resolved}`, code: EXIT_USAGE };
  }
  let text;
  try {
    text = fs.readFileSync(resolved, "utf8");
  } catch (err) {
    return { error: `Could not read ${resolved}: ${err.message}`, code: EXIT_USAGE };
  }
  return { text, label: resolved };
}

function exitCodeFor(result) {
  if (!result.valid) return EXIT_INVALID;
  if (result.counts.warning > 0) return EXIT_WARNINGS;
  return EXIT_VALID;
}

function main() {
  const flags = {
    json: args.includes("--json"),
    brief: args.includes("--brief"),
    color: !args.includes("--no-color") && process.stdout.isTTY !== false,
  };
  const positional = args.filter((a) => !a.startsWith("--"));

  const wantsHelp = args.includes("--help") || args.includes("-h");

  if (wantsHelp) {
    process.stdout.write(usage());
    return process.exit(EXIT_VALID);
  }

  if (positional.length === 0) {
    process.stdout.write(usage());
    return process.exit(EXIT_USAGE);
  }

  const command = positional[0];

  if (command === "list") {
    for (const [name, s] of Object.entries(samples)) {
      process.stdout.write(`  ${name.padEnd(20)} ${s.label}\n`);
    }
    return process.exit(EXIT_VALID);
  }

  if (command === "demo") {
    const names = args.includes("--all")
      ? Object.keys(samples)
      : positional.slice(1).length
        ? positional.slice(1)
        : Object.keys(samples);
    const unknown = names.filter((n) => !samples[n]);
    if (unknown.length) {
      process.stderr.write(`Unknown sample(s): ${unknown.join(", ")}\n`);
      return process.exit(EXIT_USAGE);
    }

    const results = {};
    let worst = EXIT_VALID;
    for (const name of names) {
      const result = validate(samples[name].credential);
      results[name] = result;
      const code = exitCodeFor(result);
      if (code !== EXIT_VALID) worst = EXIT_INVALID;
      if (flags.json) continue;
      process.stdout.write(formatReport(result, { color: flags.color }));
      process.stdout.write(`  sample: ${name} (${samples[name].label})\n\n`);
    }
    if (flags.json) process.stdout.write(JSON.stringify(results, null, 2) + "\n");
    return process.exit(worst);
  }

  if (command !== "validate") {
    process.stderr.write(`Unknown command: ${command}\n\n${usage()}`);
    return process.exit(EXIT_USAGE);
  }

  const file = positional[1];
  if (!file) {
    process.stderr.write("validate needs a file path, or - for stdin.\n");
    return process.exit(EXIT_USAGE);
  }

  const loaded = loadCredential(file);
  if (loaded.error) {
    process.stderr.write(loaded.error + "\n");
    return process.exit(loaded.code);
  }

  const parsed = parse(loaded.text);
  if (!parsed.ok) {
    if (flags.json) {
      process.stdout.write(JSON.stringify({ valid: false, parseError: parsed.error }, null, 2) + "\n");
    } else {
      process.stderr.write(`  x parse    ${loaded.label} is not valid JSON\n           ${parsed.error}\n`);
    }
    return process.exit(EXIT_INVALID);
  }

  const result = validate(parsed.value);

  if (flags.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else if (flags.brief) {
    process.stdout.write(
      `${result.valid ? "valid" : "invalid"} ${result.score}/100 ${result.band} ` +
        `${result.counts.error}e ${result.counts.warning}w ${result.counts.info}i\n`
    );
  } else {
    process.stdout.write(formatReport(result, { color: flags.color }));
  }

  return process.exit(exitCodeFor(result));
}

main();