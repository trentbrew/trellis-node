/**
 * EAV-based Datalog Engine with Path-Aware Ingestor
 *
 * Core types and fact storage for schema-agnostic data processing.
 * Inlined from trellis-core for single-package publish.
 *
 * @module trellis/core
 */

export type Atom = string | number | boolean | Date | EntityRef;
export type EntityRef = string;

export interface Fact {
  e: string; // entity
  a: string; // attribute (JSONPath)
  v: Atom; // value
}

export interface Link {
  e1: string; // source entity
  a: string; // relationship attribute
  e2: string; // target entity
}

export interface CatalogEntry {
  attribute: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'mixed';
  cardinality: 'one' | 'many';
  distinctCount: number;
  examples: Atom[];
  min?: number;
  max?: number;
}

export interface QueryTraceEntry {
  goal: string;
  bindingsCount: number;
  durationMs: number;
}

export interface QueryResult {
  bindings: Record<string, Atom>[];
  executionTime: number;
  plan?: string;
  trace?: QueryTraceEntry[];
}

/**
 * Path-aware JSON flattener
 * Converts nested JSON into attribute-value pairs with dot notation
 */
export function* flatten(obj: any, base = ''): Generator<[string, any]> {
  if (Array.isArray(obj)) {
    for (const v of obj) {
      yield* flatten(v, base);
    }
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      yield* flatten(v, base ? `${base}.${k}` : k);
    }
  } else {
    yield [base, obj];
  }
}

/**
 * Convert JSON entity to EAV facts
 */
export function jsonEntityFacts(
  entityId: string,
  root: any,
  type: string,
): Fact[] {
  const facts: Fact[] = [{ e: entityId, a: 'type', v: type }];

  for (const [a, v] of flatten(root)) {
    if (v === undefined || v === null) continue;

    if (Array.isArray(v)) {
      for (const el of v) {
        facts.push({ e: entityId, a, v: el as any });
      }
    } else if (typeof v === 'object') {
      // Handled by flatten recursion
    } else {
      facts.push({ e: entityId, a, v: v as any });
    }
  }

  return facts;
}

/**
 * In-memory EAV triple store
 */
export class EAVStore {
  private facts: Fact[] = [];
  private links: Link[] = [];
  private catalog: Map<string, CatalogEntry> = new Map();

  // Indexes for fast lookups
  private eavIndex: Map<string, Map<string, Set<number>>> = new Map();
  private aevIndex: Map<string, Map<string, Set<number>>> = new Map();
  private aveIndex: Map<string, Map<Atom, Set<number>>> = new Map();

  // Link indexes for graph queries
  private linkIndex: Map<string, Map<string, Set<string>>> = new Map(); // e1 -> a -> e2s
  private linkReverseIndex: Map<string, Map<string, Set<string>>> = new Map(); // e2 -> a -> e1s
  private linkAttrIndex: Map<string, Set<[string, string]>> = new Map(); // a -> [(e1, e2)]

  // Distinct value tracking
  private distinct = new Map<string, Set<string>>(); // attr -> set of valueKey

  addFacts(facts: Fact[]): void {
    for (let i = 0; i < facts.length; i++) {
      const fact = facts[i];
      if (fact) {
        // Deduplication: skip if (e, a, v) already exists
        if (this.hasFact(fact.e, fact.a, fact.v)) {
          continue;
        }
        this.facts.push(fact);
        this.updateIndexes(fact, this.facts.length - 1);
        this.updateCatalog(fact);
      }
    }
  }

  /**
   * Check if a fact already exists in the store.
   */
  private hasFact(entity: string, attribute: string, value: Atom): boolean {
    const valueKey = this.valueKey(value);
    const indices = this.aveIndex.get(attribute)?.get(valueKey);
    if (!indices) return false;

    for (const idx of indices) {
      const fact = this.facts[idx];
      if (fact && fact.e === entity && fact.a === attribute) {
        return true;
      }
    }
    return false;
  }

  addLinks(links: Link[]): void {
    for (const link of links) {
      this.links.push(link);
      this.updateLinkIndexes(link);
    }
  }

  deleteFacts(factsToDelete: Fact[]): void {
    for (const fact of factsToDelete) {
      // Find the fact index
      const valueKey = this.valueKey(fact.v);
      const indices = this.aveIndex.get(fact.a)?.get(valueKey);
      if (!indices) continue;

      let foundIdx = -1;
      for (const idx of indices) {
        const storedFact = this.facts[idx];
        if (storedFact && storedFact.e === fact.e && storedFact.a === fact.a) {
          foundIdx = idx;
          break;
        }
      }

      if (foundIdx !== -1) {
        // Remove from main facts (set to null to maintain indices if needed, or just remove and rebuild)
        // For simplicity and to keep indices valid without shifting, we'll set to undefined
        this.facts[foundIdx] = undefined as any;

        // Remove from indexes
        this.eavIndex.get(fact.e)?.get(fact.a)?.delete(foundIdx);
        this.aevIndex.get(fact.a)?.get(fact.e)?.delete(foundIdx);
        this.aveIndex.get(fact.a)?.get(valueKey)?.delete(foundIdx);

        // Update catalog (approximate, since we don't fully rebuild it)
        const entry = this.catalog.get(fact.a);
        if (entry) {
          // If we had a specific count, we'd decrement, but distinctCount needs re-check
          // For now we'll just leave it or let it be refreshed later
        }
      }
    }
  }

