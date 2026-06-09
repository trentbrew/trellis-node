---
title: Trellis Archived Documentation
description: Comprehensive legacy documentation from 2024-04-04, preserved for reference.
created: 2026-05-30
updated: 2026-05-30
---

# Trellis (Archived Documentation)

> **Note**: This is the archived comprehensive documentation from 2024-04-04. It has been replaced with a streamlined README.md. This file preserves all detailed information for reference and will eventually migrate to [trellis.computer](https://trellis.computer).

---

# Trellis

> **The Agentic Framework** — A structured runtime for building agents that understand code, remember everything, and explain themselves. Trellis provides the durable, queryable, and versioned state layer that modern agentic systems require.

| Use Case                       | How                                                                                                           |
| :----------------------------- | :------------------------------------------------------------------------------------------------------------ |
| **Agentic State Engine**       | Tool registry + decision traces + branching — agents operate on state they can fork, audit, and roll back     |
| **Building Agents End-to-End** | Unified LLM abstraction + context management + RAG + orchestration — everything you need in one kernel        |
| **Autonomous Code Editing**    | Semantic patching + AST-aware tools + causal history — agents modify code structure, not just text            |
| **Auditable Reasoning**        | Immutable op log + decision traces + precedent search — every agent action is signed, causal, and explainable |

---

## Why Trellis?

**[Read the story →](./THE-STORY.md)**

Most agent frameworks focus on the _reasoning engine_ (the LLM) but treat _state_ as an afterthought. Trellis reverses this. It is the **System of Record for Decisions**, providing agents with a persistent, queryable, and auditable memory that compounds over time.

- **Durable Memory**: Every thought, tool call, and file change is an immutable operation in a causal graph.
- **Explainability by Default**: Decision traces don't just store _what_ happened, but _why_—linking actions back to context, policy, and precedent.
- **Safe Exploration**: Agents can "fork" the state of a repository, explore multiple implementation paths, and merge the successful ones back—just like human developers.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Platform Overview](#platform-overview)
- [Core Capabilities](#core-capabilities)
- [Project Surfaces](#project-surfaces)
- [Package Architecture](#package-architecture)
- [CLI Overview](#cli-overview)
- [VS Code Extension](#vs-code-extension)
- [Module & Subpath Guide](#module--subpath-guide)
- [Development & Releases](#development--releases)
- [Roadmap](#roadmap)

---

## Quick Start

### Install

Global install:

```bash
# 1. Install trellis globally
npm install -g trellis
# 2. Initialize and explore the graph
trellis init
trellis status
trellis -h
```

Or use npx:

```bash
npx trellis init
```

### Initialize a repository

```bash
# With the CLI (progressive disclosure onboarding)
npx trellis init
# Choose between:
# ⚡ Minimal Setup: One-shot setup with auto-detected defaults
# 🔧 Custom Guided Setup: Full control over framework, IDEs, and features

npx trellis watch

# Or programmatically
import { TrellisVcsEngine } from 'trellis';
const engine = new TrellisVcsEngine({ rootPath: '/my/project' });
await engine.initRepo();
```

### Import from Git

```bash
npx trellis import --from /path/to/git-repo
```

---

## Platform Overview

Trellis is an event-sourced causal graph engine that unifies version control, knowledge management, semantic analysis, and intelligent automation. Every action — code changes, agent decisions, wiki-links, embeddings — is an immutable operation in a causal stream, giving you time-travel, branching, and full auditability out of the box.

The platform consists of multiple integrated surfaces:

- **`trellis` npm package** — the published package exposing all platform APIs through modular subpaths
- **`trellis` CLI** — command-line interface for repository management, semantic tooling, knowledge operations, and automation
- **VS Code extension** — visual interface for timeline exploration, issue management, knowledge navigation, and collaborative features
- **Core platform modules** — reusable building blocks for graph storage, semantic analysis, sync, knowledge graphs, embeddings, and decision traces

### Core Capabilities

#### 1. **Agentic State Kernel**

- **EAV Store** — Entity-Attribute-Value graph database for structured agent memory
- **Causal Stream** — Immutable, content-addressed operations with full auditability
- **Branching & Forking** — Allow agents to simulate and explore multiple paths safely
- **Ontology System** — Schema validation and built-in guardrails for agent actions

#### 2. **Context & Reasoning**

- **Decision Traces** — Automated capture and querying of agent tool calls and rationale
- **Embeddings** — Native vector search for semantic indexing and RAG-based context injection
- **Wiki-Links** — Bidirectional knowledge graph connecting files, issues, and decisions
- **Idea Garden** — Detect and revive abandoned reasoning paths or code clusters

#### 3. **Autonomous Code Operations**

- **Semantic Patching** — AST-aware changes enabling agents to modify code structure accurately
- **Tool Registry** — Robust environment for defining and executing agent-available tools
- **Multi-Repo Federation** — Cross-repository reasoning and relationship mapping
- **Governance** — PGP-signed ops and policy enforcement for authorized agent actions

#### 4. **Framework Infrastructure**

- **LLM Layer** — Unified abstraction for OpenAI, Anthropic, Ollama, and more
- **Peer Sync** — CRDT-based reconciliation for multi-agent or collaborative environments
- **Client/Server/React** — Complete SDK for building agentic UIs and distributed backends
- **VS Code Extension** — Visual timeline and decision inspector for human-in-the-loop oversight

## Project Surfaces

| Surface               | Location                                                      | Purpose                                                                  |
| :-------------------- | :------------------------------------------------------------ | :----------------------------------------------------------------------- |
| **npm package**       | `package.json`, `src/`, `dist/`                               | Published as `trellis`; exposes all platform APIs via subpaths           |
| **CLI**               | `src/cli/index.ts`                                            | Repository lifecycle, semantic tooling, knowledge operations, automation |
| **VS Code extension** | `vscode-extension/`                                           | Timeline, knowledge navigation, issue management, collaborative UX       |
| **Core platform**     | `src/core/`                                                   | EAV store, kernel, ontology, query, agents, plugins                      |
| **Platform modules**  | `src/vcs/`, `src/links/`, `src/embeddings/`, `src/decisions/` | Specialized subsystems for version control, knowledge, and intelligence  |

---

## Package Architecture

```
trellis/
├── src/
│   ├── core/              # EAV store, kernel, ontology, query, agents, plugins
│   │   ├── kernel/        # TrellisKernel with entity CRUD and middleware
│   │   ├── ontology/      # Schema registry, validation, built-in ontologies
│   │   ├── query/         # EQL-S query engine and Datalog evaluator
│   │   ├── agents/        # Agent harness, tool registry, decision traces
│   │   └── plugins/       # Plugin registry, event bus, workspace config
│   ├── server/            # HTTP+WS server, auth, permissions, tenancy, deploy
│   │   └── inspector/     # Visual DB inspector (web component)
│   ├── client/            # Isomorphic SDK (local + remote), config
│   ├── react/             # React hooks: useTrellis, useEntity, useQuery, useMutation
│   ├── vcs/               # Version control: ops, branches, milestones, diff, merge
│   ├── links/             # Wiki-link parsing, resolution, backlink index
│   ├── embeddings/        # Semantic indexing, vector search, auto-embed, RAG
│   ├── decisions/         # Decision trace capture and querying
│   ├── semantic/          # AST parsers, semantic diff, semantic merge
│   ├── sync/              # Peer sync, CRDT reconciler, HTTP/WebSocket transports, multi-repo
│   ├── garden/            # Idea Garden: abandoned work detection and revival
│   ├── git/               # Git import/export bridge
│   ├── identity/          # Ed25519 identity management and governance
│   ├── watcher/           # File watching + ingestion pipeline
│   ├── mcp/               # Model Context Protocol server integration
│   ├── cli/               # CLI entrypoint
│   ├── db/                # ⚠️ Deprecated shim — re-exports from server + client
│   ├── engine.ts          # Composition root
│   └── index.ts           # Main package entrypoint
├── vscode-extension/      # VS Code extension surface
├── test/                  # Comprehensive test suites
├── DESIGN.md              # Detailed architecture specification
└── justfile               # Local build and development recipes
```

### The Op Stream

Every action in Trellis is an immutable `VcsOp`:

```typescript
interface VcsOp {
  hash: string; // trellis:op:<sha256> — content-addressed
  kind: VcsOpKind; // e.g. 'vcs:fileModify'
  timestamp: string; // ISO 8601
  agentId: string; // Author identity (DID)
  previousHash?: string; // Causal chain link
  vcs: VcsPayload; // Op-specific data (filePath, contentHash, …)
  signature?: string; // Ed25519 signature (P4+)
}
```

Ops are written to `.trellis/ops.json` and replayed into an in-memory EAV graph on startup. They are **never rewritten or deleted**.

### Op Tiers

| Tier  | Kinds                                                       | Description                       |
| :---- | :---------------------------------------------------------- | :-------------------------------- |
| **0** | `fileAdd`, `fileModify`, `fileDelete`, `fileRename`         | File-level mutations from watcher |
| **1** | `dirAdd`, `dirDelete`, `branchCreate`, `milestoneCreate`, … | Structural VCS control ops        |
| **2** | `symbolRename`, `symbolMove`, `symbolExtract`               | AST-level semantic patches        |

---

## CLI Overview

The CLI is the operational surface for Trellis repositories. It is the fastest way to initialize repos, inspect history, create milestones, diff/merge work, and script automation around the op stream.

### Repository Setup

```bash
trellis init [--path <dir>]            # Initialize a new repo with progressive disclosure
trellis import --from <git-repo>       # Import Git history as milestones
trellis export --to <dir>              # Export milestones to Git commits
```

#### Progressive Disclosure Onboarding

The `trellis init` command now provides a two-stage onboarding experience:

**Stage 1: Setup Choice**

```
⚡ Minimal Setup: Fast, one-shot setup with detected framework, zero plugins, and auto-detected IDE rules
🔧 Custom Guided Setup: Customizes framework type, specific IDEs to target, workspace footprint sizes, and advanced feature plugins
```

**Stage 2: Success Screen with VCS + Semantic Substrate**

After initialization, the CLI displays:

```
✓ Initialized Trellis repository

Next steps (VCS):
  trellis status          Show repository state
  trellis log             View causal history
  trellis branch          Manage branches
  trellis milestone       Create narrative checkpoints
  trellis garden          Discover abandoned work

Semantic Substrate (Live local services):
  trellis web             Launch local web client / graph visualizer
  trellis query           Run EQL-S semantic queries against your code graph
  Agent Rules            Active for cursor, windsurf. Agents will auto-detect the graph.
```

**Smart IDE Detection**

- In Minimal setup mode, Trellis scans `process.env.TERM_PROGRAM` to detect Windsurf or Cursor
- If IDE cannot be determined confidently, it defaults to scaffolding rules for both IDEs
- Framework detection inherits from the `inferProjectContext` engine during repository scanning

### Working

```bash
trellis status                          # Current branch, op count, pending changes
trellis log [--limit N] [--branch b]    # Op stream history
trellis files [--deleted]               # All tracked files
trellis watch                           # Start continuous file watching
```

### Branches

```bash
trellis branch                          # List branches
trellis branch <name>                   # Create a branch
trellis branch -d <name>                # Delete a branch
```

### Milestones & Checkpoints

```bash
trellis milestone create -m "message"                          # Create milestone
trellis milestone create -m "msg" --from <hash> --to <hash>   # Over a specific range
trellis milestone list                                          # List milestones
trellis checkpoint create                                       # Manual checkpoint
trellis checkpoint list                                         # List checkpoints
```

### Diff & Merge

```bash
trellis diff [--from <hash>] [--to <hash>]  # File-level diff
trellis merge --branch <name> [--dry-run]   # Three-way merge
trellis parse <file>                        # Semantic parse (declarations, imports)
trellis sdiff <fileA> <fileB>               # Semantic diff between two versions
```

### Identity & Governance

```bash
trellis identity [show|create|list]         # Manage identities
trellis governance [list|add|remove]        # Manage policy rules
```

### Idea Garden

```bash
trellis garden                                        # List abandoned clusters
trellis garden list [--status <s>] [--file <f>]      # Filter clusters
trellis garden show <cluster-id>                      # Inspect a cluster
trellis garden search --keyword <term>                # Search by keyword
trellis garden revive <cluster-id>                    # Revive cluster as branch
trellis garden stats                                  # Garden statistics
```

### Sync

```bash
trellis sync status                       # Local sync state
trellis sync reconcile --remote <path>    # Reconcile with another local repo
trellis sync push --peer <id>             # Push ops to a peer (HTTP/WebSocket)
trellis sync pull --peer <id>             # Pull ops from a peer
trellis link-repo <alias> <location>      # Link a remote repo for cross-repo refs
```

### Query & Search

```bash
trellis query "find Project where status = 'active'"     # EQL-S structured query
trellis query-repl                                        # Interactive query REPL
trellis ask "authentication code"                         # Natural language semantic search
trellis ask "show me auth code" --rag                    # Output as RAG context for LLMs
```

### Ontology

```bash
trellis ontology list                     # List registered ontologies
trellis ontology show <id>                # Show ontology details
trellis ontology validate                 # Validate store against ontologies
```

### Agents

```bash
trellis agent list                        # List registered agents
trellis agent create <name>               # Create a new agent definition
trellis agent run <id> --input "task"     # Execute an agent run
trellis agent inspect <run-id>            # View run details and decision traces
```

### Plugins

```bash
trellis plugin list                       # List loaded plugins
trellis plugin add <id>                   # Register and load a plugin
trellis plugin remove <id>                # Unload and unregister a plugin
```

---

## VS Code Extension

The VS Code extension provides a rich visual interface for the entire Trellis platform, making knowledge navigation, collaboration, and project management intuitive and efficient.

### Core Features

- **Status Dashboard** — Real-time view of repository health, activity metrics, and system state
- **Causal Timeline** — Interactive exploration of the complete operation history with filtering and search
- **Knowledge Navigator** — Browse and traverse the wiki-link graph with visual connections
- **Issue Management** — Full lifecycle issue management with drag-and-drop workflow automation
- **Semantic Explorer** — Navigate code structure and relationships through AST-aware visualizations
- **Decision Inspector** — Review decision traces and understand the reasoning behind changes
- **Collaboration Hub** — Multi-repo federation view and cross-project relationship mapping
- **Intelligence Panel** — Semantic search, RAG context, and AI-powered insights

The extension lives in [`vscode-extension/`](./vscode-extension) and publishes separately from the npm package.

---

## Module & Subpath Guide

The `trellis` package is intentionally split into subpaths so consumers can depend on the specific capabilities they need, from core graph operations to advanced AI features.

### Published Package Surface

```bash
npm install trellis
```

```typescript
// Main entry — full platform engine
import { TrellisVcsEngine } from 'trellis';

// Core graph foundation (independent of VCS)
import { EAVStore, TrellisKernel } from 'trellis/core';
import type { Fact, Link, EntityRecord } from 'trellis/core';

// Server — HTTP+WS host, auth, permissions, multi-tenancy
import { startServer, TenantPool } from 'trellis/server';

// Client — isomorphic SDK (local or remote)
import { TrellisClient } from 'trellis/client';

// React — reactive hooks for graph subscriptions
import { TrellisProvider, useEntity, useQuery } from 'trellis/react';

// Version control primitives
import type { VcsOp, VcsOpKind } from 'trellis/vcs';

// Knowledge and intelligence
import { EmbeddingManager } from 'trellis/ai';
import { parseFileRefs, resolveRef, RefIndex } from 'trellis/links';
import { recordDecision, queryDecisions } from 'trellis/decisions';
```

### `trellis` — Platform Engine (`TrellisVcsEngine`)

The main entry point that orchestrates the entire platform: kernel, file watcher, version control, knowledge graphs, semantic analysis, and collaboration features.

```typescript
import { TrellisVcsEngine } from 'trellis';

const engine = new TrellisVcsEngine({ rootPath: '/my/project' });

// Repository management
await engine.initRepo();
engine.open();

// Core operations
engine.getOps(); // All operations
engine.status(); // Branch, op count, files
engine.log(); // Formatted history
engine.getFiles(); // Currently tracked files

// Version control
await engine.createBranch('feature/x');
await engine.createMilestone('Implement auth', { fromOpHash, toOpHash });

// Semantic analysis
engine.parseFile(content, 'src/auth.ts');
engine.semanticDiff(oldContent, newContent, 'src/auth.ts');

// Knowledge operations
const garden = engine.garden();
garden.listClusters();
garden.search({ keyword: 'auth' });

// Intelligence features
const embeddings = engine.embeddings();
await embeddings.search('authentication flow');
```

### `trellis/core` — Graph Foundation

The core graph layer exposes EAV primitives, ontology schemas, query engine, agent harness, and plugin system. This module is independent of version control and can be used for any graph-based application.

```typescript
import { EAVStore, TrellisKernel } from 'trellis/core';
import { OntologyRegistry, builtinOntologies } from 'trellis/core';
import { QueryEngine, parseQuery } from 'trellis/core';
import { AgentHarness } from 'trellis/core';
import { PluginRegistry, EventBus } from 'trellis/core';
import type { Fact, Link, KernelOp, AgentDef, PluginDef } from 'trellis/core';

// Graph operations
const kernel = new TrellisKernel({ backend, agentId: 'me' });
await kernel.createEntity('proj:1', 'Project', {
  name: 'Trellis',
  status: 'active',
});

// Ontology validation
const registry = new OntologyRegistry();
for (const o of builtinOntologies) registry.register(o);

// Graph queries
const query = parseQuery('find Project where status = "active"');
const results = new QueryEngine(store).eval(query);

// Agent orchestration
const harness = new AgentHarness(kernel);
await harness.createAgent({ name: 'Reviewer', status: 'active' });

// Plugin system
const plugins = new PluginRegistry();
plugins.register({ id: 'my:plugin', name: 'My Plugin', version: '1.0.0' });
```

### `trellis/vcs` — Version Control Model

The VCS subpath exposes operation types and domain-level building blocks for version control: branches, milestones, checkpoints, issues, diffing, merging, and blob storage.

Use this subpath when you want Trellis version control capabilities without the full platform surface.

### `trellis/links` — Knowledge Graph & Wiki-Links

Parse `[[wiki-links]]` from markdown, doc-comments, and source files. Resolve references to issues, files, symbols, milestones, and decisions. Build a bidirectional knowledge graph that connects all entities in your workspace.

```typescript
import { parseFileRefs, resolveRef, RefIndex } from 'trellis/links';

const refs = parseFileRefs('src/engine.ts', source);
const resolved = resolveRef(ref, context);
const index = new RefIndex();
index.indexFile('README.md', refs, context);
index.getIncoming('issue:TRL-5');

// Cross-repository references
index.addCrossRepoLink('frontend', 'proj:app', 'backend', 'api:users');
```

### `trellis/ai` — Semantic Intelligence

Advanced semantic capabilities: embed issues, milestones, files, code entities, and decisions into a vector store for intelligent search, discovery, and RAG (Retrieval-Augmented Generation).

```typescript
import { EmbeddingManager } from 'trellis/ai';

const manager = new EmbeddingManager(engine, { dbPath: 'embeddings.db' });
await manager.reindex();
const results = await manager.search('auth flow');

// RAG context for LLMs
const context = await manager.getRAGContext('authentication implementation');
```

### `trellis/decisions` — Decision Intelligence

Automatically capture tool invocations and agent decisions as auditable traces. Enrich them with rationale via hooks and query them later by tool, entity, or decision chain. Perfect for understanding how and why decisions were made.

```typescript
import { recordDecision, queryDecisions } from 'trellis/decisions';

const dec = await recordDecision(ctx, {
  toolName: 'trellis_issue_create',
  input: { title: 'Add parser' },
  output: { id: 'TRL-5' },
  rationale: 'Needed for TypeScript support',
});

// Query decision patterns
const decs = queryDecisions(ctx, { tool: 'trellis_issue_*' });
const chain = queryDecisions(ctx, { entity: 'TRL-5' }); // Full decision chain
```

### `trellis/server` — HTTP + WebSocket Server

Production-grade server host for the Trellis engine: multi-tenancy, auth (JWT + OAuth), permission middleware, realtime subscriptions, file uploads, and deployment tooling.

```typescript
import { startServer, TenantPool } from 'trellis/server';

const pool = new TenantPool('/data/tenants');
await startServer({
  port: 3000,
  dbPath: '/data/trellis',
  apiKey: 'secret',
  tenantPool: pool,
});
```

### `trellis/client` — Isomorphic SDK

TypeScript client that works in two modes — **local** (embeds TrellisKernel, zero network) or **remote** (calls the Trellis Server HTTP API). Includes CRUD, EQL-S queries, file uploads, auth, and WebSocket subscriptions.

```typescript
import { TrellisClient } from 'trellis/client';

// Remote mode
const db = new TrellisClient({
  url: 'https://myapp.example.com',
  apiKey: '...',
});

// Local mode (Node/Bun only)
const local = new TrellisClient({ path: './.trellis-db' });

// CRUD
const note = await db.create('Note', { title: 'Hello', body: 'World' });
const notes = await db.list('Note', { limit: 10 });

// Realtime subscriptions
const sub = db.subscribe("find Note where pinned = 'true'", (results) => {
  console.log('Live update:', results);
});
```

### `trellis/react` — React Hooks

Reactive hooks that turn the Trellis client into a live data layer for React applications. Auto-subscribes via WebSocket and cleans up on unmount.

```tsx
import {
  TrellisProvider,
  useEntity,
  useEntities,
  useQuery,
  useMutation,
} from 'trellis/react';

function App() {
  return (
    <TrellisProvider url="http://localhost:3000" apiKey="...">
      <NoteList />
    </TrellisProvider>
  );
}

function NoteList() {
  const { data: notes, loading } = useEntities<Note>('Note', { limit: 20 });
  const { create } = useMutation();

  if (loading) return <p>Loading...</p>;
  return notes.map((n) => <NoteCard key={n.id} note={n} />);
}

function NoteDetail({ id }: { id: string }) {
  const { data: note, loading } = useEntity<Note>(id);
  if (loading || !note) return <p>Loading...</p>;
  return <h1>{note.title}</h1>;
}
```

### `trellis/db` — Deprecated Alias

> **⚠️ Deprecated.** Use `trellis/server` and `trellis/client` instead.

This subpath re-exports everything from `trellis/server` and `trellis/client` for backward compatibility. It will be removed in a future major version.

### `src/garden/` — Idea Garden

Detects abandoned work using three heuristics, then exposes a query API.

```typescript
import { detectClusters, IdeaGarden } from './src/garden/index.js';

const clusters = detectClusters(ops, milestonedHashes);
const garden = new IdeaGarden(ops, milestones);

garden.search({ file: 'auth.ts', status: 'abandoned', limit: 10 });
garden.stats(); // { total, abandoned, draft, revived, totalOps, totalFiles }
garden.revive('cluster:abc');
```

### Platform Subsystem Guides

The following sections provide detailed guides for Trellis' internal subsystems. These are useful if you're contributing to the platform or extending its capabilities.

#### Knowledge Graph & Wiki-Links (`src/links/`)

Builds a bidirectional knowledge graph from wiki-link references across all workspace entities.

**Detection heuristics:**

| Heuristic               | Trigger             | Signal                                                            |
| :---------------------- | :------------------ | :---------------------------------------------------------------- |
| `contextSwitchDetector` | File-set pivot      | Group of ops in unrelated dirs followed by a context switch away  |
| `revertDetector`        | Complementary ops   | Ops undone by a subsequent inverse op (add→delete, modify→revert) |
| `staleBranchDetector`   | Time + no milestone | Ops on non-`main` branches untouched >7 days without a milestone  |

#### Semantic Intelligence (`src/semantic/`)

Advanced TypeScript/JavaScript analysis with structural entity extraction and semantic diffing for intelligent code understanding.

```typescript
import { typescriptParser, semanticMerge } from './src/semantic/index.js';

// Parse code into structural entities
const result = typescriptParser.parse(source, 'file.ts');
result.declarations; // ASTEntity[] — functions, classes, interfaces, enums, …
result.imports; // ImportRelation[]
result.exports; // ExportRelation[]

// Compute semantic differences
const patches = typescriptParser.diff(oldResult, newResult);
// SemanticPatch[] — symbolAdd | symbolRemove | symbolModify |
//                   symbolRename | importAdd | importRemove | …

// Intelligent merging with conflict resolution
const merged = semanticMerge(ourPatches, theirPatches, 'file.ts');
merged.clean; // true if no conflicts
merged.patches; // Merged patch list
merged.conflicts; // SemanticMergeConflict[] — entity-level, with suggestions
```

### `src/sync/` — Peer Sync

Implements the have→want→ops→ack protocol with linear and CRDT branch modes.

```typescript
import { SyncEngine, MemoryTransport, reconcile } from './src/sync/index.js';

// Standalone CRDT reconciler
const result = reconcile(localOps, remoteOps);
result.merged; // Interleaved by timestamp
result.forkPoint; // Last common op hash
result.conflicts; // File-level conflicts

// Full sync engine
const transport = new MemoryTransport('peer-a', 'Alice');
const engine = new SyncEngine({
  localPeerId: 'peer-a',
  transport,
  getLocalOps: () => ops,
  onOpsReceived: (newOps) => {
    /* integrate */
  },
  branchPolicy: { linear: false }, // CRDT mode
});

await engine.pushTo('peer-b');
await engine.pullFrom('peer-b');
engine.reconcileWith(remoteOps);
```

#### Collaboration & Sync (`src/sync/`)

Enterprise-grade synchronization with CRDT reconciliation, multiple transport protocols, and multi-repo federation for distributed teams.

```typescript
import {
  SyncEngine,
  MemoryTransport,
  reconcile,
  HttpSyncTransport,
  WebSocketSyncTransport,
  MultiRepoManager,
  formatCrossRepoRef,
} from './src/sync/index.js';

// CRDT reconciler for conflict-free merging
const result = reconcile(localOps, remoteOps);
result.merged; // Interleaved by timestamp
result.forkPoint; // Last common op hash
result.conflicts; // File-level conflicts

// HTTP transport for network sync
const httpTransport = new HttpSyncTransport('peer-a');
httpTransport.addPeer('peer-b', 'http://192.168.1.10:4200');

// WebSocket transport for real-time collaboration
const wsTransport = new WebSocketSyncTransport('peer-a');
await wsTransport.connect('peer-b', 'ws://192.168.1.10:4201');

// Multi-repo federation — connect knowledge across repositories
const repoManager = new MultiRepoManager(kernel);
await repoManager.linkRepo(
  'backend',
  '/path/to/backend-api',
  'Backend service',
);
await repoManager.addCrossRepoLink(
  'proj:frontend',
  'dependsOn',
  'backend',
  'lib:api-client',
);
// Creates: proj:frontend --dependsOn--> @backend:lib:api-client

// Discover cross-repository relationships
const refs = repoManager.findReferencesTo('backend', 'lib:api-client');
```

These subsystem guides provide insight into Trellis' internal architecture. They're particularly useful for platform contributors, extenders, or those building custom integrations.

---

## How It Works

### Init Flow

```
trellis init
  → mkdirSync .trellis/
  → write config.json (agentId, defaultBranch, ignorePatterns)
  → create vcs:branchCreate op for "main"
  → scan filesystem → create vcs:fileAdd op per file
  → flush ops to .trellis/ops.json
```

### Watch Flow

```
trellis watch
  → FileWatcher.scan() populates known-files map
  → FileWatcher.start() sets up Bun fs.watch
  → on change → debounce → SHA-256 hash → emit FileChangeEvent
  → Ingestion.process(event) → createVcsOp(kind, payload)
  → engine.applyOp(op) → EAV store + op log
  → auto-checkpoint if threshold crossed
```

### Milestone Flow

```
trellis milestone create -m "Add auth"
  → auto-detect fromOpHash (last milestone's toOpHash + 1)
  → collect affected files from ops in range
  → createVcsOp('vcs:milestoneCreate', { message, fromOpHash, toOpHash, affectedFiles })
  → optional: trellis export → Git commit
```

### Semantic Diff Flow

```
trellis sdiff old.ts new.ts
  → typescriptParser.parse(old) → ParseResult { declarations, imports, exports }
  → typescriptParser.parse(new) → ParseResult
  → typescriptParser.diff(old, new) → SemanticPatch[]
    - symbolAdd / symbolRemove / symbolModify
    - symbolRename (detected via signature similarity)
    - importAdd / importRemove / importModify
```

### Sync / Reconcile Flow

```
Engine A sends 'have' { heads: { main: 'h42' }, opCount: 42 }
  → Engine B compares to its own heads
  → B sends 'want' { afterHash: 'h38' }
  → A sends 'ops' [ op39, op40, op41, op42 ]
  → B integrates new ops (linear: filter dupes; CRDT: reconcile())
  → B sends 'ack' { integrated: ['h39', …] }
```

---

## Design Doc

See [`DESIGN.md`](./DESIGN.md) for the complete platform architecture specification, including:

- §3 — Causal stream and branch concurrency model
- §4 — Semantic patching: parser adapter interface, patch types, commutativity
- §5 — Milestone narrative model
- §6 — Identity, signing, and governance
- §7 — Idea Garden cluster detection heuristics
- §8 — Knowledge graph and wiki-link system
- §9 — Embeddings and semantic search architecture
- §10 — Decision trace capture and querying
- §11 — Sync protocols and multi-repo federation
- §12 — Core graph kernel and ontology system
- §13 — Agent harness and plugin architecture
- §14 — Open questions and architectural trade-offs

---

## Development & Releases

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.0
- No other native dependencies

### Install

```bash
bun install
```

### Test

```bash
just test-core
# or run the full suite when working on those areas:
bun test
```

**The release flow currently validates against the targeted passing core suite.**

### Typecheck

```bash
bun run typecheck
```

### Build

```bash
# Build for npm (bun build → dist/)
bun run build

# Run CLI directly during development
bun run src/cli/index.ts <command>
```

---

### Release Workflow

```bash
# Validate locally without publishing
just publish-dry-run

# Publish to npm locally, then tag/push/create release metadata
just publish
```

> **Requires [Bun](https://bun.sh) ≥ 1.0** — Trellis uses `bun:sqlite` for the vector store and Bun's native TypeScript support for optimal performance.

---

## Roadmap

| Phase | Deliverable                                     | Status | Commit    |
| :---- | :---------------------------------------------- | :----- | :-------- |
| P0    | Causal stream + CLI                             | ✅     | `51475d3` |
| P0.5  | VS Code extension / visual timeline             | ✅     | `947d5a1` |
| P1    | Git import bridge                               | ✅     | `f4cc4a6` |
| P2    | Branches, milestones, checkpoints               | ✅     | `3f91e9a` |
| P2.5  | Blob store, engine modularization, git exporter | ✅     | `5c43a31` |
| P3    | File-level diff + text-based merge              | ✅     | `c953654` |
| P4    | Identity + op signing + governance              | ✅     | `3acddda` |
| P5    | Idea Garden — cluster detection + query         | ✅     | `105a207` |
