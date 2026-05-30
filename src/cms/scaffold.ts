/**
 * Scaffold generators for CMS consumer code.
 *
 * Used by the agent's `cms` tool (scaffold_consumer action) to write
 * starter integration files instead of generating static data dumps.
 */

import type { Framework } from './types.js';

export type ScaffoldOptions = {
  collection: string;
  framework?: Framework;
  /** Field keys to expand as references (e.g. ["author"]). */
  expand?: string[];
  /** Override the CMS server URL. Default: http://localhost:4096 */
  url?: string;
  /**
   * Project directory for multi-instance backends (e.g. opencode requires this).
   * Baked into the generated client literal so requests route to the correct project.
   */
  directory?: string;
};

const DEFAULT_URL = 'http://localhost:4096';

function expandLiteral(expand?: string[]): string {
  if (!expand || expand.length === 0) return '';
  return ` expand: ${JSON.stringify(expand)},`;
}

function clientLiteral(url: string, directory?: string): string {
  if (!directory) return `createCmsClient({ url: "${url}" })`;
  return `createCmsClient({ url: "${url}", directory: ${JSON.stringify(directory)} })`;
}

function vanilla(opts: ScaffoldOptions): string {
  const url = opts.url ?? DEFAULT_URL;
  const exp = expandLiteral(opts.expand);
  return `import { createCmsClient } from "trellis/cms";

const cms = ${clientLiteral(url, opts.directory)};

const collection = cms.collection("${opts.collection}");

// One-shot fetch (defaults to status: "published")
const entries = await collection.list({${exp}});
console.log(entries);

// Live updates — re-fires whenever the collection changes
const off = collection.subscribe(
  (entries) => {
    console.log("Updated:", entries);
  },
  {${exp} onError: (err) => console.error("CMS subscription failed", err), },
);
// off();  // call to stop receiving updates
`;
}

function react(opts: ScaffoldOptions): string {
  const url = opts.url ?? DEFAULT_URL;
  const exp = expandLiteral(opts.expand);
  return `import { useEffect, useState } from "react";
import { createCmsClient, type Entry } from "trellis/cms";

const cms = ${clientLiteral(url, opts.directory)};

export function use${pascal(opts.collection)}() {
  const [entries, setEntries] = useState<Entry[]>([]);
  useEffect(() => {
    const off = cms.collection("${opts.collection}").subscribe(setEntries, {${exp} onError: (err) => console.error("CMS subscription failed", err), });
    return off;
  }, []);
  return entries;
}

// Usage:
//   const posts = use${pascal(opts.collection)}();
//   return posts.map(p => <article key={p.id}>...</article>);
`;
}

function solid(opts: ScaffoldOptions): string {
  const url = opts.url ?? DEFAULT_URL;
  const exp = expandLiteral(opts.expand);
  return `import { createSignal, onCleanup } from "solid-js";
import { createCmsClient, type Entry } from "trellis/cms";

const cms = ${clientLiteral(url, opts.directory)};

export function create${pascal(opts.collection)}() {
  const [entries, setEntries] = createSignal<Entry[]>([]);
  const off = cms.collection("${opts.collection}").subscribe(setEntries, {${exp} onError: (err) => console.error("CMS subscription failed", err), });
  onCleanup(off);
  return entries;
}

// Usage in a component:
//   const posts = create${pascal(opts.collection)}();
//   return <For each={posts()}>{(p) => <article>...</article>}</For>;
`;
}

function vue(opts: ScaffoldOptions): string {
  const url = opts.url ?? DEFAULT_URL;
  const exp = expandLiteral(opts.expand);
  return `import { ref, onUnmounted } from "vue";
import { createCmsClient, type Entry } from "trellis/cms";

const cms = ${clientLiteral(url, opts.directory)};

export function use${pascal(opts.collection)}() {
  const entries = ref<Entry[]>([]);
  const off = cms.collection("${opts.collection}").subscribe((next) => {
    entries.value = next;
  }, {${exp} onError: (err) => console.error("CMS subscription failed", err), });
  onUnmounted(off);
  return entries;
}
`;
}

function pascal(s: string): string {
  return s
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join('');
}

export function scaffoldConsumer(opts: ScaffoldOptions): string {
  switch (opts.framework ?? 'vanilla') {
    case 'react':
      return react(opts);
    case 'solid':
      return solid(opts);
    case 'vue':
      return vue(opts);
    default:
      return vanilla(opts);
  }
}

export function scaffoldFilename(opts: ScaffoldOptions): string {
  const base = `cms-${opts.collection.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
  switch (opts.framework ?? 'vanilla') {
    case 'react':
    case 'solid':
      return `${base}.ts`;
    case 'vue':
      return `${base}.ts`;
    default:
      return `${base}.js`;
  }
}
