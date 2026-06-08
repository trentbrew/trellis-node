/**
 * Contract for the schema/live-read wedge — exercised headlessly:
 *
 *   - `defineType` lowers Zod leaves + relations into a kernel `SchemaDefinition`
 *     (and a legacy `OntologySchema` adapter), keyed by `@id`.
 *   - `InferType` derives the static entity type (leaves, optionals, relation refs).
 *   - `liveQuery` is the Signal-first read primitive: loading → data on a sub
 *     callback, and surfaces local-mode `subscribe()` throws as error state rather
 *     than crashing.
 *
 * Nav is the first integration target, so the fixtures model `NavItem` / `NavSection`.
 * React mounting is covered by tsc + the existing realtime adapter tests; the
 * decisive logic here is framework-agnostic and DOM-free.
 */
import { describe, expect, expectTypeOf, test, vi } from 'vitest';
import { z } from 'zod';
import { defineType, rel, type InferType } from '../../src/schema/define.js';
import { liveQuery } from '../../src/client/live.js';
import type {
  Subscription,
  SubscriptionCallback,
  TrellisDb,
} from '../../src/client/sdk.js';

const NavItem = defineType(
  'NavItem',
  {
    label: z.string(),
    icon: z.string().optional(),
    order: z.number(),
    href: z.string().url().optional(),
  },
  { title: 'label' },
);

const NavSection = defineType(
  'NavSection',
  {
    label: z.string(),
    order: z.number(),
    collapsed: z.boolean(),
  },
  { title: 'label', relations: { items: rel(() => NavItem, 'many') } },
);

describe('defineType → SchemaDefinition', () => {
  test('emits a user-tier schema keyed by @id', () => {
    expect(NavItem.definition['@id']).toBe('trellis:NavItem');
    expect(NavItem.definition['@type']).toBe('trellis:Schema');
    expect(NavItem.definition.tier).toBe('user');
  });

  test('maps Zod leaves to Notion property types + required flags', () => {
    const f = Object.fromEntries(
      NavItem.definition.fields.map((x) => [x.name, x]),
    );
    expect(f.label.valueType).toBe('title');
    expect(f.order.valueType).toBe('number');
    expect(f.href.valueType).toBe('url'); // .url() check detected through .optional()
    expect(f.order.required).toBe(true);
    expect(f.icon.required).toBe(false);
    expect(f.href.required).toBe(false);
  });

  test('relations become relation specs with cardinality', () => {
    const items = NavSection.definition.fields.find((x) => x.name === 'items');
    expect(items?.valueType).toBe('relation');
    expect(items?.relation).toEqual({
      targetSchema: 'NavItem',
      cardinality: 'many',
    });
  });

  test('legacy adapter yields an OntologySchema for the registry', () => {
    const legacy = NavSection.toOntologySchema();
    expect(legacy.id).toBe('trellis:NavSection');
    expect(legacy.entities[0].name).toBe('NavSection');
    expect(legacy.relations[0]).toMatchObject({
      name: 'items',
      sourceTypes: ['NavSection'],
      targetTypes: ['NavItem'],
      cardinality: 'many',
    });
  });
});

describe('InferType', () => {
  test('infers leaves, optionals, relation refs, and the type literal', () => {
    type Section = InferType<typeof NavSection>;
    expectTypeOf<Section['type']>().toEqualTypeOf<'NavSection'>();
    expectTypeOf<Section['label']>().toEqualTypeOf<string>();
    expectTypeOf<Section['collapsed']>().toEqualTypeOf<boolean>();
    // Ref<S>[] is assignable to string[] (Ref is a branded string).
    expectTypeOf<Section['items']>().toMatchTypeOf<string[]>();

    type Item = InferType<typeof NavItem>;
    expectTypeOf<Item['type']>().toEqualTypeOf<'NavItem'>();
    expectTypeOf<Item['icon']>().toEqualTypeOf<string | undefined>();
  });
});

describe('liveQuery (Signal-first reads)', () => {
  test('is inert until start(), then transitions loading → data', () => {
    let cb: SubscriptionCallback<Record<string, unknown>> | null = null;
    const unsubscribe = vi.fn();
    const fake = {
      subscribe: vi.fn(
        (_eql: string, callback: SubscriptionCallback<Record<string, unknown>>): Subscription => {
          cb = callback;
          return { unsubscribe };
        },
      ),
    } as unknown as TrellisDb;

    const res = liveQuery(fake, 'find NavItem');
    expect(fake.subscribe).not.toHaveBeenCalled();
    expect(res.signal.peek()).toMatchObject({ loading: true, data: [] });

    const stop = res.start();
    expect(fake.subscribe).toHaveBeenCalledOnce();

    cb!([{ id: '1', type: 'NavItem', label: 'Home' }], {
      added: [],
      updated: [],
      removed: [],
    });
    expect(res.signal.peek()).toMatchObject({
      loading: false,
      error: null,
      data: [{ label: 'Home' }],
    });

    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  test('surfaces local-mode subscribe() throw as error state', () => {
    const fake = {
      subscribe: () => {
        throw new Error('subscribe() requires remote mode (connect to a running server)');
      },
    } as unknown as TrellisDb;

    const res = liveQuery(fake, 'find NavItem');
    res.start();
    const state = res.signal.peek();
    expect(state.loading).toBe(false);
    expect(state.error?.message).toMatch(/remote mode/);
  });
});
