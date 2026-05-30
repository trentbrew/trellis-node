/**
 * Decision Trace Types
 *
 * Types for auto-captured agent decision traces. Decisions are first-class
 * entities in the EAV store, emitted automatically from MCP tool calls
 * and enrichable via pre/post hooks.
 */

// ---------------------------------------------------------------------------
// Decision Entity
// ---------------------------------------------------------------------------

export interface Decision {
  id: string;
  toolName: string;
  input?: Record<string, unknown>;
  outputSummary?: string;
  context?: string;
  rationale?: string;
  alternatives?: string[];
  confidence?: number;
  createdAt?: string;
  createdBy?: string;
  /** IDs of related entities (issues, files, milestones) affected by this decision */
  relatedEntities: string[];
  custom?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Decision Input (for recording)
// ---------------------------------------------------------------------------

export interface DecisionInput {
  toolName: string;
  input?: Record<string, unknown>;
  outputSummary?: string;
  context?: string;
  rationale?: string;
  alternatives?: string[];
  confidence?: number;
  /** Entity IDs this decision relates to (e.g. "issue:TRL-5") */
  relatedEntities?: string[];
  custom?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Decision Filters (for querying)
// ---------------------------------------------------------------------------

export interface DecisionFilter {
  /** Filter by MCP tool name (glob-like, e.g. "trellis_issue_*") */
  toolPattern?: string;
  /** Filter by agent ID */
  agentId?: string;
  /** Only decisions after this ISO timestamp */
  since?: string;
  /** Only decisions before this ISO timestamp */
  until?: string;
  /** Only decisions referencing this entity */
  entityId?: string;
  /** Max results */
  limit?: number;
}

// ---------------------------------------------------------------------------
// Hook Types
// ---------------------------------------------------------------------------

export interface DecisionContext {
  prompt?: string;
  conversationId?: string;
  agentModel?: string;
  custom?: Record<string, unknown>;
}

export interface DecisionEnrichment {
  rationale?: string;
  alternatives?: string[];
  confidence?: number;
  relatedEntities?: string[];
  custom?: Record<string, unknown>;
}

export interface DecisionPreHook {
  name: string;
  /** Which tools to intercept — string (glob) or RegExp */
  toolPattern: string | RegExp;
  handler: (
    toolName: string,
    input: Record<string, unknown>,
  ) => Promise<DecisionContext>;
}

export interface DecisionPostHook {
  name: string;
  toolPattern: string | RegExp;
  handler: (
    toolName: string,
    input: Record<string, unknown>,
    output: unknown,
    preContext: DecisionContext,
  ) => Promise<DecisionEnrichment>;
}
