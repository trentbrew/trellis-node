/**
 * Integration materialization cache + lane overlay (W4 lazy replay).
 *
 * ADR 0001: do not replay all lane journals on every open — cache integration
 * state and overlay only the active lane journal.
 */

import { EAVStore } from '../core/store/eav-store.js';
import { decompose } from './decompose.js';
import type { VcsOp } from './types.js';

export interface MaterializationStats {
  /** Integration ops replayed in the last materialize call (0 = cache hit). */
  integrationOpsReplayed: number;
  /** Lane ops replayed in the last overlay call. */
  laneOpsReplayed: number;
  /** True when integration cache tail matched the journal tail. */
  integrationCacheHit: boolean;
  /** Integration journal tail hash after last materialize. */
  integrationTailHash?: string;
}

export interface IntegrationCache {
  tailHash: string | undefined;
  store: EAVStore;
}

export function emptyMaterializationStats(): MaterializationStats {
  return {
    integrationOpsReplayed: 0,
    laneOpsReplayed: 0,
    integrationCacheHit: false,
  };
}

export function replayOpIntoStore(store: EAVStore, op: VcsOp): void {
  const d = decompose(op);
  if (d.deleteFacts.length > 0) store.deleteFacts(d.deleteFacts);
  if (d.deleteLinks.length > 0) store.deleteLinks(d.deleteLinks);
  if (d.addFacts.length > 0) store.addFacts(d.addFacts);
  if (d.addLinks.length > 0) store.addLinks(d.addLinks);
}

/** Clone an EAV store via snapshot/restore (lane overlay fork point). */
export function cloneStore(source: EAVStore): EAVStore {
  const clone = new EAVStore();
  clone.restore(source.snapshot());
  return clone;
}

export function materializeIntegrationOps(
  ops: VcsOp[],
  cache: IntegrationCache | null,
  tailHash: string | undefined,
): { store: EAVStore; cache: IntegrationCache; stats: MaterializationStats } {
  if (cache && cache.tailHash === tailHash) {
    return {
      store: cache.store,
      cache,
      stats: {
        integrationOpsReplayed: 0,
        laneOpsReplayed: 0,
        integrationCacheHit: true,
        integrationTailHash: tailHash,
      },
    };
  }

  const store = new EAVStore();
  for (const op of ops) {
    replayOpIntoStore(store, op);
  }

  return {
    store,
    cache: { tailHash, store },
    stats: {
      integrationOpsReplayed: ops.length,
      laneOpsReplayed: 0,
      integrationCacheHit: false,
      integrationTailHash: tailHash,
    },
  };
}

/** Apply lane journal ops on a fork of the integration store. */
export function overlayLaneOps(
  integrationStore: EAVStore,
  laneOps: VcsOp[],
): { store: EAVStore; laneOpsReplayed: number } {
  const store = cloneStore(integrationStore);
  for (const op of laneOps) {
    replayOpIntoStore(store, op);
  }
  return { store, laneOpsReplayed: laneOps.length };
}

/**
 * Materialize a child-fork lane entry (ADR 0007).
 * Integration through baseOpHash, then parent journal, then child journal.
 */
export function materializeChildForkEntry(
  integrationOps: VcsOp[],
  baseOpHash: string,
  parentLaneOps: VcsOp[],
  childLaneOps: VcsOp[],
): { store: EAVStore; stats: MaterializationStats } {
  const store = new EAVStore();
  let integrationReplayed = 0;

  for (const op of integrationOps) {
    replayOpIntoStore(store, op);
    integrationReplayed++;
    if (op.hash === baseOpHash) break;
  }

  for (const op of parentLaneOps) {
    replayOpIntoStore(store, op);
  }
  for (const op of childLaneOps) {
    replayOpIntoStore(store, op);
  }

  return {
    store,
    stats: {
      integrationOpsReplayed: integrationReplayed,
      laneOpsReplayed: parentLaneOps.length + childLaneOps.length,
      integrationCacheHit: false,
      integrationTailHash: integrationOps[integrationOps.length - 1]?.hash,
    },
  };
}
