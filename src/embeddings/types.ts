/**
 * Embedding Types
 *
 * Types for the semantic embedding and vector search system.
 *
 * @see TRL-18
 */

// ---------------------------------------------------------------------------
// Chunk types — what gets embedded
// ---------------------------------------------------------------------------

export type ChunkType =
  | 'issue_title'
  | 'issue_desc'
  | 'milestone_msg'
  | 'decision_rationale'
  | 'summary_md'
  | 'code_entity'
  | 'doc_comment'
  | 'markdown';

export interface ChunkMeta {
  /** Unique chunk ID, e.g. "issue:TRL-5:title", "file:src/engine.ts:chunk:0" */
  id: string;
  /** EAV entity ID this chunk belongs to */
  entityId: string;
  /** Original text content */
  content: string;
  /** Chunk classification */
  chunkType: ChunkType;
  /** Source file path (nullable for non-file entities) */
  filePath?: string;
  /** When this chunk was last updated */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Embedding record — chunk + vector
// ---------------------------------------------------------------------------

export interface EmbeddingRecord extends ChunkMeta {
  /** 384-dimensional embedding vector */
  embedding: Float32Array;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchResult {
  /** Chunk metadata */
  chunk: ChunkMeta;
  /** Cosine similarity score (0..1) */
  score: number;
}

export interface SearchOptions {
  /** Max results to return (default: 10) */
  limit?: number;
  /** Filter by chunk type(s) */
  types?: ChunkType[];
  /** Filter by file path prefix */
  filePrefix?: string;
  /** Minimum similarity threshold (default: 0.0) */
  minScore?: number;
}

// ---------------------------------------------------------------------------
// Embedding model config
// ---------------------------------------------------------------------------

export interface EmbeddingModelConfig {
  /** Model name for transformers.js (default: "Xenova/all-MiniLM-L6-v2") */
  modelName: string;
  /** Embedding dimension (default: 384) */
  dimension: number;
  /** Cache directory for model files */
  cacheDir?: string;
}

export const DEFAULT_MODEL_CONFIG: EmbeddingModelConfig = {
  modelName: 'Xenova/all-MiniLM-L6-v2',
  dimension: 384,
};

/** New chunk types for generic graph entities */
export type GraphChunkType =
  | ChunkType
  | 'entity_summary'
  | 'entity_fact'
  | 'entity_link';
