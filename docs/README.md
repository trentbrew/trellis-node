# Trellis Documentation

The canonical documentation home for Trellis. The repository root holds only files that GitHub, npm, or AI agents expect to find there (README, LICENSE, CHANGELOG, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, llms.txt). Everything else lives here.

## Start Here

- **[The Story](./THE-STORY.md)** — Why Trellis exists. The reasoning/state gap and how decision traces close it.
- **[Vision](./VISION.md)** — Local-first agentic OS framing. The long view.
- **[Five Pillars](./PILLARS.md)** — Core architectural principles in one page.

## Architecture and Design

- **[Architecture](./ARCHITECTURE.md)** — Current package layout and target local-first runtime shape.
- **[Design Spec](./DESIGN.md)** — Full architecture specification mapping the five pillars onto the kernel.
- **[Roadmap](./ROADMAP.md)** — Planned milestone sequence and architectural invariants.

## Building on Trellis

- **[Agents Guide](./AGENTS.md)** — How to build agents on top of the Trellis kernel.
- **[Context Graphs](./CONTEXT-GRAPHS.md)** — The market thesis on agentic context as a category.

## Reference and Archive

- **[Archived README](./README-ARCHIVED.md)** — Comprehensive 2026-04-04 documentation, including the full CLI reference and module subpath guide. Preserved while the live docs site at [trellis.computer](https://trellis.computer) is built out.
- **[Scratch](./SCRATCH.md)** — Working notes and design exploration. Not authoritative; durable ideas migrate into other docs.

## Documentation Policy

- Keep docs close to the code they describe.
- Treat roadmap work as Trellis issues first, narrative milestones after completed checkpoints.
- Prefer updating docs here instead of extending older upstream docs in separate repositories.
- Preserve durable ideas from older docs; rewrite stale implementation details around the current kernel, SDK, runtime, sync, and local-first roadmap.
- Use older docs as migration sources, not as sources of truth.
