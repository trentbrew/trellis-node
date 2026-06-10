# ADR 0012: Graph overlay — config surface vs user-facing surface

**Status:** accepted  
**Date:** 2026-06-10  
**Issue:** TRL-25 (shell contract), TRL-38 (L3 operator inset)  
**Context:** ADR 0011 (three bands), fractal responsiveness wedge, graph-nav + inspector overlay work  
**Motivation (essay):** [One surface, three axes](../essays/graph-overlay-one-surface.md)  
**Related:** [0011](./0011-app-shell-three-bands.md), [l3-inspector-bits-ui.md](../planning/l3-inspector-bits-ui.md), `demo/realtime-app/`, `Sandbox/fractal-playground/fractals-playground`

## Context

ADR 0011 locks **band** (who may see which chrome). This ADR locks how **config** and **user-facing** surfaces relate on that shell — the graph overlay problem.

Two-panel builders (config beside render) fail because:

1. **Attention is phasic**, not a stable ratio — styling is 90/10 config; review is 10/90 render. A split correct on average is wrong in every moment.
2. **Coupling direction varies** — DevTools is render→config; Webflow is config→render; published apps are render-only (kitchen).
3. **Authorization and layout are the same question** — band is not a preview toggle; it is which directions of the coupling arrow a principal may render.

The configure/render tension resolves into **orthogonal axes on one surface**, not two panels whose widths we negotiate.

## Decision

Adopt **one projection canvas** with three overlay layers and **contextual inset binding**.

```text
┌─────────────────────────────────────────────────────────────┐
│  L3  Operator inset — heteromorphic tools (when permitted)  │
│      anchored │ ambient mount                               │
├─────────────────────────────────────────────────────────────┤
│  L2  In-place depth — vantage scrub, homomorphic edit       │
├─────────────────────────────────────────────────────────────┤
│  L1  Projection — route + query + shell at current vantage  │
└─────────────────────────────────────────────────────────────┘
         same graph · same URL · band × vantage × lane
```

### Axis ownership (must not collapse)

| Axis | Question it answers | Must never answer |
| ---- | ------------------- | ----------------- |
| **Band** | Which chrome may this principal render? | How an entity is drawn |
| **Vantage** | How is this identity drawn at this focal depth? | Who may edit |
| **Lane** | Which version stream is observed? | Layout mode or column count |

Cross-reference ADR 0011. TRL-25 names shell slots: `{ main, edit-chrome, operator-inset }`.

### Config binding: homomorphic vs heteromorphic

Classification is a property of **tool binding**, not tool type.

| Binding | Definition | UX |
| ------- | ---------- | -- |
| **Homomorphic** | Config maps onto a focal entity or subtree in the projection | In-place edit, vantage scrub, click-to-select |
| **Heteromorphic** | Config is topological over the graph (no stable place on the artifact) | Summoned operator inset |

**Leak (intentional):** heteromorphic tools become homomorphic when bound to selection.

| Tool (abstract) | Ambient (heteromorphic) | Anchored (homomorphic) |
| --------------- | ----------------------- | ---------------------- |
| Query editor | Global EQL | Query scoped to selection / lens |
| ACL | Full matrix | “Who can see **this** card” |
| Lane | Lane list | Promote/diff **this** draft |
| Inspector entities | All types | Attributes of **this** entity |

**Rule:** L3 inset **docks onto selection context** when `selection !== null`; **floats ambient** when no selection. Same inset component, two mount semantics — not two products.

| Mount | Header | Tab scope | Dismiss behavior |
| ----- | ------ | --------- | ---------------- |
| **Anchored** | Selection identity chip | Filtered to selection subgraph | Return to L2; preserve main vantage |
| **Ambient** | “Graph” / workspace | Full topological tools | Explicit “left artifact” state |

**Rejected:** permanently decoupled inset (DevTools clone) or permanently coupled shallow panel (Notion properties only).

### Band as permission projection

L1 is not “preview mode.” L1 is: **no render path exists** for config chrome or coupling arrows toward the graph for this principal.

| Band | Coupling arrows permitted |
| ---- | ------------------------- |
| **L1 Published** | None toward config (kitchen) |
| **L2 Editor** | Homomorphic: artifact ↔ in-place edit |
| **L3 Operator** | Homomorphic + heteromorphic (anchored or ambient) |

Layout questions (“show the inspector FAB?”) reduce to capability checks, not split ratios.

### Vantage detents (legibility)

Continuous `--vantage` is the substrate. **Territories** are named detents for legibility.

| Requirement | Builder (L2–L3) | Visitor (L1) |
| ----------- | --------------- | ------------ |
| Position indicator | Territory name + numeric vantage optional | Territory name only |
| Scrub behavior | Continuous; optional fine scrub (e.g. modifier key) | Snap to territory on release |
| Crossfade | Adjacent territories only | Same |
| Edit affordances | When band ≥ L2 **and** vantage ≥ territory threshold | Never |

**Success criterion (fractal wedge):** a non-builder can answer “what am I looking at?” in one glance without knowing what “vantage” means.

Territory map (initial, from fractal wedge — may extend):

