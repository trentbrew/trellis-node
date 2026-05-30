/**
 * Ontology Registry — Manages loaded ontology schemas.
 *
 * Provides registration, lookup, inheritance resolution, and
 * entity-type-to-schema mapping.
 *
 * @module trellis/core/ontology
 */

import type {
  OntologySchema,
  EntityDef,
  RelationDef,
  AttributeDef,
} from './types.js';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class OntologyRegistry {
  private schemas: Map<string, OntologySchema> = new Map();
  /** Resolved entity defs (with inherited attributes merged). */
  private resolvedEntities: Map<string, { def: EntityDef; ontologyId: string }> = new Map();
  /** Resolved relation defs. */
  private resolvedRelations: Map<string, { def: RelationDef; ontologyId: string }[]> = new Map();

  /**
   * Register an ontology schema.
   * Throws if an ontology with the same ID is already registered at the same version.
   */
  register(schema: OntologySchema): void {
    const existing = this.schemas.get(schema.id);
    if (existing && existing.version === schema.version) {
      throw new Error(
        `Ontology "${schema.id}" v${schema.version} is already registered.`,
      );
    }
    this.schemas.set(schema.id, schema);
    this._resolve(schema);
  }

  /**
   * Unregister an ontology by ID.
   */
  unregister(id: string): void {
    const schema = this.schemas.get(id);
    if (!schema) return;

    // Remove entities belonging to this ontology
    for (const [name, entry] of this.resolvedEntities) {
      if (entry.ontologyId === id) {
        this.resolvedEntities.delete(name);
      }
    }

    // Remove relations belonging to this ontology
    for (const [name, entries] of this.resolvedRelations) {
      const filtered = entries.filter((e) => e.ontologyId !== id);
      if (filtered.length === 0) {
        this.resolvedRelations.delete(name);
      } else {
        this.resolvedRelations.set(name, filtered);
      }
    }

    this.schemas.delete(id);
  }

  /**
   * Get a registered ontology schema by ID.
   */
  get(id: string): OntologySchema | undefined {
    return this.schemas.get(id);
  }

  /**
   * List all registered ontology schemas.
   */
  list(): OntologySchema[] {
    return [...this.schemas.values()];
  }

  /**
   * Get the resolved entity definition for an entity type name.
   * Returns the entity def with inherited attributes merged in.
   */
  getEntityDef(typeName: string): EntityDef | undefined {
    return this.resolvedEntities.get(typeName)?.def;
  }

  /**
   * Get the ontology ID that defines a given entity type.
   */
  getEntityOntology(typeName: string): string | undefined {
    return this.resolvedEntities.get(typeName)?.ontologyId;
  }

  /**
   * List all known entity type names.
   */
  listEntityTypes(): string[] {
    return [...this.resolvedEntities.keys()];
  }

  /**
   * Get all relation definitions involving a given entity type
   * (either as source or target).
   */
  getRelationsForType(typeName: string): RelationDef[] {
    const results: RelationDef[] = [];
    for (const [, entries] of this.resolvedRelations) {
      for (const entry of entries) {
        if (
          entry.def.sourceTypes.includes(typeName) ||
          entry.def.targetTypes.includes(typeName)
        ) {
          results.push(entry.def);
        }
      }
    }
    return results;
  }

  /**
   * Get a specific relation definition by name.
   */
  getRelationDef(name: string): RelationDef | undefined {
    const entries = this.resolvedRelations.get(name);
    return entries?.[0]?.def;
  }

  /**
   * List all known relation names.
   */
  listRelationNames(): string[] {
    return [...this.resolvedRelations.keys()];
  }

  /**
   * Check if an entity type is known to any registered ontology.
   */
  hasEntityType(typeName: string): boolean {
    return this.resolvedEntities.has(typeName);
  }

  /**
   * Get the required attributes for an entity type.
   */
  getRequiredAttributes(typeName: string): AttributeDef[] {
    const def = this.getEntityDef(typeName);
    if (!def) return [];
    return def.attributes.filter((a) => a.required);
  }

  // -------------------------------------------------------------------------
  // Resolution (inheritance)
  // -------------------------------------------------------------------------

  private _resolve(schema: OntologySchema): void {
    // Register entities
    for (const entity of schema.entities) {
      const resolved = this._resolveEntity(entity, schema);
      this.resolvedEntities.set(entity.name, {
        def: resolved,
        ontologyId: schema.id,
      });
    }

    // Register relations
    for (const relation of schema.relations) {
      const existing = this.resolvedRelations.get(relation.name) ?? [];
      existing.push({ def: relation, ontologyId: schema.id });
      this.resolvedRelations.set(relation.name, existing);
    }
  }

  private _resolveEntity(entity: EntityDef, schema: OntologySchema): EntityDef {
    if (!entity.extends) return entity;

    // Find parent — check current schema first, then all registered
    let parent = schema.entities.find((e) => e.name === entity.extends);
    if (!parent) {
      const resolved = this.resolvedEntities.get(entity.extends!);
      parent = resolved?.def;
    }

    if (!parent) {
      throw new Error(
        `Entity "${entity.name}" extends "${entity.extends}" which is not defined.`,
      );
    }

    // Resolve parent first (recursive)
    const resolvedParent = this._resolveEntity(parent, schema);

    // Merge: child attributes override parent attributes with same name
    const childAttrNames = new Set(entity.attributes.map((a) => a.name));
    const mergedAttrs = [
      ...resolvedParent.attributes.filter((a) => !childAttrNames.has(a.name)),
      ...entity.attributes,
    ];

    return {
      ...entity,
      attributes: mergedAttrs,
    };
  }
}
