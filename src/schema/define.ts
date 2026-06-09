/**
 * Trellis Schema — typed entity definitions over the ontology.
 *
 * `defineType` is the Trellis answer to Jazz's `co.map`: one definition produces
 * BOTH a runtime {@link SchemaDefinition} (registerable in the kernel via
 * `createOntology`) AND a static TypeScript type via {@link InferType}. Zod
 * handles leaf validation + inference; a second options bag handles the graph
 * semantics Zod can't express — relation cardinality, rollups, formulas, tier.
 *
 * This deliberately targets `SchemaDefinition` (the live kernel path consumed by
 * schema/rollup middleware), not the legacy `OntologySchema` registry — see
 * {@link TrellisType.toOntologySchema} for the legacy adapter.
 *
 *   import { defineType, rel } from 'trellis/schema';
 *   import { z } from 'zod';
 *
 *   const NavItem = defineType('NavItem', {
 *     label: z.string(),
 *     icon: z.string().optional(),
 *     order: z.number(),
 *   }, { title: 'label' });
 *
 *   const NavSection = defineType('NavSection', {
 *     label: z.string(),
 *     order: z.number(),
 *     collapsed: z.boolean(),
 *   }, { title: 'label', relations: { items: rel(() => NavItem, 'many') } });
 *
 *   type Section = InferType<typeof NavSection>;
 *   // { id: string; type: 'NavSection'; label: string; order: number;
 *   //   collapsed: boolean; items: Ref<typeof NavItem>[] }
 *
 * @module trellis/schema
 */
import { z } from 'zod';
import type { Atom } from '../core/store/eav-store.js';
import type {
  AttrType,
  AttributeDef,
  OntologySchema,
  OntologyTier,
  PropertyType,
  PropertyValueSpecification,
  RelationDef,
  SchemaDefinition,
} from '../core/ontology/types.js';

// ---------------------------------------------------------------------------
// References & relations
// ---------------------------------------------------------------------------

/**
 * A reference to another entity. Unresolved it is the target's id (a `string`);
 * a future `resolve` option swaps it for the loaded {@link InferType} value.
 */
export type Ref<S extends AnyType = AnyType> = string & { readonly __ref?: S };

export type RelTarget<S extends AnyType> = (() => S) | string;

export interface Relation<S extends AnyType, C extends 'one' | 'many'> {
  readonly target: RelTarget<S>;
  readonly cardinality: C;
}

/** Declare a relation field. Target may be a thunk (define-order safe) or a name. */
export function rel<S extends AnyType, C extends 'one' | 'many' = 'one'>(
  target: RelTarget<S>,
  cardinality: C = 'one' as C,
): Relation<S, C> {
  return { target, cardinality };
}

export type RelationMap = Record<string, Relation<AnyType, 'one' | 'many'>>;

// ---------------------------------------------------------------------------
// Computed fields (rollups / formulas) — readonly in the inferred type
// ---------------------------------------------------------------------------

export interface ComputedField {
  readonly spec: Partial<PropertyValueSpecification> & { valueType: PropertyType };
}

export type ComputedMap = Record<string, ComputedField>;

/** Declare a rollup over a relation (e.g. count of linked items). */
export function rollup(
  cfg: NonNullable<PropertyValueSpecification['rollup']>,
): ComputedField {
  return { spec: { valueType: 'rollup', rollup: cfg, computed: true, editable: false } };
}

/** Declare a formula field. */
export function formula(expr: string): ComputedField {
  return { spec: { valueType: 'formula', formula: expr, computed: true, editable: false } };
}

// ---------------------------------------------------------------------------
// The type handle
// ---------------------------------------------------------------------------

export interface TrellisType<
  Name extends string,
  Z extends z.ZodRawShape,
  R extends RelationMap,
  C extends ComputedMap,
> {
  readonly type: Name;
  /** Leaf validator (does not include relations/computed). */
  readonly zod: z.ZodObject<Z>;
  readonly relations: R;
  readonly computed: C;
  /** Kernel-facing schema, keyed by `@id` = `trellis:<Name>`. */
  readonly definition: SchemaDefinition;
  /** Adapter to the legacy OntologyRegistry (relation resolution only). */
  toOntologySchema(): OntologySchema;
}

export type AnyType = TrellisType<string, z.ZodRawShape, RelationMap, ComputedMap>;

// ---------------------------------------------------------------------------
// Inference
// ---------------------------------------------------------------------------

