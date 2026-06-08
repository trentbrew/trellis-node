/**
 * Graph-resident navigation, defined once with `defineType`.
 *
 * This single definition is simultaneously:
 *   - the runtime SchemaDefinition registered with the kernel (`registerType`), and
 *   - the static TypeScript type (`InferType`) the UI is written against.
 *
 * NavItem ↔ NavSection reference each other, so NavItem points back with a string
 * target (`rel('NavSection')`) to avoid the define-order cycle, while NavSection
 * uses a thunk (`rel(() => NavItem, 'many')`).
 */
import { defineType, rel, type InferResolvedType, type InferType } from 'trellis/schema';
import { z } from 'zod';

export const NavItem = defineType(
  'NavItem',
  {
    label: z.string(),
    href: z.string().optional(),
    order: z.number(),
  },
  {
    title: 'label',
    relations: { section: rel('NavSection') }, // string target breaks the cycle
  },
);

export const NavSection = defineType(
  'NavSection',
  {
    label: z.string(),
    order: z.number(),
    collapsed: z.boolean(),
  },
  {
    title: 'label',
    relations: { items: rel(() => NavItem, 'many') },
  },
);

export type NavSectionT = InferType<typeof NavSection>;
export type NavItemT = InferType<typeof NavItem>;

/** NavSection with `items` expanded via `{ resolve: { items: true } }`. */
export type NavSectionLoaded = InferResolvedType<
  typeof NavSection,
  { items: true }
>;
