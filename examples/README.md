# Trellis framework examples

Reference apps for **typed SDK parity** (TRL-35). Each demonstrates the same
public APIs in React, Vue, and Svelte — code-as-config, no visual builder.

| Example | Command | Port | Typed graph | Realtime |
| ------- | ------- | ---- | ----------- | -------- |
| [graph-nav](./graph-nav/) | `just graph-nav` | 4200 | ✓ `defineType` + live mutations | Sidecar WS |
| [universal-presence](./universal-presence/) | `just universal-presence` | 4100 | — | ✓ presence · chat · text |

**Docs:** [sdk-typed-realtime.md](../docs/sdk-typed-realtime.md) — stable entrypoints, mutation semantics, tests, reconnect notes.

**Integration harness (not parity matrix):** [demo/realtime-app](../demo/realtime-app/) — SvelteKit explorer sketchpad.
