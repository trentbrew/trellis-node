#!/usr/bin/env node
/**
 * Smoke test for trellis/cms.
 *
 * Resolves the built dist, exercises the public API surface, and (if an
 * opencode backend is reachable at localhost:4096) lists collections.
 *
 * Usage:
 *   bun script/smoke-cms.mjs
 *   bun script/smoke-cms.mjs --url http://localhost:4096 --dir /path/to/project
 */

import { createCmsClient, scaffoldConsumer, scaffoldFilename } from '../dist/cms/index.js';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((acc, cur, i, arr) => {
      if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]]);
      return acc;
    }, []),
);

const url = args.url ?? 'http://localhost:4096';
const directory = args.dir ?? process.cwd();

console.log('▸ trellis/cms smoke test');
console.log(`  url: ${url}`);
console.log(`  directory: ${directory}`);
console.log();

console.log('▸ scaffoldConsumer({ collection: "blog_post", framework: "react", expand: ["author"] })');
const code = scaffoldConsumer({
  collection: 'blog_post',
  framework: 'react',
  expand: ['author'],
});
const filename = scaffoldFilename({ collection: 'blog_post', framework: 'react' });
console.log(`  → ${filename} (${code.length} bytes)`);
console.log();
console.log(code.split('\n').slice(0, 8).join('\n'));
console.log('  ... (truncated)');
console.log();

console.log('▸ createCmsClient → collections()');
try {
  const cms = createCmsClient({ url, directory });
  const collections = await cms.collections();
  if (collections.length === 0) {
    console.log('  ✓ Client constructed, returned 0 collections (no CMS data yet, or backend not running).');
  } else {
    console.log(`  ✓ Got ${collections.length} collections:`);
    for (const c of collections) {
      console.log(`    ${c.key.padEnd(20)} count=${c.count}`);
    }
  }
} catch (err) {
  console.log(`  ⚠ Client call failed: ${err.message}`);
  console.log('  (This is expected if opencode is not running at the URL above.)');
}

console.log();
console.log('✓ Module resolves and public API surface is intact.');
