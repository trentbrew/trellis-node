# Trellis live graph explorer (canonical UI)

This SvelteKit app is the **default** surface for `trellis ui` and `just run`.

Integration harness for typed SDK + realtime — not shipping Studio. See ADR 0011
for L1/L2/L3 band model; collections and fractal wedges live here until shell
contracts stabilize.

## Typed SDK path (browser)

1. **Schemas** — `src/lib/schemas/*.ts` (`defineType` + Zod shapes)
2. **Bootstrap** — `bootstrapExplorerSchemas()` registers types idempotently on mount
3. **Reads** — `entitiesStore(client, SomeType, { where })` from `trellis/svelte/typed`
4. **Writes** — `mutations(client, SomeType)` → `create` / `update` / `remove`

Collections (`/` + `/collections/[slug]`) are the reference typed CRUD surface.
Fractal + platform remotes use **server** `createEntityCollection` in
`src/lib/trellis/collection.ts` for lane materialization only.

## What it demonstrates

- **Graph sidecar** — `query.live`, ontology, entity CRUD (`:3920`)
- **L3 inspector FAB** — embedded on `:4000` via `TrellisInspectorLoader` (bottom-right DB pill); `:3920` is dev-only bare landing
- **Realtime primitives** — presence, chat, `/collab` RealtimeText CRDT (`/editor` redirects here)
- **Agent lanes** — draft/promote on `/?lane=agent:demo`

## Run from trellis-node root

```bash
just run
# or
trellis ui
```

`dev:all` starts the Trellis sidecar, a presence relay (`ws://localhost:8231/rt`),
and Vite — so `/presence` syncs across browsers, not just cross-tab.

First time in this folder:

```bash
pnpm install   # preinstall runs ensure-trellis-build (dist + package.json sync)
pnpm trellis:init
```

From **trellis-node root**, `just run` / `trellis ui` also run `demo-ensure-build`, evict stale ports, and refresh the linked `trellis` package when `node_modules` already exists.

## Sync from sandbox

Upstream lives at `turtle/projects/sandbox/svelte-remote-functions/realtime-app`.

```bash
just explorer-sync
# REALTIME_APP_SRC=/path/to/realtime-app node scripts/sync-realtime-app.mjs
```

## Legacy VCS visualizer

The old `client.html` System Visualizer (file/issue/milestone graph) is still available:

```bash
trellis ui --legacy --port 3333
```
