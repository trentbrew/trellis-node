/**
 * Linked Markdown
 *
 * Wiki-link parser, entity reference resolver, and bidirectional
 * reference index for [[...]] syntax in markdown and doc-comments.
 *
 * @see TRL-11
 */

export {
  parseFileRefs,
  parseMarkdownRefs,
  parseDocCommentRefs,
  parseRefContent,
  inferNamespace,
} from './parser.js';
export { resolveRef, resolveRefs, createResolverContext } from './resolver.js';
export type { ResolverContext, Enginelike } from './resolver.js';
export {
  buildRefIndex,
  updateFileInIndex,
  removeFileFromIndex,
  getOutgoingRefs,
  getBacklinks,
  getReferencedEntities,
  getFilesWithRefs,
  getIndexStats,
} from './ref-index.js';
export {
  StaleRefRegistry,
  buildRenameProposal,
  applyRenameProposal,
  handleSymbolDeletion,
  handleFileDeletion,
  getDiagnostics,
  processSemanticPatches,
} from './lifecycle.js';
export type { StaleRef, RefDiagnostic, LifecycleEvent } from './lifecycle.js';
export type {
  EntityRef,
  RefSource,
  RefContext,
  RefNamespace,
  ResolvedRef,
  RefState,
  RefIndex,
  RefUpdateProposal,
  RefRewrite,
} from './types.js';
