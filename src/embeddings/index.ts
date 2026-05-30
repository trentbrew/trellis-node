/**
 * Embeddings Module — Public API
 *
 * Provides semantic embedding and vector search for TrellisVCS entities.
 *
 * @see TRL-18
 */

// Types
export type {
  ChunkType,
  ChunkMeta,
  EmbeddingRecord,
  SearchResult,
  SearchOptions,
  EmbeddingModelConfig,
} from './types.js';
export { DEFAULT_MODEL_CONFIG } from './types.js';

// Model
export { embed, embedBatch, loadModel, resetModel } from './model.js';

// Store
export { VectorStore, cosineSimilarity } from './store.js';

// Search
export { EmbeddingManager } from './search.js';
export type { SearchableEngine, Embedder } from './search.js';

// Auto-embedding middleware + RAG
export { createAutoEmbedMiddleware, buildRAGContext } from './auto-embed.js';
export type { AutoEmbedOptions, RAGContext } from './auto-embed.js';

// New graph chunk types
export type { GraphChunkType } from './types.js';

// Chunker
export {
  chunkIssue,
  chunkMilestone,
  chunkDecision,
  chunkMarkdown,
  chunkCodeEntities,
  chunkDocComments,
  chunkSummary,
  chunkFile,
  slidingWindow,
} from './chunker.js';
