/**
 * MCP Tools — Brand token management and catalog generation tools
 * for the Model Context Protocol.
 *
 * These are standalone tool definitions that can be registered on any MCP server.
 * Each tool follows the pattern: { name, description, inputSchema, handler }.
 *
 * @module trellis/plugins/brand
 */

import { z } from 'zod';
import type { Atom } from '../../core/store/eav-store.js';
import type { TrellisKernel, EntityRecord } from '../../core/kernel/trellis-kernel.js';
import { generateBrandCatalog, type KernelReader } from './catalog-generator.js';
import { CatalogCache } from './cache.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
}

interface McpToolDef<T> {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodType>;
  handler: (input: T, ctx: BrandToolContext) => Promise<McpToolResult>;
}

export interface BrandToolContext {
  kernel: TrellisKernel;
  cache: CatalogCache;
  /** The `defineCatalog` function from `@json-render/core` */
  defineCatalog: (schema: unknown, input: { components: Record<string, unknown>; actions: Record<string, unknown> }) => unknown;
  /** The schema instance from `@json-render/react/schema` (or other renderer) */
  schema: unknown;
  /** Base component definitions (e.g., shadcnComponentDefinitions) */
  baseComponents: Record<string, { props: unknown; [key: string]: unknown }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function text(content: string): McpToolResult {
  return { content: [{ type: 'text', text: content }] };
}

function factsToRecord(entity: EntityRecord): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const fact of entity.facts) {
    if (fact.a === 'type' || fact.a === 'createdAt' || fact.a === 'updatedAt') continue;
    record[fact.a] = fact.v;
  }
  return record;
}

// ---------------------------------------------------------------------------
// Tool: brand_create_guide
// ---------------------------------------------------------------------------

export const brandCreateGuide: McpToolDef<{
  guideId: string;
  name: string;
  complianceMode?: string;
  voiceTone?: string;
}> = {
  name: 'brand_create_guide',
  description:
    'Create a new BrandGuide entity. A brand guide is a container for design tokens and brand rules that constrain AI-generated UI output.',
  inputSchema: {
    guideId: z.string().describe('Unique entity ID for the brand guide'),
    name: z.string().describe('Human-readable name for the brand guide'),
    complianceMode: z
      .enum(['strict', 'moderate', 'permissive'])
      .optional()
      .describe('How strictly to enforce brand constraints (default: strict)'),
    voiceTone: z
      .string()
      .optional()
      .describe('JSON string of voice/tone config: { traits?, preferred?, avoided?, examples? }'),
  },
  handler: async ({ guideId, name, complianceMode, voiceTone }, { kernel }) => {
    const attrs: Record<string, Atom> = { name };
    if (complianceMode) attrs.complianceMode = complianceMode;
    if (voiceTone) attrs.voiceTone = voiceTone;

    await kernel.createEntity(guideId, 'BrandGuide', attrs);
    return text(`Created BrandGuide "${name}" (${guideId})`);
  },
};

// ---------------------------------------------------------------------------
// Tool: brand_upsert_token
// ---------------------------------------------------------------------------

export const brandUpsertToken: McpToolDef<{
  tokenId: string;
  guideId: string;
  name: string;
  tokenType: string;
  role: string;
  value: string;
  description?: string;
  lightMode?: string;
  darkMode?: string;
  wcagAA?: boolean;
  wcagAAA?: boolean;
}> = {
  name: 'brand_upsert_token',
  description:
    'Create or update a DesignToken and link it to a BrandGuide. Token roles map to component prop enum values (e.g., role "primary" → Button variant "primary").',
  inputSchema: {
    tokenId: z.string().describe('Unique entity ID for the token'),
    guideId: z.string().describe('BrandGuide entity ID to link this token to'),
    name: z.string().describe('Human-readable token name (e.g., "Primary Blue 600")'),
    tokenType: z
      .enum(['color', 'typography', 'spacing', 'shadow', 'motion', 'radius'])
      .describe('Token category'),
    role: z
      .string()
      .describe('Semantic role: primary, secondary, accent, destructive, muted, etc.'),
    value: z.string().describe('Token value as JSON string (e.g., \'{"hex":"#2563eb","oklch":"..."}\''),
    description: z.string().optional().describe('Usage notes'),
    lightMode: z.string().optional().describe('Light-mode override value (JSON string, colors only)'),
    darkMode: z.string().optional().describe('Dark-mode override value (JSON string, colors only)'),
    wcagAA: z.boolean().optional().describe('Passes WCAG AA contrast ratio'),
    wcagAAA: z.boolean().optional().describe('Passes WCAG AAA contrast ratio'),
  },
  handler: async (input, { kernel }) => {
    const existing = kernel.getEntity(input.tokenId);
    const attrs: Record<string, Atom> = {
      name: input.name,
      tokenType: input.tokenType,
      role: input.role,
      value: input.value,
    };
    if (input.description) attrs.description = input.description;
    if (input.lightMode) attrs.lightMode = input.lightMode;
    if (input.darkMode) attrs.darkMode = input.darkMode;
    if (input.wcagAA !== undefined) attrs.wcagAA = input.wcagAA;
    if (input.wcagAAA !== undefined) attrs.wcagAAA = input.wcagAAA;

    if (existing) {
      await kernel.updateEntity(input.tokenId, attrs);
      return text(`Updated DesignToken "${input.name}" (${input.tokenId})`);
    } else {
      await kernel.createEntity(input.tokenId, 'DesignToken', attrs, [
        { attribute: 'hasToken', targetEntityId: input.guideId },
      ]);
      // Also add link from guide → token
      await kernel.addLink(input.guideId, 'hasToken', input.tokenId);
      return text(`Created DesignToken "${input.name}" (${input.tokenId}) linked to ${input.guideId}`);
    }
  },
};

