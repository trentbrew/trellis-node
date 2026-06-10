---
title: Trellis Agent Skills
description: Reusable AI agent skills and behaviors for interacting with the Trellis knowledge graph and VCS engine.
created: 2026-05-30
updated: 2026-05-30
---

# Trellis Agent Skills

Reusable AI agent skills and behaviors for interacting with **Trellis** — the local-first Agentic State Engine.

These skills teach AI agents (such as **Claude Code**, **OpenCode**, and other custom agents) how to interact with the Trellis knowledge graph and the TrellisVCS version control engine.

---

## Quickstart (Install Skills)

You can easily install these skills into your local agent environment using the open [skills CLI](https://www.npmjs.com/package/skills):

```bash
# Install all skills from this repository
npx skills add trentbrew/trellis
```

Or install a specific skill:

```bash
# Install only the graph ontology/MCP skill
npx skills add trentbrew/trellis --skill trellis-graph

# Install only the VCS workflow skill
npx skills add trentbrew/trellis --skill trellis-vcs
```

---

## Included Skills

### 1. [Trellis Graph](./trellis-graph/SKILL.md) (`trellis-graph`)

Teaches agents how to work with the Trellis knowledge graph, including:

- **Two-Axis Type System**: Classifying entities structurally (temporal, document, actor, container) and typographically.
- **Campus Substrate**: Working with the spatial ontology (Facilities and Zones).
- **Graph CRUD & Ontologies**: Creating, querying, linking, and managing entities using the TQL Graph API via MCP tools.
- **EQL-S Querying**: Executing semantic queries.

### 2. [TrellisVCS](./trellis-vcs/SKILL.md) (`trellis-vcs`)

Teaches agents how to use TrellisVCS for graph-native version control and issue tracking:

- **Core CLI commands**: Checking status, viewing causal op streams, and creating narrative milestones.
- **Issue Tracking**: Tracking issue lifecycles with strict verification gates and context switching (pause/resume).
- **Idea Garden**: Discovered and reviving abandoned reasoning or context-switches.
- **Semantic Code Analysis**: Working with semantic AST-level diffs (`trellis sdiff`).
- **Decision Traces**: Inspecting and auditing decisions (`trellis decision`).

---

## How It Works

`npx skills` downloads the `SKILL.md` instruction sets from this repository and automatically installs them into your active coding agent's configuration directory (such as `.claude/skills/` or `.devin/skills/`).

Once installed, your agent will dynamically load these instructions and automatically know how to use Trellis commands and MCP tools to manage your projects and knowledge graph!
