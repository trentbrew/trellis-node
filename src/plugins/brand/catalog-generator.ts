/**
 * Catalog Generator — Reads brand tokens from the Trellis graph and produces
 * a json-render catalog with Zod-constrained component props.
 *
 * Pure function: no side effects, no caching (caching is handled by CatalogCache).
 *
 * @module trellis/plugins/brand
 */

import type { Fact, Link } from '../../core/store/eav-store.js';
import type { EntityRecord } from '../../core/kernel/trellis-kernel.js';
import { constrainComponentDef } from './constraints.js';
import { buildVoiceToneRules, type VoiceToneConfig } from './voice-tone.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CollectedTokens {
  color: Array<{ role: string; value: unknown; lightMode?: unknown; darkMode?: unknown }>;
  typography: Array<{ role: string; value: unknown }>;
  spacing: Array<{ role: string; value: unknown }>;
  shadow: Array<{ role: string; value: unknown }>;
  motion: Array<{ role: string; value: unknown }>;
  radius: Array<{ role: string; value: unknown }>;
}

export interface BrandGuideData {
  id: string;
  name: string;
  status: string;
  complianceMode: 'strict' | 'moderate' | 'permissive';
  voiceTone: VoiceToneConfig | null;
}

export interface GenerateCatalogResult {
  /** The constrained catalog (opaque — call .prompt() or .jsonSchema() on it) */
  catalog: unknown;
  /** Voice/tone rules derived from the brand guide */
  voiceRules: string[];
  /** The parsed brand guide data */
  guide: BrandGuideData;
  /** All collected tokens grouped by type */
  tokens: CollectedTokens;
}

/**
 * Minimal kernel interface — only the methods the generator needs.
 * Avoids importing the full TrellisKernel class.
 */
export interface KernelReader {
  getEntity(entityId: string): EntityRecord | null;
  listEntities(type?: string, filters?: Record<string, unknown>): EntityRecord[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract a flat key-value record from an EntityRecord's facts. */
function factsToRecord(facts: Fact[]): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const fact of facts) {
    if (fact.a === 'type' || fact.a === 'createdAt' || fact.a === 'updatedAt') continue;
    record[fact.a] = fact.v;
  }
  return record;
}

/** Find target entity IDs from a set of links filtered by attribute. */
function linkTargets(links: Link[], attribute: string): string[] {
  return links.filter((l) => l.a === attribute).map((l) => l.e2);
}

// ---------------------------------------------------------------------------
// Token collection
// ---------------------------------------------------------------------------

/**
 * Collect all DesignTokens linked to a BrandGuide, grouped by tokenType.
 */
export function collectTokens(kernel: KernelReader, guideEntity: EntityRecord): CollectedTokens {
  const result: CollectedTokens = {
    color: [],
    typography: [],
    spacing: [],
    shadow: [],
    motion: [],
    radius: [],
  };

  // Get token entity IDs from hasToken links
  const tokenIds = linkTargets(guideEntity.links, 'hasToken');

  for (const tokenId of tokenIds) {
    const entity = kernel.getEntity(tokenId);
    if (!entity || entity.type !== 'DesignToken') continue;

    const attrs = factsToRecord(entity.facts);
    const tokenType = attrs.tokenType as keyof CollectedTokens;
    const role = attrs.role as string;
    if (!tokenType || !role) continue;

    const bucket = result[tokenType];
    if (!bucket) continue;

    bucket.push({
      role,
      value: attrs.value,
      ...(tokenType === 'color' && attrs.lightMode ? { lightMode: attrs.lightMode } : {}),
      ...(tokenType === 'color' && attrs.darkMode ? { darkMode: attrs.darkMode } : {}),
    });
  }

  return result;
}

/**
 * Parse a BrandGuide entity into structured data.
 */
export function parseBrandGuide(entity: EntityRecord): BrandGuideData {
  const attrs = factsToRecord(entity.facts);

  let voiceTone: VoiceToneConfig | null = null;
  if (attrs.voiceTone) {
    try {
      voiceTone =
        typeof attrs.voiceTone === 'string'
          ? JSON.parse(attrs.voiceTone)
          : (attrs.voiceTone as VoiceToneConfig);
    } catch {
      voiceTone = null;
    }
  }

  return {
    id: entity.id,
    name: (attrs.name as string) ?? 'Untitled',
    status: (attrs.status as string) ?? 'draft',
    complianceMode: (attrs.complianceMode as BrandGuideData['complianceMode']) ?? 'strict',
    voiceTone,
  };
}

// ---------------------------------------------------------------------------
// Catalog generation
// ---------------------------------------------------------------------------

/**
 * Generate a brand-constrained json-render catalog.
 *
 * @param kernel - Trellis kernel (or anything implementing KernelReader)
 * @param brandGuideId - Entity ID of the BrandGuide
 * @param defineCatalog - The `defineCatalog` function from `@json-render/core`
 * @param schema - The schema instance from `@json-render/react/schema` (or other renderer)
 * @param baseComponents - Component definitions to constrain (defaults to shadcn if not provided)
 * @returns Generated catalog, voice rules, guide data, and collected tokens
 */
export function generateBrandCatalog(
  kernel: KernelReader,
  brandGuideId: string,
  defineCatalog: (schema: unknown, input: { components: Record<string, unknown>; actions: Record<string, unknown> }) => unknown,
  schema: unknown,
  baseComponents: Record<string, { props: unknown; [key: string]: unknown }>,
): GenerateCatalogResult {
  // 1. Load and parse the brand guide
  const guideEntity = kernel.getEntity(brandGuideId);
  if (!guideEntity) {
    throw new Error(`BrandGuide "${brandGuideId}" not found`);
  }
  if (guideEntity.type !== 'BrandGuide') {
    throw new Error(`Entity "${brandGuideId}" is type "${guideEntity.type}", expected "BrandGuide"`);
  }
  const guide = parseBrandGuide(guideEntity);

  // 2. Collect all tokens linked to this guide
  const tokens = collectTokens(kernel, guideEntity);

  // 3. Build token-roles-by-type for the constraint system
  const tokensByType: Record<string, Array<{ role: string }>> = {};
  for (const [tokenType, tokenList] of Object.entries(tokens)) {
    tokensByType[tokenType] = tokenList.map((t: { role: string }) => ({ role: t.role }));
  }

  // 4. Apply constraints to each component definition
  const components: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(baseComponents)) {
    if (guide.complianceMode === 'permissive') {
      // Permissive mode: pass through all components unchanged
      components[name] = def;
    } else {
      components[name] = constrainComponentDef(name, def as any, tokensByType);
    }
  }

  // 5. Build the catalog
  const catalog = defineCatalog(schema, { components, actions: {} });

  // 6. Build voice/tone rules
  const voiceRules = buildVoiceToneRules(guide.voiceTone);

  return { catalog, voiceRules, guide, tokens };
}
