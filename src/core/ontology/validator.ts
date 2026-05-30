/**
 * Ontology Validation — Schema enforcement for graph mutations.
 *
 * Provides both standalone validation (check existing entities against schemas)
 * and a kernel middleware that rejects mutations violating ontology constraints.
 *
 * @module trellis/core/ontology
 */

import type { EAVStore, Fact, Link, Atom } from '../store/eav-store.js';
import type { KernelOp } from '../persist/backend.js';
import type { KernelMiddleware, MiddlewareContext, OpMiddlewareNext } from '../kernel/middleware.js';
import type { OntologyRegistry } from './registry.js';
import type {
  AttributeDef,
  AttrType,
  EntityDef,
  ValidationError,
  ValidationResult,
} from './types.js';

// ---------------------------------------------------------------------------
// Standalone Validation
// ---------------------------------------------------------------------------

/**
 * Validate a single entity against the ontology registry.
 */
export function validateEntity(
  entityId: string,
  store: EAVStore,
  registry: OntologyRegistry,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  const facts = store.getFactsByEntity(entityId);
  if (facts.length === 0) {
    return { valid: true, errors: [], warnings: [] };
  }

  const typeFact = facts.find((f) => f.a === 'type');
  if (!typeFact) {
    warnings.push({
      entityId,
      entityType: '(unknown)',
      field: 'type',
      message: 'Entity has no "type" attribute.',
      severity: 'warning',
    });
    return { valid: true, errors, warnings };
  }

  const entityType = String(typeFact.v);
  const def = registry.getEntityDef(entityType);

  if (!def) {
    // Type not in any registered ontology — that's OK, just warn
    warnings.push({
      entityId,
      entityType,
      field: 'type',
      message: `Entity type "${entityType}" is not defined in any registered ontology.`,
      severity: 'warning',
    });
    return { valid: true, errors, warnings };
  }

  // Check abstract
  if (def.abstract) {
    errors.push({
      entityId,
      entityType,
      field: 'type',
      message: `Cannot instantiate abstract entity type "${entityType}".`,
      severity: 'error',
    });
  }

  // Check required attributes
  for (const attr of def.attributes) {
    if (attr.required && attr.name !== 'type') {
      const hasFact = facts.some((f) => f.a === attr.name);
      if (!hasFact) {
        errors.push({
          entityId,
          entityType,
          field: attr.name,
          message: `Required attribute "${attr.name}" is missing.`,
          severity: 'error',
        });
      }
    }
  }

  // Validate each fact against its attribute def
  for (const fact of facts) {
    if (fact.a === 'type' || fact.a === 'createdAt' || fact.a === 'updatedAt') continue;

    const attrDef = def.attributes.find((a) => a.name === fact.a);
    if (!attrDef) {
      // Unknown attribute — warn but don't error (open-world assumption)
      warnings.push({
        entityId,
        entityType,
        field: fact.a,
        message: `Attribute "${fact.a}" is not defined in the "${entityType}" ontology.`,
        severity: 'warning',
      });
      continue;
    }

    // Type check
    const typeErr = validateAttrType(fact.v, attrDef);
    if (typeErr) {
      errors.push({
        entityId,
        entityType,
        field: fact.a,
        message: typeErr,
        severity: 'error',
      });
    }

    // Enum check
    if (attrDef.enum && !attrDef.enum.includes(fact.v)) {
      errors.push({
        entityId,
        entityType,
        field: fact.a,
        message: `Value "${fact.v}" is not in allowed values: [${attrDef.enum.join(', ')}].`,
        severity: 'error',
      });
    }

    // Pattern check
    if (attrDef.pattern && typeof fact.v === 'string') {
      if (!new RegExp(attrDef.pattern).test(fact.v)) {
        errors.push({
          entityId,
          entityType,
          field: fact.a,
          message: `Value "${fact.v}" does not match pattern /${attrDef.pattern}/.`,
          severity: 'error',
        });
      }
    }

    // Range check
    if (attrDef.min !== undefined) {
      if (typeof fact.v === 'number' && fact.v < attrDef.min) {
        errors.push({
          entityId,
          entityType,
          field: fact.a,
          message: `Value ${fact.v} is below minimum ${attrDef.min}.`,
          severity: 'error',
        });
      }
      if (typeof fact.v === 'string' && fact.v.length < attrDef.min) {
        errors.push({
          entityId,
          entityType,
          field: fact.a,
          message: `String length ${fact.v.length} is below minimum ${attrDef.min}.`,
          severity: 'error',
        });
      }
    }
    if (attrDef.max !== undefined) {
      if (typeof fact.v === 'number' && fact.v > attrDef.max) {
        errors.push({
          entityId,
          entityType,
          field: fact.a,
          message: `Value ${fact.v} exceeds maximum ${attrDef.max}.`,
          severity: 'error',
        });
      }
      if (typeof fact.v === 'string' && fact.v.length > attrDef.max) {
        errors.push({
          entityId,
          entityType,
          field: fact.a,
          message: `String length ${fact.v.length} exceeds maximum ${attrDef.max}.`,
          severity: 'error',
        });
      }
    }
  }

  // Validate links
  const links = store.getLinksByEntity(entityId);
  for (const link of links) {
    if (link.e1 !== entityId) continue; // Only validate outgoing links
    const relDef = registry.getRelationDef(link.a);
    if (!relDef) continue;

    // Check source type is allowed
    if (!relDef.sourceTypes.includes(entityType)) {
      errors.push({
        entityId,
        entityType,
        field: link.a,
        message: `Entity type "${entityType}" is not allowed as source for relation "${link.a}".`,
        severity: 'error',
      });
    }

    // Check target type
    const targetFacts = store.getFactsByEntity(link.e2);
    const targetType = targetFacts.find((f) => f.a === 'type');
    if (targetType && !relDef.targetTypes.includes(String(targetType.v))) {
      errors.push({
        entityId,
        entityType,
        field: link.a,
        message: `Target type "${targetType.v}" is not allowed for relation "${link.a}" (expected: ${relDef.targetTypes.join(', ')}).`,
        severity: 'error',
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate all entities in the store against the ontology registry.
 */
export function validateStore(
  store: EAVStore,
  registry: OntologyRegistry,
): ValidationResult {
  const allErrors: ValidationError[] = [];
  const allWarnings: ValidationError[] = [];

  const typeFacts = store.getFactsByAttribute('type');
  const entityIds = new Set(typeFacts.map((f) => f.e));

  for (const entityId of entityIds) {
    const result = validateEntity(entityId, store, registry);
    allErrors.push(...result.errors);
    allWarnings.push(...result.warnings);
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
  };
}

// ---------------------------------------------------------------------------
// Type checking helper
// ---------------------------------------------------------------------------

function validateAttrType(value: Atom, def: AttributeDef): string | null {
  if (def.type === 'any') return null;

  switch (def.type) {
    case 'string':
      if (typeof value !== 'string') return `Expected string, got ${typeof value}.`;
      break;
    case 'number':
      if (typeof value !== 'number') return `Expected number, got ${typeof value}.`;
      break;
    case 'boolean':
      if (typeof value !== 'boolean') return `Expected boolean, got ${typeof value}.`;
      break;
    case 'date':
      if (typeof value === 'string') {
        if (isNaN(Date.parse(value))) return `Expected ISO date string, got "${value}".`;
      } else if (!(value instanceof Date)) {
        return `Expected date, got ${typeof value}.`;
      }
      break;
    case 'ref':
      if (typeof value !== 'string') return `Expected entity reference (string), got ${typeof value}.`;
      break;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Validation Middleware
// ---------------------------------------------------------------------------

/**
 * Creates a kernel middleware that validates mutations against the ontology.
 *
 * - On `addFacts`: validates that new facts conform to attribute definitions
 * - On `addLinks`: validates that links conform to relation definitions
 * - Blocks operations that would create invalid data (throws on error)
 *
 * @param registry The ontology registry to validate against
 * @param strict If true, unknown entity types cause errors (default: false = warnings only)
 */
export function createValidationMiddleware(
  registry: OntologyRegistry,
  options?: { strict?: boolean },
): KernelMiddleware {
  const strict = options?.strict ?? false;

  return {
    name: 'ontology-validator',

    handleOp: (op: KernelOp, ctx: MiddlewareContext, next: OpMiddlewareNext) => {
      // Validate new facts
      if (op.facts && op.facts.length > 0) {
        for (const fact of op.facts) {
          if (fact.a === 'type') continue; // type facts are always allowed
          if (fact.a === 'createdAt' || fact.a === 'updatedAt') continue;

          // Find the entity type from the same op's facts or skip
          const typeFact = op.facts.find((f) => f.e === fact.e && f.a === 'type');
          if (!typeFact) continue; // Can't validate without knowing the type

          const entityType = String(typeFact.v);
          const def = registry.getEntityDef(entityType);
          if (!def) {
            if (strict) {
              throw new Error(
                `[ontology-validator] Unknown entity type "${entityType}" for entity "${fact.e}".`,
              );
            }
            continue;
          }

          const attrDef = def.attributes.find((a) => a.name === fact.a);
          if (!attrDef) {
            if (strict) {
              throw new Error(
                `[ontology-validator] Unknown attribute "${fact.a}" for type "${entityType}".`,
              );
            }
            continue;
          }

          // Type check
          const typeErr = validateAttrType(fact.v, attrDef);
          if (typeErr) {
            throw new Error(
              `[ontology-validator] Entity "${fact.e}" attribute "${fact.a}": ${typeErr}`,
            );
          }

          // Enum check
          if (attrDef.enum && !attrDef.enum.includes(fact.v)) {
            throw new Error(
              `[ontology-validator] Entity "${fact.e}" attribute "${fact.a}": value "${fact.v}" not in [${attrDef.enum.join(', ')}].`,
            );
          }
        }
      }

      // Validate new links
      if (op.links && op.links.length > 0) {
        for (const link of op.links) {
          const relDef = registry.getRelationDef(link.a);
          if (!relDef) continue; // Unknown relation — skip

          // Source type check (from op facts)
          const sourceTypeFact = op.facts?.find(
            (f) => f.e === link.e1 && f.a === 'type',
          );
          if (sourceTypeFact && !relDef.sourceTypes.includes(String(sourceTypeFact.v))) {
            throw new Error(
              `[ontology-validator] Relation "${link.a}": source type "${sourceTypeFact.v}" not allowed (expected: ${relDef.sourceTypes.join(', ')}).`,
            );
          }
        }
      }

      return next(op, ctx);
    },
  };
}
