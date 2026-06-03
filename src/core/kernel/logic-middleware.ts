/**
 * Logic Middleware
 *
 * Evaluates computed fields (formula, rollup, ai_generated) after queries.
 * Runs post-query to enrich EQL binding rows with computed values.
 */

import type { Atom } from '../store/eav-store.js';
import type { QueryResult } from '../query/engine.js';
import { evalExpr } from '../computation/expr-evaluator.js';
import type { KernelMiddleware, MiddlewareContext } from './middleware.js';
import type { SchemaDefinition } from '../ontology/types.js';

export interface LogicMiddlewareConfig {
  ontologies: Map<string, SchemaDefinition>;
  /** Resolve entity type from id when bindings omit an explicit type. */
  getEntityType?: (entityId: string) => string | undefined;
  /** Optional AI function for ai_generated fields */
  generateAiField?: (
    prompt: string,
    context: Record<string, unknown>,
  ) => Promise<string>;
}

/**
 * Creates a logic middleware that enriches query results with computed fields.
 * This middleware hooks into queries, not mutations.
 */
export function createLogicMiddleware(
  config: LogicMiddlewareConfig,
): KernelMiddleware {
  return {
    name: 'logic-computation',

    handleQuery(
      query: unknown,
      ctx: MiddlewareContext,
      next: (...args: unknown[]) => unknown,
    ) {
      const result = next(query) as QueryResult | undefined;

      if (result && Array.isArray(result.bindings)) {
        for (const binding of result.bindings) {
          enrichBinding(binding, config, ctx);
        }
      }

      return result;
    },
  };
}

function enrichBinding(
  binding: Record<string, Atom>,
  config: LogicMiddlewareConfig,
  ctx: MiddlewareContext,
): void {
  const row = binding as Record<string, unknown>;
  const type = resolveEntityType(binding, config);
  if (!type) return;

  const schema = config.ontologies.get(type);
  if (!schema) return;

  for (const field of schema.fields) {
    if (!(field.computed || field.formula || field.rollup || field.aiGenerated))
      continue;

    const fieldName = field.name;
    if (fieldName in binding) continue;

    if (field.formula) {
      binding[fieldName] = evalExpr(field.formula, row);
    }

    if (field.rollup) {
      binding[fieldName] = '';
    }

    if (field.aiGenerated && config.generateAiField) {
      const prompt = field.aiGenerated.prompt.replace(
        /\{\{(\w+)\}\}/g,
        (_, key) => String(row[key] ?? ''),
      );
      config
        .generateAiField(prompt, row)
        .then((value) => {
          binding[fieldName] = value;
        })
        .catch(() => {
          binding[fieldName] = '';
        });
    }
  }

  void ctx;
}

function resolveEntityType(
  binding: Record<string, Atom>,
  config: LogicMiddlewareConfig,
): string | undefined {
  const explicit = binding.type;
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;

  const entityId = findEntityId(binding);
  if (entityId && config.getEntityType) {
    return config.getEntityType(entityId);
  }

  return undefined;
}

function findEntityId(binding: Record<string, Atom>): string | undefined {
  for (const value of Object.values(binding)) {
    if (typeof value === 'string' && value.includes(':')) return value;
  }
  return undefined;
}
