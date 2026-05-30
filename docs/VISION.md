# Trellis Vision

> The semantic web was right. Just at the wrong scale.

Trellis is a local-first agentic OS runtime: a personal and collaborative semantic graph where files, entities, facts, links, decisions, agents, branches, and milestones live in one inspectable causal substrate.

The goal is not to build another hosted realtime database. The goal is to build an owned local graph runtime that can sync with peers, host agents, expose programmable views, and remain useful without a cloud server.

## Thesis

The fragmentation of personal and collaborative computing is a data model problem. Tasks, notes, files, people, projects, decisions, and agent actions should not live in disconnected apps. They should be graph nodes with typed facts, links, provenance, and queryable history.

When the graph is the product, applications become projections over state rather than separate silos of state.

## First Principles

### Everything is a node

Files, blocks, entities, projections, agent actions, relationships, issues, milestones, and decisions should be representable in the graph.

### Views are queries

Lists, tables, boards, calendars, graphs, dashboards, and agent workspaces should render query results over the same underlying graph rather than creating separate data models.

### Local ownership is primary

Trellis must be fully useful without a cloud server. Local state, local identity, local persistence, and local query execution are the default. Cloud services, relays, gateways, and hosted indexes are additive.

### Agents are inspectable participants

Agent work should appear as graph facts, decision traces, tool calls, mutations, and milestones. A user should be able to ask why something changed and traverse the causal graph to answer it.

### Sync is replication, not ownership transfer

Peer sync should replicate signed, causally ordered operations between Trellis nodes. A relay may help peers connect or bridge browsers, but it should not become the primary owner of state.

## Product Modes

| Mode | Purpose | Trellis expression |
|---|---|---|
| World | End-user interaction | Browse, ask, compose, inspect, and use the graph |
| Forge | Structure-making | Ontologies, schemas, templates, capabilities, and runtime configuration |
| Observatory | Provenance and operations | Causal stream, milestones, decisions, sync state, agents, and graph health |

## What Trellis Is Not

- Not a productivity app that happens to have a graph underneath.
- Not a Notion clone.
- Not an AI assistant with opaque memory.
- Not a cloud-first database with a local cache.
- Not a centralized web app that later adds peer sync.

Trellis is the local-first graph substrate. Web apps, SDKs, relays, and dashboards are surfaces over that substrate.
