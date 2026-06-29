# ADR 0013: Rich text — graph-native documents and semantic layer

**Status:** accepted  
**Date:** 2026-06-15  
**Issue:** TRL-10 (rich text field editor), fractal-playground spike  
**Context:** `rich_text` ontology fields, `trellis/links` wiki-link grammar, realtime stack (`/realtime` vs `/rt`), ADR 0012 homomorphic edit  
**Related:** [0012](./0012-graph-overlay-config-surface.md), [0011](./0011-app-shell-three-bands.md), `src/realtime/text.ts`, `demo/realtime-app/src/lib/schemas/block.ts`, `trellis/links`

## Context

Trellis already models prose fields (`rich_text` on `core:Document`, `CollectionRecord.body`, etc.) as **opaque strings** in EAV. Clients today use `<textarea>` blur-save or Monaco for structured data — not a document surface.

fractal-playground and Studio need a **rich text field editor** (TRL-10). The long-term bar is higher: documents are **first-class graph nodes** with native entity mentions, automatic link suggestions, paste-driven graph mutations, embedding-backed relatedness, multi-vantage semantic projections, and embedded artifacts (e.g. Mermaid diagrams) as their own entities.

Three realtime layers must not be conflated:

| Layer | Transport | What it syncs | Persisted? |
| ----- | --------- | ------------- | ---------- |
| **Graph subscriptions** | WS `/realtime` | EQL query results (collections, cards, document bodies after save) | Yes — op log |
| **Presence relay** | WS `/rt` | Cursors, record focus, chat, `RealtimeText` | Ephemeral (+ in-memory replay) |
| **VCS peer sync** | `trellis/sync` | Branch op reconciliation | Yes — different problem |

`RealtimeText` (`src/realtime/text.ts`) is a **plain-character RGA CRDT** on `/rt` — intentionally minimal. It is not a rich-text or block-formatting engine.

Prior art in-repo:

- **Block LWW** — `demo/realtime-app/src/lib/schemas/block.ts`: one graph entity per block; concurrent edits to different blocks merge cleanly (`/editor` currently redirects to char CRDT `/collab`; block server code remains the better Notion-grain model for formatted prose).
- **Wiki-links** — `trellis/links`: `[[entity:…]]` parse/resolve for markdown and doc-comments; bidirectional ref index and stale-ref lifecycle.
- **Tiptap** — exists only in `apps/docs/` (CMS demo); not engine/SDK.

Editor framework choice (Tiptap vs Plate) is **secondary** to the document semantic contract.

## Decision

Adopt a **two-layer architecture**:

1. **Editor substrate (commodity)** — ProseMirror-family editor via **Tiptap or Plate** (or equivalent). Handles caret, IME, selection, copy/paste DOM, accessibility, marks/blocks UI. **Not built from scratch.**
2. **Trellis document semantic layer (moat)** — graph-native protocol for mentions, links, paste intake, derived metadata, and multi-vantage projections. Lives in **`trellis/links` + new `trellis/document` surface** (name TBD), **editor-agnostic**.

```text
┌─────────────────────────────────────────────────────────────┐
│  L2 Editor UI — Tiptap / Plate (framework-specific, opt-in)   │
├─────────────────────────────────────────────────────────────┤
│  trellis/document — mentions, paste pipeline, block mapping,  │
│                     vantage projections, suggest-link         │
├─────────────────────────────────────────────────────────────┤
│  trellis/links — [[…]] grammar, resolve, ref index, stale     │
├─────────────────────────────────────────────────────────────┤
│  Graph — core:Document + block/diagram child entities, EAV    │
└─────────────────────────────────────────────────────────────┘
```

### Document as graph node (not a blob)

A document is an **entity** (`core:Document` or typed subclass), not merely a string attribute on another row.

| Concern | Storage | Notes |
| ------- | ------- | ----- |
| **Canonical body (P0)** | `content: rich_text` on document entity | Serialized per wire format below |
| **Block structure (P1+)** | Child `block` entities keyed by `doc` + `order` | Port demo block LWW schema; one editor instance per block |
| **Embedded diagrams (P1+)** | Child `diagram` (or `asset`) entities | Mermaid source stored on entity; document holds `trellis-ref` to it |
| **Mentions / links** | `vcs:storeLink` + ref index via `trellis/links` | Inline marks carry stable ref ids; index is derived |
| **Semantic zoom (P2+)** | Derived metadata on document entity | Outline, summary, embedding vector, link density — **projections**, not duplicate prose |

