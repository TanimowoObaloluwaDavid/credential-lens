#!/usr/bin/env node
"use strict";

/* Builds the animated demo GIF used in the README.
 *
 * Drives the real page in headless Chrome over the DevTools Protocol, clicking
 * through the bundled samples and capturing PNG frames, then assembles them
 * into a GIF with ffmpeg.
 *
 * Requires Node 22+ (for the global WebSocket) and ffmpeg on PATH, or set
 * FFMPEG_PATH. Frames are always written, so the GIF step can be redone by hand.
 *
 *   node scripts/make-demo-gif.js
 */

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PAGE = "file:///" + path.join(ROOT, "web", "index.html").replace(/\\/g, "/");
const OUT_DIR = path.join(ROOT, "assets");
const FRAME_DIR = path.join(os.tmpdir(), "credlens-frames");

const CHROME =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const VIEWPORT = { width: 1100, height: 1240 };
const GIF_WIDTH = 860;
const HOLD_FRAMES = 9; // how many PNGs to emit per state
const FRAME_INTERVAL_MS = 100;
const SETTLE_MS = 950; // let the gauge transition finish before capturing

/* The tour: each state is held long enough to read, ending back on the first
   state so the GIF loops without a jarring cut. */
const TOUR = [
  "well-formed",
  "no-proof",
  "placeholder-proof",
  "expired",
  "legacy-v1",
  "well-formed",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function requireWebSocket() {
  if (typeof WebSocket === "undefined") {
    throw new Error(
      "This script needs the global WebSocket, which Node provides from v22 onwards.\n" +
        "You are on " + process.version + "."
    );
  }
}

async function waitForDevTools(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error("Chrome DevTools endpoint never became available");
}

/** Best-effort ffmpeg discovery so the script works without extra setup. */
function findFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const onPath = spawnSync(process.platform === "win32" ? "where" : "which", ["ffmpeg"], {
    encoding: "utf8",
  });
  if (onPath.status === 0) {
    const first = onPath.stdout.split(/\r?\n/).filter(Boolean)[0];
    if (first && fs.existsSync(first)) return first;
  }
  return null;
}

async function main() {
  requireWebSocket();
  if (!fs.existsSync(CHROME)) throw new Error("Chrome not found at " + CHROME);

  fs.rmSync(FRAME_DIR, { recursive: true, force: true });
  fs.mkdirSync(FRAME_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "credlens-gif-"));
  const port = 9700 + (process.pid % 200);
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--force-color-profile=srgb",
      "--remote-debugging-port=" + port,
      "--user-data-dir=" + profile,
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  let ws;
  let frameCount = 0;

  try {
    await waitForDevTools(port);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (!target) throw new Error("no page target");

    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", rej, { once: true });
    });

    let msgId = 0;
    const pending = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    });

    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++msgId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });

    await send("Page.enable");
    await send("Runtime.enable");
    // A fixed device metrics override keeps every frame pixel-identical in size.
    await send("Emulation.setDeviceMetricsOverride", {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await send("Page.navigate", { url: PAGE });
    await sleep(1600);

    const shot = async () => {
      const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      const name = "frame-" + String(frameCount++).padStart(3, "0") + ".png";
      fs.writeFileSync(path.join(FRAME_DIR, name), Buffer.from(data, "base64"));
    };

    for (const sample of TOUR) {
      await send("Runtime.evaluate", {
        expression:
          "(function(){var b=document.querySelector('.chip-btn[data-sample=" +
          JSON.stringify(sample) +
          "]');b.click();if(document.activeElement)document.activeElement.blur();})()",
      });
      await sleep(SETTLE_MS);
      for (let i = 0; i < HOLD_FRAMES; i++) {
        await shot();
        await sleep(FRAME_INTERVAL_MS);
      }
      process.stdout.write("  captured " + sample + "\n");
    }

    ws.close();
  } finally {
    try { if (ws) ws.close(); } catch {}
    chrome.kill();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }

  console.log("\n" + frameCount + " frames in " + FRAME_DIR);

  const ffmpeg = findFfmpeg();
  if (!ffmpeg) {
    console.log(
      "\nffmpeg not found, so no GIF was produced. Install ffmpeg or set FFMPEG_PATH,\n" +
        "then run:\n  " +
        path.join(FRAME_DIR, "..") +
        "\n  ffmpeg -framerate 10 -i " +
        FRAME_DIR +
        "\\frame-%03d.png ...\n" +
        "(see scripts/make-demo-gif.js for the exact two-pass command)"
    );
    return;
  }

  const palette = path.join(FRAME_DIR, "palette.png");
  const gif = path.join(OUT_DIR, "demo.gif");
  const fps = 10;

  const scale = `scale=${GIF_WIDTH}:-1:flags=lanczos`;

  console.log("\nbuilding palette...");
  let r = spawnSync(
    ffmpeg,
    ["-y", "-framerate", String(fps), "-i", path.join(FRAME_DIR, "frame-%03d.png"),
     "-vf", `${scale},palettegen=max_colors=200:stats_mode=diff`, palette],
    { encoding: "utf8" }
  );
  if (r.status !== 0) throw new Error("palettegen failed:\n" + (r.stderr || "").slice(-1500));

  console.log("encoding GIF...");
  r = spawnSync(
    ffmpeg,
    ["-y", "-framerate", String(fps), "-i", path.join(FRAME_DIR, "frame-%03d.png"),
     "-i", palette,
     "-lavfi", `${scale}[v];[v][1:v]paletteuse=dither=sierra2_4a`,
     "-loop", "0", gif],
    { encoding: "utf8" }
  );
  if (r.status !== 0) throw new Error("paletteuse failed:\n" + (r.stderr || "").slice(-1500));

  const bytes = fs.statSync(gif).size;
  console.log(
    "\nwrote " + path.relative(ROOT, gif) + "  " +
      (bytes / 1024 / 1024).toFixed(2) + " MB  " +
      GIF_WIDTH + "px wide, " + frameCount + " frames"
  );
}

main().catch((err) => {
  console.error("\n" + err.message);
  process.exit(1);
});