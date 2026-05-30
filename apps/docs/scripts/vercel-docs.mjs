#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const EXPECTED_REPO = "https://github.com/trentbrew/trellis";
const EXPECTED_APP_DIR = "apps/docs";
const mode = process.argv[2] ?? "check";
const appRoot = process.cwd();
const repoRoot = resolve(appRoot, "../..");

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`✓ ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? appRoot,
    stdio: options.stdio ?? "pipe",
    encoding: "utf8",
  });

  if (result.error) fail(result.error.message);
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    fail(output || `${command} ${args.join(" ")} failed`);
  }

  return result.stdout.trim();
}

function ensureDocsRoot() {
  if (basename(appRoot) !== "docs" || basename(resolve(appRoot, "..")) !== "apps") {
    fail(`Run this from ${EXPECTED_APP_DIR}`);
  }

  if (!existsSync(resolve(appRoot, "nuxt.config.ts"))) fail("Missing nuxt.config.ts");
  if (!existsSync(resolve(appRoot, "vercel.json"))) fail("Missing vercel.json");
  ok(`Running from ${EXPECTED_APP_DIR}`);
}

function ensureGitRemote() {
  const remote = run("git", ["config", "--get", "remote.origin.url"], { cwd: repoRoot });
  const normalized = remote.replace(/^git@github.com:/, "https://github.com/").replace(/\.git$/, "");
  const expected = EXPECTED_REPO.replace(/\.git$/, "");

  if (normalized !== expected) {
    fail(`Expected git remote ${EXPECTED_REPO}, got ${remote}`);
  }

  ok(`Git remote is ${EXPECTED_REPO}`);
}

function ensureVercelConfig() {
  const config = JSON.parse(readFileSync(resolve(appRoot, "vercel.json"), "utf8"));

  if (config.framework !== "nuxtjs") fail("vercel.json framework must be nuxtjs");
  if (config.buildCommand !== "npm run build") fail("vercel.json buildCommand must be npm run build");
  if (config.installCommand !== "npm install --legacy-peer-deps") {
    fail("vercel.json installCommand must be npm install --legacy-peer-deps");
  }

  ok("vercel.json is configured for the Nuxt docs app");
}

function ensureVercelCli() {
  run("npx", ["--yes", "vercel", "--version"]);
  ok("Vercel CLI is available");
}

function check() {
  ensureDocsRoot();
  ensureGitRemote();
  ensureVercelConfig();
  console.log("\nVercel project settings should use:");
  console.log(`  Repository: ${EXPECTED_REPO}`);
  console.log(`  Root Directory: ${EXPECTED_APP_DIR}`);
  console.log("  Build Command: npm run build");
  console.log("  Install Command: npm install --legacy-peer-deps");
}

function link() {
  check();
  ensureVercelCli();
  spawnSync("npx", ["--yes", "vercel", "link"], { cwd: appRoot, stdio: "inherit" });
}

function deploy() {
  check();
  ensureVercelCli();
  spawnSync("npx", ["--yes", "vercel", "--prod"], { cwd: appRoot, stdio: "inherit" });
}

if (mode === "check") check();
else if (mode === "link") link();
else if (mode === "deploy") deploy();
else fail(`Unknown mode: ${mode}`);