**Rule:** vantage changes **how** a document is rendered (summary vs full vs bone structure), not **whether** it is a graph node. Cross-reference ADR 0012 — homomorphic edit binds to the focal document entity.

### Serialization wire format (phased)

| Phase | Format | When |
| ----- | ------ | ---- |
| **P0** | HTML with `data-trellis-ref` on mention nodes | fractal-playground TRL-10 spike; blur/debounce save to `rich_text` |
| **P0 alt** | Markdown subset with `[[…]]` | If wiki-link parity matters more than WYSIWYG |
| **P1** | ProseMirror JSON per block entity | Block LWW; avoids huge single-string blobs on Sprites/sql.js |
| **P2** | Normalized block graph (entity ids, not inline HTML) | Full Notion-grain; editor serializes to block ops |

P0 **must** round-trip without losing mention refs. Pick one format per app; do not mix HTML and markdown on the same field without an explicit migration.

### Mention and auto-link protocol

Extend `trellis/links` — do not invent a parallel mention syntax.

| Mechanism | Behavior |
| --------- | -------- |
| **Explicit mention** | User picks entity → insert mark/node with `data-trellis-ref="entity:TRL-10"` (HTML) or `[[TRL-10]]` (markdown) |
| **Paste intake** | Paste pipeline classifies payload (URL, issue id, file path, plain text) → optional **suggest-link** candidates |
| **Auto-suggest** | Embedding similarity + ref index lookup on selected text or paste → UI confirmation; **no silent graph writes** |
| **Confirmed link** | `resolveRef` → `storeLink` op + ref index update; stale-ref lifecycle on rename/delete |
| **Trigger ops** | Paste/create mention may enqueue: link assert, embedding index job, decision trace — via document **intake hooks**, not editor internals |

**Rejected:** editor-owned graph writes without confirmation for suggest-link (too noisy for causal log).

### Collab tiers (explicit, ordered)

| Tier | Model | Default for TRL-10? |
| ---- | ----- | ------------------- |
| **1** | Local editor + graph LWW persist + record-level presence | **Yes — P0** |
| **2** | Ephemeral plain-text draft via `RealtimeText` on `/rt`; debounce persist | Optional spike; **formatting lost** in live collab |
| **3** | Block entities — graph LWW per block | **P1** for Notion-grain |
| **4** | Yjs/Hocuspocus for formatted char collab | **Deferred** — parallel transport; Trellis remains system of record |

**Rejected as default:** Yjs + Hocuspocus for v1 rich text — duplicates `/rt` investment without replacing graph durability.

### Editor framework

| Option | Verdict |
| ------ | ------- |
| **Tiptap / Plate on ProseMirror** | **Accepted** — substrate for TRL-10 and playground |
| **Custom rich-text editor from scratch** | **Rejected** — caret/IME/paste/a11y cost dominates; not differentiated |
| **Custom `trellis/document` semantic layer** | **Accepted** — mentions, paste, blocks, vantage metadata |

Framework choice (Tiptap vs Plate) is an **app-level** decision. Ship semantic APIs from `trellis/document` without binding to one editor package in `trellis/client`.

### Local-first save UX (required for P0)

Typed SDK mutations are **server-confirmed, not optimistic** today. The editor **must** maintain local editor state and show save lifecycle (editing / saving / saved / error) independent of graph ACK latency.

### Dev parity: `presenceRelay` on `trellis db serve`

**Problem:** Sprites deploy passes `presenceRelay: true` (`src/server/deploy.ts`). `trellis db serve` does not — local dev only gets cross-**tab** presence via `BroadcastChannelTransport`; cross-**browser** presence and `RealtimeText` collab require a separate `scripts/demo-relay.mjs` on port 8231 or `NEXT_PUBLIC_PRESENCE_RELAY_URL`.

**Decision:** Enable `presenceRelay: true` on `trellis db serve` by default (or via `--presence-relay` flag). Mounts the same `/rt` WebSocket relay on the DB HTTP server so `joinPresence({ relayUrl: 'ws://localhost:3000/rt' })` works in dev without a second process.

| Environment | Before | After |
| ----------- | ------ | ----- |
| Sprites prod | `ws://host/rt` on same server | unchanged |
| `trellis db serve` | `/realtime` only; `/rt` absent | `/rt` on same port |
| Same-browser only | `BroadcastChannelTransport` | unchanged (still works without relay) |

