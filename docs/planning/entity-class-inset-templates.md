---
title: Entity-class inset templates
description: Map ENTITY_CLASSES dialog shells to anchored L3 operator inset templates (ADR 0012).
created: 2026-06-10
updated: 2026-06-10
issue: TRL-16
related:
  - ../adr/0012-graph-overlay-config-surface.md
  - l3-inspector-bits-ui.md
  - ../../../../Sandbox/fractal-playground/fractals-playground/docs/planning/fractal-registry-synthesis.md
---

# Entity-class inset templates

**Status:** spec (TRL-16)  
**Repo:** `demo/realtime-app` — `src/lib/registry/entity-class-insets.ts`  
**Replaces:** trellis-client `TemporalDialogShell`, `DocumentDialogShell`, `ActorDialogShell`, `ContainerDialogShell` as **permanent routes**

## Goal

Map the four `ENTITY_CLASSES` archetypes to **anchored L3 inset templates** per [ADR 0012](../adr/0012-graph-overlay-config-surface.md). Detail / expand flows mount the same inset component in **anchored** mode when `selection !== null`; **ambient** mode when no selection (global graph tools).

**Rejected:** four permanent dialog routes or always-visible side panels (ADR 0012 alternatives).

## Anchored vs ambient (ADR 0012)

| Mount | When | Header | Tab scope | Dismiss |
| ----- | ---- | ------ | --------- | ------- |
| **Anchored** | `selection` set (entity class + id) | Selection identity chip | Filtered to selection subgraph | Return to L2; preserve main vantage |
| **Ambient** | `selection === null` | “Graph” / workspace | Full topological tools (EQL, entities, stats) | Explicit “left artifact” state |

Heteromorphic tools **leak** into homomorphic binding when selection exists — same inset component, two mount semantics.

## Mapping table

| EntityClass | InsetTemplateId | defaultDialogShell (legacy) | defaultVantage | Notes |
| ----------- | --------------- | --------------------------- | -------------- | ----- |
| `temporal` | `temporal-inset` | `TemporalDialogShell` | 5 (row) | Calendar / timeline fields; row territory |
| `document` | `document-inset` | `DocumentDialogShell` | 8 (card) | Content body fields; card territory |
| `actor` | `actor-inset` | `ActorDialogShell` | 10 (profile card) | Identity / contact fields |
| `container` | `container-inset` | `ContainerDialogShell` | 8 (card) | Collection / folder grouping |

Resolver: `resolveInsetTemplate({ entityClass?, dialogShell? })` — `dialogShell` override accepts legacy shell name or bare class string.

## Per-class spec

### Temporal

- **Class signals:** `startDate`, `endDate`, `dueDate`, `allDay`, interval fields.
- **Anchored inset:** temporal attributes, lane timeline, related events in subgraph.
- **Collection projections:** calendar, list, table, kanban, timeline (from trellis-client `ENTITY_CLASSES`).
- **Not:** a dedicated `/dialogs/temporal` route.

### Document

- **Class signals:** `content`, `body`, `pinned`, `wordCount`.
- **Anchored inset:** properties + content panel slots (maps to ontology `panels` when present).
- **Collection projections:** list, card-grid, table.
- **Proof hook:** collection record row click → `entityClass: 'document'` → anchored `document-inset`.

### Actor

- **Class signals:** `email`, `phone`, `avatar`, `firstName`, `lastName`, `role`.
- **Anchored inset:** identity chip, contact fields, membership edges.
- **Collection projections:** table, card-grid, list, graph.

### Container

- **Class signals:** default fallback when no stronger class match; `collectionId`, nesting refs.
- **Anchored inset:** child list, containment edges, collection meta.
- **Collection projections:** list, kanban, table.

## AppShell `operator-inset` slot integration

```text
AppShell
├── GraphNav (L1 nav)
├── main slot (projection canvas)
├── edit-chrome slot (L2 — future TRL-25)
└── operator-inset slot (L3)
    ├── FAB → toggle insetOpen
    ├── selection via app-shell context (not per-page props)
    └── resolveInsetTemplate(selection)
        ├── template → "Inset: {label} (anchored)"
        └── null     → "Graph tools (ambient)"
```

**Propagation plan (TRL-25 follow-on):**

1. `AppShell` owns `selection` + `insetOpen`; exposes `getAppShellContext()` for routes.
2. Collection row click sets `{ id, entityClass: 'document' }`.
3. TRL-38 replaces placeholder with Bits UI `Sheet` + tab scaffold; drop-in CE remains for non-Svelte scaffolds.
4. Band gate: L3 only renders operator-inset chrome (stub: dev always-on).

## Distinction from Thing.svelte / shells.ts

| Track | Module | Question |
| ----- | ------ | -------- |
| **Fractal responsiveness** | `Thing.svelte`, `resolveShell(vantage)` | How is **one identity** drawn at many focal depths? |
| **Entity-class insets** | `entity-class-insets.ts`, `resolveInsetTemplate` | Which **L3 detail template** mounts when an entity is in focus? |
| **Fractal projection** | fractals-playground `createRowProjection` | How do **many entities** reconcile into layout modes? |

- `resolveShell(vantage)` → continuous territory (`node` | `row` | `card`) for homomorphic edit on the projection canvas.
- `resolveInsetTemplate(entityClass)` → discrete class template for heteromorphic→homomorphic L3 tools.
- **Convergence target:** anchored inset + optional vantage jump — not N permanent dialog components.

`defaultVantage` on each inset spec seeds territory when opening from a collection row until dual-shell crossfade lands (TRL-25).

## Non-goals (TRL-16)

- Bits UI Sheet/Tabs implementation (TRL-38).
- Four permanent dialog Svelte components.
- Vantage crossfade or FLIP reconcile (separate wedges).

## Acceptance criteria (TRL-16)

- [x] Spec per temporal / document / actor / container (this doc).
- [x] `entity-class-insets.ts` + `AppShell` stub + collections row-click proof.
- [x] Unit tests for `resolveInsetTemplate` (each class + dialogShell override).

## References

- trellis-client `apps/web/app/config/entityRegistry.ts` — `ENTITY_CLASSES` source
- ADR 0012 — anchored vs ambient binding model
- `demo/realtime-app/src/lib/ui/AppShell.svelte` — mount point
