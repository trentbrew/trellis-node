/**
 * Relation `resolve` — batched expansion after hydration.
 */
import { describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { defineType, rel } from '../../src/schema/define.js';
import {
  inverseForeignKey,
  resolveRelations,
} from '../../src/schema/resolve.js';
import type { EntityData, TrellisDb } from '../../src/client/sdk.js';

const NavItem = defineType(
  'NavItem',
  { label: z.string(), order: z.number() },
  { relations: { section: rel('NavSection') } },
);

const NavSection = defineType(
  'NavSection',
  { label: z.string(), order: z.number(), collapsed: z.boolean() },
  { relations: { items: rel(() => NavItem, 'many') } },
);

describe('inverseForeignKey', () => {
  test('finds child back-reference for a many relation', () => {
    expect(inverseForeignKey(NavSection, 'items', NavItem)).toBe('section');
  });
});

describe('resolveRelations', () => {
  test('groups NavItems onto NavSection.items in one pass', async () => {
    const table: Record<string, EntityData> = {
      'navsection:a': {
        id: 'navsection:a',
        type: 'NavSection',
        label: 'Workspace',
        order: 0,
        collapsed: false,
      },
      'navitem:1': {
        id: 'navitem:1',
        type: 'NavItem',
        label: 'Overview',
        order: 0,
        section: 'navsection:a',
      },
      'navitem:2': {
        id: 'navitem:2',
        type: 'NavItem',
        label: 'Tasks',
        order: 1,
        section: 'navsection:a',
      },
    };

    const client = {
      query: vi.fn(async () => ({
        bindings: [{ e: 'navitem:1' }, { e: 'navitem:2' }],
        executionTime: 0,
      })),
      read: vi.fn(async (id: string) => table[id] ?? null),
    } as unknown as TrellisDb;

    const sections = [table['navsection:a']!];
    const resolved = await resolveRelations(client, NavSection, sections, {
      items: true,
    });

    expect(client.query).toHaveBeenCalledOnce();
    expect(resolved[0]!.items).toHaveLength(2);
    expect((resolved[0] as EntityData & { items: EntityData[] }).items.map((i) => i.label)).toEqual([
      'Overview',
      'Tasks',
    ]);
  });

  test('nested resolve expands forward one on grouped children', async () => {
    const table: Record<string, EntityData> = {
      'navsection:a': {
        id: 'navsection:a',
        type: 'NavSection',
        label: 'Workspace',
        order: 0,
        collapsed: false,
      },
      'navitem:1': {
        id: 'navitem:1',
        type: 'NavItem',
        label: 'Overview',
        order: 0,
        section: 'navsection:a',
      },
    };

    const client = {
      query: vi.fn(async () => ({
        bindings: [{ e: 'navitem:1' }],
        executionTime: 0,
      })),
      read: vi.fn(async (id: string) => table[id] ?? null),
    } as unknown as TrellisDb;

    const sections = [table['navsection:a']!];
    const resolved = await resolveRelations(client, NavSection, sections, {
      items: { section: true },
    });

    const items = (resolved[0] as EntityData & { items: EntityData[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0]!.section).toMatchObject({
      id: 'navsection:a',
      label: 'Workspace',
    });
  });
});
