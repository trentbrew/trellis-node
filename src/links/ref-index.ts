/**
 * Bidirectional Reference Index
 *
 * Builds and maintains a bidirectional index of [[...]] references:
 * - outgoing: source file → EntityRefs it contains
 * - incoming: target entity ID → RefSources that reference it
 *
 * Supports incremental updates when files change.
 *
 * @see TRL-13
 */

import type { EntityRef, RefIndex, RefSource } from './types.js';
import { parseFileRefs } from './parser.js';
import { resolveRef } from './resolver.js';
import type { ResolverContext } from './resolver.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a complete RefIndex by scanning all provided file contents.
 */
export function buildRefIndex(
  files: Array<{ path: string; content: string }>,
  ctx: ResolverContext,
): RefIndex {
  const index: RefIndex = {
    outgoing: new Map(),
    incoming: new Map(),
  };

  for (const file of files) {
    const refs = parseFileRefs(file.content, file.path);
    addFileToIndex(index, file.path, refs, ctx);
  }

  return index;
}

/**
 * Update the index for a single file that was added or modified.
 * Removes old entries for the file, then re-parses and re-indexes.
 */
export function updateFileInIndex(
  index: RefIndex,
  filePath: string,
  content: string,
  ctx: ResolverContext,
): void {
  // Remove old entries for this file
  removeFileFromIndex(index, filePath);

  // Parse and add new entries
  const refs = parseFileRefs(content, filePath);
  addFileToIndex(index, filePath, refs, ctx);
}

/**
 * Remove all refs originating from a file (e.g. when the file is deleted).
 */
export function removeFileFromIndex(index: RefIndex, filePath: string): void {
  const oldRefs = index.outgoing.get(filePath);
  if (!oldRefs) return;

  // Remove incoming entries that came from this file
  for (const ref of oldRefs) {
    const resolved = resolveRefToEntityId(ref);
    if (resolved) {
      const sources = index.incoming.get(resolved);
      if (sources) {
        const filtered = sources.filter((s) => s.filePath !== filePath);
        if (filtered.length > 0) {
          index.incoming.set(resolved, filtered);
        } else {
          index.incoming.delete(resolved);
        }
      }
    }
  }

  // Remove outgoing entry
  index.outgoing.delete(filePath);
}

/**
 * Get all outgoing refs from a file.
 */
export function getOutgoingRefs(index: RefIndex, filePath: string): EntityRef[] {
  return index.outgoing.get(filePath) ?? [];
}

/**
 * Get all incoming refs (backlinks) for an entity.
 * Accepts either a raw entity ID (e.g. "issue:TRL-5") or a target string.
 */
export function getBacklinks(index: RefIndex, entityId: string): RefSource[] {
  return index.incoming.get(entityId) ?? [];
}

/**
 * Get all entity IDs that have at least one backlink.
 */
export function getReferencedEntities(index: RefIndex): string[] {
  return [...index.incoming.keys()];
}

/**
 * Get all files that contain at least one ref.
 */
export function getFilesWithRefs(index: RefIndex): string[] {
  return [...index.outgoing.keys()];
}

/**
 * Get total counts for the index.
 */
export function getIndexStats(index: RefIndex): {
  totalFiles: number;
  totalRefs: number;
  totalEntities: number;
} {
  let totalRefs = 0;
  for (const refs of index.outgoing.values()) {
    totalRefs += refs.length;
  }
  return {
    totalFiles: index.outgoing.size,
    totalRefs,
    totalEntities: index.incoming.size,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Add parsed refs from a file into the index.
 */
function addFileToIndex(
  index: RefIndex,
  filePath: string,
  refs: EntityRef[],
  ctx: ResolverContext,
): void {
  if (refs.length === 0) return;

  // Store outgoing refs
  index.outgoing.set(filePath, refs);

  // Build incoming (backlink) entries
  for (const ref of refs) {
    // Resolve the ref to get an entity ID for the backlinks map
    const resolved = resolveRef(ref, ctx);
    const entityId = resolved.entityId ?? buildFallbackEntityId(ref);

    const sources = index.incoming.get(entityId) ?? [];
    sources.push(ref.source);
    index.incoming.set(entityId, sources);
  }
}

/**
 * Build a synthetic entity ID from a ref for backlink indexing
 * even when the ref doesn't resolve (broken/stale refs still
 * appear in the backlinks map so they can be found later).
 */
function buildFallbackEntityId(ref: EntityRef): string {
  if (ref.anchor) {
    return `${ref.namespace}:${ref.target}#${ref.anchor}`;
  }
  return `${ref.namespace}:${ref.target}`;
}

/**
 * Quick entity ID extraction from a ref without full resolution.
 * Used for removing old entries.
 */
function resolveRefToEntityId(ref: EntityRef): string {
  if (ref.anchor) {
    return `${ref.namespace}:${ref.target}#${ref.anchor}`;
  }
  return `${ref.namespace}:${ref.target}`;
}
