/**
 * Compact graph summary for room MCP — token-efficient agent orientation.
 *
 * Mirrors trellis-client GET /api/graph/summary shape for skill portability.
 *
 * @module trellis/mcp
 */

import type { TrellisKernel } from '../core/kernel/trellis-kernel.js';

export interface RoomGraphSummaryOptions {
  limit?: number;
}

export interface RoomGraphSummary {
  health: {
    status: 'ok';
    factCount: number;
    linkCount: number;
    entityCount: number;
    ops: number;
    tenantId: string | null;
  };
  entityTypes: Array<{ type: string; count: number }>;
  ontologies: {
    total: number;
    system: string[];
    user: string[];
  };
  topAttributes: Array<{
    attribute: string;
    distinctCount: number;
    cardinality: 'one' | 'many';
  }>;
  links: { total: number; relations: string[] };
  recentMutations: Array<{
    kind: string;
    agentId: string;
    timestamp: string;
    entityId?: string;
  }>;
}

const SKIP_ATTRS = new Set(['@id', '@type', 'id', 'type']);

export function buildRoomGraphSummary(
  kernel: TrellisKernel,
  tenantId: string | null,
  opts: RoomGraphSummaryOptions = {},
): RoomGraphSummary {
  const limit = opts.limit ?? 10;
  const store = kernel.getStore();

  let factCount = 0;
  for (const _ of store.getAllFacts()) factCount++;

  let linkCount = 0;
  for (const _ of store.getAllLinks()) linkCount++;

  const typeCounts: Record<string, number> = {};
  const entityIds = new Set<string>();
  for (const fact of store.getAllFacts()) {
    if (fact.a === 'type') {
      const type = String(fact.v);
      typeCounts[type] = (typeCounts[type] ?? 0) + 1;
      entityIds.add(fact.e);
    }
  }

  const entityTypes = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([type, count]) => ({ type, count }));

  const systemOntologies: string[] = [];
  const userOntologies: string[] = [];
  for (const schema of kernel.listOntologies()) {
    const shortId = schema['@id'].replace(/^(trellis:schema\/|core:)/, '');
    if (schema.tier === 'user') {
      userOntologies.push(shortId);
    } else if (schema.tier !== 'core') {
      systemOntologies.push(shortId);
    }
  }

  const topAttributes = store
    .getCatalog()
    .filter((c) => !SKIP_ATTRS.has(c.attribute))
    .sort((a, b) => b.distinctCount - a.distinctCount)
    .slice(0, limit)
    .map((c) => ({
      attribute: c.attribute,
      distinctCount: c.distinctCount,
      cardinality: c.cardinality,
    }));

  const relations = new Set<string>();
  for (const link of store.getAllLinks()) relations.add(link.a);

  const recentMutations = kernel
    .readAllOps()
    .slice(-limit)
    .reverse()
    .map((op) => ({
      kind: op.kind,
      agentId: op.agentId,
      timestamp: op.timestamp,
      entityId: inferEntityIdFromOp(op),
    }));

  return {
    health: {
      status: 'ok',
      factCount,
      linkCount,
      entityCount: entityIds.size,
      ops: kernel.readAllOps().length,
      tenantId,
    },
    entityTypes,
    ontologies: {
      total: kernel.listOntologies().length,
      system: systemOntologies.slice(0, limit),
      user: userOntologies.slice(0, limit),
    },
    topAttributes,
    links: { total: linkCount, relations: [...relations].sort().slice(0, limit) },
    recentMutations,
  };
}

function inferEntityIdFromOp(op: {
  kind: string;
  facts?: Array<{ e: string; a: string }>;
  deleteFacts?: Array<{ e: string }>;
}): string | undefined {
  const facts = op.facts ?? op.deleteFacts;
  if (!facts?.length) return undefined;
  const typeFact = facts.find((f) => 'a' in f && f.a === 'type');
  return typeFact?.e ?? facts[0]?.e;
}
