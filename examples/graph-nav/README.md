# graph-nav

A sidebar where every section and item **is a typed entity in the Trellis graph** —
read live and mutated through the schema-typed SDK. The wedge for the
"Jazz-competitive DX, on our home turf (semantic graph)" story.

**TRL-35 parity demo** — React, Vue, and Svelte mounts share `schema.ts` and
`bootstrap.ts`. See [sdk-typed-realtime.md](../../docs/sdk-typed-realtime.md).

Three framework entries (React · Vue · Svelte) share one graph and one WebSocket
subscription channel — open two tabs on the same entry and edits sync without polling.

## What it exercises

- **`schema.ts`** — `defineType` + Zod; one definition is runtime schema and TS type.
- **`registerType`** — `POST /ontologies` on first boot (409-safe on re-register).
- **`useEntities` / `useMutation`** (or Vue/Svelte equivalents) — live hydrated reads
  over `/realtime`, typed writes.
- **`resolve`** — `useEntities(NavSection, { resolve: { items: true } })` expands
  child items in one batched pass (no per-section subscriptions).

| Framework | Entry | Typed hooks |
|-----------|-------|-------------|
| React | `/react/` | `trellis/react/typed` |
| Vue | `/vue/` | `trellis/vue/typed` |
| Svelte | `/svelte/` | `trellis/svelte/typed` |

## Run

From **trellis-node root** (recommended):

```bash
just graph-nav
```

Or manually — Trellis entity server + Vite:

```bash
cd examples/graph-nav
pnpm install
pnpm dev:all         # trellis :8230 + vite :4200
```

Cross-browser sync uses the Trellis `/realtime` WebSocket (not the presence
relay) — any browser hitting the same Vite origin shares one graph.

- Hub: <http://localhost:4200/>
- React: <http://localhost:4200/react/>
- Vue: <http://localhost:4200/vue/>
- Svelte: <http://localhost:4200/svelte/>
- **L3 inspector FAB** — bottom-right DB pill on all Vite entries (proxied to trellis `:8230`); bare DB landing at <http://localhost:8230/>

**QA:** open any framework URL in two tabs. Add a section or item in tab A — tab B
updates within a second (no refresh).

## How the live read works

`useEntities(NavSection, { resolve: { items: true } })` subscribes once, hydrates
sections, then batches NavItem loads grouped by `section`. Tests:
`test/schema/resolve.test.ts`, `test/schema/graph-nav-sync.test.ts`.

## Notes

- `where` filters are string-equality only.
- Data persists to `./.graph-nav-db`; delete to reset. Bootstrap is idempotent.
