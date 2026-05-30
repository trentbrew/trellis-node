/**
 * Linked Markdown — Type Definitions
 *
 * Types for wiki-link parsing, entity reference resolution,
 * and bidirectional reference indexing.
 *
 * @see TRL-11
 */

// ---------------------------------------------------------------------------
// Reference Namespaces
// ---------------------------------------------------------------------------

export type RefNamespace =
  | 'issue'
  | 'file'
  | 'symbol'
  | 'identity'
  | 'milestone'
  | 'decision';

// ---------------------------------------------------------------------------
// Entity Reference (parsed from [[...]] syntax)
// ---------------------------------------------------------------------------

export interface EntityRef {
  /** Full matched text inside [[ ]], e.g. "issue:TRL-5|the parser ticket" */
  raw: string;
  /** Resolved or inferred namespace */
  namespace: RefNamespace;
  /** Target identifier, e.g. "TRL-5", "src/engine.ts" */
  target: string;
  /** Optional anchor for symbol refs, e.g. "createIssue" in [[src/engine.ts#createIssue]] */
  anchor?: string;
  /** Optional display alias, e.g. "the parser ticket" in [[TRL-5|the parser ticket]] */
  alias?: string;
  /** Where this reference was found */
  source: RefSource;
}

// ---------------------------------------------------------------------------
// Reference Source Location
// ---------------------------------------------------------------------------

export interface RefSource {
  /** File containing the reference */
  filePath: string;
  /** 1-indexed line number */
  line: number;
  /** 0-indexed column offset of the opening [[ */
  col: number;
  /** Context in which the ref was found */
  context: RefContext;
}

export type RefContext = 'markdown' | 'jsdoc' | 'pydoc' | 'rustdoc' | 'godoc' | 'comment';

// ---------------------------------------------------------------------------
// Resolved Reference
// ---------------------------------------------------------------------------

export type RefState = 'resolved' | 'stale' | 'broken';

export interface ResolvedRef extends EntityRef {
  /** Whether the reference target was found */
  state: RefState;
  /** EAV entity ID if resolved (e.g. "issue:TRL-5", "file:src/engine.ts") */
  entityId?: string;
  /** Human-readable label from the resolved entity */
  title?: string;
  /** For stale refs: the op hash that caused the ref to become stale */
  staleOpHash?: string;
  /** For stale refs: reason it became stale */
  staleReason?: 'renamed' | 'deleted';
}

// ---------------------------------------------------------------------------
// Reference Index
// ---------------------------------------------------------------------------

export interface RefIndex {
  /** Forward: source file → refs it contains */
  outgoing: Map<string, EntityRef[]>;
  /** Backward: target entity ID → sources that reference it */
  incoming: Map<string, RefSource[]>;
}

// ---------------------------------------------------------------------------
// Ref Update Proposal (for rename prompts)
// ---------------------------------------------------------------------------

export interface RefUpdateProposal {
  /** The rename that triggered this proposal */
  oldTarget: string;
  newTarget: string;
  /** Files that would be modified */
  affectedFiles: string[];
  /** Individual ref rewrites */
  rewrites: RefRewrite[];
}

export interface RefRewrite {
  filePath: string;
  line: number;
  col: number;
  oldText: string;
  newText: string;
}
