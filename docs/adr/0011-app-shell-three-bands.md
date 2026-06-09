# ADR 0011: App shell — three bands (published / editor / operator)

**Status:** accepted  
**Date:** 2026-06-06  
**Issue:** TRL-33 (acceptance + sequencing lock; close duplicate TRL-32)  
**Context:** Explorer typed-SDK program (TRL-17), Collections v1 (TRL-31), fractal shell contract (TRL-25)  
**Related:** [ontology-glossary.md](../ontology-glossary.md), `demo/realtime-app/`

## Context

`demo/realtime-app` (`localhost:4000`) is an **integration sketchpad** — a single repo where we prove typed SDK, live sync, lanes, fractals, chat, and presence. It is not the shipping Trellis Studio surface.

Before more UI work we need a product boundary between:

1. **What visitors experience** on a published app URI.
2. **What editors mutate** when they have content rights.
3. **What operators configure** (graph, ontology, users, permissions, routes, publish state).

Two whole-product patterns were considered:

| Pattern | Summary | Risk |
| ------- | ------- | ---- |
| **Option A — single surface** (Notion / Framer) | App and builder share one canvas; edit mode reveals affordances. | Platform admin (EAV inspector, ACL matrix) collides with published content; leak surface. |
| **Option B — dual surface** (Jazz-style) | App is separate; floating control opens an admin explorer. | Two mental models; fractal/kernel story splits unless both read the same graph. |

A related UX question: should **collections** appear as a persistent sidebar in the published app? We concluded **no** for visitors. A table is a **projection** of user content (`CollectionRecord` rows under a route), not primary navigation over workspace metadata. A global “Collections” list belongs in **operator** chrome, not visitor IA.

Fractal Responsiveness already defines two axes on content:

- **Lane** — version / draft stream (`main` vs `agent:…`).
- **Vantage** — representation depth (node → row → card → editable card).

This ADR adds a third axis for **shell chrome**: **band** — who may see which affordances.

## Decision

Adopt **one graph, one app shell, three bands**. Bands gate chrome depth; they are not separate apps or databases.

```text
┌─────────────────────────────────────────────────────────────┐
│  L1  Published   — content projections only                 │
│  L2  Editor      — in-place mutation on those projections   │
│  L3  Operator    — privileged inset (explorer / control plane)│
└─────────────────────────────────────────────────────────────┘
         same graph · same URL · same codebase
```

### Invariants

```text
Published app routes render graph projections.
Editors mutate those projections in place when permitted.
Platform work uses operator chrome only when permitted.
Operator chrome never mounts for viewers without the capability.
Permission enforcement lives in the kernel / query layer — not UI hiding alone.
```

### Band definitions

| Band | Audience | Chrome | Examples |
| ---- | -------- | ------ | -------- |
| **L1 Published** | Visitors, read-only collaborators | Main projection only — no explorer, no edit controls | Chat read, cursor presence, record list at row vantage, fractal node/row shells |
| **L2 Editor** | Users with content `can:edit` on scope | L1 + inline affordances + layout/section tools | Inline title/body edit, add row, reorder section, deeper fractal vantages with save |
| **L3 Operator** | Admins, agents, builders | L2 + **operator inset** (FAB, ⌘K, side panel) | Graph inspector, ontology editor, users/ACL, route wiring, publish toggle, collection **configuration**, lane status |

**Operator inset** is not a second application. It is the deepest **inset** in the shell (see Inset Hierarchy) — same typography and entities as L1–L2, with unmistakable “operator mode” chrome.

Entry points for L3 (non-exhaustive): persistent Trellis control (bottom-right), keyboard palette, agent session. Exact UX is TRL-25+; the **band contract** is fixed here.

### Projection model

A **route** (or app section) is configuration that says:

- which **Type** or query projects rows onto the surface;
- which **view** renders them (list, detail, chat room, fractal spectrum);
- which **band** the viewer receives from permissions.

```text
/ideas  →  projection(CollectionRecord WHERE collectionId = …)  @ list vantage
/chat   →  projection(ChatMessage WHERE room = …)
/fractal→  benchmark wedge (dev); production uses projection + shell slots
```

Visitors do not navigate “all collections.” They navigate **routes** that already imply collection context.

### Entity roles (demo + product)

Aligns with [ontology-glossary.md](../ontology-glossary.md). Demo names in parentheses.

| Artifact | Tier | Band | Meaning |
| -------- | ---- | ---- | ------- |
| User content instances (`CollectionRecord`, `ChatMessage`, …) | user Type | L1–L2 | Rows projected into views |
| Builder table config (`CollectionMeta`) | user Type | L3 | Name, icon, color, slug — **not** visitor sidebar IA |
| App structure (`NavItem`, `NavSection`) | user Type | L3 config → L1 render | Route map editors maintain; visitors see resolved links only |
| Kernel types (`core:Record`, `core:Collection`, …) | core | — | Structural; apps extend, do not replace |
| **Thing shell** (fractal UI) | representation | L1–L2 | Same entity id, many vantages — not a graph `type` |
| **Lane** | VCS / version | L2–L3 | Draft stream overlay — orthogonal to band |

