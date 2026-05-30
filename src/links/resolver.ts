/**
 * Entity Reference Resolver
 *
 * Resolves parsed EntityRefs to TrellisVCS entities by querying
 * the EAV store, tracked files, semantic parser, milestones, and identities.
 *
 * @see TRL-12
 */

import type { EntityRef, ResolvedRef, RefNamespace } from './types.js';

// ---------------------------------------------------------------------------
// Resolver Context — interface for engine capabilities
// ---------------------------------------------------------------------------

/**
 * Abstract interface for the engine capabilities the resolver needs.
 * This allows testing with mocks without a real TrellisVcsEngine.
 */
export interface ResolverContext {
  /** Get a tracked file by path. Returns true if the file exists in the op stream. */
  hasTrackedFile(path: string): boolean;

  /** Look up an issue by ID (e.g. "TRL-5"). Returns title if found. */
  getIssueTitle(id: string): string | undefined;

  /** Look up a milestone by ID or message fragment. Returns message if found. */
  getMilestoneTitle(idOrMessage: string): string | undefined;

  /** Check if a symbol exists in a file. Returns true if found. */
  hasSymbol(filePath: string, symbolName: string): boolean;

  /** Check if an identity/agent ID exists. Returns true if known. */
  hasIdentity(id: string): boolean;

  /** List all known agent IDs (from ops). */
  getKnownAgentIds(): string[];

  /** List all tracked file paths. */
  getTrackedFilePaths(): string[];

  /** List all issue IDs. */
  getIssueIds(): string[];

  /** List all milestone IDs. */
  getMilestoneIds(): string[];

  /** Check if a decision exists by ID (e.g. "DEC-1"). */
  hasDecision(id: string): boolean;

  /** Get a decision's tool name as a human-readable title. */
  getDecisionTitle(id: string): string | undefined;

