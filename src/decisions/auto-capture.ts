/**
 * Decision Auto-Capture Middleware
 *
 * Wraps MCP tool handlers to automatically emit vcs:decisionRecord ops
 * for every tool invocation. Pre/post hooks can enrich the trace with
 * rationale, alternatives, and prompt context.
 */

import type { HookRegistry } from './hooks.js';
import type { DecisionInput, DecisionContext } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A generic MCP tool handler: receives params, returns a result. */
export type ToolHandler = (params: Record<string, unknown>) => Promise<unknown>;

/** Callback invoked after auto-capture builds the DecisionInput. */
export type DecisionRecorder = (decision: DecisionInput) => Promise<void>;

export interface AutoCaptureOpts {
  /** The hook registry for pre/post enrichment. */
  hooks: HookRegistry;
  /** Called to persist the decision as a VcsOp. */
  recorder: DecisionRecorder;
  /** Tool names to exclude from auto-capture (e.g. read-only queries). */
  exclude?: Set<string>;
}

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap an MCP tool handler for automatic decision trace capture.
 */
export function wrapToolHandler(
  toolName: string,
  handler: ToolHandler,
  opts: AutoCaptureOpts,
): ToolHandler {
  return async (params: Record<string, unknown>) => {
    // Skip excluded tools
    if (opts.exclude?.has(toolName)) {
      return handler(params);
    }

    // Run pre-hooks
    const preContext: DecisionContext = await opts.hooks.runPreHooks(
      toolName,
      params,
    );

    // Execute the actual tool
    const result = await handler(params);

    // Run post-hooks
    const enrichment = await opts.hooks.runPostHooks(
      toolName,
      params,
      result,
      preContext,
    );

    // Build the decision input
    const decision: DecisionInput = {
      toolName,
      input: sanitizeInput(params),
      outputSummary: summarize(result),
      context: preContext.prompt ?? preContext.conversationId,
      rationale: enrichment.rationale,
      alternatives: enrichment.alternatives,
      confidence: enrichment.confidence,
      relatedEntities: enrichment.relatedEntities,
      custom: {
        ...preContext.custom,
        ...enrichment.custom,
        agentModel: preContext.agentModel,
      },
    };

    // Record asynchronously — don't block tool response
    opts.recorder(decision).catch(() => {
      // Silently ignore recording failures
    });

    return result;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Remove potentially large/sensitive fields from tool input before storing.
 */
function sanitizeInput(
  params: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value.length > 2000) {
      sanitized[key] = value.slice(0, 2000) + '…';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Summarize a tool result to a concise string (max 500 chars).
 */
function summarize(result: unknown): string {
  if (result === null || result === undefined) return '';

  // MCP-style { content: [{ type: 'text', text: '...' }] }
  if (typeof result === 'object' && result !== null && 'content' in result) {
    const content = (result as any).content;
    if (Array.isArray(content)) {
      const texts = content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');
      return texts.length > 500 ? texts.slice(0, 500) + '…' : texts;
    }
  }

  const str =
    typeof result === 'string' ? result : JSON.stringify(result, null, 0);
  return str.length > 500 ? str.slice(0, 500) + '…' : str;
}

export { summarize as _summarizeForTest };
