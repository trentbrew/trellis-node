/**
 * Ontology Module — Public API Surface
 *
 * @module trellis/core/ontology
 */

// Types (expanded with 18 property types and tiered mutability)
export type {
  PropertyType,
  OntologyTier,
  PropertyValueSpecification,
  RelationConfig,
  RollupConfig,
  AiGeneratedConfig,
  EntityClass,
  SchemaDefinition,
  ProjectionDefinition,
  RouteDefinition,
  WorkspaceConfig,
  AttrType,
  AttributeDef,
  RelationDef,
  EntityDef,
  OntologySchema,
  ValidationError,
  ValidationResult,
} from './types.js';

// Re-export Atom for convenience
export type { Atom } from '../store/eav-store.js';

// Core ontology (immutable built-in schemas)
export { CORE_ONTOLOGY, CORE_VERSION } from './core-ontology.js';

// Registry
export { OntologyRegistry } from './registry.js';

// Built-in ontologies
export {
  projectOntology,
  teamOntology,
  agentOntology,
  builtinOntologies,
} from './builtins.js';

// Validation
export {
  validateEntity,
  validateStore,
  createValidationMiddleware,
} from './validator.js';
