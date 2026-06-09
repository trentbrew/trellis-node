/**
 * Graph-resident app navigation — shared schema for shell + bootstrap.
 */
import { defineType, rel, type InferResolvedType, type InferType } from 'trellis/schema';
import { z } from 'zod';

export const NavItem = defineType(
	'NavItem',
	{
		label: z.string(),
		href: z.string().optional(),
		order: z.number()
	},
	{
		title: 'label',
		relations: { section: rel('NavSection') }
	}
);

export const NavSection = defineType(
	'NavSection',
	{
		label: z.string(),
		order: z.number(),
		collapsed: z.boolean()
	},
	{
		title: 'label',
		relations: { items: rel(() => NavItem, 'many') }
	}
);

export type NavSectionT = InferType<typeof NavSection>;
export type NavItemT = InferType<typeof NavItem>;
export type NavSectionLoaded = InferResolvedType<typeof NavSection, { items: true }>;
