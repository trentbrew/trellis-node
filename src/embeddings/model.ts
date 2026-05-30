/**
 * Embedding Model
 *
 * Lazy-loads @huggingface/transformers (v3+) with all-MiniLM-L6-v2 (384-dim).
 * Falls back to @xenova/transformers (v2) if the new package is unavailable.
 * Model is loaded once on first use and cached for subsequent calls.
 *
 * @see TRL-18
 */

import { EmbeddingModelConfig, DEFAULT_MODEL_CONFIG } from './types.js';

// ---------------------------------------------------------------------------
// Model singleton
// ---------------------------------------------------------------------------

let pipeline: any = null;
let loadPromise: Promise<any> | null = null;

/**
 * Dynamically import the transformers library.
 * Tries @huggingface/transformers first (v3+), falls back to @xenova/transformers (v2).
 */
async function importTransformers(): Promise<{ pipeline: any }> {
  try {
    return await import('@huggingface/transformers' as string);
  } catch {
    try {
      return await import('@xenova/transformers' as string);
    } catch {
      throw new Error(
        'No transformers library found. Install @huggingface/transformers (recommended) or @xenova/transformers.',
      );
    }
  }
}

/**
 * Load the embedding model lazily. Returns the feature-extraction pipeline.
 * Subsequent calls return the cached pipeline.
 */
export async function loadModel(
  config: EmbeddingModelConfig = DEFAULT_MODEL_CONFIG,
): Promise<any> {
  if (pipeline) return pipeline;

  if (!loadPromise) {
    loadPromise = (async () => {
      const { pipeline: createPipeline } = await importTransformers();
      const opts: Record<string, unknown> = {};
      if (config.cacheDir) {
        opts.cache_dir = config.cacheDir;
      }
      pipeline = await createPipeline(
        'feature-extraction',
        config.modelName,
        opts,
      );
      return pipeline;
    })();
  }

  return loadPromise;
}

/**
 * Generate an embedding vector for the given text.
 * Returns a Float32Array of length `config.dimension` (default: 384).
 */
export async function embed(
  text: string,
  config: EmbeddingModelConfig = DEFAULT_MODEL_CONFIG,
): Promise<Float32Array> {
  const pipe = await loadModel(config);
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  // output.data is a Float32Array of shape [1, dimension]
  return new Float32Array(output.data);
}

/**
 * Generate embeddings for multiple texts in a batch.
 * More efficient than calling embed() individually.
 */
export async function embedBatch(
  texts: string[],
  config: EmbeddingModelConfig = DEFAULT_MODEL_CONFIG,
): Promise<Float32Array[]> {
  if (texts.length === 0) return [];

  const pipe = await loadModel(config);
  const results: Float32Array[] = [];

  // Process in batches of 32 to manage memory
  const batchSize = 32;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    for (const text of batch) {
      const output = await pipe(text, { pooling: 'mean', normalize: true });
      results.push(new Float32Array(output.data));
    }
  }

  return results;
}

/**
 * Reset the model singleton. Useful for testing.
 */
export function resetModel(): void {
  pipeline = null;
  loadPromise = null;
}
