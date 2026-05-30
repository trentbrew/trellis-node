/**
 * Ref Lifecycle — Rename Prompts & Stale Detection
 *
 * Handles the three-tier diagnostic model for wiki-link references:
 * - Resolved: target exists and resolves
 * - Stale (warning): target was renamed or deleted, known provenance
 * - Broken (error): target never existed
 *
 * On symbol rename → build a RefUpdateProposal for user confirmation.
 * On symbol delete → mark affected refs as stale (no file modification).
 *
 * @see TRL-14
 */

import type {
  EntityRef,
  RefIndex,
  RefSource,
  RefUpdateProposal,
  RefRewrite,
  RefState,
} from './types.js';
import { getBacklinks } from './ref-index.js';
import { readFileSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Stale Ref Tracking
// ---------------------------------------------------------------------------

export interface StaleRef {
  /** The entity ID that became stale */
  entityId: string;
  /** Why it became stale */
  reason: 'renamed' | 'deleted';
  /** The op hash that caused the staleness */
  causeOpHash?: string;
  /** For renames: the new name */
  newTarget?: string;
  /** Timestamp when it became stale */
  timestamp: string;
  /** Sources that reference this stale entity */
  sources: RefSource[];
}

/**
 * In-memory stale ref registry.
 * Maps entity ID → StaleRef.
 */
export class StaleRefRegistry {
  private staleRefs: Map<string, StaleRef> = new Map();

  /**
   * Mark an entity as stale due to rename or deletion.
   */
  markStale(
    entityId: string,
    reason: 'renamed' | 'deleted',
    sources: RefSource[],
    opts?: { causeOpHash?: string; newTarget?: string },
  ): StaleRef {
    const entry: StaleRef = {
      entityId,
      reason,
      causeOpHash: opts?.causeOpHash,
      newTarget: opts?.newTarget,
      timestamp: new Date().toISOString(),
      sources,
    };
    this.staleRefs.set(entityId, entry);
    return entry;
  }

  /**
   * Remove stale status (e.g. after user accepts rename update).
   */
  clearStale(entityId: string): void {
    this.staleRefs.delete(entityId);
  }

  /**
   * Check if an entity is stale.
   */
  isStale(entityId: string): boolean {
    return this.staleRefs.has(entityId);
  }

  /**
   * Get stale info for an entity.
   */
  getStale(entityId: string): StaleRef | undefined {
    return this.staleRefs.get(entityId);
  }

  /**
   * Get all stale refs.
   */
  getAllStale(): StaleRef[] {
    return [...this.staleRefs.values()];
  }

  /**
   * Get stale refs filtered by reason.
   */
  getByReason(reason: 'renamed' | 'deleted'): StaleRef[] {
    return this.getAllStale().filter((s) => s.reason === reason);
  }
}

// ---------------------------------------------------------------------------
// Rename → RefUpdateProposal
// ---------------------------------------------------------------------------

/**
 * Build a RefUpdateProposal when a symbol is renamed.
 * Scans the ref index for all references to the old symbol name
 * and produces a list of rewrites.
 *
 * Does NOT modify any files — returns a proposal for user confirmation.
 */
export function buildRenameProposal(
  index: RefIndex,
  filePath: string,
  oldName: string,
  newName: string,
): RefUpdateProposal {
  // Entity ID for the old symbol
  const oldEntityId = `symbol:${filePath}#${oldName}`;
  const newEntityId = `symbol:${filePath}#${newName}`;

  // Find all backlinks to the old symbol
  const sources = getBacklinks(index, oldEntityId);

  // Also check for refs using the fallback entity ID pattern
  const altEntityId = `symbol:${filePath}#${oldName}`;
  const altSources = getBacklinks(index, altEntityId);
  const allSources = deduplicateSources([...sources, ...altSources]);

  const rewrites: RefRewrite[] = [];
  const affectedFiles = new Set<string>();

  for (const source of allSources) {
    affectedFiles.add(source.filePath);

    // Build the old and new text for the rewrite
    const oldText = buildRefText(filePath, oldName);
    const newText = buildRefText(filePath, newName);

    rewrites.push({
      filePath: source.filePath,
      line: source.line,
      col: source.col,
      oldText,
      newText,
    });
  }

  return {
    oldTarget: oldEntityId,
    newTarget: newEntityId,
    affectedFiles: [...affectedFiles],
    rewrites,
  };
}

/**
 * Apply a RefUpdateProposal by rewriting files.
 * Reads each affected file, applies the rewrites, and writes back.
 *
 * Returns the list of files that were actually modified.
 */
export function applyRenameProposal(
  proposal: RefUpdateProposal,
  rootPath: string,
): string[] {
  const modifiedFiles: string[] = [];

  // Group rewrites by file
  const byFile = new Map<string, RefRewrite[]>();
  for (const rw of proposal.rewrites) {
    const existing = byFile.get(rw.filePath) ?? [];
    existing.push(rw);
    byFile.set(rw.filePath, existing);
  }

  for (const [filePath, rewrites] of byFile) {
    try {
      const absPath = join(rootPath, filePath);
      let content = readFileSync(absPath, 'utf-8');
      let modified = false;

      for (const rw of rewrites) {
        // Replace all occurrences of the old ref text with the new one
        if (content.includes(rw.oldText)) {
          content = content.replaceAll(rw.oldText, rw.newText);
          modified = true;
        }
      }

      if (modified) {
        const { writeFileSync } = require('fs');
        writeFileSync(absPath, content);
        modifiedFiles.push(filePath);
      }
    } catch {
      // File may have been deleted or moved — skip
    }
  }

  return modifiedFiles;
}

// ---------------------------------------------------------------------------
// Deletion → Stale marking
// ---------------------------------------------------------------------------

/**
 * Handle a symbol deletion by marking all referencing refs as stale.
 * Does NOT modify any files.
 *
 * Returns the StaleRef entry for diagnostic display.
 */
export function handleSymbolDeletion(
  index: RefIndex,
  registry: StaleRefRegistry,
  filePath: string,
  symbolName: string,
  causeOpHash?: string,
): StaleRef | null {
  const entityId = `symbol:${filePath}#${symbolName}`;
  const sources = getBacklinks(index, entityId);

  if (sources.length === 0) return null;

  return registry.markStale(entityId, 'deleted', sources, { causeOpHash });
}

/**
 * Handle a file deletion by marking all refs to that file (and its symbols) as stale.
 */
export function handleFileDeletion(
  index: RefIndex,
  registry: StaleRefRegistry,
  filePath: string,
  causeOpHash?: string,
): StaleRef | null {
  const entityId = `file:${filePath}`;
  const sources = getBacklinks(index, entityId);

  if (sources.length === 0) return null;

  return registry.markStale(entityId, 'deleted', sources, { causeOpHash });
}

// ---------------------------------------------------------------------------
// Diagnostic queries
// ---------------------------------------------------------------------------

export type RefDiagnostic = {
  entityId: string;
  state: RefState;
  source: RefSource;
  message: string;
};

/**
 * Produce diagnostics for all refs in the index.
 * Combines stale registry info with broken ref detection.
 */
export function getDiagnostics(
  index: RefIndex,
  registry: StaleRefRegistry,
  resolvedEntityIds: Set<string>,
): RefDiagnostic[] {
  const diagnostics: RefDiagnostic[] = [];

  // Walk all outgoing refs
  for (const [filePath, refs] of index.outgoing) {
    for (const ref of refs) {
      const entityId = buildEntityIdFromRef(ref);

      // Check stale first
      const staleInfo = registry.getStale(entityId);
      if (staleInfo) {
        const reason =
          staleInfo.reason === 'renamed'
            ? `renamed to ${staleInfo.newTarget}`
            : 'removed';
        diagnostics.push({
          entityId,
          state: 'stale',
          source: ref.source,
          message: `Reference to '${ref.target}${ref.anchor ? '#' + ref.anchor : ''}' is stale: target was ${reason}`,
        });
        continue;
      }

      // Check if resolved
      if (!resolvedEntityIds.has(entityId)) {
        diagnostics.push({
          entityId,
          state: 'broken',
          source: ref.source,
          message: `Cannot resolve reference: '${ref.target}${ref.anchor ? '#' + ref.anchor : ''}' does not exist`,
        });
      }
    }
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// SemanticPatch integration
// ---------------------------------------------------------------------------

import type { SemanticPatch } from '../semantic/types.js';

export interface LifecycleEvent {
  type: 'rename-proposal' | 'stale-detected';
  filePath: string;
  proposal?: RefUpdateProposal;
  staleRef?: StaleRef;
}

/**
 * Process semantic patches and produce lifecycle events.
 * This is the main integration point — call this when sdiff detects changes.
 */
export function processSemanticPatches(
  patches: SemanticPatch[],
  filePath: string,
  index: RefIndex,
  registry: StaleRefRegistry,
  causeOpHash?: string,
): LifecycleEvent[] {
  const events: LifecycleEvent[] = [];

  for (const patch of patches) {
    if (patch.kind === 'symbolRename') {
      const proposal = buildRenameProposal(
        index,
        filePath,
        patch.oldName,
        patch.newName,
      );
      if (proposal.rewrites.length > 0) {
        events.push({
          type: 'rename-proposal',
          filePath,
          proposal,
        });
      }
    }

    if (patch.kind === 'symbolRemove') {
      const staleRef = handleSymbolDeletion(
        index,
        registry,
        filePath,
        patch.entityName,
        causeOpHash,
      );
      if (staleRef) {
        events.push({
          type: 'stale-detected',
          filePath,
          staleRef,
        });
      }
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRefText(filePath: string, symbolName: string): string {
  return `[[${filePath}#${symbolName}]]`;
}

function buildEntityIdFromRef(ref: EntityRef): string {
  if (ref.anchor) {
    return `${ref.namespace}:${ref.target}#${ref.anchor}`;
  }
  return `${ref.namespace}:${ref.target}`;
}

function deduplicateSources(sources: RefSource[]): RefSource[] {
  const seen = new Set<string>();
  return sources.filter((s) => {
    const key = `${s.filePath}:${s.line}:${s.col}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
