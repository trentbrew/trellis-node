/**
 * Ontology Type System — Declarative schemas for entity types, attributes,
 * constraints, and relationships.
 *
 * Ontologies define the "shape" of entities in the graph. They are used for:
 *   - Schema validation (reject mutations that violate constraints)
 *   - Documentation (describe what entity types exist and their attributes)
 *   - Code generation and tooling (auto-complete, type checking)
 *
 * @module trellis/core/ontology
 */

import type { Atom } from '../store/eav-store.js';

// ---------------------------------------------------------------------------
// Property types (Notion-compatible, 18 types)
// ---------------------------------------------------------------------------

export const PropertyTypeSchema = [
  'title',
  'rich_text',
  'number',
  'select',
  'multi_select',
  'status',
  'date',
  'people',
  'files',
  'checkbox',
  'url',
  'email',
  'phone_number',
  'relation',
  'rollup',
  'formula',
  'ai_generated',
  'json',
] as const;

export type PropertyType = (typeof PropertyTypeSchema)[number];

// ---------------------------------------------------------------------------
// Ontology tier — determines mutability and ownership
// ---------------------------------------------------------------------------

export type OntologyTier = 'core' | 'system' | 'user';

/**
 * - core: Built into the kernel, immutable. Defines the structural type hierarchy.
 * - system: Shipped with the app, versioned with releases. Entity types like task, note, etc.
 * - user: Created at runtime via API. Custom schemas and marketplace imports.
 */

// ---------------------------------------------------------------------------
// Field specification
// ---------------------------------------------------------------------------

export interface RelationConfig {
  targetSchema?: string;
  cardinality?: 'one' | 'many';
  syncedProperty?: string;
}

export interface RollupConfig {
  relationProperty: string;
  targetProperty: string;
  aggregation: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'median' | 'mode';
}

export interface AiGeneratedConfig {
  prompt: string;
  model?: string;
}

export interface PropertyValueSpecification {
  name: string;
  valueType: PropertyType;
  required?: boolean;
  description?: string;
  selectOptions?: Atom[];
  relation?: RelationConfig;
  formula?: string;
  rollup?: RollupConfig;
  aiGenerated?: AiGeneratedConfig;
  icon?: string;
  group?: string;
  display?: 'pill' | 'toggle' | 'inline-input' | 'popover';
  editable?: boolean;
  computed?: boolean;
  modes?: ('view' | 'create' | 'edit')[];
  defaultValue?: Atom;
  // Number constraints
  min?: number;
  max?: number;
  // String constraints
  pattern?: string;
  minLength?: number;
  maxLength?: number;
}

// ---------------------------------------------------------------------------
// Entity classification
// ---------------------------------------------------------------------------

export type EntityClass = 'temporal' | 'document' | 'actor' | 'container';

// ---------------------------------------------------------------------------
// Attribute types (legacy, for compatibility)
// ---------------------------------------------------------------------------

export type AttrType = 'string' | 'number' | 'boolean' | 'date' | 'ref' | 'any';

export interface AttributeDef {
  name: string;
  type: AttrType;
  description?: string;
  required?: boolean;
  unique?: boolean;
  default?: Atom;
  enum?: Atom[];
  pattern?: string;
  min?: number;
  max?: number;
  refTypes?: string[];
}

// ---------------------------------------------------------------------------
// Relation types (legacy, for compatibility)
// ---------------------------------------------------------------------------

export interface RelationDef {
  name: string;
  description?: string;
  sourceTypes: string[];
  targetTypes: string[];
  cardinality?: 'one' | 'many';
  required?: boolean;
  inverse?: string;
}

// ---------------------------------------------------------------------------
// Schema definition
// ---------------------------------------------------------------------------

export interface SchemaDefinition {
  '@id': string;
  '@type': 'trellis:Schema';
  version: string;
  fields: PropertyValueSpecification[];
  tier?: OntologyTier;
  subClassOf?: string;
  entityClass?: EntityClass;
  label?: string;
  labelPlural?: string;
  icon?: string;
  color?: string;
  projections?: string[];
  defaultProjection?: string;
  dialogShell?: string;
  panels?: {
    properties: string;
    content: string;
    footerActions: string[];
  };
  propertyFieldIds?: string[];
  defaultSortField?: string;
  searchFields?: string[];
}

// ---------------------------------------------------------------------------
// Projection definition
// ---------------------------------------------------------------------------

export interface ProjectionDefinition {
  '@id': string;
  '@type': 'trellis:Projection';
  name: string;
  type: string;
  query?: string;
  icon?: string;
  component?: string;
  order?: number;
  status?: string;
  requirements?: {
    schema?: {
      fieldTypes: string[];
    };
  };
  config?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Route definition
// ---------------------------------------------------------------------------

export interface RouteDefinition {
  '@id': string;
  '@type': 'trellis:Route';
  routePath: string;
  label: string;
  icon?: string;
  tint?: string;
  order?: number;
  inRail?: boolean;
  railPosition?: 'primary' | 'secondary';
  collapseSidebar?: boolean;
  requiresAuth?: boolean;
  inCommandPalette?: boolean;
  searchKeywords?: string[];
  permissions?: Record<string, unknown>;
  meta?: {
    title?: string;
    description?: string;
    subtitle?: string;
    showBackButton?: boolean;
    fullWidth?: boolean;
    hideSidebar?: boolean;
    sidebarSectionPath?: string;
  };
  sidebarSections?: unknown[];
  children?: unknown[];
  editable?: boolean;
  tabs?: unknown[];
  entityType?: string;
  pageVariant?: string;
  projectionTypes?: string[];
}

// ---------------------------------------------------------------------------
// Workspace configuration
// ---------------------------------------------------------------------------

export interface WorkspaceConfig {
  workspace: {
    name?: string;
    description?: string;
    ontologies?: Record<string, SchemaDefinition>;
    graph?: {
      nodes?: unknown[];
      edges?: unknown[];
    };
    projections?: Record<string, ProjectionDefinition>;
    routes?: Record<string, RouteDefinition>;
    app?: {
      title?: string;
      description?: string;
      version?: string;
      devPort?: number;
    };
  };
}

// ---------------------------------------------------------------------------
// Legacy types (for compatibility)
// ---------------------------------------------------------------------------

export interface EntityDef {
  name: string;
  description?: string;
  attributes: AttributeDef[];
  abstract?: boolean;
  extends?: string;
}

export interface OntologySchema {
  id: string;
  name: string;
  version: string;
  description?: string;
  entities: EntityDef[];
  relations: RelationDef[];
}

export interface ValidationError {
  entityId: string;
  entityType: string;
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}
