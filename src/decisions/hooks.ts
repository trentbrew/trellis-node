/**
 * Decision Hook Registry
 *
 * External agent harnesses register pre/post hooks to enrich decision traces
 * with rationale, alternatives, prompt context, etc.
 */

import type {
  DecisionPreHook,
  DecisionPostHook,
  DecisionContext,
  DecisionEnrichment,
} from './types.js';

// ---------------------------------------------------------------------------
// Hook Registry
// ---------------------------------------------------------------------------

export class HookRegistry {
  private preHooks: DecisionPreHook[] = [];
  private postHooks: DecisionPostHook[] = [];

  /**
   * Register a pre-hook that runs before a tool handler.
   */
  registerPreHook(hook: DecisionPreHook): void {
    this.preHooks.push(hook);
  }

  /**
   * Register a post-hook that runs after a tool handler.
   */
  registerPostHook(hook: DecisionPostHook): void {
    this.postHooks.push(hook);
  }

  /**
   * Remove a pre-hook by name.
   */
  removePreHook(name: string): void {
    this.preHooks = this.preHooks.filter((h) => h.name !== name);
  }

  /**
   * Remove a post-hook by name.
   */
  removePostHook(name: string): void {
    this.postHooks = this.postHooks.filter((h) => h.name !== name);
  }

  /**
   * Get all pre-hooks matching a tool name.
   */
  getPreHooks(toolName: string): DecisionPreHook[] {
    return this.preHooks.filter((h) => matchesPattern(h.toolPattern, toolName));
  }

  /**
   * Get all post-hooks matching a tool name.
   */
  getPostHooks(toolName: string): DecisionPostHook[] {
    return this.postHooks.filter((h) =>
      matchesPattern(h.toolPattern, toolName),
    );
  }

  /**
   * Run all matching pre-hooks and merge their contexts.
   */
  async runPreHooks(
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<DecisionContext> {
    const hooks = this.getPreHooks(toolName);
    const merged: DecisionContext = {};

    for (const hook of hooks) {
      try {
        const ctx = await hook.handler(toolName, input);
        Object.assign(merged, ctx);
        if (ctx.custom) {
          merged.custom = { ...merged.custom, ...ctx.custom };
        }
      } catch {
        // Hooks should not break tool execution
      }
    }

    return merged;
  }

  /**
   * Run all matching post-hooks and merge their enrichments.
   */
  async runPostHooks(
    toolName: string,
    input: Record<string, unknown>,
    output: unknown,
    preContext: DecisionContext,
  ): Promise<DecisionEnrichment> {
    const hooks = this.getPostHooks(toolName);
    const merged: DecisionEnrichment = {};

    for (const hook of hooks) {
      try {
        const enrichment = await hook.handler(
          toolName,
          input,
          output,
          preContext,
        );
        if (enrichment.rationale) merged.rationale = enrichment.rationale;
        if (enrichment.alternatives)
          merged.alternatives = enrichment.alternatives;
        if (enrichment.confidence !== undefined)
          merged.confidence = enrichment.confidence;
        if (enrichment.relatedEntities) {
          merged.relatedEntities = [
            ...(merged.relatedEntities ?? []),
            ...enrichment.relatedEntities,
          ];
        }
        if (enrichment.custom) {
          merged.custom = { ...merged.custom, ...enrichment.custom };
        }
      } catch {
        // Hooks should not break tool execution
      }
    }

    return merged;
  }

  /**
   * Clear all hooks.
   */
  clear(): void {
    this.preHooks = [];
    this.postHooks = [];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Match a tool name against a glob-like pattern or RegExp.
 * Supports `*` as a wildcard in string patterns (e.g. "trellis_issue_*").
 */
function matchesPattern(pattern: string | RegExp, toolName: string): boolean {
  if (pattern instanceof RegExp) {
    return pattern.test(toolName);
  }
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return pattern === toolName;

  // Convert glob to regex: escape special chars, replace * with .*
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(toolName);
}
