/**
 * EAV Store Module (VCS-integrated)
 *
 * Persists CMS / knowledge-graph entities via vcs:storeAssert|Retract|Link|Unlink
 * ops in the integration journal (.trellis/ops.json). See ADR 0008.
 */

import type { Atom, Fact, Link } from '../core/store/eav-store.js';
import type { EntityRecord } from '../core/kernel/trellis-kernel.js';
import { createVcsOp } from './ops.js';
import type { VcsOp } from './types.js';
import type { EngineContext } from './engine-context.js';

const VCS_ENTITY_PREFIXES = ['issue:', 'file:', 'dir:', 'branch:', 'milestone:', 'checkpoint:', 'criterion:', 'lane:', 'decision:'];

export interface StoreEntityCreateOptions {
  links?: Array<{ attribute: string; targetEntityId: string }>;
}

export function getEntity(ctx: EngineContext, entityId: string): EntityRecord | null {
  const facts = ctx.store.getFactsByEntity(entityId);
  if (facts.length === 0) return null;

  const typeFact = facts.find((f) => f.a === 'type');
  return {
    id: entityId,
    type: (typeFact?.v as string) ?? 'unknown',
    facts,
    links: ctx.store.getLinksByEntity(entityId),
  };
}

export function listEntities(
  ctx: EngineContext,
  type?: string,
  filters?: Record<string, Atom>,
  opts?: { includeVcs?: boolean },
): EntityRecord[] {
  let entityIds: Set<string>;

  if (type) {
    entityIds = new Set(
      ctx.store.getFactsByValue('type', type).map((f) => f.e),
    );
  } else {
    entityIds = new Set(ctx.store.getFactsByAttribute('type').map((f) => f.e));
  }

  if (!opts?.includeVcs) {
    for (const id of entityIds) {
      if (VCS_ENTITY_PREFIXES.some((p) => id.startsWith(p))) {
        entityIds.delete(id);
      }
    }
  }

  if (filters) {
    for (const [attr, value] of Object.entries(filters)) {
      const matching = new Set(
        ctx.store.getFactsByValue(attr, value).map((f) => f.e),
      );
      for (const id of entityIds) {
        if (!matching.has(id)) entityIds.delete(id);
      }
    }
  }

  return Array.from(entityIds)
    .map((id) => getEntity(ctx, id)!)
    .filter(Boolean);
}

export async function createEntity(
  ctx: EngineContext,
  entityId: string,
  type: string,
  attributes: Record<string, Atom> = {},
  opts?: StoreEntityCreateOptions,
): Promise<VcsOp> {
  const facts: Fact[] = [
    { e: entityId, a: 'type', v: type },
    { e: entityId, a: 'createdAt', v: new Date().toISOString() },
  ];

  for (const [attr, value] of Object.entries(attributes)) {
    facts.push({ e: entityId, a: attr, v: value });
  }

  const op = await createVcsOp('vcs:storeAssert', {
    agentId: ctx.agentId,
    previousHash: ctx.getLastOp()?.hash,
    vcs: { facts },
  });
  await ctx.applyOp(op);

  if (opts?.links?.length) {
    for (const link of opts.links) {
      await addLink(ctx, entityId, link.attribute, link.targetEntityId);
    }
  }

  return op;
}

export async function updateEntity(
  ctx: EngineContext,
  entityId: string,
  updates: Record<string, Atom>,
): Promise<VcsOp> {
  const existing = ctx.store.getFactsByEntity(entityId);
  if (existing.length === 0) {
    throw new Error(`Entity ${entityId} not found.`);
  }

  const deleteFacts: Fact[] = [];
  const addFacts: Fact[] = [
    { e: entityId, a: 'updatedAt', v: new Date().toISOString() },
  ];

  for (const [attr, newValue] of Object.entries(updates)) {
    for (const f of existing.filter((x) => x.a === attr)) {
      deleteFacts.push(f);
    }
    addFacts.push({ e: entityId, a: attr, v: newValue });
  }

  if (deleteFacts.length > 0) {
    const retractOp = await createVcsOp('vcs:storeRetract', {
      agentId: ctx.agentId,
      previousHash: ctx.getLastOp()?.hash,
      vcs: { facts: deleteFacts },
    });
    await ctx.applyOp(retractOp);
  }

  const op = await createVcsOp('vcs:storeAssert', {
    agentId: ctx.agentId,
    previousHash: ctx.getLastOp()?.hash,
    vcs: { facts: addFacts },
  });
  await ctx.applyOp(op);
  return op;
}

export async function deleteEntity(
  ctx: EngineContext,
  entityId: string,
): Promise<VcsOp> {
  const facts = ctx.store.getFactsByEntity(entityId);
  const links = ctx.store.getLinksByEntity(entityId);
  if (facts.length === 0 && links.length === 0) {
    throw new Error(`Entity ${entityId} not found.`);
  }

  let lastOp: VcsOp | undefined;

  if (facts.length > 0) {
    lastOp = await createVcsOp('vcs:storeRetract', {
      agentId: ctx.agentId,
      previousHash: ctx.getLastOp()?.hash,
      vcs: { facts },
    });
    await ctx.applyOp(lastOp);
  }

  if (links.length > 0) {
    lastOp = await createVcsOp('vcs:storeUnlink', {
      agentId: ctx.agentId,
      previousHash: ctx.getLastOp()?.hash,
      vcs: { links },
    });
    await ctx.applyOp(lastOp);
  }

  return lastOp!;
}

export async function addFact(
  ctx: EngineContext,
  entityId: string,
  attribute: string,
  value: Atom,
): Promise<VcsOp> {
  const op = await createVcsOp('vcs:storeAssert', {
    agentId: ctx.agentId,
    previousHash: ctx.getLastOp()?.hash,
    vcs: { facts: [{ e: entityId, a: attribute, v: value }] },
  });
  await ctx.applyOp(op);
  return op;
}

export async function removeFact(
  ctx: EngineContext,
  entityId: string,
  attribute: string,
  value: Atom,
): Promise<VcsOp> {
  const op = await createVcsOp('vcs:storeRetract', {
    agentId: ctx.agentId,
    previousHash: ctx.getLastOp()?.hash,
    vcs: { facts: [{ e: entityId, a: attribute, v: value }] },
  });
  await ctx.applyOp(op);
  return op;
}

export async function addLink(
  ctx: EngineContext,
  sourceId: string,
  attribute: string,
  targetId: string,
): Promise<VcsOp> {
  const link: Link = { e1: sourceId, a: attribute, e2: targetId };
  const op = await createVcsOp('vcs:storeLink', {
    agentId: ctx.agentId,
    previousHash: ctx.getLastOp()?.hash,
    vcs: { links: [link] },
  });
  await ctx.applyOp(op);
  return op;
}

export async function removeLink(
  ctx: EngineContext,
  sourceId: string,
  attribute: string,
  targetId: string,
): Promise<VcsOp> {
  const link: Link = { e1: sourceId, a: attribute, e2: targetId };
  const op = await createVcsOp('vcs:storeUnlink', {
    agentId: ctx.agentId,
    previousHash: ctx.getLastOp()?.hash,
    vcs: { links: [link] },
  });
  await ctx.applyOp(op);
  return op;
}