  /** Get all symbol names for a file. */
  getSymbolNames(filePath: string): string[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a single EntityRef against the resolver context.
 */
export function resolveRef(ref: EntityRef, ctx: ResolverContext): ResolvedRef {
  switch (ref.namespace) {
    case 'issue':
      return resolveIssue(ref, ctx);
    case 'file':
      return resolveFile(ref, ctx);
    case 'symbol':
      return resolveSymbol(ref, ctx);
    case 'identity':
      return resolveIdentity(ref, ctx);
    case 'milestone':
      return resolveMilestone(ref, ctx);
    case 'decision':
      return resolveDecision(ref, ctx);
    default:
      return { ...ref, state: 'broken' };
  }
}

/**
 * Resolve multiple EntityRefs in batch.
 */
export function resolveRefs(
  refs: EntityRef[],
  ctx: ResolverContext,
): ResolvedRef[] {
  return refs.map((ref) => resolveRef(ref, ctx));
}

// ---------------------------------------------------------------------------
// Namespace-specific resolvers
// ---------------------------------------------------------------------------

function resolveIssue(ref: EntityRef, ctx: ResolverContext): ResolvedRef {
  const title = ctx.getIssueTitle(ref.target);
  if (title !== undefined) {
    return {
      ...ref,
      state: 'resolved',
      entityId: `issue:${ref.target}`,
      title,
    };
  }
  return { ...ref, state: 'broken' };
}

function resolveFile(ref: EntityRef, ctx: ResolverContext): ResolvedRef {
  if (ctx.hasTrackedFile(ref.target)) {
    return {
      ...ref,
      state: 'resolved',
      entityId: `file:${ref.target}`,
      title: ref.target,
    };
  }
  return { ...ref, state: 'broken' };
}

function resolveSymbol(ref: EntityRef, ctx: ResolverContext): ResolvedRef {
  // First check the file exists
  if (!ctx.hasTrackedFile(ref.target)) {
    return { ...ref, state: 'broken' };
  }

  // Then check the symbol exists in that file
  if (ref.anchor && ctx.hasSymbol(ref.target, ref.anchor)) {
    return {
      ...ref,
      state: 'resolved',
      entityId: `symbol:${ref.target}#${ref.anchor}`,
      title: `${ref.anchor} in ${ref.target}`,
    };
  }

  // File exists but symbol not found
  if (ref.anchor) {
    return { ...ref, state: 'broken' };
  }

  // No anchor — resolve as file
  return {
    ...ref,
    state: 'resolved',
    entityId: `file:${ref.target}`,
    title: ref.target,
  };
}

function resolveIdentity(ref: EntityRef, ctx: ResolverContext): ResolvedRef {
  if (ctx.hasIdentity(ref.target)) {
    return {
      ...ref,
      state: 'resolved',
      entityId: `identity:${ref.target}`,
      title: ref.target,
    };
  }
  return { ...ref, state: 'broken' };
}

function resolveMilestone(ref: EntityRef, ctx: ResolverContext): ResolvedRef {
  const title = ctx.getMilestoneTitle(ref.target);
  if (title !== undefined) {
    return {
      ...ref,
      state: 'resolved',
      entityId: `milestone:${ref.target}`,
      title,
    };
  }
  return { ...ref, state: 'broken' };
}

function resolveDecision(ref: EntityRef, ctx: ResolverContext): ResolvedRef {
  if (ctx.hasDecision(ref.target)) {
    return {
      ...ref,
      state: 'resolved',
      entityId: `decision:${ref.target}`,
      title: ctx.getDecisionTitle(ref.target) ?? ref.target,
    };
  }
  return { ...ref, state: 'broken' };
}

// ---------------------------------------------------------------------------
// Engine Adapter — creates a ResolverContext from a TrellisVcsEngine
// ---------------------------------------------------------------------------

/**
 * Minimal engine interface for building a ResolverContext.
 * Accepts anything that quacks like TrellisVcsEngine.
 */
export interface Enginelike {
  trackedFiles(): Array<{ path: string; contentHash: string | undefined }>;
  getIssue(id: string): { title?: string } | null;
  listIssues(filters?: any): Array<{ id: string }>;
  listMilestones(): Array<{ id: string; message?: string }>;
  parseFile(
    content: string,
    filePath: string,
  ): { declarations: Array<{ name: string }> } | null;
  getOps(): Array<{ agentId: string }>;
  getRootPath(): string;
  getDecision?(id: string): { id: string; toolName: string } | null;
  queryDecisions?(filter?: any): Array<{ id: string; toolName: string }>;
}

/**
 * Build a ResolverContext from an engine-like object.
 * The symbol resolution reads files from disk and parses them.
 */
export function createResolverContext(engine: Enginelike): ResolverContext {
  // Cache tracked files
  const trackedSet = new Set(engine.trackedFiles().map((f) => f.path));

  // Cache agent IDs from ops
  const agentIds = new Set(engine.getOps().map((op) => op.agentId));

  // Cache issue IDs
  const issues = engine.listIssues();

  // Cache milestones
  const milestones = engine.listMilestones();

  return {
    hasTrackedFile(path: string): boolean {
      return trackedSet.has(path);
    },

    getIssueTitle(id: string): string | undefined {
      const issue = engine.getIssue(id);
      return issue?.title;
    },

    getMilestoneTitle(idOrMessage: string): string | undefined {
      // Try exact ID match first
      const byId = milestones.find((m) => m.id === idOrMessage);
      if (byId) return byId.message;

      // Try matching by message content
      const byMsg = milestones.find(
        (m) =>
          m.message &&
          m.message.toLowerCase().includes(idOrMessage.toLowerCase()),
      );
      return byMsg?.message;
    },

    hasSymbol(filePath: string, symbolName: string): boolean {
      try {
        const { readFileSync } = require('fs');
        const { join } = require('path');
        const absPath = join(engine.getRootPath(), filePath);
        const content = readFileSync(absPath, 'utf-8');
        const result = engine.parseFile(content, filePath);
        if (!result) return false;
        return result.declarations.some((d) => d.name === symbolName);
      } catch {
        return false;
      }
    },

    hasIdentity(id: string): boolean {
      // Check if this agent ID appears in any ops
      return agentIds.has(id) || agentIds.has(`agent:${id}`);
    },

    getKnownAgentIds(): string[] {
      return [...agentIds];
    },

    getTrackedFilePaths(): string[] {
      return [...trackedSet];
    },

    getIssueIds(): string[] {
      return issues.map((i) => i.id);
    },

    getMilestoneIds(): string[] {
      return milestones.map((m) => m.id);
    },

    hasDecision(id: string): boolean {
      if (!engine.getDecision) return false;
      return engine.getDecision(id) !== null;
    },

    getDecisionTitle(id: string): string | undefined {
      if (!engine.getDecision) return undefined;
      const d = engine.getDecision(id);
      return d?.toolName;
    },

    getSymbolNames(filePath: string): string[] {
      try {
        const { readFileSync } = require('fs');
        const { join } = require('path');
        const absPath = join(engine.getRootPath(), filePath);
        const content = readFileSync(absPath, 'utf-8');
        const result = engine.parseFile(content, filePath);
        if (!result) return [];
        return result.declarations.map((d) => d.name);
      } catch {
        return [];
      }
    },
  };
}