  deleteLinks(linksToDelete: Link[]): void {
    for (const link of linksToDelete) {
      // Find and remove from main links list
      const initialLen = this.links.length;
      this.links = this.links.filter(
        (l) => !(l.e1 === link.e1 && l.a === link.a && l.e2 === link.e2),
      );

      if (this.links.length < initialLen) {
        // Remove from indexes
        this.linkIndex.get(link.e1)?.get(link.a)?.delete(link.e2);
        this.linkReverseIndex.get(link.e2)?.get(link.a)?.delete(link.e1);

        const attrPairs = this.linkAttrIndex.get(link.a);
        if (attrPairs) {
          for (const pair of attrPairs) {
            if (pair[0] === link.e1 && pair[1] === link.e2) {
              attrPairs.delete(pair);
              break;
            }
          }
        }
      }
    }
  }

  private updateIndexes(fact: Fact, index: number): void {
    // EAV index: entity -> attribute -> fact indices
    if (!this.eavIndex.has(fact.e)) {
      this.eavIndex.set(fact.e, new Map());
    }
    if (!this.eavIndex.get(fact.e)!.has(fact.a)) {
      this.eavIndex.get(fact.e)!.set(fact.a, new Set());
    }
    this.eavIndex.get(fact.e)!.get(fact.a)!.add(index);

    // AEV index: attribute -> entity -> fact indices
    if (!this.aevIndex.has(fact.a)) {
      this.aevIndex.set(fact.a, new Map());
    }
    if (!this.aevIndex.get(fact.a)!.has(fact.e)) {
      this.aevIndex.get(fact.a)!.set(fact.e, new Set());
    }
    this.aevIndex.get(fact.a)!.get(fact.e)!.add(index);

    // AVE index: attribute -> value -> fact indices
    if (!this.aveIndex.has(fact.a)) {
      this.aveIndex.set(fact.a, new Map());
    }
    const valueKey = this.valueKey(fact.v);
    if (!this.aveIndex.get(fact.a)!.has(valueKey)) {
      this.aveIndex.get(fact.a)!.set(valueKey, new Set());
    }
    this.aveIndex.get(fact.a)!.get(valueKey)!.add(index);
  }

  private updateLinkIndexes(link: Link): void {
    // Forward index: e1 -> a -> e2s
    if (!this.linkIndex.has(link.e1)) {
      this.linkIndex.set(link.e1, new Map());
    }
    const e1Attrs = this.linkIndex.get(link.e1)!;
    if (!e1Attrs.has(link.a)) {
      e1Attrs.set(link.a, new Set());
    }
    e1Attrs.get(link.a)!.add(link.e2);

    // Reverse index: e2 -> a -> e1s
    if (!this.linkReverseIndex.has(link.e2)) {
      this.linkReverseIndex.set(link.e2, new Map());
    }
    const e2Attrs = this.linkReverseIndex.get(link.e2)!;
    if (!e2Attrs.has(link.a)) {
      e2Attrs.set(link.a, new Set());
    }
    e2Attrs.get(link.a)!.add(link.e1);

    // Attribute index: a -> [(e1, e2)]
    if (!this.linkAttrIndex.has(link.a)) {
      this.linkAttrIndex.set(link.a, new Set());
    }
    this.linkAttrIndex.get(link.a)!.add([link.e1, link.e2]);
  }

  private valueKey(v: Atom): string {
    if (v instanceof Date) return `date:${v.toISOString()}`;
    return `${typeof v}:${v}`;
  }

  private updateCatalog(fact: Fact): void {
    const entry = this.catalog.get(fact.a) || {
      attribute: fact.a,
      type: this.inferType(fact.v),
      cardinality: 'one',
      distinctCount: 0,
      examples: [],
    };

    // Update type (may become 'mixed')
    const factType = this.inferType(fact.v);
    if (entry.type !== factType && entry.type !== 'mixed') {
      entry.type = 'mixed';
    }

    // Update cardinality (if we see multiple values for same entity+attribute)
    const entityAttrs = this.eavIndex.get(fact.e)?.get(fact.a);
    if (entityAttrs && entityAttrs.size > 1) {
      entry.cardinality = 'many';
    }

    // Update distinct count
    const k = this.valueKey(fact.v);
    const s =
      this.distinct.get(fact.a) ||
      (this.distinct.set(fact.a, new Set()), this.distinct.get(fact.a)!);
    s.add(k);
    entry.distinctCount = s.size;

    // Update examples (keep first 5)
    if (entry.examples.length < 5 && !entry.examples.includes(fact.v)) {
      entry.examples.push(fact.v);
    }

    // Update numeric ranges
    if (typeof fact.v === 'number') {
      entry.min = Math.min(entry.min ?? fact.v, fact.v);
      entry.max = Math.max(entry.max ?? fact.v, fact.v);
    }

    this.catalog.set(fact.a, entry);
  }

