#!/usr/bin/env node
// Cross-platform smoke test for `trellis studio`.
//
// Spawns the CLI via `node bin/trellis.mjs studio --no-open` in a temp
// directory, polls the Studio URL for a 200 response, then tears down
// the whole process tree. Exits 0 on success, 1 on timeout/failure.
//
// Used in CI to validate that the published path works on macOS/Linux/
// Windows — and that the node-compatible launcher correctly re-execs
// under bun on each platform.
//
// Usage:
//   node script/smoke-studio.mjs
//   node script/smoke-studio.mjs --port 7997 --timeout 90

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dir, "..");
const cliPath = join(repoRoot, "bin", "trellis.mjs");

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const port = parseInt(args.port ?? "7997", 10);
const timeoutSec = parseInt(args.timeout ?? "90", 10);
const url = `http://127.0.0.1:${port}/`;
const tmp = mkdtempSync(join(tmpdir(), "trellis-smoke-"));
const isWin = process.platform === "win32";

console.log(`▸ trellis studio smoke test`);
console.log(`  platform: ${process.platform}/${process.arch}`);
console.log(`  node:     ${process.versions.node}`);
console.log(`  cli:      ${cliPath}`);
console.log(`  cwd:      ${tmp}`);
console.log(`  port:     ${port}`);
console.log(`  timeout:  ${timeoutSec}s`);
console.log();

const child = spawn(
  process.execPath,
  [
    cliPath,
    "studio",
    "--no-open",
    "--port",
    String(port),
    "--quiet-backend",
  ],
  {
    cwd: tmp,
    stdio: ["ignore", "inherit", "inherit"],
    // POSIX: new process group so we can signal the tree.
    // Windows: must use taskkill (handled in killTree).
    detached: !isWin,
  }
);

let cleaned = false;
function killTree() {
  if (cleaned) return;
  cleaned = true;
  if (!child.pid) return;
  if (isWin) {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } catch {}
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
    setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    }, 2000).unref();
  }
}

function exitWith(code) {
  killTree();
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {}
  // Give the kill signal a moment to land before exit, otherwise the
  // child may outlive us on slow runners.
  setTimeout(() => process.exit(code), 500).unref();
}

process.on("SIGINT", () => exitWith(130));
process.on("SIGTERM", () => exitWith(143));

let childExitCode = null;
child.on("exit", (code) => {
  childExitCode = code;
});
child.on("error", (err) => {
  console.error(`✗ Failed to spawn CLI: ${err.message}`);
  exitWith(1);
});

const deadline = Date.now() + timeoutSec * 1000;
let success = false;
while (Date.now() < deadline) {
  if (childExitCode !== null) {
    console.error(`✗ CLI exited prematurely with code ${childExitCode}`);
    exitWith(1);
  }
  await new Promise((r) => setTimeout(r, 1000));
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (res.status === 200) {
      const body = await res.text();
      const isStudio =
        body.includes("TurtleCode") || body.includes("Trellis");
      console.log(
        `✓ ${url} responded 200 (${body.length} bytes${
          isStudio ? ", looks like Studio" : ""
        })`
      );
      success = true;
      break;
    } else {
      console.log(`  ${url} → ${res.status}, retrying...`);
    }
  } catch {
    // Server not ready yet; keep polling.
  }
}

if (!success) {
  console.error(`✗ Studio did not respond within ${timeoutSec}s at ${url}`);
}
exitWith(success ? 0 : 1);
