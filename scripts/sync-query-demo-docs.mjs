#!/usr/bin/env node
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WWW = path.resolve(process.env.TRELLIS_DOCS_WWW ?? path.join(ROOT, '../../Packages/trellis-docs/www'));

const DEMO_SRC = path.join(ROOT, 'demo/query/index.html');
const DEMO_DEST = path.join(WWW, 'public/demos/query/index.html');

async function main() {
  await mkdir(path.dirname(DEMO_DEST), { recursive: true });
  await copyFile(DEMO_SRC, DEMO_DEST);
  console.log('→ public/demos/query/index.html');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
