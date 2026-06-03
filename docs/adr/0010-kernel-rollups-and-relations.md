# ADR 0010: Kernel rollups and relation projection

**Status:** accepted  
**Issue:** TRL-21 (desk id may differ)

## Context

Ontology fields can declare `rollup` and `relation` value types. After TRL-20, formulas enrich EQL bindings in `logic-middleware`, but rollups were stubbed (`''`) and relation fields were not projected from the graph.

The realtime-app sandbox computes `tagCount` via `frameworkTag` join-entities and a server-side `tags.length` helper. Kernel support should cover both graph links and join-entity rollups.

## Decision

1. **`evaluateRollup`** (`src/core/computation/rollup.ts`) runs post-EQL with store access:
   - **Graph links:** `relationProperty` is the link attribute; forward links from the binding entity are aggregated.
   - **Join-entities:** optional `rollup.joinEntity: { type, foreignKey }` counts/filters rows whose `foreignKey` fact points at the parent entity.
   - Aggregations: `count`, `sum`, `avg`, `min`, `max`, `median`, `mode`.
   - `targetProperty: 'id'` uses related entity ids (typical for `count`).

2. **Relation projection:** for ontology fields with `valueType: 'relation'`, missing binding keys are filled from `getLinksByEntityAndAttribute(entityId, field.name)`. Cardinality `one` → single target id; `many` → comma-separated ids (v1).

3. **Store wiring:** `attachStandardMiddleware` passes `getStore: () => kernel.getStore()`; `kernel.query()` also sets `ctx.store` for middleware.

## Consequences

- EQL can `SELECT ?tagCount` when ontology declares the rollup field and middleware is attached.
- Join-entity rollups require explicit `joinEntity` in ontology (sandbox `tagCount` schema is the reference shape).
- CMS `{field}` rollups remain separate; kernel uses ontology `RollupConfig` only.
- Future: unify join-entities with ontology `relation` defs; richer many-cardinality binding shape.
