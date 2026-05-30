/**
 * Catalog Cache — Stores generated json-render catalogs keyed by BrandGuide ID.
 *
 * Invalidation is event-driven: the plugin clears the cache when
 * DesignToken or BrandGuide entities are created, updated, or deleted.
 *
 * @module trellis/plugins/brand
 */

export class CatalogCache {
  private store: Map<string, unknown> = new Map();

  get(brandGuideId: string): unknown | undefined {
    return this.store.get(brandGuideId);
  }

  set(brandGuideId: string, catalog: unknown): void {
    this.store.set(brandGuideId, catalog);
  }

  invalidate(brandGuideId: string): void {
    this.store.delete(brandGuideId);
  }

  invalidateAll(): void {
    this.store.clear();
  }

  has(brandGuideId: string): boolean {
    return this.store.has(brandGuideId);
  }

  get size(): number {
    return this.store.size;
  }
}
