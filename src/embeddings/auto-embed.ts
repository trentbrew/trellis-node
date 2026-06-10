/**
 * Auto-Embedding Middleware
 *
 * Kernel middleware that automatically embeds entity facts and links
 * on graph mutations. Runs after successful ops to index new/changed
 * content into the vector store.
 *
 * @module trellis/embeddings
 */

import type { KernelOp } from '../core/persist/backend.js';
import type {
  KernelMiddleware,
  MiddlewareContext,
  OpMiddlewareNext,
} from '../core/kernel/middleware.js';
import type { Fact, Link } from '../core/store/eav-store.js';
import type { ChunkMeta, EmbeddingRecord } from './types.js';
import type { Embedder } from './search.js';
import { VectorStore } from './store.js';
import { embed } from './model.js';

// ---------------------------------------------------------------------------
// Entity text builder — converts facts/links into embeddable text
// ---------------------------------------------------------------------------

function factsToText(facts: Fact[]): string {
  return facts
    .filter((f) => f.a !== 'createdAt' && f.a !== 'updatedAt')
    .map((f) => `${f.a}: ${f.v}`)
    .join('\n');
}

function linksToText(links: Link[]): string {
  return links.map((l) => `${l.e1} —[${l.a}]→ ${l.e2}`).join('\n');
}

