#!/usr/bin/env node
/**
 * Build state-demo browser bundle and copy into trellis.computer (www).
 *
 *   node scripts/sync-state-demo-docs.mjs
 *   TRELLIS_DOCS_WWW=/path/to/trellis-docs/www node scripts/sync-state-demo-docs.mjs
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_WWW = path.resolve(ROOT, '../../Packages/trellis-docs/www');
const WWW = path.resolve(process.env.TRELLIS_DOCS_WWW ?? DEFAULT_WWW);

const BUNDLE_SRC = path.join(ROOT, 'dist/state-demo.bundle.js');
const BUNDLE_DEST = path.join(WWW, 'public/vendor/state-demo.bundle.js');
const DEMO_SRC = path.join(ROOT, 'demo/state-demo/index.html');
const DEMO_DEST = path.join(WWW, 'public/demos/state/index.html');
const EMBED_DEST = path.join(WWW, 'public/demos/state/embed.html');

const BUNDLE_IMPORT_KERNEL = "from '../../dist/state-demo.bundle.js'";
const BUNDLE_IMPORT_WWW = "from '/vendor/state-demo.bundle.js'";

function buildBundle() {
  const esbuild = path.join(ROOT, 'node_modules/.bin/esbuild');
  if (!existsSync(esbuild)) {
    execSync('npm run build:state-demo-bundle', { cwd: ROOT, stdio: 'inherit' });
    return;
  }
  console.log('Building state-demo browser bundle (esbuild)…');
  execSync(
    `"${esbuild}" demo/state-demo/entry.ts --bundle --format=esm --platform=browser --outfile=dist/state-demo.bundle.js`,
    { cwd: ROOT, shell: true, stdio: 'inherit' },
  );
}

async function main() {
  buildBundle();

  await mkdir(path.dirname(BUNDLE_DEST), { recursive: true });
  await mkdir(path.dirname(DEMO_DEST), { recursive: true });

  await copyFile(BUNDLE_SRC, BUNDLE_DEST);
  console.log(`  → ${path.relative(ROOT, BUNDLE_DEST)}`);

  let html = await readFile(DEMO_SRC, 'utf8');
  if (!html.includes(BUNDLE_IMPORT_KERNEL)) {
    throw new Error(
      `Expected demo import ${BUNDLE_IMPORT_KERNEL} — update sync-state-demo-docs.mjs`,
    );
  }
  html = html.replaceAll(BUNDLE_IMPORT_KERNEL, BUNDLE_IMPORT_WWW);
  await writeFile(DEMO_DEST, html);
  console.log(`  → ${path.relative(ROOT, DEMO_DEST)}`);

  const redirect = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Trellis State Demo</title>
    <script>
      const q = new URLSearchParams(location.search);
      q.set('embed', '1');
      location.replace('index.html?' + q.toString());
    </script>
  </head>
  <body></body>
</html>
`;
  await writeFile(EMBED_DEST, redirect);
  console.log(`  → ${path.relative(ROOT, EMBED_DEST)}`);
  console.log('Done. www demo: /demos/state/index.html?embed=1');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
