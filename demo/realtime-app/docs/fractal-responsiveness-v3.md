# Fractal Responsiveness — v3

**TRELLIS / TURTLESTACK — Working Notes**
Trenton Brew · Turtle Labs LLC · 2026

> v3 revises the v2 concept brief after the model met a working implementation. The
> SvelteKit × Trellis app ([REPORT.md](REPORT.md)) is the first substrate where
> `query.live` + diff-subscriptions + lanes run together, and a deliberate vertical
> slice (the "fractal wedge," commits `da37c19` / `f8ce1d2`) tested the model's
> load-bearing claims. **The brief survived contact with code.** This document keeps
> what held, corrects what didn't, and marks the boundary between _observed_ and
> _expected_.

---

## 1. What changed from v2

v2 described representation (vantage) as a continuous fidelity spectrum and treated the
kernel as immutable. v3 makes three structural changes:

1. **A second and third axis are named.** A Thing has a representation (vantage), a
   **version** (lane), and a position in **time** (history). v2 only theorized vantage.
2. **The axes are not a clean product space.** Vantage is orthogonal to both version and
   time; version and time are _entangled_. (§2)
3. **The kernel is immutable only within a coordinate.** Across lanes/time it is exactly
   what diverges. v2's "the Thing never changes" needs the qualifier _within a (lane, time)
   coordinate._ (§4)

---

## 2. The axes and their topology

A Thing resolves under three coordinates, anchored to a stable identity:

| Axis                         | Question        | Continuity        | Refusal mode                        | UI primitive     |
| ---------------------------- | --------------- | ----------------- | ----------------------------------- | ---------------- |
| **Vantage** (representation) | How close am I? | continuous        | superposition (all levels co-valid) | **crossfade**    |
| **Lane** (version)           | Which version?  | discrete          | divergence-with-reconvergence       | **diff / merge** |
| **Time** (history)           | Which moment?   | discrete (op-log) | append-only record                  | scrub / replay   |

### 2.1 Orthogonality is partial — `vantage ⊥ (lane, time)`

The honest statement is **not** "three orthogonal coordinates." Vantage is genuinely free:
you can be at any fidelity, in any lane, at any moment. But **lane and time are entangled**
— a lane is a _divergent timeline from a fork point_, so a lane coordinate already implies a
position in time, and the history available inside a lane is bounded by its fork (an
`agent:42` lane has past only back to where it branched). This is a fiber bundle —
vantage is the free base; (lane, time) is the entangled fiber — not a product of three
independent dimensions. The "three orthogonal coordinates" line is punchier and slightly
false; if it appears in public framing, it is a chosen simplification, not an oversight.

### 2.2 Two refusals, two primitives

v2 framed both axes as "refusals of single-canonical-form." True, but they refuse
_differently_, and that dictates different interactions:

- **Representation refuses by superposition.** Every vantage is co-valid; the dot _is_ the
  star; no scale is privileged. The primitive is a **crossfade** — you blend because no
  level is more true.
- **Version refuses by divergence.** Lanes are alternatives meant to reconverge. You do not
  crossfade between `main` and `agent:demo` — that interaction is meaningless. The primitive
  is a **diff / merge**.

Conflating them — treating version as "just another fractal axis" — would lead to a
zoom-between-versions interaction that has no meaning. The wedge confirmed this: switching
lane is a hard recontextualization, not a blend (§5.2).

### 2.3 Directionality is contingent, not intrinsic

A correction v2 and the first analysis both missed: **"main is privileged, promote is
directional" is a property of the centralized-integration topology, not of the model.**

- **Trellis-as-built** (this app): a single integration lane (`main`), `promoteLane` merges
  drafts into it by slug. Version-space is diff-not-blend **and directional**.
- **Trellis-as-intended** (the local-first / Iroh peer target): no privileged `main`; peers
  diverge and reconverge, and merge approaches commutative. Version-space stays
  **diff-not-blend** but **loses directionality**.

