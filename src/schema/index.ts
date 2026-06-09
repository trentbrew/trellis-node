/**
 * Trellis Schema — Public API Surface
 *
 * Typed entity definitions (`defineType`) that emit a kernel `SchemaDefinition`
 * and a static TS type. Import from `trellis/schema`:
 *
 *   import { defineType, rel, type InferType } from 'trellis/schema';
 *
 * @module trellis/schema
 */
export {
  defineType,
  rel,
  rollup,
  formula,
} from './define.js';
export type {
  AnyType,
  ComputedField,
  ComputedMap,
  DefineTypeOptions,
  InferEntitiesRead,
  InferEntityRead,
  InferType,
  InferResolvedType,
  Ref,
  Relation,
  RelationMap,
  RelTarget,
  ResolveSpecFor,
  TrellisType,
} from './define.js';

// EQL-S query builders (shared by the typed read adapters)
export {
  entitiesQuery,
  entityQuery,
  escapeValue,
  formatEqlLiteral,
  isWhereFilter,
  whereCondition,
} from './eql.js';
export type { WhereFilter, WhereInput, WhereOp, WhereValue } from './eql.js';

// Schema-typed mutations
export { entityMutations } from './mutations.js';
export type { EntityMutations } from './mutations.js';

// Relation expansion + entity projection for live reads
export { resolveRelations, inverseForeignKey } from './resolve.js';
export type { ResolveSpec } from './resolve.js';
export {
  bindingEntityId,
  bindingToEntity,
  entityRecordToPlain,
  hydrateBindings,
  isSparseBinding,
} from './entity-projection.js';
export type { EntityReader, EntityRecordLike } from './entity-projection.js';