| Territory | Vantage range | Shell | Label (example) |
| --------- | ------------- | ----- | --------------- |
| Node | 0–4 | `node` | Labeled node |
| Row | 5–7 | `row` | Row |
| Card | 8–13 | `card` | Kanban card / profile card |

### Two “fractal” tracks (do not merge names)

| Track | Repo / wedge | Primary question |
| ----- | ------------ | ---------------- |
| **Fractal responsiveness** | `demo/realtime-app` — `Thing.svelte`, `shells.ts`, `--vantage` | How is **one identity** drawn at many focal depths? |
| **Fractal projection** | `Sandbox/.../fractals-playground` — projection contract, anime.js FLIP | How do **many entities** reconcile into animated layout modes? |

Studio needs both. Vantage crossfade and projection FLIP are composable but not interchangeable.

Expand-in-place (planets overlay) ≈ temporary vantage jump via modal; it is **not** a substitute for territory detents or dual-shell crossfade.

## Alternatives considered

### Static proportional split (Option 1)

Allocate screen width by average visit frequency.

**Rejected:** attention is phasic; correct on average, wrong in every session. Survivors: user-draggable split with memory, explicit modes, or continuous vantage with detents.

### Permanent side-by-side config panel

Squarespace / Webflow default — config always visible beside render.

**Rejected for L1–L2:** burns loop-tightness for styling tasks and duplicates band-gated chrome. Acceptable only as **anchored L3 inset**, not as default shell.

### Vantage-only (no L3 inset)

All config via scrubbing and in-place inspection.

**Rejected:** heteromorphic tools (global query, schema browser, route wiring) have no spatial place on the artifact. Hybrid is required.

## Consequences

### Positive

- TRL-38 inset acceptance criteria are binding-aware (anchored default when selection exists).
- Inspector FAB is correctly L3 ambient; selection-click should re-mount anchored mode.
- Investor/engineer thesis is structural: band gates which coupling directions exist.
- Fractal wedge tests detent legibility, not only edit affordances.

### Negative / cost

- Shell must propagate `selection` + `band` + `vantage` to inset root — not per-page props.
- Projection track (FLIP reconcile) must wrap graph-driven DOM changes in `layout.update` consistently; partial Svelte `{#each}` reconcile will pop without motion.
- Two fractal vocabularies require namespace discipline in docs and packages.

### Non-goals (this ADR)

- Final FAB visual design, inset animation curves, Bits UI component choices.
- Virtualization and 10k-row collection performance.
- Saved views / presentational state persistence (fractal projection contract; separate issue).
- Replacing browser `TrellisDb` vs server-remote data paths in demos.

## Acceptance criteria

### Shell contract (TRL-25)

- [ ] `{ main, edit-chrome, operator-inset }` slots named; band gating at layout root.
- [ ] `selection` propagates to operator inset; anchored vs ambient mount implemented.
- [ ] Vantage territory indicator visible on L1–L2 main projection.
- [ ] Edit affordances gated on `band ≥ L2` **and** `vantage ≥ threshold`.

### Fractal wedge (`/fractal`)

- [ ] Builder: vantage scrub replaces preview toggle for homomorphic edit on one Type.
- [ ] Visitor: territory label answers “what am I looking at?” without jargon.
- [ ] Crossfade limited to adjacent territories.

### L3 inset (TRL-38)

- [ ] Entities tab: ambient list; anchored when selection set.
- [ ] Query tab: ambient EQL; anchored template when selection set.
- [ ] Drop-in `/__trellis/inspector.js` remains for non-Svelte scaffolds (no regression).

## Implementation follow-on

| Item | Depends on | Purpose |
| ---- | ---------- | ------- |
| TRL-25 | this ADR | Shell slots + band × vantage rules |
| TRL-38 | TRL-25 slots | Native Bits UI inset with anchored mount |
| Projection extraction | fractals-playground contract | `createRowProjection`, FLIP reconcile in collections |
| Vantage crossfade | fractal wedge | Dual-shell opacity; deferred from wedge slice |

## Open questions

1. **Selection model** — click-to-select on projection only, or keyboard/roving focus counts?
2. **Anchored inset layout** — sheet (right) vs bottom dock when spatial coupling is high?
3. **Capability names** — inherit from ADR 0011 open questions (`can:edit`, `can:admin`, resource scope).

Resolve in TRL-25 spec; do not block inset binding model on these.

## See also — collection vs entity registry (2026-06)

ADR 0012 axes (band × vantage × lane) govern **one entity in focus** on the projection canvas.
**Collection-scale** layout (table / kanban / calendar for *many* entities) is a separate registry
axis — do not merge it with vantage.

| Axis | Answers | Primary source |
| ---- | ------- | -------------- |
| Collection projection | How are many entities placed? | trellis-client `BrowseViewMode`, fractals-playground reconcile |
| Entity representation | How is one entity drawn? | `Thing.svelte`, `resolveShell(vantage)` |
| Band | Who sees which chrome? | ADR 0011, client `VARIANT_CONFIGS` |
| Vantage | Focal depth of one identity? | fractal territories |
| Lane | Which version stream? | trellis-node lane model |

Synthesis doc (three repos, ontology gate, actionable ports):
`Sandbox/fractal-playground/fractals-playground/docs/planning/fractal-registry-synthesis.md`
