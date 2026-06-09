# Trellis live graph explorer (canonical UI)

This SvelteKit app is the **default** surface for `trellis ui` and `just run`.

It demonstrates:

- **Graph sidecar** — `query.live`, ontology, entity CRUD (`:3920` + inspector)
- **Realtime primitives** — presence, chat, collaborative editor
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
