<div align="center">
  <img src="./logo.svg" alt="Trellis" width="88" height="88" />
  <h1>Trellis</h1>
  <p><strong>The Agentic Framework</strong> — a local-first, event-sourced graph engine for code, agents, and decisions.</p>
  <p>
    <a href="https://trellis.computer">Docs</a> ·
    <a href="https://studio.trellis.computer">Studio</a> ·
    <a href="https://github.com/trentbrew/trellis">GitHub</a>
  </p>
</div>

---

Most agent frameworks pour everything into the reasoning engine and treat state as an afterthought. Trellis inverts that. It is the **system of record for decisions**: a persistent, queryable, auditable memory where every thought, tool call, and file change is an immutable operation in a causal graph. It runs fully offline — servers may relay, accelerate, or back up, but never own your state.

- **Durable memory** — every op is content-addressed and never rewritten or deleted.
- **Explainable by default** — decision traces record not just *what* happened, but *why*.
- **Safe to explore** — branch state to try multiple paths, then merge or discard.
- **Realtime** — one write updates current state, durable history, and every live subscriber.

## Install

```bash
npm install -g trellis
```

## Quick start

```bash
mkdir my-project && cd my-project
trellis init      # guided or one-shot setup
trellis ui        # live graph explorer
trellis code      # start an agent coding session
```

Track work as graph-native entities instead of text commits:

```bash
trellis issue create -t "Bootstrap viz"
trellis milestone create -m "Initial release"
trellis garden                          # discover & revive abandoned work
trellis query 'find ?e where type = "Task"'
```

## Build a realtime app

Scaffold a typed, live-graph app — React, Vue, or Svelte — backed by Trellis:

```bash
npm create trellis@latest
```

```ts
import { defineType } from 'trellis/schema';
import { z } from 'zod';

export const Task = defineType('Task', { title: z.string(), done: z.boolean() });
```

```svelte
<script>
  import { entitiesStore, mutations } from 'trellis/svelte/typed';
  const tasks = entitiesStore(client, Task);  // re-renders live, across every client
  const task = mutations(client, Task);
</script>
```

A single mutation produces current state, durable history, and a realtime push to every subscriber — the same write path.

## API surface

The `trellis` package exposes focused subpaths:

| Import | Purpose |
| --- | --- |
| `trellis/client` | Local + remote client SDK |
| `trellis/schema` | `defineType`, typed entities, EQL-S queries |
| `trellis/{react,vue,svelte}/typed` | Live, schema-typed reads + mutations |
| `trellis/realtime` | Presence, chat, CRDT text |
| `trellis/cms` | Read content collections over HTTP |
| `trellis/server` | HTTP + WebSocket DB server |

## Documentation

- **[trellis.computer](https://trellis.computer)** — full documentation
- **[The Story](./docs/THE-STORY.md)** — why Trellis exists
- **[Architecture](./docs/ARCHITECTURE.md)** · **[Design spec](./docs/DESIGN.md)** · **[Roadmap](./docs/ROADMAP.md)**

## Develop

```bash
bun install   # requires Bun ≥ 1.0
bun test
bun run build
```

## License

[AGPL-3.0-or-later](./LICENSE) © Turtle Labs LLC