This is **infrastructure parity**, not a document-model change. Implement as follow-on to this ADR (small CLI/server patch).

## Rejected alternatives

### Build a rich-text editor from scratch

ProseMirror, Slate, and descendants exist because **editing surfaces are commodity infrastructure** with years of edge-case work. Trellis differentiation is **graph-native documents** — mentions that write ops, paste that suggests entities, diagrams as nodes, semantic zoom as projection — not caret rendering.

Building a custom editor would delay TRL-10 by quarters and still require a document model isomorphic to ProseMirror's anyway.

### Single monolithic `rich_text` string forever

Works for P0 spikes; **rejected as long-term model** for large docs, Mermaid entities, block-level merge, and embedding granularity. P1 block entities are the planned escape hatch (demo schema already exists).

### Put Tiptap in `trellis/client` core

**Rejected.** Optional subpath (`trellis/tiptap`) or app-local dependency only. Keeps bundle and framework matrix out of the transport SDK.

## Consequences

### Positive

- TRL-10 scope is clear: **editor UX + P0 persist**, collab tier chosen explicitly later.
- Long-term features (auto-link, embeddings, diagrams-as-entities) have a **home** in `trellis/document`, not scattered in UI code.
- Block LWW demo schema becomes the P1 north star instead of fighting `RealtimeText` limits.
- `trellis/links` stays the single grammar for references across markdown, doc-comments, and rich text.
- Dev/prod presence parity reduces playground e2e surprises.

### Negative / cost

- Two formats during migration (HTML P0 → block graph P1) need a migration story.
- Paste/intake and suggest-link require embedding infra and UX for confirmation — not P0.
- `trellis/document` is new surface area to maintain alongside `trellis/links`.
- Block model increases entity count per document (acceptable for graph-native design).

### Non-goals (this ADR)

- Final Tiptap vs Plate choice for fractal-playground.
- Yjs/Hocuspocus integration (Tier 4).
- Full optimistic mutation protocol (SPEC-v1.1+).
- Studio whiteboard / Excalidraw embedding (separate artifact type).
- Ontology GET/PATCH on sidecar (TRL-37 playground shims).

## Acceptance criteria

### TRL-10 P0 (fractal-playground / realtime-app)

- [ ] `rich_text` field renders in Plate or Tiptap — not `<textarea>` for `body` / `content`.
- [ ] Explicit entity mention inserts stable ref; survives round-trip (P0 wire format).
- [ ] Save uses `trellis/schema` mutation with visible save state; collections e2e green.
- [ ] Record-level presence ("who is viewing/editing this document") reuses `joinPresence` — no new infra.
- [ ] Collab tier documented in issue; **no Yjs in P0**.

### Engine follow-on (presence relay)

- [ ] `trellis db serve` exposes `ws://localhost:<port>/rt` when relay enabled.
- [ ] Cross-browser presence spike works against `db serve` without `demo-relay.mjs`.

### P1 (block + diagrams)

- [ ] Block entities replace single-string body for at least one document type.
- [ ] Mermaid (or diagram) paste/create spawns linked child entity.
- [ ] Paste intake suggests links; confirmed suggest writes graph link op.

### P2 (semantic zoom)

- [ ] Document entity exposes derived outline/summary facts or queryable projections.
- [ ] Vantage scrub on document (ADR 0012) switches representation without duplicate storage.

## Implementation follow-on

| Item | Depends on | Purpose |
| ---- | ---------- | ------- |
| TRL-10 spike | this ADR | Editor + P0 persist + mentions |
| `trellis/document` module | TRL-10 learnings | Mention wire format, paste classifier, block mapper |
| `db serve --presence-relay` | this ADR | Dev parity with Sprites |
| Block port from demo | P1 | `block` schema in playground ontology |
| Suggest-link + embeddings | `trellis/ai`, paste pipeline | Auto-link on paste/selection |
| `trellis/tiptap` (optional) | `trellis/document` | Shared mention extension |

## Open questions

1. **P0 wire format** — HTML + `data-trellis-ref` vs markdown `[[…]]` for playground (spike decides).
2. **Diagram entity type** — extend `core:Document` vs new `core:Diagram` in ontology.
3. **Suggest-link threshold** — embedding score floor + always confirm vs auto-link for high-confidence issue ids.
4. **Block vs inline Mermaid** — block entity only, or inline mark that lazily materializes entity on save.

Resolve in TRL-10 spec and spike; do not block P0 editor on P1/P2 answers.