function entitySummaryText(
  entityId: string,
  facts: Fact[],
  links: Link[],
): string {
  const type = facts.find((f) => f.a === 'type')?.v ?? 'Entity';
  const name =
    facts.find((f) => f.a === 'name' || f.a === 'title')?.v ?? entityId;
  const parts = [`${type}: ${name} (${entityId})`];

  const attrs = facts.filter(
    (f) => !['type', 'name', 'title', 'createdAt', 'updatedAt'].includes(f.a),
  );
  if (attrs.length > 0) {
    parts.push(attrs.map((f) => `  ${f.a} = ${f.v}`).join('\n'));
  }

  if (links.length > 0) {
    parts.push('Relations:');
    parts.push(links.map((l) => `  ${l.a} → ${l.e2}`).join('\n'));
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

export interface AutoEmbedOptions {
  /** Path to the vector store SQLite database. */
  dbPath: string;
  /** Custom embedder function (default: transformers.js embed). */
  embedFn?: Embedder;
  /** Whether to embed facts individually (default: false — only entity summaries). */
  embedIndividualFacts?: boolean;
}

/**
 * Creates a kernel middleware that auto-embeds entities on mutation.
 *
 * On addFacts/addLinks: embeds entity summaries into the vector store.
 * On deleteFacts/deleteLinks: removes stale embeddings.
 */
export async function createAutoEmbedMiddleware(
  options: AutoEmbedOptions,
): Promise<KernelMiddleware & { close: () => void }> {
  const store = await VectorStore.create(options.dbPath);
  const embedFn = options.embedFn ?? embed;
  const embedIndividual = options.embedIndividualFacts ?? false;

  return {
    name: 'auto-embed',

    handleOp: async (
      op: KernelOp,
      ctx: MiddlewareContext,
      next: OpMiddlewareNext,
    ) => {
      // Let the op proceed first
      await next(op, ctx);

      // Then asynchronously embed (don't block the mutation)
      try {
        await _processOp(op, store, embedFn, embedIndividual);
      } catch {
        // Embedding failures are non-fatal
      }
    },

    close: () => {
      store.close();
    },
  };
}

async function _processOp(
  op: KernelOp,
  store: VectorStore,
  embedFn: Embedder,
  embedIndividual: boolean,
): Promise<void> {
  const now = new Date().toISOString();

  // Collect affected entity IDs
  const entityIds = new Set<string>();
  if (op.facts) for (const f of op.facts) entityIds.add(f.e);
  if (op.links)
    for (const l of op.links) {
      entityIds.add(l.e1);
      entityIds.add(l.e2);
    }
  if (op.deleteFacts) for (const f of op.deleteFacts) entityIds.add(f.e);
  if (op.deleteLinks)
    for (const l of op.deleteLinks) {
      entityIds.add(l.e1);
      entityIds.add(l.e2);
    }

  let mutated = false;

  // Handle deletions — remove old embeddings for deleted entities
  if (op.deleteFacts || op.deleteLinks) {
    for (const eid of entityIds) {
      store.deleteByEntity(eid);
    }
    mutated = true;
  }

  // Handle additions — embed entity summaries
  if (op.facts && op.facts.length > 0) {
    // Group facts by entity
    const factsByEntity = new Map<string, Fact[]>();
    for (const f of op.facts) {
      const existing = factsByEntity.get(f.e) ?? [];
      existing.push(f);
      factsByEntity.set(f.e, existing);
    }

    const linksByEntity = new Map<string, Link[]>();
    if (op.links) {
      for (const l of op.links) {
        const existing = linksByEntity.get(l.e1) ?? [];
        existing.push(l);
        linksByEntity.set(l.e1, existing);
      }
    }

    const records: EmbeddingRecord[] = [];

    for (const [eid, facts] of factsByEntity) {
      const links = linksByEntity.get(eid) ?? [];

      // Entity summary embedding
      const summaryText = entitySummaryText(eid, facts, links);
      if (summaryText.trim()) {
        try {
          const vector = await embedFn(summaryText);
          records.push({
            id: `entity:${eid}:summary`,
            entityId: eid,
            content: summaryText,
            chunkType: 'summary_md' as any,
            updatedAt: now,
            embedding: vector,
          });
        } catch {}
      }

      // Individual fact embeddings (optional)
      if (embedIndividual) {
        for (const fact of facts) {
          if (['type', 'createdAt', 'updatedAt'].includes(fact.a)) continue;
          const text = `${fact.a}: ${fact.v}`;
          try {
            const vector = await embedFn(text);
            records.push({
              id: `entity:${eid}:fact:${fact.a}`,
              entityId: eid,
              content: text,
              chunkType: 'doc_comment' as any,
              updatedAt: now,
              embedding: vector,
            });
          } catch {}
        }
      }
    }

    if (records.length > 0) {
      store.upsertBatch(records);
      mutated = true;
    }
  }

  // Persist immediately so embeddings are durable per-op. The store otherwise
  // only flushes its in-memory image to disk every N writes, which would leave
  // freshly indexed entities invisible to readers that open the store anew.
  if (mutated) {
    store.flush();
  }
}

// ---------------------------------------------------------------------------
// RAG Context Builder
// ---------------------------------------------------------------------------

export interface RAGContext {
  /** The original query. */
  query: string;
  /** Retrieved chunks ranked by relevance. */
  chunks: Array<{
    content: string;
    entityId: string;
    score: number;
    chunkType: string;
  }>;
  /** Total token estimate (rough: 1 token ≈ 4 chars). */
  estimatedTokens: number;
}

/**
 * Build a RAG context from a natural language query.
 * Searches the vector store and assembles ranked context chunks.
 */
export async function buildRAGContext(
  query: string,
  vectorStore: VectorStore,
  embedFn: Embedder = embed,
  options?: {
    maxChunks?: number;
    maxTokens?: number;
    minScore?: number;
  },
): Promise<RAGContext> {
  const maxChunks = options?.maxChunks ?? 10;
  const maxTokens = options?.maxTokens ?? 4000;
  const minScore = options?.minScore ?? 0.1;

  const queryVector = await embedFn(query);
  const results = vectorStore.search(queryVector, {
    limit: maxChunks * 2,
    minScore,
  });

  const chunks: RAGContext['chunks'] = [];
  let totalChars = 0;

  for (const r of results) {
    if (chunks.length >= maxChunks) break;
    if (totalChars + r.chunk.content.length > maxTokens * 4) break;

    chunks.push({
      content: r.chunk.content,
      entityId: r.chunk.entityId,
      score: r.score,
      chunkType: r.chunk.chunkType,
    });
    totalChars += r.chunk.content.length;
  }

  return {
    query,
    chunks,
    estimatedTokens: Math.ceil(totalChars / 4),
  };
}