So the durable claim is: _version-space is diff-not-blend in both regimes; directionality is
an artifact of centralized integration that dissolves under peer reconvergence._ This makes
the local-first future a **consequence** of the model rather than a footnote to it.

---

## 3. Identity and the anchor

If vantage and lane are coordinates, **identity is the origin they are measured against** —
not a fourth axis. You do not move along identity; it is the fixed point.

But "identity is the anchor" raised a concrete question the build answered sharply: _what
carries identity across the version axis?_ In the implementation, **the entity id is
lane-bound** — a framework has exactly one `laneId`, and the "same" Thing in `main` and
`agent:demo` is **two distinct entities sharing a slug**, which is what `promoteLane` merges
on. So cross-lane identity is carried by the slug, not the id; the id is effectively
`(identity, lane)` fused.

### 3.1 Slug is content-_derived_, not content-_addressed_

It is tempting — and wrong — to call this content-addressing. The semantics are inverted:

- **Content-addressing** (Iroh: BLAKE3 hashes; iroh-docs: signed namespace/author keys)
  _intends_ same-content → same-key as verified identity. The key proves the bytes.
- **A slug** (`title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-')`) treats same-content →
  same-key as a **collision to resolve** (two "Hello World"s cannot both be `hello-world`),
  and is **rename-fragile**: recompute on edit and you lose the anchor exactly when you need
  it; freeze at creation and it is a UUID-with-a-nice-default seeded from content.

Either way a slug is a **stable correlation key**, not a content-address. The instinct is
correct and is the real finding — _cross-lane identity must be carried by a lane-independent
key, and the current entity id cannot do it because it fuses (identity, lane)_. But the peer
future needs a collision-resistant, rename-stable identifier — a content hash or a signed key
— which the slug **foreshadows but does not yet meet.**

> **v3 sentence:** cross-lane identity is carried by a lane-independent key, today a slug;
> generalizing to peers requires a content-address or signed id that slug foreshadows but
> does not satisfy.

---

## 4. What the substrate proved

The wedge is a minimal vertical slice: a `getThing(id, lane)` live query
([data.remote.ts](../src/routes/data.remote.ts)) feeding a generic `<Thing>` shell
([Thing.svelte](../src/lib/fractal/Thing.svelte)) that resolves its shell from a continuous
vantage and morphs properties via CSS `--vantage`. Three Playwright tests
([fractal.e2e.ts](../src/routes/fractal.e2e.ts)) assert the claims below. No canvas,
crossfade, ghost proxy, or affinity layout — those are deferred (§7).

### 4.1 Multi-vantage is real and live — _observed_

Four shells, each independently subscribed to the same `(id, lane)` kernel, render the same
Thing at vantages 2 / 5 / 8 / 13 simultaneously. Editing the focus card propagates to the
other shells **with no reload** — SvelteKit dedupes the identical keyed live query and the
Trellis WS diff fans out to every subscriber. v2 §12's open "can a Thing render at two
vantages simultaneously, shared kernel, independent shells?" is **closed: yes, with a passing
test.**

### 4.2 Vantage ⊥ lane — _measured, not inferred_

The cross-term test mounts two shells differing on **both** axes at once — A in `main` at
vantage 2 (node), B in `agent:demo` at vantage 13 (card) — and edits B while watching A.
Result: B updates; **A's value and shell are untouched**; neither vantage moves. There is no
lane → representation leak and no representation → lane leak; version isolation holds under
simultaneous mixed render. This is the cross term, not orthogonality demonstrated at fixed
points — it is _measured._ (Note: this measures version **isolation** under mixed render;
cross-lane _propagation_ is a slug-merge at promote, a different event.)

### 4.3 The pure-projection invariant — _true, with a boundary_

v2 invariant #7 said "CSS does the work; `--vantage` is the only data crossing the boundary."
The build is sharper: **vantage never reaches the server at all** — `getThing` takes only
`(id, lane)`. Representation is a pure client-side projection of an identity-keyed kernel.

