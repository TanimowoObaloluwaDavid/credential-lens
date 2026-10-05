"use strict";

const SEV_ORDER = { error: 0, warning: 1, info: 2 };

const GLYPH = { error: "x", warning: "!", info: "i" };

const SEV_COLOR = { error: "\x1b[31m", warning: "\x1b[33m", info: "\x1b[36m" };
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

function paint(enabled, code, text) {
  return enabled ? code + text + RESET : text;
}

function bar(score, width = 24) {
  const filled = Math.max(0, Math.min(width, Math.round((score / 100) * width)));
  return "#".repeat(filled) + ".".repeat(width - filled);
}

function sortFindings(findings) {
  return [...findings].sort((a, b) => {
    const s = SEV_ORDER[a.severity] - SEV_ORDER[b.severity];
    return s !== 0 ? s : a.pointer.localeCompare(b.pointer);
  });
}

/** Human-readable terminal report. */
function formatReport(result, options = {}) {
  const color = options.color !== false;
  const out = [];

  const heading = `${result.valid ? "VALID" : "INVALID"}  ${result.score}/100  ${result.band}`;
  out.push("");
  out.push(paint(color, BOLD, heading));
  out.push("  " + bar(result.score));
  out.push(
    "  " +
      paint(color, result.counts.error ? SEV_COLOR.error : DIM, `${result.counts.error} error`) +
      paint(color, DIM, "  ·  ") +
      paint(color, result.counts.warning ? SEV_COLOR.warning : DIM, `${result.counts.warning} warning`) +
      paint(color, DIM, "  ·  ") +
      paint(color, SEV_COLOR.info, `${result.counts.info} info`)
  );
  out.push("");

  if (result.findings.length === 0) {
    out.push(paint(color, GREEN, "  No findings. This credential is well formed."));
  } else {
    for (const f of sortFindings(result.findings)) {
      const tag = paint(color, SEV_COLOR[f.severity] || "", ` ${GLYPH[f.severity]} ${f.severity.toUpperCase().padEnd(7)}`);
      out.push(tag + " " + f.message);
      out.push("     " + paint(color, DIM, f.pointer));
      if (f.hint) out.push("     " + paint(color, DIM, "-> " + f.hint));
      out.push("");
    }
  }

  out.push(
    paint(
      color,
      DIM,
      "  Note: structure and proof presence were checked. The signature itself was NOT"
    )
  );
  out.push(paint(color, DIM, "  cryptographically verified. Publish the issuer key to allow that."));
  out.push("");
  return out.join("\n");
}

function formatFindings(findings) {
  return sortFindings(findings)
    .map((f) => `  ${f.severity.toUpperCase().padEnd(7)} ${f.code.padEnd(30)} ${f.pointer}\n          ${f.message}`)
    .join("\n");
}

module.exports = { formatReport, formatFindings, bar, sortFindings };