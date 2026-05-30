/**
 * Trellis CMS — internal helpers (fact join, status detection, reference expansion).
 */

import type { Entry, EntryStatus } from './types.js';

export type RawFact = { e: string; a: string; v: string | number | boolean };
export type RawEntity = { id: string; type: string };
export type RawLink = { e1: string; a: string; e2: string };

const SYSTEM_TYPES = new Set([
  'issue',
  'agent',
  'project',
  'memory',
  'mcp',
  'sprite',
  'workunit',
  'cycle',
  'epic',
  'roadmap',
  'suggestion',
  'file',
  'directory',
  'op',
  'branch',
  'decision',
  'session',
  'typeschema',
  'field',
]);

export function isSystemType(type: string): boolean {
  return SYSTEM_TYPES.has(type.trim().toLowerCase());
}

export function typeKey(type: string): string {
  return type.trim().toLowerCase();
}

export function entryFromFacts(entity: RawEntity, facts: RawFact[], links?: RawLink[]): Entry {
  const fields: Record<string, unknown> = {};
  let status: EntryStatus = 'draft';
  let cmsStatusSeen = false;
  for (const f of facts) {
    if (f.a === 'type') continue;
    if (f.a === 'cms_status') {
      status = f.v === 'published' ? 'published' : 'draft';
      cmsStatusSeen = true;
      continue;
    }
    fields[f.a] = f.v;
  }
  // Status fallback: if `cms_status` isn't set but a `status` fact exists with
  // a recognized value, treat that as the entry's publication state. This
  // covers data created outside the IDE's CMS panel (e.g. by an agent that
  // uses `status: published` directly).
  if (!cmsStatusSeen) {
    if (fields.status === 'published') status = 'published';
    else if (fields.status === 'draft') status = 'draft';
  }
  // Merge graph links into the fields bag so reference fields stored as links
  // (rather than fact-string ids) are visible to expandReferences. Existing
  // facts win — links only fill in keys that aren't already populated.
  if (links) {
    for (const link of links) {
      if (link.e1 !== entity.id) continue;
      if (!(link.a in fields)) fields[link.a] = link.e2;
    }
  }
  return { id: entity.id, type: entity.type, status, fields };
}

export function groupFactsByEntity(facts: RawFact[]): Map<string, RawFact[]> {
  const map = new Map<string, RawFact[]>();
  for (const f of facts) {
    const list = map.get(f.e);
    if (list) list.push(f);
    else map.set(f.e, [f]);
  }
  return map;
}

export function groupLinksBySource(links: RawLink[]): Map<string, RawLink[]> {
  const map = new Map<string, RawLink[]>();
  for (const l of links) {
    const list = map.get(l.e1);
    if (list) list.push(l);
    else map.set(l.e1, [l]);
  }
  return map;
}

/**
 * For each entry, replace string ids in `expand` field keys with the resolved Entry.
 * Lookups are batched in parallel.
 */
export async function expandReferences(
  entries: Entry[],
  expandKeys: string[],
  fetchEntity: (id: string) => Promise<Entry | null>,
): Promise<Entry[]> {
  const ids = new Set<string>();
  for (const entry of entries) {
    for (const key of expandKeys) {
      const v = entry.fields[key];
      if (typeof v === 'string') ids.add(v);
    }
  }
  if (ids.size === 0) return entries;

  const resolved = new Map<string, Entry | null>();
  await Promise.all(
    [...ids].map(async (id) => {
      try {
        resolved.set(id, await fetchEntity(id));
      } catch {
        resolved.set(id, null);
      }
    }),
  );

  return entries.map((entry) => {
    const next: Record<string, unknown> = { ...entry.fields };
    for (const key of expandKeys) {
      const v = next[key];
      if (typeof v === 'string' && resolved.has(v)) {
        next[key] = resolved.get(v);
      }
    }
    return { ...entry, fields: next };
  });
}

/**
 * Cheap deep-equality fingerprint for change detection in subscriptions.
 */
export function fingerprint(value: unknown): string {
  return JSON.stringify(value);
}
