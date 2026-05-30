/**
 * Idea Garden — Query Layer + Revive
 *
 * DESIGN.md §7.4–7.5 — Search and revive idea clusters.
 *
 * The Garden is a query layer over the causal stream that surfaces
 * abandoned work as searchable idea clusters. It also provides the
 * ability to revive clusters into new branches.
 */

import type { VcsOp } from '../vcs/types.js';
import {
  detectClusters,
  defaultDetectors,
  type IdeaCluster,
  type ClusterDetector,
} from './cluster.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScoredCluster {
  cluster: IdeaCluster;
  score: number;
}

export interface GardenSearchOpts {
  /** Filter by affected file path (substring match). */
  file?: string;
  /** Filter by keyword in affected files or estimated intent. */
  keyword?: string;
  /** Filter by cluster status. */
  status?: IdeaCluster['status'];
  /** Maximum results to return. */
  limit?: number;
  /** Use vector similarity when an EmbeddingManager is available (default: true). */
  semantic?: boolean;
}

/**
 * Optional embedding manager interface for vector-enhanced search.
 * Avoids hard dependency on the embeddings module.
 */
export interface GardenEmbedder {
  search(
    query: string,
    opts?: { limit?: number; filePrefix?: string },
  ): Promise<
    Array<{ chunk: { filePath?: string; content: string }; score: number }>
  >;
}

export interface GardenContext {
  /** All ops in the stream. */
  readAllOps(): VcsOp[];
  /** Set of op hashes that belong to a milestone range. */
  getMilestonedOpHashes(): Set<string>;
}

// ---------------------------------------------------------------------------
// Garden
// ---------------------------------------------------------------------------

export class IdeaGarden {
  private ctx: GardenContext;
  private detectors: ClusterDetector[];
  private _cache: IdeaCluster[] | null = null;
  private _revivedIds = new Set<string>();
  private _embedder: GardenEmbedder | null = null;

  constructor(ctx: GardenContext, detectors?: ClusterDetector[]) {
    this.ctx = ctx;
    this.detectors = detectors ?? defaultDetectors;
  }

  /**
   * Attach an embedding manager for vector-enhanced search.
   */
  setEmbedder(embedder: GardenEmbedder | null): void {
    this._embedder = embedder;
  }

  /**
   * Invalidate the cluster cache (call after new ops are added).
   */
  invalidate(): void {
    this._cache = null;
  }

  /**
   * Detect and return all idea clusters.
   */
  listClusters(): IdeaCluster[] {
    if (!this._cache) {
      const ops = this.ctx.readAllOps();
      const milestoned = this.ctx.getMilestonedOpHashes();
      this._cache = detectClusters(ops, milestoned, this.detectors);

      // Apply revived status
      for (const cluster of this._cache) {
        if (this._revivedIds.has(cluster.id)) {
          cluster.status = 'revived';
        }
      }
    }
    return this._cache;
  }

  /**
   * Get a single cluster by ID.
   */
  getCluster(clusterId: string): IdeaCluster | null {
    return this.listClusters().find((c) => c.id === clusterId) ?? null;
  }

  /**
   * Search clusters with filters (synchronous keyword search).
   */
  search(opts: GardenSearchOpts = {}): IdeaCluster[] {
    let clusters = this.listClusters();

    if (opts.status) {
      clusters = clusters.filter((c) => c.status === opts.status);
    }

    if (opts.file) {
      const fileTerm = opts.file.toLowerCase();
      clusters = clusters.filter((c) =>
        c.affectedFiles.some((f) => f.toLowerCase().includes(fileTerm)),
      );
    }

    if (opts.keyword) {
      const kw = opts.keyword.toLowerCase();
      clusters = clusters.filter((c) => {
        // Search in file paths
        if (c.affectedFiles.some((f) => f.toLowerCase().includes(kw)))
          return true;
        // Search in estimated intent
        if (c.estimatedIntent.toLowerCase().includes(kw)) return true;
        // Search in op kinds
        if (c.ops.some((o) => o.kind.toLowerCase().includes(kw))) return true;
        return false;
      });
    }

    if (opts.limit && opts.limit > 0) {
      clusters = clusters.slice(0, opts.limit);
    }

    return clusters;
  }

