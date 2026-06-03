# ADR 0009: Kernel vs CMS formula syntax

**Status:** accepted  
**Issue:** TRL-20

## Context

Trellis has two formula surfaces today:

| Surface | Syntax | Example | Where evaluated |
| ------- | ------ | ------- | --------------- |
| CMS collections | `{field}` numeric DSL | `{price} * {quantity}` | `trellis/cms` client on read |
| Kernel ontology | `$fn($field, …)` DSL | `$mul($price, $quantity)` | `logic-middleware` post-EQL via `ExprEvaluator` |

## Decision

- **Kernel path** uses `ExprEvaluator` (`$if`, `$concat`, `$mul`, `$field`, …) per `TRELLIS_SPEC`.
- **CMS path** keeps `{field}` arithmetic for backward-compatible collection schemas.
- No automatic aliasing in v1 — document both; unify later if CMS schemas migrate to kernel ontologies.

## Consequences

- `trellis db serve` / `kernel.query()` enrich EQL bindings when ontology fields declare `formula`.
- CMS virtual fields remain client-side until collections share kernel ontology definitions.