type RelValue<X> = X extends Relation<infer S, infer C>
  ? C extends 'many'
    ? Ref<S>[]
    : Ref<S>
  : never;

export type InferType<T> = T extends TrellisType<
  infer Name,
  infer Z,
  infer R,
  infer C
>
  ? { id: string; type: Name } & z.infer<z.ZodObject<Z>> & {
        [K in keyof R]: RelValue<R[K]>;
      } & { readonly [K in keyof C]: number }
  : never;

/** Target entity schema of a relation field. */
type RelationTarget<R> = R extends Relation<infer S, 'one' | 'many'> ? S : never;

/**
 * Typed `resolve` spec for {@link InferResolvedType} — mirrors runtime
 * {@link import('./resolve.js').ResolveSpec} but keyed to declared relations.
 *
 *   `{ items: true }` — expand `items` to full entities.
 *   `{ items: { section: true } }` — expand `items`, then each item's `section`.
 */
export type ResolveSpecFor<T extends AnyType> = {
  [K in keyof T['relations'] & string]?:
    | true
    | ResolveSpecFor<RelationTarget<T['relations'][K]>>;
};

/** Expand one relation key according to a resolve spec entry (`true` or nested). */
type ApplyResolve<
  Field extends Relation<AnyType, 'one' | 'many'>,
  Spec,
> = Field extends Relation<infer S, infer C>
  ? [Spec] extends [true]
    ? C extends 'many'
      ? InferType<S>[]
      : InferType<S>
    : Spec extends ResolveSpecFor<S>
      ? C extends 'many'
        ? InferResolvedType<S, Spec>[]
        : InferResolvedType<S, Spec>
      : RelValue<Field>
  : never;

/**
 * Like {@link InferType}, but relation keys in `resolve` are expanded entity
 * shapes instead of `Ref` ids. Nested objects recurse (TRL-4).
 */
export type InferResolvedType<
  T extends AnyType,
  R extends ResolveSpecFor<T>,
> = T extends TrellisType<infer Name, infer Z, infer Rel, infer C>
  ? { id: string; type: Name } & z.infer<z.ZodObject<Z>> & {
        [K in keyof Rel]: K extends keyof R
          ? ApplyResolve<Rel[K], R[K]>
          : RelValue<Rel[K]>;
      } & { readonly [K in keyof C]: number }
  : never;

/**
 * Infer the entity array shape returned by typed live reads (`useEntities`,
 * `entitiesStore`) from optional read options.
 */
export type InferEntitiesRead<S extends AnyType, O> = O extends {
  resolve: infer R;
}
  ? R extends ResolveSpecFor<S>
    ? InferResolvedType<S, R>[]
    : InferType<S>[]
  : InferType<S>[];

/**
 * Infer the entity shape returned by typed single-entity reads (`useEntity`,
 * `entityStore`) from optional read options.
 */
export type InferEntityRead<S extends AnyType, O> = O extends {
  resolve: infer R;
}
  ? R extends ResolveSpecFor<S>
    ? InferResolvedType<S, R> | null
    : InferType<S> | null
  : InferType<S> | null;

// ---------------------------------------------------------------------------
// defineType
// ---------------------------------------------------------------------------

export interface DefineTypeOptions<
  Z extends z.ZodRawShape,
  R extends RelationMap,
  C extends ComputedMap,
> {
  /** Which leaf key is the entity's `title` property. */
  title?: Extract<keyof Z, string>;
  relations?: R;
  computed?: C;
  /** Defaults to 'user'. Core/system are reserved for shipped schemas. */
  tier?: OntologyTier;
  version?: string;
  /** Parent type name (`subClassOf`). */
  extends?: string;
  label?: string;
}

export function defineType<
  Name extends string,
  Z extends z.ZodRawShape,
  R extends RelationMap = Record<never, never>,
  C extends ComputedMap = Record<never, never>,
>(
  type: Name,
  shape: Z,
  opts: DefineTypeOptions<Z, R, C> = {},
): TrellisType<Name, Z, R, C> {
  const relations = (opts.relations ?? {}) as R;
  const computed = (opts.computed ?? {}) as C;

  const fields: PropertyValueSpecification[] = [
    ...Object.entries(shape).map(([name, zt]) =>
      zodToSpec(name, zt as z.ZodTypeAny, name === opts.title),
    ),
    ...Object.entries(relations).map(([name, r]) => relationToSpec(name, r)),
    ...Object.entries(computed).map(
      ([name, c]) => ({ name, required: false, ...c.spec }) as PropertyValueSpecification,
    ),
  ];

  const definition: SchemaDefinition = {
    '@id': `trellis:${type}`,
    '@type': 'trellis:Schema',
    version: opts.version ?? '1.0.0',
    tier: opts.tier ?? 'user',
    label: opts.label ?? type,
    fields,
    ...(opts.extends ? { subClassOf: opts.extends } : {}),
  };

  return {
    type,
    zod: z.object(shape),
    relations,
    computed,
    definition,
    toOntologySchema: () => lowerToLegacy(type, definition, relations),
  };
}

