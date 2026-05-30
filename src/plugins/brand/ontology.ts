/**
 * Brand Token Ontology — Schema definitions for BrandGuide and DesignToken entities.
 *
 * Two entity types, one relation. Deliberately flat:
 * - BrandGuide: container for a set of tokens + brand rules
 * - DesignToken: a single token discriminated by tokenType
 * - hasToken: links a guide to its tokens
 *
 * @module trellis/plugins/brand
 */

import type { OntologySchema } from '../../core/ontology/types.js';

export const brandOntology: OntologySchema = {
  id: 'trellis:brand',
  name: 'Brand Token System',
  version: '1.0.0',
  description: 'Design tokens and brand governance for json-render catalogs',
  entities: [
    {
      name: 'BrandGuide',
      description: 'Container for a set of design tokens and brand rules',
      attributes: [
        { name: 'name', type: 'string', required: true },
        {
          name: 'status',
          type: 'string',
          enum: ['draft', 'published', 'archived'],
          default: 'draft',
        },
        {
          name: 'complianceMode',
          type: 'string',
          enum: ['strict', 'moderate', 'permissive'],
          default: 'strict',
          description:
            'strict = LLM structurally cannot emit unapproved variants; moderate = strict JSON Schema without additionalProperties enforcement; permissive = full shadcn enums, prompt guidance only',
        },
        {
          name: 'voiceTone',
          type: 'any',
          description:
            'JSON blob: { traits?: string[], preferred?: Record<string,string>, avoided?: string[], examples?: string[] }',
        },
      ],
    },
    {
      name: 'DesignToken',
      description: 'A single design token (color, typography, spacing, etc.)',
      attributes: [
        { name: 'name', type: 'string', required: true },
        {
          name: 'tokenType',
          type: 'string',
          required: true,
          enum: ['color', 'typography', 'spacing', 'shadow', 'motion', 'radius'],
        },
        {
          name: 'role',
          type: 'string',
          required: true,
          description:
            'Semantic role that maps to json-render prop enum values: primary, secondary, accent, destructive, muted, etc.',
        },
        {
          name: 'value',
          type: 'any',
          required: true,
          description:
            'Token value — format depends on tokenType. Colors: { hex, oklch, rgb, hsl }. Spacing: "1rem". Typography: { fontFamily, fontSize, fontWeight }.',
        },
        {
          name: 'lightMode',
          type: 'any',
          description: 'Light-mode override value (colors only)',
        },
        {
          name: 'darkMode',
          type: 'any',
          description: 'Dark-mode override value (colors only)',
        },
        { name: 'wcagAA', type: 'boolean', description: 'Passes WCAG AA contrast ratio' },
        { name: 'wcagAAA', type: 'boolean', description: 'Passes WCAG AAA contrast ratio' },
        { name: 'description', type: 'string' },
      ],
    },
  ],
  relations: [
    {
      name: 'hasToken',
      sourceTypes: ['BrandGuide'],
      targetTypes: ['DesignToken'],
      cardinality: 'many',
    },
  ],
};
