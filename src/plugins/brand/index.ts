/**
 * Brand Token System — Trellis plugin for design token governance
 * and json-render catalog generation.
 *
 * @module trellis/plugins/brand
 *
 * @example
 * ```typescript
 * import { createBrandPlugin, brandOntology, generateBrandCatalog, brandTools } from 'trellis/plugins/brand';
 *
 * // 1. Register the plugin
 * const { plugin, cache } = createBrandPlugin();
 * pluginRegistry.register(plugin);
 * await pluginRegistry.load('trellis:brand', kernel, ontologyRegistry);
 *
 * // 2. Create a brand guide + tokens
 * await kernel.createEntity('guide-1', 'BrandGuide', { name: 'Acme Brand', complianceMode: 'strict' });
 * await kernel.createEntity('token-primary', 'DesignToken', {
 *   name: 'Primary Blue', tokenType: 'color', role: 'primary',
 *   value: JSON.stringify({ hex: '#2563eb', oklch: 'oklch(0.55 0.22 264)' }),
 * });
 * await kernel.addLink('guide-1', 'hasToken', 'token-primary');
 *
 * // 3. Generate a constrained catalog
 * import { defineCatalog } from '@json-render/core';
 * import { schema } from '@json-render/react/schema';
 * import { shadcnComponentDefinitions } from '@json-render/shadcn/catalog';
 *
 * const { catalog, voiceRules } = generateBrandCatalog(
 *   kernel, 'guide-1', defineCatalog, schema, shadcnComponentDefinitions,
 * );
 *
 * // 4. Get the AI prompt with brand constraints
 * const prompt = catalog.prompt({ customRules: voiceRules, mode: 'inline' });
 * ```
 */

// Ontology
export { brandOntology } from './ontology.js';

// Plugin
export { createBrandPlugin } from './plugin.js';

// Cache
export { CatalogCache } from './cache.js';

// Catalog generator
export {
  generateBrandCatalog,
  collectTokens,
  parseBrandGuide,
  type CollectedTokens,
  type BrandGuideData,
  type GenerateCatalogResult,
  type KernelReader,
} from './catalog-generator.js';

// Constraints
export {
  constrainEnum,
  constrainComponentDef,
  extractEnumValues,
  CONSTRAINT_MAP,
  ROLE_ALIASES,
} from './constraints.js';

// Voice & Tone
export { buildVoiceToneRules, type VoiceToneConfig } from './voice-tone.js';

// MCP Tools
export {
  brandTools,
  brandCreateGuide,
  brandUpsertToken,
  brandDeleteToken,
  brandListTokens,
  brandGenerateCatalog,
  brandGetPrompt,
  type BrandToolContext,
} from './mcp-tools.js';
