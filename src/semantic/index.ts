/**
 * Semantic Patching — Public Surface
 *
 * @module semantic
 *
 * Re-exports the {@link ParserAdapter} interface, the built-in
 * {@link typescriptParser} (Tier 1 regex-based TS/JS parser), and the
 * {@link semanticMerge} engine that merges patch sets with commutativity
 * analysis.
 *
 * @see DESIGN.md §4 for the full semantic patching specification.
 */

export type {
  ASTEntity,
  ASTEntityKind,
  ImportRelation,
  ExportRelation,
  ParseResult,
  ParserAdapter,
  SemanticPatch,
  SemanticMergeConflict,
  SemanticMergeResult,
} from './types.js';

export { typescriptParser } from './ts-parser.js';
export { pythonParser } from './python-parser.js';
export { goParser } from './go-parser.js';
export { rustParser } from './rust-parser.js';
export { rubyParser } from './ruby-parser.js';
export { javaParser } from './java-parser.js';
export { csharpParser } from './csharp-parser.js';

export { patchesCommute, semanticMerge } from './semantic-merge.js';