  private inferType(
    v: Atom,
  ): 'string' | 'number' | 'boolean' | 'date' | 'mixed' {
    if (typeof v === 'string') return 'string';
    if (typeof v === 'number') return 'number';
    if (typeof v === 'boolean') return 'boolean';
    if (v instanceof Date) return 'date';
    return 'mixed';
  }

  // Query methods
  getFactsByEntity(entity: string): Fact[] {
    const indices = this.eavIndex.get(entity);
    if (!indices) return [];

    const result: Fact[] = [];
    for (const attrIndices of indices.values()) {
      for (const idx of attrIndices) {
        const fact = this.facts[idx];
        if (fact) {
          result.push(fact);
        }
      }
    }
    return result;
  }

  getFactsByAttribute(attribute: string): Fact[] {
    const indices = this.aevIndex.get(attribute);
    if (!indices) return [];

    const result: Fact[] = [];
    for (const entityIndices of indices.values()) {
      for (const idx of entityIndices) {
        const fact = this.facts[idx];
        if (fact) {
          result.push(fact);
        }
      }
    }
    return result;
  }

  getFactsByValue(attribute: string, value: Atom): Fact[] {
    const indices = this.aveIndex.get(attribute)?.get(this.valueKey(value));
    if (!indices) return [];

    return Array.from(indices)
      .map((idx) => this.facts[idx])
      .filter((fact): fact is Fact => fact !== undefined);
  }

  getCatalog(): CatalogEntry[] {
    return Array.from(this.catalog.values());
  }

  getCatalogEntry(attribute: string): CatalogEntry | undefined {
    return this.catalog.get(attribute);
  }

  // Statistics
  getAllFacts(): Fact[] {
    return this.facts.filter((f): f is Fact => f !== undefined);
  }

  getAllLinks(): Link[] {
    return [...this.links];
  }

  getLinksByEntity(entity: string): Link[] {
    const results: Link[] = [];
    const forwardLinks = this.linkIndex.get(entity);
    if (forwardLinks) {
      for (const [attr, targets] of forwardLinks) {
        for (const target of targets) {
          results.push({ e1: entity, a: attr, e2: target });
        }
      }
    }
    const reverseLinks = this.linkReverseIndex.get(entity);
    if (reverseLinks) {
      for (const [attr, sources] of reverseLinks) {
        for (const source of sources) {
          results.push({ e1: source, a: attr, e2: entity });
        }
      }
    }
    return results;
  }

  getLinksByAttribute(attribute: string): Link[] {
    const results: Link[] = [];
    const links = this.linkAttrIndex.get(attribute);
    if (links) {
      for (const [e1, e2] of links) {
        results.push({ e1, a: attribute, e2 });
      }
    }
    return results;
  }

  getLinksByEntityAndAttribute(entity: string, attribute: string): Link[] {
    const results: Link[] = [];
    const attrs = this.linkIndex.get(entity);
    if (attrs) {
      const targets = attrs.get(attribute);
      if (targets) {
        for (const target of targets) {
          results.push({ e1: entity, a: attribute, e2: target });
        }
      }
    }
    return results;
  }

  getStats() {
    return {
      totalFacts: this.facts.length,
      totalLinks: this.links.length,
      uniqueEntities: this.eavIndex.size,
      uniqueAttributes: this.aevIndex.size,
      catalogEntries: this.catalog.size,
    };
  }

  /**
   * Creates a serializable snapshot of the current store state.
   */
  snapshot(): { facts: Fact[]; links: Link[]; catalog: CatalogEntry[] } {
    return {
      facts: this.facts.filter((f) => f !== undefined),
      links: [...this.links],
      catalog: this.getCatalog(),
    };
  }

  /**
   * Restores the store state from a snapshot and rebuilds all indexes.
   */
  restore(snapshot: {
    facts: Fact[];
    links: Link[];
    catalog: CatalogEntry[];
  }): void {
    // Clear current state
    this.facts = [];
    this.links = [];
    this.catalog.clear();
    this.eavIndex.clear();
    this.aevIndex.clear();
    this.aveIndex.clear();
    this.linkIndex.clear();
    this.linkReverseIndex.clear();
    this.linkAttrIndex.clear();
    this.distinct.clear();

    // Re-add data
    this.addFacts(snapshot.facts);
    this.addLinks(snapshot.links);

    // Explicitly restore catalog if provided (though addFacts rebuilds it partially)
    if (snapshot.catalog) {
      for (const entry of snapshot.catalog) {
        this.catalog.set(entry.attribute, entry);
      }
    }
  }
}
