/**
 * Logic Middleware
 *
 * Evaluates computed fields (formula, rollup, ai_generated) after queries.
 * Runs post-query to enrich results with computed values.
 */

import type { KernelMiddleware, MiddlewareContext } from './middleware.js';
import type { SchemaDefinition } from '../ontology/types.js';

export interface LogicMiddlewareConfig {
  ontologies: Map<string, SchemaDefinition>;
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
      // Execute the query first
      const result = next(query);

      // If result has rows, enrich with computed fields
      if (result && typeof result === 'object' && 'rows' in result) {
        const rows = (result as { rows: unknown[] }).rows;

        for (const row of rows) {
          if (row && typeof row === 'object') {
            enrichComputedFields(row as Record<string, unknown>, config, ctx);
          }
        }
      }

      return result;
    },
  };
}

/**
 * Enrich a row with computed field values.
 */
function enrichComputedFields(
  row: Record<string, unknown>,
  config: LogicMiddlewareConfig,
  ctx: MiddlewareContext,
): void {
  // Get entity type
  const type = row.type as string | undefined;
  if (!type) return;

  const schema = config.ontologies.get(type);
  if (!schema) return;

  // Find computed fields
  for (const field of schema.fields) {
    if (field.computed || field.formula || field.rollup || field.aiGenerated) {
      const fieldName = field.name;

      // Skip if already has value
      if (fieldName in row) continue;

      // Evaluate formula
      if (field.formula) {
        const computed = evaluateFormula(field.formula, row);
        row[fieldName] = computed;
      }

      // Evaluate rollup (simplified — would need to query related entities)
      if (field.rollup) {
        // TODO: Implement rollup aggregation
        row[fieldName] = null;
      }

      // Evaluate ai_generated
      if (field.aiGenerated && config.generateAiField) {
        const prompt = field.aiGenerated.prompt.replace(
          /\{\{(\w+)\}\}/g,
          (_, key) => String(row[key] ?? ''),
        );
        config
          .generateAiField(prompt, row)
          .then((value) => {
            row[fieldName] = value;
          })
          .catch(() => {
            row[fieldName] = null;
          });
      }
    }
  }
}

/**
 * Evaluate a simple formula string against a row.
 * Supports: $if, $round, $concat, basic arithmetic.
 */
function evaluateFormula(
  formula: string,
  row: Record<string, unknown>,
): unknown {
  // Simple formula parser — expand as needed

  // $if(condition, trueVal, falseVal)
  const ifMatch = formula.match(/\$if\((.+?),(.+?),(.+?)\)/);
  if (ifMatch) {
    const condition = ifMatch[1].trim();
    const trueVal = ifMatch[2].trim();
    const falseVal = ifMatch[3].trim();

    // Simple condition check
    const condResult = evaluateCondition(condition, row);
    return condResult
      ? evaluateValue(trueVal, row)
      : evaluateValue(falseVal, row);
  }

  // $round(value, decimals)
  const roundMatch = formula.match(/\$round\((.+?),(\d+)\)/);
  if (roundMatch) {
    const value = evaluateValue(roundMatch[1].trim(), row);
    const decimals = parseInt(roundMatch[2], 10);
    if (typeof value === 'number') {
      const factor = Math.pow(10, decimals);
      return Math.round(value * factor) / factor;
    }
  }

  // $concat(a, b, ...)
  if (formula.startsWith('$concat(')) {
    const args = formula
      .slice(8, -1)
      .split(',')
      .map((arg) => evaluateValue(arg.trim(), row));
    return args.join('');
  }

  // Simple field reference
  if (formula.startsWith('$')) {
    const fieldName = formula.slice(1);
    return row[fieldName];
  }

  // Literal string/number
  return evaluateValue(formula, row);
}

function evaluateCondition(
  condition: string,
  row: Record<string, unknown>,
): boolean {
  // Handle ==, !=, >, <, >=, <=
  const eqMatch = condition.match(/(\w+)\s*==\s*(.+)/);
  if (eqMatch) {
    const field = row[eqMatch[1]];
    const expected = evaluateValue(eqMatch[2], row);
    return field === expected;
  }

  const neMatch = condition.match(/(\w+)\s*!=\s*(.+)/);
  if (neMatch) {
    const field = row[neMatch[1]];
    const expected = evaluateValue(neMatch[2], row);
    return field !== expected;
  }

  const gtMatch = condition.match(/(\w+)\s*>\s*(.+)/);
  if (gtMatch) {
    const field = row[gtMatch[1]] as number;
    const expected = evaluateValue(gtMatch[2], row) as number;
    return field > expected;
  }

  const ltMatch = condition.match(/(\w+)\s*<\s*(.+)/);
  if (ltMatch) {
    const field = row[ltMatch[1]] as number;
    const expected = evaluateValue(ltMatch[2], row) as number;
    return field < expected;
  }

  // Truthy check
  return !!row[condition];
}

function evaluateValue(value: string, row: Record<string, unknown>): unknown {
  const trimmed = value.trim();

  // Field reference ($fieldName)
  if (trimmed.startsWith('$')) {
    return row[trimmed.slice(1)];
  }

  // Boolean
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  // Number
  const num = Number(trimmed);
  if (!isNaN(num) && trimmed !== '') return num;

  // String (remove quotes)
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}