  /**
   * Vector-enhanced search: uses embeddings to find clusters whose affected
   * files are semantically similar to the query. Falls back to keyword search
   * if no embedder is attached.
   */
  async semanticSearch(opts: GardenSearchOpts = {}): Promise<ScoredCluster[]> {
    // Start with keyword-filtered clusters
    const keywordResults = this.search({ ...opts, limit: undefined });

    // If no embedder or semantic explicitly disabled, wrap as scored
    if (!this._embedder || opts.semantic === false) {
      const scored = keywordResults.map((c) => ({ cluster: c, score: 1.0 }));
      if (opts.limit && opts.limit > 0) return scored.slice(0, opts.limit);
      return scored;
    }

    // Use embeddings to score clusters by file similarity
    const query = opts.keyword ?? opts.file ?? '';
    if (!query) {
      const scored = keywordResults.map((c) => ({ cluster: c, score: 1.0 }));
      if (opts.limit && opts.limit > 0) return scored.slice(0, opts.limit);
      return scored;
    }

    const allClusters = this.listClusters();
    const embeddingResults = await this._embedder.search(query, { limit: 50 });

    // Build file → score map from embedding results
    const fileScores = new Map<string, number>();
    for (const r of embeddingResults) {
      if (r.chunk.filePath) {
        const existing = fileScores.get(r.chunk.filePath) ?? 0;
        fileScores.set(r.chunk.filePath, Math.max(existing, r.score));
      }
    }

    // Score each cluster by max file similarity
    const scored: ScoredCluster[] = [];
    const keywordIds = new Set(keywordResults.map((c) => c.id));

    for (const cluster of allClusters) {
      // Apply status and file filters
      if (opts.status && cluster.status !== opts.status) continue;
      if (opts.file) {
        const fileTerm = opts.file.toLowerCase();
        if (
          !cluster.affectedFiles.some((f) => f.toLowerCase().includes(fileTerm))
        )
          continue;
      }

      let maxScore = 0;
      for (const file of cluster.affectedFiles) {
        const s = fileScores.get(file) ?? 0;
        if (s > maxScore) maxScore = s;
      }

      // Boost keyword matches
      if (keywordIds.has(cluster.id)) {
        maxScore = Math.max(maxScore, 0.5);
      }

      if (maxScore > 0) {
        scored.push({ cluster, score: maxScore });
      }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    if (opts.limit && opts.limit > 0) return scored.slice(0, opts.limit);
    return scored;
  }

  /**
   * Mark a cluster as revived. Returns the ops to replay.
   */
  revive(clusterId: string): VcsOp[] | null {
    const cluster = this.getCluster(clusterId);
    if (!cluster) return null;

    cluster.status = 'revived';
    this._revivedIds.add(clusterId);
    this.invalidate();

    return cluster.ops;
  }

  /**
   * Get summary statistics for the garden.
   */
  stats(): {
    total: number;
    abandoned: number;
    draft: number;
    revived: number;
    totalOps: number;
    totalFiles: number;
  } {
    const clusters = this.listClusters();
    const allFiles = new Set<string>();
    let totalOps = 0;

    for (const c of clusters) {
      totalOps += c.ops.length;
      for (const f of c.affectedFiles) allFiles.add(f);
    }

    return {
      total: clusters.length,
      abandoned: clusters.filter((c) => c.status === 'abandoned').length,
      draft: clusters.filter((c) => c.status === 'draft').length,
      revived: clusters.filter((c) => c.status === 'revived').length,
      totalOps,
      totalFiles: allFiles.size,
    };
  }
}

// ---------------------------------------------------------------------------
// Helper: Build milestoned op hash set from ops
// ---------------------------------------------------------------------------

/**
 * Build a set of op hashes that fall within milestone ranges.
 * Used by the engine to provide GardenContext.getMilestonedOpHashes().
 */
export function buildMilestonedOpHashes(ops: VcsOp[]): Set<string> {
  const milestoned = new Set<string>();
  const milestoneOps = ops.filter((o) => o.kind === 'vcs:milestoneCreate');

  for (const mOp of milestoneOps) {
    const from = mOp.vcs?.fromOpHash;
    const to = mOp.vcs?.toOpHash;

    if (!from || !to) continue;

    const fromIdx = ops.findIndex((o) => o.hash === from);
    const toIdx = ops.findIndex((o) => o.hash === to);

    if (fromIdx >= 0 && toIdx >= 0) {
      for (let i = fromIdx; i <= toIdx; i++) {
        milestoned.add(ops[i].hash);
      }
    }

    // Also mark the milestone op itself
    milestoned.add(mOp.hash);
  }

  return milestoned;
}
