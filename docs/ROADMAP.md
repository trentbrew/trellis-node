# Trellis Roadmap

Trellis is a local-first agentic OS runtime. The local graph kernel, causal op log, identity, and peer replication model are the source of truth. Hosted services, browser gateways, relays, and web SDKs are compatibility layers that may bridge, accelerate, back up, or expose state, but they must not become the primary owner of Trellis state.

## Architectural Invariants

- Trellis must be fully useful without a cloud server.
- Local graph state is primary.
- Every mutation should become a durable, inspectable operation.
- Peers validate state through identity, signatures, capabilities, and causal history.
- Relays and gateways are optional adapters, not architectural centers.
- Browser compatibility should not compromise local-first ownership.

## Planned Milestone Sequence

### Milestone 0 — Local-First OS Architecture

Issue: `TRL-7` — Codify local-first Trellis OS architecture

Checkpoint message:

```bash
trellis milestone create -m "Codify Trellis as a local-first agentic OS runtime"
```

Outcome:

- Architecture docs state that Trellis works without a cloud server.
- Core layers are named: kernel, runtime, sync, UI, and compatibility adapters.
- Centralized web paths are explicitly treated as adapters.

### Milestone 1 — Local Runtime Loop

Issue: `TRL-8` — Prototype local Trellis runtime loop

Checkpoint message:

```bash
trellis milestone create -m "Implement local Trellis runtime loop with live graph queries"
```

Outcome:

- Local mutations run against TrellisKernel and SQLite persistence.
- Local live queries update after mutations.
- Runtime remains useful offline.

### Milestone 2 — Turtle Desktop Shell

Issue: `TRL-9` — Create Turtle Tauri desktop shell prototype

Checkpoint message:

```bash
trellis milestone create -m "Prototype Turtle desktop shell on top of local Trellis runtime"
```

Outcome:

- Tauri app launches and connects to the local Trellis runtime.
- UI can create, update, and list graph entities.
- Live graph state is visible in the desktop shell.

### Milestone 3 — Runtime and NixOS Boundary

Issue: `TRL-10` — Define NixOS and local runtime service boundary

Checkpoint message:

```bash
trellis milestone create -m "Define Turtle runtime boundary and NixOS service model"
```

Outcome:

- Runtime process responsibilities are explicit.
- Storage, identity, config, and lifecycle boundaries are defined.
- NixOS service/module direction is documented.

### Milestone 4 — Graph Op Sync Protocol

Issue: `TRL-11` — Generalize graph op sync protocol

Checkpoint message:

```bash
trellis milestone create -m "Generalize sync protocol for Trellis graph op replication"
```

Outcome:

- Existing sync concepts generalize beyond VCS ops.
- In-memory peers can exchange graph ops and converge.
- Incoming ops are idempotent and causally validated.

### Milestone 5 — Iroh P2P Transport

Issue: `TRL-12` — Spike Iroh transport for Trellis sync

Checkpoint message:

```bash
trellis milestone create -m "Sync Trellis graph state peer-to-peer over Iroh"
```

Outcome:

- Two local Trellis nodes connect over Iroh.
- Graph ops replicate without an app relay server.
- Remote ops apply locally and trigger live query updates.

### Milestone 6 — Signed Ops and Governance

Issue: `TRL-13` — Design signed ops and capability governance

Checkpoint message:

```bash
trellis milestone create -m "Add signed graph ops and capability-based workspace governance"
```

Outcome:

- Incoming ops are signature-verified.
- Capability checks reject unauthorized writes.
- Invite and revocation semantics are defined.

### Milestone 7 — Optional Relay and Browser Gateway

Issue: `TRL-14` — Add optional relay and browser gateway adapter

Checkpoint message:

```bash
trellis milestone create -m "Add optional relay and browser gateway without centralizing state ownership"
```

Outcome:

- Browser clients can access Trellis through a compatibility adapter.
- Relays remain optional and do not become source of truth.
- Local-first operation continues to work without hosted infrastructure.

## Deferred Compatibility References

PartyKit, InstantDB, PocketBase, hosted Trellis servers, and browser-first SDKs are useful references and compatibility paths. They should inform ergonomics, admin UX, realtime transport design, and developer experience, but the core Trellis architecture should remain local-first, peer-capable, and OS-oriented.

## Issue Workflow

Roadmap items begin as Trellis issues. Milestones are created only after a coherent checkpoint is completed, so each milestone remains a narrative summary of accomplished work rather than a speculative plan.