// ---------------------------------------------------------------------------
// Tool: brand_delete_token
// ---------------------------------------------------------------------------

export const brandDeleteToken: McpToolDef<{ tokenId: string }> = {
  name: 'brand_delete_token',
  description: 'Remove a DesignToken and its hasToken link from the brand guide.',
  inputSchema: {
    tokenId: z.string().describe('Entity ID of the token to delete'),
  },
  handler: async ({ tokenId }, { kernel }) => {
    const entity = kernel.getEntity(tokenId);
    if (!entity) return text(`Token "${tokenId}" not found`);

    await kernel.deleteEntity(tokenId);
    return text(`Deleted DesignToken "${tokenId}"`);
  },
};

// ---------------------------------------------------------------------------
// Tool: brand_list_tokens
// ---------------------------------------------------------------------------

export const brandListTokens: McpToolDef<{
  guideId: string;
  tokenType?: string;
}> = {
  name: 'brand_list_tokens',
  description: 'List all DesignTokens linked to a BrandGuide, optionally filtered by tokenType.',
  inputSchema: {
    guideId: z.string().describe('BrandGuide entity ID'),
    tokenType: z
      .enum(['color', 'typography', 'spacing', 'shadow', 'motion', 'radius'])
      .optional()
      .describe('Filter by token type'),
  },
  handler: async ({ guideId, tokenType }, { kernel }) => {
    const guide = kernel.getEntity(guideId);
    if (!guide) return text(`BrandGuide "${guideId}" not found`);

    const tokenIds = guide.links
      .filter((l) => l.a === 'hasToken')
      .map((l) => l.e2);

    const tokens: Array<Record<string, unknown>> = [];
    for (const id of tokenIds) {
      const entity = kernel.getEntity(id);
      if (!entity || entity.type !== 'DesignToken') continue;

      const attrs = factsToRecord(entity);
      if (tokenType && attrs.tokenType !== tokenType) continue;

      tokens.push({ id, ...attrs });
    }

    return text(JSON.stringify(tokens, null, 2));
  },
};

// ---------------------------------------------------------------------------
// Tool: brand_generate_catalog
// ---------------------------------------------------------------------------

export const brandGenerateCatalog: McpToolDef<{ guideId: string }> = {
  name: 'brand_generate_catalog',
  description:
    'Generate a brand-constrained json-render catalog from a BrandGuide. Returns the AI system prompt (with voice/tone rules) and JSON Schema for structured output.',
  inputSchema: {
    guideId: z.string().describe('BrandGuide entity ID'),
  },
  handler: async ({ guideId }, ctx) => {
    // Check cache first
    if (ctx.cache.has(guideId)) {
      const cached = ctx.cache.get(guideId) as { systemPrompt: string; jsonSchema: unknown; componentNames: string[] };
      return text(JSON.stringify(cached, null, 2));
    }

    const { catalog, voiceRules, guide } = generateBrandCatalog(
      ctx.kernel as KernelReader,
      guideId,
      ctx.defineCatalog,
      ctx.schema,
      ctx.baseComponents,
    );

    const cat = catalog as {
      prompt: (opts: { customRules?: string[]; mode?: string }) => string;
      jsonSchema: (opts: { strict?: boolean }) => unknown;
      componentNames: string[];
      actionNames: string[];
    };

    const result = {
      systemPrompt: cat.prompt({ customRules: voiceRules, mode: 'inline' }),
      jsonSchema: cat.jsonSchema({ strict: guide.complianceMode === 'strict' }),
      componentNames: cat.componentNames,
      actionNames: cat.actionNames,
    };

    ctx.cache.set(guideId, result);
    return text(JSON.stringify(result, null, 2));
  },
};

// ---------------------------------------------------------------------------
// Tool: brand_get_prompt
// ---------------------------------------------------------------------------

export const brandGetPrompt: McpToolDef<{ guideId: string }> = {
  name: 'brand_get_prompt',
  description:
    'Generate the AI system prompt from a BrandGuide. Lighter-weight than brand_generate_catalog — returns the prompt string only.',
  inputSchema: {
    guideId: z.string().describe('BrandGuide entity ID'),
  },
  handler: async ({ guideId }, ctx) => {
    const { catalog, voiceRules } = generateBrandCatalog(
      ctx.kernel as KernelReader,
      guideId,
      ctx.defineCatalog,
      ctx.schema,
      ctx.baseComponents,
    );

    const cat = catalog as {
      prompt: (opts: { customRules?: string[]; mode?: string }) => string;
    };

    return text(cat.prompt({ customRules: voiceRules, mode: 'inline' }));
  },
};

// ---------------------------------------------------------------------------
// All tools
// ---------------------------------------------------------------------------

export const brandTools = [
  brandCreateGuide,
  brandUpsertToken,
  brandDeleteToken,
  brandListTokens,
  brandGenerateCatalog,
  brandGetPrompt,
] as const;
