#!/usr/bin/env node
"use strict";

/* Writes the bundled samples to disk as one JSON file per sample, plus the
   DataIntegrityKey that matches the sample signatures. Useful for feeding the
   CLI, for fixtures, and for seeing exactly what each broken sample looks like. */

const fs = require("fs");
const path = require("path");

const { samples, validKey } = require("../src/samples");

const outDir = path.resolve(__dirname, "..", "samples");

fs.mkdirSync(outDir, { recursive: true });

let written = 0;
for (const [name, sample] of Object.entries(samples)) {
  const file = path.join(outDir, name + ".json");
  fs.writeFileSync(file, JSON.stringify(sample.credential, null, 2) + "\n");
  written++;
  console.log("wrote " + path.relative(process.cwd(), file));
}

const keyFile = path.join(outDir, "awarder-key.json");
fs.writeFileSync(keyFile, JSON.stringify(validKey, null, 2) + "\n");
written++;
console.log("wrote " + path.relative(process.cwd(), keyFile));

console.log("\n" + written + " files written to " + outDir);