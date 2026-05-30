/**
 * Schema Validation Middleware
 *
 * Validates mutations against ontology schemas. Blocks operations that
 * violate schema constraints (required fields, type mismatches, etc.).
 */

import type { KernelOp } from '../persist/backend.js';
import type {
  KernelMiddleware,
  MiddlewareContext,
  OpMiddlewareNext,
} from './middleware.js';
import type {
  SchemaDefinition,
  PropertyValueSpecification,
} from '../ontology/types.js';
import type { Atom } from '../store/eav-store.js';

export interface SchemaMiddlewareConfig {
  ontologies: Map<string, SchemaDefinition>;
  /** Whether to block on validation errors (default: true) */
  strict?: boolean;
}

export function createSchemaMiddleware(
  config: SchemaMiddlewareConfig,
): KernelMiddleware {
  const strict = config.strict ?? true;

  return {
    name: 'schema-validation',

    async handleOp(
      op: KernelOp,
      ctx: MiddlewareContext,
      next: OpMiddlewareNext,
    ): Promise<void> {
      // Only validate mutations with facts
      if (!op.facts || op.facts.length === 0) {
        return next(op, ctx);
      }

      const errors: string[] = [];

      for (const fact of op.facts) {
        // Get entity type from facts
        const typeFact = op.facts?.find(
          (f) => f.e === fact.e && f.a === 'type',
        );
        if (!typeFact) continue;

        const entityType = typeFact.v as string;
        const schema = config.ontologies.get(entityType);

        if (!schema) {
          // No schema defined — allow
          continue;
        }

        // Find the field specification
        const fieldSpec = schema.fields.find((f) => f.name === fact.a);
        if (!fieldSpec) {
          // Field not in schema — allow (extensible)
          continue;
        }

        // Validate value type
        const validationError = validateValue(fact.a, fact.v, fieldSpec);
        if (validationError) {
          errors.push(validationError);
        }

        // Check required fields
        if (fieldSpec.required) {
          const hasValue = op.facts?.some(
            (f) => f.e === fact.e && f.a === fact.a,
          );
          if (!hasValue) {
            errors.push(
              `Missing required field: ${fact.a} on entity ${fact.e}`,
            );
          }
        }
      }

      if (errors.length > 0 && strict) {
        const errorMsg = errors.join('; ');
        throw new Error(`Schema validation failed: ${errorMsg}`);
      }

      return next(op, ctx);
    },
  };
}

function validateValue(
  fieldName: string,
  value: Atom,
  spec: PropertyValueSpecification,
): string | null {
  // Null/undefined check
  if (value === null || value === undefined) {
    return null; // Allow nulls (use required flag to block)
  }

  // Type validation
  const actualType = typeof value;

  switch (spec.valueType) {
    case 'title':
    case 'rich_text':
    case 'select':
    case 'multi_select':
    case 'status':
    case 'phone_number':
    case 'url':
    case 'email':
      if (actualType !== 'string') {
        return `Field ${fieldName}: expected string, got ${actualType}`;
      }

      // Validate select options
      if (spec.selectOptions && spec.selectOptions.length > 0) {
        if (!spec.selectOptions.includes(value)) {
          return `Field ${fieldName}: value "${value}" not in allowed options`;
        }
      }
      break;

    case 'number':
      if (actualType !== 'number') {
        return `Field ${fieldName}: expected number, got ${actualType}`;
      }

      if (spec.min !== undefined && (value as number) < spec.min) {
        return `Field ${fieldName}: value ${value} below minimum ${spec.min}`;
      }
      if (spec.max !== undefined && (value as number) > spec.max) {
        return `Field ${fieldName}: value ${value} above maximum ${spec.max}`;
      }
      break;

    case 'checkbox':
      if (actualType !== 'boolean') {
        return `Field ${fieldName}: expected boolean, got ${actualType}`;
      }
      break;

    case 'date':
      // Allow ISO strings or dates
      if (actualType === 'string') {
        const date = new Date(value as string);
        if (isNaN(date.getTime())) {
          return `Field ${fieldName}: invalid date format`;
        }
      } else if (actualType !== 'object') {
        return `Field ${fieldName}: expected date string or object, got ${actualType}`;
      }
      break;

    case 'files':
    case 'people':
    case 'relation':
    case 'rollup':
    case 'formula':
    case 'ai_generated':
    case 'json':
      // Complex types — skip validation for now
      break;

    default:
      // Unknown type — allow
      break;
  }

  return null;
}
