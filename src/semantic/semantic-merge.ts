/**
 * Semantic Merge Engine
 *
 * DESIGN.md §4.4 — Patch Commutativity and Conflict Detection.
 * Two patches commute when they operate on disjoint entities.
 * Two patches conflict when they both modify the same entity
 * in incompatible ways.
 */

import type {
  SemanticPatch,
  SemanticMergeConflict,
  SemanticMergeResult,
} from './types.js';

// ---------------------------------------------------------------------------
// Patch entity extraction
// ---------------------------------------------------------------------------

/**
 * Extract the entity ID that a patch operates on.
 * Returns null for patches that don't target a specific entity.
 */
function patchEntityId(patch: SemanticPatch): string | null {
  switch (patch.kind) {
    case 'symbolAdd':
      return patch.entity.id;
    case 'symbolRemove':
      return patch.entityId;
    case 'symbolModify':
      return patch.entityId;
    case 'symbolRename':
      return patch.entityId;
    case 'symbolMove':
      return patch.entityId;
    case 'importAdd':
    case 'importRemove':
    case 'importModify':
      return `import:${patch.fileId}:${patch.source}`;
    case 'exportAdd':
    case 'exportRemove':
      return `export:${patch.fileId}:${patch.name}`;
  }
}

function patchEntityName(patch: SemanticPatch): string {
  switch (patch.kind) {
    case 'symbolAdd':
      return patch.entity.name;
    case 'symbolRemove':
      return patch.entityName;
    case 'symbolModify':
      return patch.entityName;
    case 'symbolRename':
      return patch.oldName;
    case 'symbolMove':
      return patch.entityName;
    case 'importAdd':
    case 'importRemove':
    case 'importModify':
      return patch.source;
    case 'exportAdd':
    case 'exportRemove':
      return patch.name;
  }
}

function patchEntityKind(patch: SemanticPatch): string {
  switch (patch.kind) {
    case 'symbolAdd':
      return patch.entity.kind;
    case 'importAdd':
    case 'importRemove':
    case 'importModify':
      return 'import';
    case 'exportAdd':
    case 'exportRemove':
      return 'export';
    default:
      return 'symbol';
  }
}

// ---------------------------------------------------------------------------
// Commutativity check
// ---------------------------------------------------------------------------

/**
 * Check if two patches commute (can be applied in either order).
 * Returns true if they operate on disjoint entities or are identical.
 */
export function patchesCommute(a: SemanticPatch, b: SemanticPatch): boolean {
  const idA = patchEntityId(a);
  const idB = patchEntityId(b);

  // Disjoint entities always commute
  if (idA !== idB) return true;

  // Same entity — check specific combinations
  // Identical patches commute (idempotent)
  if (a.kind === b.kind && JSON.stringify(a) === JSON.stringify(b)) return true;

  // importAdd + importAdd on same source — deduplicate (commutes)
  if (a.kind === 'importAdd' && b.kind === 'importAdd') return true;

  // symbolMove + symbolModify — commutes (modify at new location)
  if (
    (a.kind === 'symbolMove' && b.kind === 'symbolModify') ||
    (a.kind === 'symbolModify' && b.kind === 'symbolMove')
  ) {
    return true;
  }

  // Everything else on the same entity does NOT commute
  return false;
}

// ---------------------------------------------------------------------------
// Semantic merge
// ---------------------------------------------------------------------------

/**
 * Merge two sets of semantic patches (ours and theirs) against a common base.
 * Produces a merged patch list or structured conflicts.
 */
export function semanticMerge(
  oursPatches: SemanticPatch[],
  theirsPatches: SemanticPatch[],
  filePath: string = '',
): SemanticMergeResult {
  const merged: SemanticPatch[] = [];
  const conflicts: SemanticMergeConflict[] = [];

  // Index theirs by entity ID
  const theirsByEntity = new Map<string, SemanticPatch[]>();
  for (const patch of theirsPatches) {
    const id = patchEntityId(patch) ?? '__no_entity__';
    if (!theirsByEntity.has(id)) theirsByEntity.set(id, []);
    theirsByEntity.get(id)!.push(patch);
  }

  const processedTheirsEntities = new Set<string>();

  // Process ours patches
  for (const ourPatch of oursPatches) {
    const entityId = patchEntityId(ourPatch) ?? '__no_entity__';
    const theirPatches = theirsByEntity.get(entityId);

    if (!theirPatches || theirPatches.length === 0) {
      // Only we changed this entity — apply ours
      merged.push(ourPatch);
      continue;
    }

    processedTheirsEntities.add(entityId);

    // Check commutativity with each of their patches on the same entity
    let allCommute = true;
    for (const theirPatch of theirPatches) {
      if (!patchesCommute(ourPatch, theirPatch)) {
        allCommute = false;

        // Determine suggestion
        let suggestion: SemanticMergeConflict['suggestion'] = undefined;
        if (ourPatch.kind === 'symbolRemove' || theirPatch.kind === 'symbolRemove') {
          suggestion = undefined; // delete/edit — human decision
        } else if (ourPatch.kind === 'symbolModify' && theirPatch.kind === 'symbolModify') {
          suggestion = undefined; // both modified — human decision
        } else if (ourPatch.kind === 'symbolRename' && theirPatch.kind === 'symbolModify') {
          suggestion = 'combine'; // rename + modify — can auto-resolve
        }

        conflicts.push({
          entityId,
          entityName: patchEntityName(ourPatch),
          entityKind: patchEntityKind(ourPatch),
          filePath,
          ours: ourPatch,
          theirs: theirPatch,
          suggestion,
        });
      }
    }

    if (allCommute) {
      // Both commute — apply both
      merged.push(ourPatch);
      for (const tp of theirPatches) {
        // Deduplicate identical patches
        if (JSON.stringify(tp) !== JSON.stringify(ourPatch)) {
          merged.push(tp);
        }
      }
    }
  }

  // Process theirs patches that don't overlap with ours
  for (const theirPatch of theirsPatches) {
    const entityId = patchEntityId(theirPatch) ?? '__no_entity__';
    if (!processedTheirsEntities.has(entityId)) {
      merged.push(theirPatch);
    }
  }

  return {
    clean: conflicts.length === 0,
    patches: merged,
    conflicts,
  };
}
