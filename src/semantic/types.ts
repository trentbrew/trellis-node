/**
 * Semantic Patching — Type Definitions
 *
 * DESIGN.md §4.1–4.4 — Pillar 2: Semantic Patching.
 * Types for parser adapters, AST entities, parse results,
 * semantic patches, and structured merge conflicts.
 */

// ---------------------------------------------------------------------------
// AST Entities
// ---------------------------------------------------------------------------

export interface ASTEntity {
  /** Stable ID derived from structural signature (name + kind + scope path). */
  id: string;
  /** Entity type. */
  kind: ASTEntityKind;
  /** Human-readable name. */
  name: string;
  /** Scope path for disambiguation (e.g. 'MyClass.myMethod'). */
  scopePath: string;
  /** Byte range in source for roundtrip (start, end). */
  span: [number, number];
  /** Raw source text of this declaration. */
  rawText: string;
  /** Structural signature for identity matching (excludes whitespace/comments). */
  signature: string;
  /** Child entities (nested functions, inner classes, etc.). */
  children: ASTEntity[];
}

export type ASTEntityKind =
  | 'FunctionDef'
  | 'ClassDef'
  | 'InterfaceDef'
  | 'TypeAlias'
  | 'EnumDef'
  | 'VariableDecl'
  | 'MethodDef'
  | 'PropertyDef'
  | 'Constructor'
  | 'Unknown';

// ---------------------------------------------------------------------------
// Import / Export Relations
// ---------------------------------------------------------------------------

export interface ImportRelation {
  source: string;
  specifiers: string[];
  isDefault: boolean;
  isNamespace: boolean;
  rawText: string;
  span: [number, number];
}

export interface ExportRelation {
  name: string;
  isDefault: boolean;
  source?: string;
  rawText: string;
  span: [number, number];
}

// ---------------------------------------------------------------------------
// Parse Result
// ---------------------------------------------------------------------------

export interface ParseResult {
  /** The file entity this parse belongs to. */
  fileEntityId: string;
  /** File path. */
  filePath: string;
  /** Language identifier. */
  language: string;
  /** Top-level declarations found in the file. */
  declarations: ASTEntity[];
  /** Import relationships. */
  imports: ImportRelation[];
  /** Export relationships. */
  exports: ExportRelation[];
}

// ---------------------------------------------------------------------------
// Parser Adapter Interface
// ---------------------------------------------------------------------------

export interface ParserAdapter {
  /** Languages this adapter supports. */
  languages: string[];
  /** Parse a source file into AST-level entities. */
  parse(content: string, filePath: string): ParseResult;
  /** Compute semantic patches between two parse results. */
  diff(oldResult: ParseResult, newResult: ParseResult): SemanticPatch[];
}

// ---------------------------------------------------------------------------
// Semantic Patch Types
// ---------------------------------------------------------------------------

export type SemanticPatch =
  | { kind: 'symbolAdd'; entity: ASTEntity }
  | { kind: 'symbolRemove'; entityId: string; entityName: string }
  | {
      kind: 'symbolModify';
      entityId: string;
      entityName: string;
      oldSignature: string;
      newSignature: string;
      oldRawText: string;
      newRawText: string;
    }
  | {
      kind: 'symbolRename';
      entityId: string;
      oldName: string;
      newName: string;
    }
  | {
      kind: 'symbolMove';
      entityId: string;
      entityName: string;
      oldFile: string;
      newFile: string;
    }
  | {
      kind: 'importAdd';
      fileId: string;
      source: string;
      specifiers: string[];
      rawText: string;
    }
  | {
      kind: 'importRemove';
      fileId: string;
      source: string;
    }
  | {
      kind: 'importModify';
      fileId: string;
      source: string;
      oldSpecifiers: string[];
      newSpecifiers: string[];
    }
  | {
      kind: 'exportAdd';
      fileId: string;
      name: string;
      rawText: string;
    }
  | {
      kind: 'exportRemove';
      fileId: string;
      name: string;
    };

// ---------------------------------------------------------------------------
// Semantic Merge Conflict
// ---------------------------------------------------------------------------

export interface SemanticMergeConflict {
  entityId: string;
  entityName: string;
  entityKind: string;
  filePath: string;
  ours: SemanticPatch;
  theirs: SemanticPatch;
  suggestion?: 'accept-ours' | 'accept-theirs' | 'combine';
}

export interface SemanticMergeResult {
  clean: boolean;
  patches: SemanticPatch[];
  conflicts: SemanticMergeConflict[];
}
