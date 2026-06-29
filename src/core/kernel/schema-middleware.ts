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
import type { Atom, Fact } from '../store/eav-store.js';
import { buildOntologyIndex } from './boot-middleware.js';

export interface SchemaMiddlewareConfig {
  /** Live ontology index — refreshed per op so schema edits apply immediately. */
  getOntologies: () => Map<string, SchemaDefinition>;
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
      if (!op.facts || op.facts.length === 0) {
        return next(op, ctx);
      }

      const ontologies = config.getOntologies();
      const errors: string[] = [];
      const entities = new Set(
        op.facts
          .filter((fact) => fact.a === 'type')
          .map((fact) => fact.e),
      );

      for (const entityId of entities) {
        const typeFact = op.facts.find((fact) => fact.e === entityId && fact.a === 'type');
        if (!typeFact) continue;

        const entityType = String(typeFact.v);
        const schema = resolveSchemaForEntity(entityType, entityId, op.facts, ontologies);
        if (!schema) continue;

        for (const fact of op.facts) {
          if (fact.e !== entityId) continue;
          const fieldSpec = schema.fields.find((field) => field.name === fact.a);
          if (!fieldSpec) continue;

          const validationError = validateValue(fact.a, fact.v, fieldSpec);
          if (validationError) errors.push(validationError);
        }

        for (const fieldSpec of schema.fields) {
          if (!fieldSpec.required) continue;
          const hasValue = op.facts.some(
            (fact) =>
              fact.e === entityId &&
              fact.a === fieldSpec.name &&
              fact.v !== null &&
              fact.v !== undefined &&
              fact.v !== '',
          );
          if (!hasValue) {
            errors.push(`Missing required field: ${fieldSpec.name} on entity ${entityId}`);
          }
        }
      }

      if (errors.length > 0 && strict) {
        const errorMsg = [...new Set(errors)].join('; ');
        throw new Error(`Schema validation failed: ${errorMsg}`);
      }

      return next(op, ctx);
    },
  };
}

function collectionSlugFromCollectionId(collectionId: string): string | null {
  const prefix = 'collectionMeta:';
  if (!collectionId.startsWith(prefix)) return null;
  const slug = collectionId.slice(prefix.length).trim();
  return slug || null;
}

function findPerCollectionRecordSchema(
  slug: string,
  ontologies: Map<string, SchemaDefinition>,
): SchemaDefinition | undefined {
  const suffix = `/collections/${slug}/Record`;
  for (const schema of ontologies.values()) {
    if (schema['@id'].endsWith(suffix)) return schema;
  }
  return undefined;
}

function resolveSchemaForEntity(
  entityType: string,
  entityId: string,
  facts: Fact[],
  ontologies: Map<string, SchemaDefinition>,
): SchemaDefinition | undefined {
  const shortType = entityType.includes(':')
    ? entityType.split(':').pop()!
    : entityType;

  if (shortType === 'CollectionRecord') {
    const collectionIdFact = facts.find(
      (fact) => fact.e === entityId && fact.a === 'collectionId',
    );
    const slug = collectionIdFact
      ? collectionSlugFromCollectionId(String(collectionIdFact.v))
      : null;
    if (slug) {
      const perCollection = findPerCollectionRecordSchema(slug, ontologies);
      if (perCollection?.fields?.length) return perCollection;
    }
  }

  return (
    ontologies.get(entityType) ??
    ontologies.get(shortType) ??
    ontologies.get(shortType.toLowerCase()) ??
    ontologies.get(entityType.toLowerCase())
  );
}

function validateValue(
  fieldName: string,
  value: Atom,
  spec: PropertyValueSpecification,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const actualType = typeof value;

  switch (spec.valueType) {
    case 'title':
    case 'rich_text':
    case 'select':
    case 'multi_select':
    case 'status':
    case 'phone_number':
    case 'url':
    case 'email': {
      if (actualType !== 'string') {
        return `Field ${fieldName}: expected string, got ${actualType}`;
      }

      const text = value as string;

      if (spec.minLength !== undefined && text.length < spec.minLength) {
        return `Field ${fieldName}: must be at least ${spec.minLength} characters`;
      }
      if (spec.maxLength !== undefined && text.length > spec.maxLength) {
        return `Field ${fieldName}: must be at most ${spec.maxLength} characters`;
      }
      if (spec.pattern) {
        try {
          if (!new RegExp(spec.pattern).test(text)) {
            return `Field ${fieldName}: invalid format`;
          }
        } catch {
          // ignore invalid schema patterns
        }
      }

      if (spec.selectOptions && spec.selectOptions.length > 0) {
        if (!spec.selectOptions.includes(value)) {
          return `Field ${fieldName}: value "${value}" not in allowed options`;
        }
      }
      break;
    }

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
      break;

    default:
      break;
  }

  return null;
}
