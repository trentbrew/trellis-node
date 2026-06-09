/**
 * TRL-4 — nested {@link InferResolvedType} matches runtime nested `resolve`.
 */
import { describe, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import {
  defineType,
  rel,
  type InferEntitiesRead,
  type InferResolvedType,
  type InferType,
} from '../../src/schema/define.js';

const Author = defineType('Author', { name: z.string() });

const Post = defineType(
  'Post',
  { title: z.string() },
  { relations: { author: rel(() => Author) } },
);

const Blog = defineType(
  'Blog',
  { name: z.string() },
  { relations: { posts: rel(() => Post, 'many') } },
);

const Category = defineType('Category', { label: z.string() });

const Product = defineType(
  'Product',
  { name: z.string() },
  { relations: { category: rel(() => Category) } },
);

const Store = defineType(
  'Store',
  { name: z.string() },
  { relations: { products: rel(() => Product, 'many') } },
);

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

describe('InferResolvedType (flat)', () => {
  test('expands a many relation to a full entity array', () => {
    type Loaded = InferResolvedType<typeof NavSection, { items: true }>;
    type Item = InferType<typeof NavItem>;

    expectTypeOf<Loaded['items']>().toEqualTypeOf<Item[]>();
    expectTypeOf<Loaded['label']>().toEqualTypeOf<string>();
    expectTypeOf<Loaded['collapsed']>().toEqualTypeOf<boolean>();
  });

  test('leaves unlisted relations as refs', () => {
    type Loaded = InferResolvedType<typeof NavSection, { items: true }>;
    expectTypeOf<Loaded['items'][number]['section']>().toMatchTypeOf<string>();
  });
});

describe('InferResolvedType (nested)', () => {
  test('recurses through nested resolve specs', () => {
    type Loaded = InferResolvedType<
      typeof Store,
      { products: { category: true } }
    >;
    type CategoryT = InferType<typeof Category>;
    type ProductT = InferType<typeof Product>;

    expectTypeOf<Loaded['products']>().toEqualTypeOf<
      (ProductT & { category: CategoryT })[]
    >();
  });

  test('supports multi-level nesting', () => {
    type Loaded = InferResolvedType<
      typeof Blog,
      { posts: { author: true } }
    >;
    type AuthorT = InferType<typeof Author>;
    type PostT = InferType<typeof Post>;

    expectTypeOf<Loaded['posts']>().toEqualTypeOf<
      (PostT & { author: AuthorT })[]
    >();
  });

  test('empty nested spec keeps refs at that level', () => {
    type Loaded = InferResolvedType<typeof Store, { products: {} }>;
    expectTypeOf<Loaded['products']>().toEqualTypeOf<
      InferType<typeof Product>[]
    >();
    expectTypeOf<Loaded['products'][number]['category']>().toMatchTypeOf<string>();
  });
});

describe('InferEntitiesRead', () => {
  test('infers resolved rows from read options', () => {
    type Flat = InferEntitiesRead<
      typeof NavSection,
      { resolve: { items: true } }
    >;
    expectTypeOf<Flat>().toEqualTypeOf<
      InferResolvedType<typeof NavSection, { items: true }>[]
    >();

    type Nested = InferEntitiesRead<
      typeof Store,
      { resolve: { products: { category: true } } }
    >;
    expectTypeOf<Nested>().toEqualTypeOf<
      InferResolvedType<
        typeof Store,
        { products: { category: true } }
      >[]
    >();
  });

  test('defaults to InferType when resolve is absent', () => {
    type Plain = InferEntitiesRead<typeof NavSection, { where: { collapsed: false } }>;
    expectTypeOf<Plain>().toEqualTypeOf<InferType<typeof NavSection>[]>();
  });
});
