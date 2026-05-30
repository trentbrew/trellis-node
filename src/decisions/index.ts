/**
 * Decision Traces Module
 *
 * Auto-captures agent decision traces from MCP tool invocations as
 * first-class Decision entities in the EAV store.
 *
 * Public API:
 * - recordDecision()   — persist a decision as a vcs:decisionRecord op
 * - queryDecisions()   — filter/list decisions from the EAV store
 * - getDecisionChain() — all decisions that affected a given entity
 * - HookRegistry       — pre/post hook registration for external harnesses
 * - wrapToolHandler()  — MCP middleware for auto-capture
 */

export { HookRegistry } from './hooks.js';
export {
  wrapToolHandler,
  type ToolHandler,
  type DecisionRecorder,
  type AutoCaptureOpts,
} from './auto-capture.js';
export type {
  Decision,
  DecisionInput,
  DecisionFilter,
  DecisionContext,
  DecisionEnrichment,
  DecisionPreHook,
  DecisionPostHook,
} from './types.js';

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { createVcsOp } from '../vcs/ops.js';
import { decisionEntityId } from '../vcs/types.js';
import type { VcsOp } from '../vcs/types.js';
import type { EngineContext } from '../vcs/engine-context.js';
import type { Decision, DecisionInput, DecisionFilter } from './types.js';

// ---------------------------------------------------------------------------
// Sequential Decision ID (file-based, matching issue counter pattern)
// ---------------------------------------------------------------------------

function getDecisionCounterPath(rootPath: string): string {
  return join(rootPath, '.trellis', 'decision-counter.json');
}

function nextDecisionId(rootPath: string): string {
  const counterPath = getDecisionCounterPath(rootPath);
  let counter = 0;
  if (existsSync(counterPath)) {
    try {
      counter = JSON.parse(readFileSync(counterPath, 'utf-8')).counter ?? 0;
    } catch {}
  }
  counter++;
  const dir = dirname(counterPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(counterPath, JSON.stringify({ counter }, null, 2));
  return `DEC-${counter}`;
}

// ---------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------

/**
 * Record a decision trace as a vcs:decisionRecord op.
 */
export async function recordDecision(
  ctx: EngineContext,
  rootPath: string,
  input: DecisionInput,
): Promise<VcsOp> {
  const id = nextDecisionId(rootPath);

  const op = await createVcsOp('vcs:decisionRecord', {
    agentId: ctx.agentId,
    previousHash: ctx.getLastOp()?.hash,
    vcs: {
      decisionId: id,
      decisionToolName: input.toolName,
      decisionToolInput: input.input ? JSON.stringify(input.input) : undefined,
      decisionToolOutput: input.outputSummary,
      decisionContext: input.context,
      decisionRationale: input.rationale,
      decisionAlternatives: input.alternatives
        ? JSON.stringify(input.alternatives)
        : undefined,
    },
  });
  await ctx.applyOp(op);

  // Store related entity links
  if (input.relatedEntities) {
    const eid = decisionEntityId(id);
    const links = input.relatedEntities.map((target) => ({
      e1: eid,
      a: 'relatedTo',
      e2: target,
    }));
    if (links.length > 0) {
      ctx.store.addLinks(links);
    }
  }

  return op;
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/**
 * Build a Decision from EAV facts for a given entity ID.
 */
function buildDecision(ctx: EngineContext, entityId: string): Decision {
  const facts = ctx.store.getFactsByEntity(entityId);
  const get = (a: string) => {
    const matches = facts.filter((f) => f.a === a);
    return matches.length > 0
      ? (matches[matches.length - 1].v as string)
      : undefined;
  };

  // Gather related entity links
  const links = ctx.store.getLinksByAttribute('relatedTo');
  const related = links.filter((l) => l.e1 === entityId).map((l) => l.e2);

  const bareId = entityId.replace(/^decision:/, '');

  const alternativesRaw = get('alternatives');
  let alternatives: string[] | undefined;
  if (alternativesRaw) {
    try {
      alternatives = JSON.parse(alternativesRaw);
    } catch {
      alternatives = [alternativesRaw];
    }
  }

  const confidenceRaw = get('confidence');
  const confidence =
    confidenceRaw !== undefined ? parseFloat(confidenceRaw) : undefined;

  return {
    id: bareId,
    toolName: get('toolName') ?? '',
    outputSummary: get('outputSummary'),
    context: get('context'),
    rationale: get('rationale'),
    alternatives,
    confidence,
    createdAt: get('createdAt'),
    createdBy: get('createdBy'),
    relatedEntities: related,
  };
}

/**
 * Query decisions with optional filters.
 */
export function queryDecisions(
  ctx: EngineContext,
  filter?: DecisionFilter,
): Decision[] {
  const decisionFacts = ctx.store
    .getFactsByAttribute('type')
    .filter((f) => f.v === 'Decision');

  let decisions = decisionFacts.map((f) => buildDecision(ctx, f.e));

  if (filter?.toolPattern) {
    const pattern = filter.toolPattern;
    const regex = pattern.includes('*')
      ? new RegExp(
          `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
        )
      : null;
    decisions = decisions.filter((d) =>
      regex ? regex.test(d.toolName) : d.toolName === pattern,
    );
  }

  if (filter?.agentId) {
    decisions = decisions.filter((d) => d.createdBy === filter.agentId);
  }

  if (filter?.since) {
    const since = new Date(filter.since).getTime();
    decisions = decisions.filter(
      (d) => d.createdAt && new Date(d.createdAt).getTime() >= since,
    );
  }

  if (filter?.until) {
    const until = new Date(filter.until).getTime();
    decisions = decisions.filter(
      (d) => d.createdAt && new Date(d.createdAt).getTime() <= until,
    );
  }

  if (filter?.entityId) {
    decisions = decisions.filter((d) =>
      d.relatedEntities.includes(filter.entityId!),
    );
  }

  // Sort by createdAt descending (newest first)
  decisions.sort((a, b) => {
    if (!a.createdAt || !b.createdAt) return 0;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  if (filter?.limit && filter.limit > 0) {
    decisions = decisions.slice(0, filter.limit);
  }

  return decisions;
}

/**
 * Get all decisions that affected a given entity (the decision chain).
 */
export function getDecisionChain(
  ctx: EngineContext,
  entityId: string,
): Decision[] {
  // Find all decision entities linked to this entity
  const allLinks = ctx.store.getLinksByAttribute('relatedTo');
  const decisionEids = new Set(
    allLinks
      .filter((l) => l.e2 === entityId)
      .map((l) => l.e1)
      .filter((e) => e.startsWith('decision:')),
  );

  const decisions = Array.from(decisionEids).map((eid) =>
    buildDecision(ctx, eid),
  );

  // Sort chronologically
  decisions.sort((a, b) => {
    if (!a.createdAt || !b.createdAt) return 0;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  return decisions;
}

/**
 * Get a single decision by ID.
 */
export function getDecision(ctx: EngineContext, id: string): Decision | null {
  const eid = decisionEntityId(id);
  const typeFact = ctx.store
    .getFactsByEntity(eid)
    .find((f) => f.a === 'type' && f.v === 'Decision');
  if (!typeFact) return null;
  return buildDecision(ctx, eid);
}
