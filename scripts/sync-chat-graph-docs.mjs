#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WWW = path.resolve(process.env.TRELLIS_DOCS_WWW ?? path.join(ROOT, '../../Packages/trellis-docs/www'));

const BUNDLE_SRC = path.join(ROOT, 'dist/realtime.bundle.js');
const BUNDLE_DEST = path.join(WWW, 'public/vendor/realtime.bundle.js');
const DEMO_SRC = path.join(ROOT, 'demo/chat-graph/index.html');
const DEMO_DEST = path.join(WWW, 'public/demos/chat-graph/index.html');
const FROM = "from '../../dist/realtime.bundle.js'";
const TO = "from '/vendor/realtime.bundle.js'";

async function main() {
  if (!existsSync(BUNDLE_SRC)) {
    const esbuild = path.join(ROOT, 'node_modules/.bin/esbuild');
    const { execSync } = await import('node:child_process');
    execSync(
      `"${esbuild}" src/realtime/index.ts --bundle --format=esm --platform=browser --outfile=dist/realtime.bundle.js`,
      { cwd: ROOT, shell: true, stdio: 'inherit' },
    );
  }
  await mkdir(path.dirname(DEMO_DEST), { recursive: true });
  await copyFile(BUNDLE_SRC, BUNDLE_DEST);
  let html = await readFile(DEMO_SRC, 'utf8');
  html = html.replaceAll(FROM, TO);
  await writeFile(DEMO_DEST, html);
  console.log('→ public/demos/chat-graph/index.html');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
