"use strict";
/* Headless browser test for web/index.html.
   Drives a real Chrome over the DevTools Protocol using Node's built-in
   WebSocket, so it can check computed styles and click each sample chip.
   No dependencies, no test runner needed: node test/web-smoke.js */

const { spawn, execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PAGE = "file:///" + path.resolve(__dirname, "..", "web", "index.html").replace(/\\/g, "/");
const PORT = 9333 + (process.pid % 500);

if (typeof WebSocket === "undefined") {
  console.error(
    "This harness needs the global WebSocket, which Node provides from v22 onwards.\n" +
    "You are on " + process.version + ". Run it with Node 22 or newer:\n" +
    "  npx -y node@22 test/web-smoke.js"
  );
  process.exit(2);
}

if (!fs.existsSync(CHROME)) {
  console.error("Chrome not found at: " + CHROME + "\nSet CHROME_PATH to override.");
  process.exit(2);
}

let pass = 0, fail = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; failures.push(name); console.log("  FAIL " + name + (extra ? "  -> " + extra : "")); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevTools() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return await res.json();
    } catch {}
    await sleep(250);
  }
  throw new Error("DevTools endpoint never became available");
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "credlens-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=" + PORT, "--user-data-dir=" + profile,
    "--window-size=1280,900", PAGE,
  ], { stdio: "ignore" });

  let ws;
  try {
    await waitForDevTools();

    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (!page) throw new Error("no page target");

    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", rej, { once: true });
    });

    let id = 0;
    const pending = new Map();
    const consoleErrors = [];

    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method === "Runtime.exceptionThrown") {
        consoleErrors.push(msg.params.exceptionDetails.text);
      } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        consoleErrors.push(msg.params.args.map((a) => a.value).join(" "));
      }
    });

    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const msgId = ++id;
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });

    const evaluate = async (expression) => {
      const r = await send("Runtime.evaluate", {
        expression: "(function(){" + expression + "})()",
        returnByValue: true, awaitPromise: true,
      });
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.text + " " +
          (r.exceptionDetails.exception && r.exceptionDetails.exception.description || ""));
      }
      return r.result.value;
    };

    await send("Runtime.enable");
    await send("Page.enable");
    await send("Page.navigate", { url: PAGE });
    await sleep(1800);

    console.log("\nBoot");
    check("page has no JS errors", consoleErrors.length === 0, consoleErrors.join(" | "));
    check("validator API exposed to the page", await evaluate("return typeof window.CredentialLens.validate === 'function'"));
    check("samples API exposed to the page", await evaluate("return Object.keys(window.CredentialLensSamples.samples).length === 6"));

    console.log("\nStyling actually applied");
    const bg = await evaluate("return getComputedStyle(document.body).backgroundColor");
    check("dark theme background computed", bg === "rgb(14, 17, 23)", bg);
    const btnBg = await evaluate("return getComputedStyle(document.getElementById('run')).backgroundColor");
    check("primary button styled", btnBg === "rgb(31, 111, 235)", btnBg);
    const gaugeStroke = await evaluate("return document.getElementById('gaugeFill').style.stroke");
    check("gauge stroke coloured by band", gaugeStroke === "rgb(63, 185, 80)", gaugeStroke);

    console.log("\nDefault load (well-formed sample)");
    check("results visible", await evaluate("return !document.getElementById('results').hidden"));
    check("score is 100", (await evaluate("return document.getElementById('score').textContent")) === "100");
    check("band is strong", (await evaluate("return document.getElementById('band').textContent")) === "strong");
    check("verdict class is good",
      (await evaluate("return document.getElementById('verdict').className")) === "verdict good");
    check("counts show zero of everything",
      (await evaluate("return document.getElementById('counts').textContent")) === "0 error · 0 warning · 0 info");
    check("no-findings message shown",
      await evaluate("return document.getElementById('findings').textContent.includes('No findings')"));
    check("credential tree rendered",
      await evaluate("return document.getElementById('tree').textContent.includes('OpenBadgeCredential')"));
    check("gauge fully filled",
      (await evaluate("return parseFloat(document.getElementById('gaugeFill').style.strokeDashoffset)")) === 0);

    console.log("\nEvery sample renders a live verdict");
    const expected = {
      "well-formed": { valid: true, band: "strong" },
      "no-proof": { valid: false, band: "weak" },
      "placeholder-proof": { valid: false, band: "weak" },
      "expired": { valid: false, band: "weak" },
      "legacy-v1": { valid: false, band: "poor" },
      "not-a-credential": { valid: false, band: "poor" },
    };

    for (const [name, want] of Object.entries(expected)) {
      await evaluate(
        "document.querySelector('.chip-btn[data-sample=\"" + name + "\"]').click(); return 1;"
      );
      await sleep(220);
      const cls = await evaluate("return document.getElementById('verdict').className");
      const band = await evaluate("return document.getElementById('band').textContent");
      const active = await evaluate(
        "return document.querySelector('.chip-btn.on').dataset.sample"
      );
      check(name + ": verdict class", cls === "verdict " + (want.valid ? "good" : "bad"), cls);
      check(name + ": band", band === want.band, band);
      check(name + ": chip marked active", active === name, active);

      // A partial score must leave a matching gap in the gauge arc.
      const offset = await evaluate(
        "return parseFloat(document.getElementById('gaugeFill').style.strokeDashoffset)"
      );
      const shownScore = Number(await evaluate("return document.getElementById('score').textContent"));
      const expectedOffset = 326.726 * (1 - shownScore / 100);
      check(name + ": gauge arc matches score",
        Math.abs(offset - expectedOffset) < 0.5, offset + " vs " + expectedOffset.toFixed(2));
    }

    console.log("\nTyped input and error handling");
    await evaluate(
      "var t=document.getElementById('input');" +
      "t.value='{ not json';document.getElementById('run').click();return 1;"
    );
    await sleep(160);
    check("bad JSON shows an error status",
      await evaluate("return document.getElementById('status').classList.contains('err')"));
    check("bad JSON hides results", await evaluate("return document.getElementById('results').hidden"));

    await evaluate(
      "var t=document.getElementById('input');t.value='{\"a\":1}';document.getElementById('run').click();return 1;"
    );
    await sleep(200);
    check("non-credential JSON is reported invalid",
      (await evaluate("return document.getElementById('verdict').className")) === "verdict bad");
    check("JSON.stringify sample survives a round trip",
      await evaluate(
        "var s=window.CredentialLensSamples.samples['well-formed'].credential;" +
        "return JSON.stringify(s).length > 500;"
      ));

    await evaluate("document.getElementById('clear').click();return 1");
    await sleep(120);
    check("clear empties the textarea and hides results",
      (await evaluate("return document.getElementById('input').value")) === "" &&
      (await evaluate("return document.getElementById('results').hidden")));

    check("still no JS errors at the end", consoleErrors.length === 0, consoleErrors.join(" | "));

    ws.close();
  } finally {
    try { if (ws) ws.close(); } catch {}
    chrome.kill();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }

  console.log("\n" + pass + " passed, " + fail + " failed");
  if (fail) {
    console.log("Failing: " + failures.join(", "));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\nHarness error:", err.message);
  process.exit(2);
});