**Caveat (load-bearing for the canvas path):** this holds because the wedge fully-hydrates
every Thing at every vantage. The moment a low vantage deliberately _does not_ fetch the
body/notes that only appear at dialog fidelity (progressive property hydration), vantage
begins to shape requests. The honest invariant is: **vantage does not reach the server for a
fully-hydrated Thing.** Still strong; it just names the wall the canvas walks into.

### 4.4 Substrate performance

Reads and graph queries against the Trellis sidecar are sub-2 ms p50, writes ~3 ms p50 on
loopback (see [REPORT.md §7](REPORT.md)). Representation changes cost nothing server-side
(§4.3). Realtime fan-out is diff-based, not snapshot-based.

---

## 5. Revisions to the v2 invariants

| v2 invariant                          | v3 status                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| #1 The Thing never changes            | **Amended:** immutable _within a (lane, time) coordinate_; across them it is what diverges.      |
| #2 Vantage is continuous              | Holds. Demonstrated **discretely**; continuous crossfade is the next representational step (§7). |
| #3 Projections set ceilings           | Holds (untested by the wedge).                                                                   |
| #4 Shells are generic                 | Holds — one `<Thing>` shell, type accents only.                                                  |
| #5 Spatial memory is symmetric        | Untested (ghost proxy deferred).                                                                 |
| #6 Invariant properties are invariant | Holds — status pip identical at every vantage in the wedge.                                      |
| #7 CSS does the work                  | **Upgraded + bounded:** vantage never reaches the server _for a fully-hydrated Thing_ (§4.3).    |
| #8 The dot is the floor               | Holds.                                                                                           |
| #9 Self-similar                       | Holds (asserted by model, not yet by a workspace-as-dot render).                                 |

**New invariant (#10):** _Representation and version are independent coordinates._ Moving a
Thing along vantage does not perturb its lane, and switching lane does not perturb its vantage
(§4.2, measured).

---

## 6. v2 §12 open questions — disposition

| Question                              | v3                                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Multi-vantage (one Thing, two shells) | **Resolved** — observed live (§4.1).                                                                                                             |
| Signal (vantage 0)                    | **Refined** — maps to the _optimistic create_ state specifically (temp id before the server assigns one), not optimistic updates. Not yet built. |
| Affinity computation                  | Still open.                                                                                                                                      |
| Natural-vantage instance overrides    | Still open.                                                                                                                                      |
| Vantage permissions                   | Still open.                                                                                                                                      |
| XR / depth-as-vantage                 | Still open.                                                                                                                                      |

---

## 7. Implementation notes & deferred work

**Hydration gotcha (recorded for the canvas path).** Remote queries must be consumed via a
**top-level `await`** in markup, _not_ an `{#await}` block. `{#await}` does not force SSR to
resolve the query, so no hydration payload is serialized and the client throws
`hydratable_missing_but_required`. Both wedge components use top-level `await` for this reason.

**Deferred (the canvas path, not writing prerequisites):**

- **Dual-shell crossfade** — mount `floor(vantage)` and `ceil(vantage)` shells, opacity =
  `vantage % 1`. The wedge used discrete shell resolution, so crossing 7 → 8 is a hard swap.
  This is the first brick of the canvas and the next representational uncertainty.
- **scale → vantage curve** — analog zoom → vantage mapping with dwell weighting.
- **Ghost proxy** — spatial-memory choreography across portal boundaries; pure shell-layer
  craft, decoupled from the substrate.
- **Affinity / constellation layout** — force-directed positioning by affinity weight.

---

## 8. Status

The reframe is defensible: identity-as-anchor, `vantage ⊥ (lane, time)` with an entangled
fiber, crossfade-vs-diff as distinct primitives, directionality-as-contingent, and the
pure-projection invariant — all confirmed against a running build except the items explicitly
marked open. The strong claim this document can make, and could not before: **the model held
under contact with code.**

_v3 — substrate-tested; axes, topology, anchor semantics, and orthogonality folded in from the
fractal wedge. v2 — continuous vantage model, canvas architecture, ghost proxy, CSS morphing.
v1 — whiteboard sketch, 9 vantages, discrete shells._
