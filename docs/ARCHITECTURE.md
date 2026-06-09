---
title: Trellis Architecture
description: How Trellis is organized around a local-first runtime core with optional compatibility adapters.
created: 2026-05-30
updated: 2026-05-30
---

# Trellis Architecture

Trellis is organized around a local-first runtime core with optional compatibility adapters.

## Target Shape

```text
NixOS / host system
  -> Turtle runtime service or sidecar
    -> Trellis kernel
      -> EAV graph store
      -> causal op log
      -> query engine
      -> blob store
      -> identity and governance
      -> local live subscriptions
    -> sync transports
      -> Iroh peer-to-peer
      -> local memory transport
      -> optional WebSocket or PartyKit relay
    -> client surfaces
      -> Tauri desktop shell
      -> CLI
      -> MCP
      -> TypeScript SDK
      -> browser gateway
```

## Current Codebase Shape

```text
trellis-package/
  src/core/       graph store, kernel, query, ontology, agents, plugins
  src/vcs/        causal stream, branches, milestones, merge, issues
  src/client/     TrellisClient / TrellisDb SDK, local and remote modes
  src/server/     HTTP, WebSocket realtime, auth, permissions, tenancy
  src/react/      React provider and hooks
  src/sync/       current sync engine and transport abstractions
  src/mcp/        MCP integration and docs server
  src/semantic/   AST parsing and semantic diffing
  docs/           canonical documentation
  ROADMAP.md      milestone roadmap
```

## Architectural Invariants

- Trellis must work fully without a cloud server.
- Local graph state is primary.
- Every mutation should become a durable, inspectable operation.
- Peers validate state through identity, signatures, capabilities, and causal history.
- Relays and gateways are optional adapters.
- Browser compatibility must not compromise local-first ownership.

## Runtime Layers

### Kernel

The kernel owns graph mutation, replay, persistence, snapshots, and queryable EAV state.

### Runtime

The runtime is the process boundary around the kernel. It should eventually support desktop sidecar, local daemon, and NixOS service modes.

### Client SDK

The SDK should expose one coherent API across local and remote compatibility modes. Local mode should remain first-class rather than a testing convenience.

### Sync

Sync should be transport-independent. Iroh is the north-star peer-to-peer transport. WebSocket and PartyKit-style relays are useful adapters for browser compatibility and unreachable peers.

### UI

The Tauri desktop shell should become the primary client layer. Browser UI remains valuable as a compatibility surface and development surface.

## Compatibility Adapters

Hosted Trellis servers, PartyKit relays, InstantDB-style experiments, PocketBase-inspired admin surfaces, and browser SDKs can all be useful. They should adapt to the Trellis runtime instead of replacing it.
