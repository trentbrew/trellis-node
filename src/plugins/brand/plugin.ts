/**
 * Brand Plugin — Trellis plugin definition for the brand token system.
 *
 * Registers the brand ontology and subscribes to entity events to
 * invalidate cached catalogs when tokens or guides change.
 *
 * @module trellis/plugins/brand
 */

import type { PluginDef } from '../../core/plugins/types.js';
import { brandOntology } from './ontology.js';
import { CatalogCache } from './cache.js';

/**
 * Create a brand token plugin instance.
 *
 * Returns a PluginDef and the shared CatalogCache so MCP tools
 * and external consumers can access cached catalogs.
 */
export function createBrandPlugin(): { plugin: PluginDef; cache: CatalogCache } {
  const cache = new CatalogCache();

  const isBrandEntity = (data: unknown): boolean => {
    if (!data || typeof data !== 'object') return false;
    const d = data as Record<string, unknown>;
    return d.type === 'DesignToken' || d.type === 'BrandGuide';
  };

  const plugin: PluginDef = {
    id: 'trellis:brand',
    name: 'Brand Token System',
    version: '1.0.0',
    description: 'Design tokens → json-render catalogs with brand governance',

    ontologies: [brandOntology],

    eventHandlers: [
      {
        event: 'entity:created',
        handler: (data) => {
          if (isBrandEntity(data)) cache.invalidateAll();
        },
      },
      {
        event: 'entity:updated',
        handler: (data) => {
          if (isBrandEntity(data)) cache.invalidateAll();
        },
      },
      {
        event: 'entity:deleted',
        handler: (data) => {
          if (isBrandEntity(data)) cache.invalidateAll();
        },
      },
    ],

    onLoad: async (ctx) => {
      ctx.log('Brand token system loaded');
    },

    onUnload: async (ctx) => {
      cache.invalidateAll();
      ctx.log('Brand token system unloaded');
    },
  };

  return { plugin, cache };
}