// ---------------------------------------------------------------------------
// Zod → PropertyValueSpecification
// ---------------------------------------------------------------------------

function unwrap(zt: z.ZodTypeAny): z.ZodTypeAny {
  let t = zt;
  // Peel ZodOptional / ZodNullable / ZodDefault to reach the leaf type.
  for (let i = 0; i < 8; i++) {
    if (
      t instanceof z.ZodOptional ||
      t instanceof z.ZodNullable ||
      t instanceof z.ZodDefault
    ) {
      const inner = (t._def as { innerType?: z.ZodTypeAny }).innerType;
      if (!inner) break;
      t = inner;
    } else {
      break;
    }
  }
  return t;
}

function zodToSpec(
  name: string,
  zt: z.ZodTypeAny,
  isTitle: boolean,
): PropertyValueSpecification {
  const required = !zt.isOptional();
  const base = unwrap(zt);

  let valueType: PropertyType = 'rich_text';
  let selectOptions: Atom[] | undefined;

  if (isTitle) {
    valueType = 'title';
  } else if (base instanceof z.ZodString) {
    const checks = (base._def.checks ?? []) as { kind: string }[];
    if (checks.some((c) => c.kind === 'email')) valueType = 'email';
    else if (checks.some((c) => c.kind === 'url')) valueType = 'url';
    else if (checks.some((c) => c.kind === 'datetime')) valueType = 'date';
    else valueType = 'rich_text';
  } else if (base instanceof z.ZodNumber) {
    valueType = 'number';
  } else if (base instanceof z.ZodBoolean) {
    valueType = 'checkbox';
  } else if (base instanceof z.ZodDate) {
    valueType = 'date';
  } else if (base instanceof z.ZodEnum) {
    valueType = 'select';
    selectOptions = (base.options as readonly string[]).slice() as Atom[];
  } else if (base instanceof z.ZodArray) {
    const el = unwrap((base._def as { type: z.ZodTypeAny }).type);
    valueType = 'multi_select';
    if (el instanceof z.ZodEnum) {
      selectOptions = (el.options as readonly string[]).slice() as Atom[];
    }
  } else {
    valueType = 'json';
  }

  const spec: PropertyValueSpecification = { name, valueType, required };
  if (selectOptions) spec.selectOptions = selectOptions;
  return spec;
}

function targetName(r: Relation<AnyType, 'one' | 'many'>): string {
  return typeof r.target === 'string' ? r.target : r.target().type;
}

function relationToSpec(
  name: string,
  r: Relation<AnyType, 'one' | 'many'>,
): PropertyValueSpecification {
  return {
    name,
    valueType: 'relation',
    required: false,
    relation: { targetSchema: targetName(r), cardinality: r.cardinality },
  };
}

// ---------------------------------------------------------------------------
// Legacy OntologySchema adapter
// ---------------------------------------------------------------------------

function attrType(v: PropertyType): AttrType {
  switch (v) {
    case 'number':
    case 'rollup':
      return 'number';
    case 'checkbox':
      return 'boolean';
    case 'date':
      return 'date';
    case 'relation':
      return 'ref';
    default:
      return 'string';
  }
}

function lowerToLegacy(
  type: string,
  def: SchemaDefinition,
  relations: RelationMap,
): OntologySchema {
  const attributes: AttributeDef[] = def.fields
    .filter((f) => f.valueType !== 'relation')
    .map((f) => ({
      name: f.name,
      type: attrType(f.valueType),
      required: f.required ?? false,
    }));

  const rels: RelationDef[] = Object.entries(relations).map(([name, r]) => ({
    name,
    sourceTypes: [type],
    targetTypes: [targetName(r)],
    cardinality: r.cardinality,
  }));

  return {
    id: def['@id'],
    name: type,
    version: def.version,
    entities: [{ name: type, attributes }],
    relations: rels,
  };
}