**Rejected default:** permanent “Collections” sidebar on L1 listing every `CollectionMeta`. Acceptable on L3 while configuring the app.

### Relationship to fractal work

| Axis | Question it answers |
| ---- | ------------------- |
| **Vantage** | How is one identity **drawn**? |
| **Lane** | Which **version** of the graph is observed? |
| **Band** | Which **chrome** may appear for this principal? |

TRL-25 (shell contract) must name slots for all three, e.g. `{ main, edit-chrome, operator-inset }`, and define how `--vantage` and band interact (edit affordances only when L2+ and vantage deep enough — as in the fractal wedge today).

### Sketchpad (`demo/realtime-app`) posture

Until shell extraction lands:

- Keep **one repo** as integration harness.
- Treat routes as **capability wedges**, not as final visitor IA.
- New **platform** affordances go toward L3 patterns, not new top-level demo nav items.
- Conceptual packages (may share a repo): `app-shell` (L1–L2), `operator-inset` (L3), `realtime` primitives (embeddable).

## Alternatives considered

### Pure Option A (everything in edit mode)

Single surface including graph inspector and ontology editor inline.

**Rejected:** correct philosophy (all projections) but wrong ergonomics and security posture for graph-OS scale. Operator tasks need a stable inset; published URIs must not sit adjacent to raw EAV tooling.

### Pure Option B (separate builder app)

Distinct admin application and published runtime.

**Rejected:** duplicates surface sync, weakens “one graph” narrative, and splits fractal benchmarks from product unless rigorously unified.

### Hybrid without bands (floating explorer + ad-hoc edit)

Jazz-like popup with no formal L1/L2/L3 contract.

**Rejected:** bandless hybrid drifts — demo routes accumulate admin chrome; collections sidebar becomes accidental visitor nav.

## Consequences

### Positive

- Clear handoff for TRL-25: shell slots and band gating are acceptance criteria, not taste calls.
- Collections v1 (TRL-31) functional sync is sufficient; **product** collections UX targets L2 projections + L3 config.
- Explorer overlay and in-place edit coexist without choosing Notion *or* Jazz globally.
- Agents default to L3; human editors spend most time in L1–L2.

### Negative / cost

- Shell implementation must implement band checks in layout roots, not per-page patches.
- `demo/realtime-app` nav and home picker are **L3-shaped** today — refactor when operator inset exists.
- Publish workflow must define permission envelopes per route/tenant (kernel work streams in parallel).

### Non-goals (this ADR)

- User-defined columns per collection (runtime schema per click) — later CMS/runtime-schema wedge.
- Final visual design of FAB, inset animation, or edit-mode tint — TRL-25 / design pass.
- Splitting `demo/realtime-app` into multiple packages — follow-on once contracts stabilize.

## Sequencing priority (accepted with ADR)

Fractals and a Jazz-style operator overlay are **not** prerequisites for a useful
collections editor or for competitive realtime DX.

**Critical path** — ship **typed SDK parity** in ordinary React / Vue / Svelte apps:

- `defineType` + `registerType`
- `entitiesStore` / `mutations` (or framework equivalents)
- live subscription, reconnect, optimistic mutations, permission-aware queries

**Code-as-configuration** — app source is the config layer for v1 product:

- Types and Zod shapes live in repo (`src/schemas/…`)
- Routes/pages are projections (`/ideas` → query + view over `CollectionRecord`)
- Publish = deploy + permission envelope, not a separate visual schema builder

**Deferred** until SDK parity is demoable across frameworks:

- L3 operator FAB / full explorer overlay (thin MCP + CLI + inspector is enough for agents)
- Fractal shell morphing (TRL-25–30) — differentiation, not editor blocker
- Graph-native `NavItem` / `CollectionMeta` as authoring UI — optional; code or seed config suffices

Collections **L2 editor** work (body field, validation, more props) proceeds in
`demo/realtime-app` **without** TRL-25.

## Implementation follow-on (issues, not part of acceptance here)

| Item | Priority | Purpose |
| ---- | -------- | ------- |
| TRL-33 | now | ADR acceptance + sequencing lock (this document) |
| TBD | **critical** | Realtime typed SDK parity — React, Vue, Svelte reference apps |
| TRL-31b (optional) | high | Collections L2 forms in sketchpad (no fractals) |
| TRL-25 | medium | Shell contract: slots, band gating, vantage × band rules |
| TRL-26+ | medium | Fractal projections of `CollectionRecord` on L1–L2 |
| TBD | low | Operator inset v0: FAB + graph stub behind capability check |
| TBD | low | Route projection config in graph (`NavItem` → query + view) |

## Open questions

1. **Capability names** — `can:edit` vs `can:admin` vs scoped resource grants (align with existing governance middleware).
2. **Publish primitive** — route-level flag, tenant mode, or lane promote to `main` only?
3. **CollectionMeta fate** — keep as builder config entity vs fold into route projection config document.

Resolve in TRL-25 spec or a child ADR; do not block band model on these.
