---
title: TrellisVCS Architecture Design
description: Design document for the TrellisVCS subsystem — causal streams, branches, milestones, and merge.
created: 2026-05-30
updated: 2026-05-30
---

# TrellisVCS: Architecture Design

**Version:** 0.1.0-draft
**Date:** March 2026
**Status:** Design Phase

TrellisVCS is a graph-native, code-first version control system built on top of the Trellis semantic kernel. It replaces Git's file-centric snapshot model with a queryable semantic graph where code structure (functions, classes, modules) is represented as first-class entities, changes are recorded as a continuous causal stream, and history is both an immutable ledger and a curated narrative.

This document maps each of the [Five Pillars](./PILLARS.md) onto the existing `trellis-core` kernel and defines the extensions needed to realize TrellisVCS.

---

## Table of Contents

1. [Kernel Primitive Audit](#1-kernel-primitive-audit)
2. [VCS Data Model](#2-vcs-data-model)
3. [Pillar 1: The Causal Stream](#3-pillar-1-the-causal-stream)
4. [Pillar 2: Semantic Patching](#4-pillar-2-semantic-patching)
5. [Pillar 3: Narrative Milestones](#5-pillar-3-narrative-milestones)
6. [Pillar 4: The Governance Subgraph](#6-pillar-4-the-governance-subgraph)
7. [Pillar 5: The Idea Garden](#7-pillar-5-the-idea-garden)
8. [Module Layout](#8-module-layout)
9. [Layered Ingestion Strategy](#9-layered-ingestion-strategy)
10. [Open Questions & Risks](#10-open-questions--risks)

---

## 1. Kernel Primitive Audit

The trellis-core kernel already provides several primitives that map directly to VCS concepts. This section identifies what we can reuse as-is, what needs extension, and what is missing entirely.

### 1.1 Primitive Mapping

| Kernel Primitive      | Location                            | VCS Role                                                                                                                                                    | Reuse Status                                                                                                                                |
| :-------------------- | :---------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------ |
| `KernelOp`            | `src/persist/backend.ts`            | **Causal stream atom.** Each VCS change becomes an op in the append-only log. Content-addressed via SHA-256, causally chained via `previousHash`.           | **Extend** — add new `kind` variants for VCS-specific operations.                                                                           |
| `KernelBackend`       | `src/persist/backend.ts`            | **Durable storage.** SQLite backend already provides `append`, `readAll`, `readUntil`, `readAfter`, `readUntilTimestamp`, and snapshot support.             | **Reuse as-is** — the interface is sufficient for the causal stream. May need a secondary index for branch-scoped reads.                    |
| `SqliteKernelBackend` | `src/persist/sqlite-backend.ts`     | **Local persistence.** WAL-mode SQLite with ops table and snapshots table.                                                                                  | **Extend** — add tables/indexes for branch pointers, milestone metadata, and file-hash lookups.                                             |
| `EAVStore`            | `src/store/eav-store.ts`            | **In-memory graph.** Repository structure (files, directories, AST nodes) lives here as facts and links. Triple indexes (EAV, AEV, AVE) enable fast lookup. | **Reuse as-is** — the EAV model naturally represents file trees, code structure, and VCS metadata.                                          |
| `Fact` / `Link`       | `src/store/eav-store.ts`            | **Graph atoms.** `Fact{e, a, v}` models entity attributes. `Link{e1, a, e2}` models relationships (file→directory, function→module, milestone→op-range).    | **Reuse as-is.**                                                                                                                            |
| `jsonEntityFacts`     | `src/store/eav-store.ts`            | **Ingestion.** Converts JSON objects into EAV facts with path-aware flattening. Used to ingest file metadata, AST node properties, etc.                     | **Reuse as-is** for metadata. Code-structure ingestion needs a parser adapter (see §9).                                                     |
| `KernelMiddleware`    | `src/kernel/middleware.ts`          | **Policy enforcement.** Intercepts ops (mutations) and queries. Maps directly to governance policies, schema validation, and access control.                | **Reuse as-is** — the `handleOp` / `handleQuery` / `next` chain is exactly the hook point for branch protection, signing requirements, etc. |
| `SecurityMiddleware`  | `src/kernel/security-middleware.ts` | **Capability-based auth.** Already implements agent-based `can(capability)` checks on mutations and queries.                                                | **Extend** — add VCS-specific capabilities (`push`, `merge`, `createBranch`, `createMilestone`).                                            |
| `SyncProvider`        | `src/kernel/sync.ts`                | **P2P replication.** `broadcast(op)` and `onRemoteOp(callback)` enable distributed op propagation.                                                          | **Reuse as-is** — the interface is sync-transport-agnostic. Iroh integration is already a declared dependency.                              |
| `TrellisKernel`       | `src/kernel/trellis-kernel.ts`      | **Composition root.** Orchestrates store, backend, middleware, evaluator, and sync. Provides `boot()`, `mutate()`, `query()`, `checkpoint()`, time-travel.  | **Extend** — add VCS-specific high-level methods (`ingest`, `milestone`, `branch`, `merge`, `diff`).                                        |
| `WorkspaceConfig`     | `src/kernel/workspace.ts`           | **Declarative config.** `.trellis` files define ontologies, projections, and graph data.                                                                    | **Extend** — add VCS-specific workspace fields (tracked paths, ignore patterns, branch policies).                                           |
| `EQL-S` / `Datalog`   | `src/query/`                        | **Query layer.** Structured queries over the graph.                                                                                                         | **Reuse as-is** — VCS queries ("find all milestones that touched module X") compile to existing EQL-S/Datalog.                              |

### 1.2 Gaps: What's Missing

| Gap                        | Description                                                                                                                                                           | Pillar |
| :------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----- |
| **VCS op kinds**           | `KernelOpKind` only has `addFacts`/`addLinks`/`deleteFacts`/`deleteLinks`. VCS needs higher-level semantic ops (`fileAdd`, `fileModify`, `rename`, `astPatch`, etc.). | 1, 2   |
| **Branch model**           | No concept of branches/refs. Need branch pointers as graph entities that reference op-chain heads.                                                                    | 1, 3   |
| **File-system bridge**     | No file watcher or ingestion pipeline from disk → graph.                                                                                                              | 1, 9   |
| **AST parser adapter**     | No code-structure decomposition. Need a pluggable parser interface (tree-sitter).                                                                                     | 2, 9   |
| **Diff / merge engine**    | No mechanism to compare two graph states or reconcile divergent op chains.                                                                                            | 2      |
| **Milestone entity type**  | No concept of curated history markers.                                                                                                                                | 3      |
| **Identity model**         | `agentId` is an opaque string. Need cryptographic identity (key pairs, DIDs).                                                                                         | 4      |
| **Idea cluster detection** | No heuristics for identifying un-milestoned op ranges.                                                                                                                | 5      |

---

## 2. VCS Data Model

TrellisVCS models everything — repositories, files, code structure, branches, milestones — as entities in the Trellis EAV graph. This section defines the entity types, their attributes, and the links between them.

### 2.1 Entity Type Hierarchy

```
Repository
├── Workspace          (a checked-out view / branch context)
├── Branch             (a named pointer into the causal stream)
├── Milestone          (a curated marker on the causal stream)
├── Checkpoint         (an auto-generated stable-state marker)
├── Identity           (a cryptographic actor)
│
├── FileNode           (a tracked file)
├── DirectoryNode      (a tracked directory)
│
└── [Tier 2: AST-level entities]
    ├── ModuleDef      (a source module / file's semantic root)
    ├── FunctionDef    (a function or method)
    ├── ClassDef       (a class or struct)
    ├── ImportDecl     (an import statement)
    └── SymbolRef      (a reference to a named symbol)
```

### 2.2 EAV Fact Schema

Every entity is stored as a set of `Fact{e, a, v}` triples. Below are the attributes for each entity type.

#### Repository

| Entity ID     | Attribute       | Value          | Example                   |
| :------------ | :-------------- | :------------- | :------------------------ |
| `repo:{uuid}` | `type`          | `"Repository"` |                           |
|               | `name`          | string         | `"my-project"`            |
|               | `rootPath`      | string         | `"/Users/dev/my-project"` |
|               | `createdAt`     | ISO string     | `"2026-03-29T..."`        |
|               | `defaultBranch` | EntityRef      | `"branch:main"`           |

#### Branch

| Entity ID       | Attribute    | Value      | Example                  |
| :-------------- | :----------- | :--------- | :----------------------- |
| `branch:{name}` | `type`       | `"Branch"` |                          |
|                 | `name`       | string     | `"main"`                 |
|                 | `headOpHash` | string     | `"trellis:op:abc123..."` |
|                 | `baseOpHash` | string     | `"trellis:op:def456..."` |
|                 | `createdAt`  | ISO string |                          |
|                 | `createdBy`  | EntityRef  | `"identity:alice"`       |

#### FileNode

| Entity ID          | Attribute      | Value        | Example                 |
| :----------------- | :------------- | :----------- | :---------------------- |
| `file:{path-hash}` | `type`         | `"FileNode"` |                         |
|                    | `path`         | string       | `"src/utils/math.ts"`   |
|                    | `contentHash`  | string       | SHA-256 of file content |
|                    | `size`         | number       | `2048`                  |
|                    | `language`     | string       | `"typescript"`          |
|                    | `lastModified` | ISO string   |                         |

#### DirectoryNode

| Entity ID         | Attribute | Value             | Example        |
| :---------------- | :-------- | :---------------- | :------------- |
| `dir:{path-hash}` | `type`    | `"DirectoryNode"` |                |
|                   | `path`    | string            | `"src/utils/"` |

#### Milestone

| Entity ID          | Attribute         | Value         | Example                          |
| :----------------- | :---------------- | :------------ | :------------------------------- |
| `milestone:{hash}` | `type`            | `"Milestone"` |                                  |
|                    | `message`         | string        | `"fix: handle null auth tokens"` |
|                    | `fromOpHash`      | string        | Start of op range                |
|                    | `toOpHash`        | string        | End of op range                  |
|                    | `createdAt`       | ISO string    |                                  |
|                    | `createdBy`       | EntityRef     | `"identity:alice"`               |
|                    | `parentMilestone` | EntityRef     | `"milestone:{prev-hash}"`        |

#### Checkpoint

| Entity ID           | Attribute   | Value          | Example                        |
| :------------------ | :---------- | :------------- | :----------------------------- |
| `checkpoint:{hash}` | `type`      | `"Checkpoint"` |                                |
|                     | `trigger`   | string         | `"green-build"` / `"interval"` |
|                     | `atOpHash`  | string         | Op hash at checkpoint time     |
|                     | `createdAt` | ISO string     |                                |

#### Identity

| Entity ID                | Attribute     | Value        | Example             |
| :----------------------- | :------------ | :----------- | :------------------ |
| `identity:{fingerprint}` | `type`        | `"Identity"` |                     |
|                          | `displayName` | string       | `"Alice"`           |
|                          | `publicKey`   | string       | Ed25519 public key  |
|                          | `did`         | string       | `"did:key:z6Mk..."` |

### 2.3 Link Schema

Links (`Link{e1, a, e2}`) model relationships between entities.

| Source        | Relation        | Target                   | Meaning                         |
| :------------ | :-------------- | :----------------------- | :------------------------------ |
| `repo:*`      | `contains`      | `branch:*`               | Repository has branch           |
| `repo:*`      | `defaultBranch` | `branch:*`               | Default branch pointer          |
| `branch:*`    | `hasMilestone`  | `milestone:*`            | Branch contains milestone       |
| `milestone:*` | `parent`        | `milestone:*`            | Milestone parentage (DAG)       |
| `milestone:*` | `createdBy`     | `identity:*`             | Authorship                      |
| `milestone:*` | `attestedBy`    | `identity:*`             | Review/CI attestation           |
| `dir:*`       | `contains`      | `file:*` / `dir:*`       | Directory tree structure        |
| `file:*`      | `definedIn`     | `module:*`               | File → AST module root (Tier 2) |
| `module:*`    | `exports`       | `function:*` / `class:*` | Module → declarations (Tier 2)  |
| `function:*`  | `calls`         | `function:*`             | Call graph edge (Tier 2)        |
| `class:*`     | `extends`       | `class:*`                | Inheritance edge (Tier 2)       |
| `file:*`      | `imports`       | `file:*`                 | Import dependency (Tier 2)      |

### 2.4 Extended Operation Kinds

The existing `KernelOpKind` is extended with VCS-specific variants. Each new kind is a higher-level semantic operation that decomposes into underlying `addFacts`/`deleteFacts`/`addLinks`/`deleteLinks` when applied to the store.

```typescript
type VcsOpKind =
  // Tier 0: File-level operations
  | 'vcs:fileAdd' // New file tracked
  | 'vcs:fileModify' // File content changed
  | 'vcs:fileDelete' // File removed
  | 'vcs:fileRename' // File moved/renamed (preserves entity identity)
  // Tier 1: Structural operations
  | 'vcs:dirAdd' // Directory created
  | 'vcs:dirDelete' // Directory removed
  // Tier 2: AST-level semantic patches (future)
  | 'vcs:symbolRename' // Rename a symbol across scope
  | 'vcs:symbolMove' // Move a declaration to another file
  | 'vcs:symbolExtract' // Extract code into a new function/class
  | 'vcs:signatureChange' // Change a function's type signature
  // VCS control operations
  | 'vcs:branchCreate' // Create a new branch
  | 'vcs:branchDelete' // Delete a branch
  | 'vcs:branchAdvance' // Move a branch head pointer forward
  | 'vcs:milestoneCreate' // Mark a milestone on the stream
  | 'vcs:checkpointCreate' // Auto-mark a checkpoint
  | 'vcs:merge'; // Reconcile two branches
```

These VCS op kinds carry structured payloads rather than raw facts:

```typescript
interface VcsOp extends KernelOp {
  kind: KernelOpKind | VcsOpKind;

  // VCS-specific payload (present when kind starts with 'vcs:')
  vcs?: {
    // File operations
    filePath?: string;
    oldFilePath?: string; // for renames
    contentHash?: string; // SHA-256 of new content
    oldContentHash?: string; // SHA-256 of previous content
    rawDiff?: string; // unified diff (Tier 0 fallback)

    // Branch operations
    branchName?: string;
    targetOpHash?: string;
    sourceBranch?: string;

    // Milestone operations
    milestoneId?: string;
    message?: string;
    fromOpHash?: string;
    toOpHash?: string;

    // AST operations (Tier 2)
    symbolId?: string;
    oldName?: string;
    newName?: string;
    sourceFile?: string;
    targetFile?: string;

    // Signature
    signature?: string; // Ed25519 signature over op hash
    signedBy?: string; // identity entity ref
  };
}
```

### 2.5 How VCS Ops Decompose

When a `VcsOp` is applied to the kernel, a **VCS middleware** decomposes it into primitive store operations. This keeps the core `EAVStore` unchanged while adding semantic meaning at the op layer.

Example — `vcs:fileAdd` for `src/utils/math.ts`:

```
Input op:
  kind: 'vcs:fileAdd'
  vcs: { filePath: 'src/utils/math.ts', contentHash: 'sha256:abc...' }

Decomposed into:
  1. addFacts([
       { e: 'file:h(src/utils/math.ts)', a: 'type',        v: 'FileNode' },
       { e: 'file:h(src/utils/math.ts)', a: 'path',        v: 'src/utils/math.ts' },
       { e: 'file:h(src/utils/math.ts)', a: 'contentHash', v: 'sha256:abc...' },
       { e: 'file:h(src/utils/math.ts)', a: 'language',    v: 'typescript' },
     ])
  2. addLinks([
       { e1: 'dir:h(src/utils/)', a: 'contains', e2: 'file:h(src/utils/math.ts)' },
     ])
```

Example — `vcs:fileRename` from `src/old.ts` to `src/new.ts`:

```
Input op:
  kind: 'vcs:fileRename'
  vcs: { filePath: 'src/new.ts', oldFilePath: 'src/old.ts' }

Decomposed into:
  1. deleteFacts([ { e: 'file:h(src/old.ts)', a: 'path', v: 'src/old.ts' } ])
  2. addFacts([ { e: 'file:h(src/old.ts)', a: 'path', v: 'src/new.ts' } ])
  3. deleteLinks([ { e1: 'dir:h(src/)', a: 'contains', e2: 'file:h(src/old.ts)' } ])
  4. addLinks([ { e1: 'dir:h(src/)', a: 'contains', e2: 'file:h(src/new.ts)' } ])

Note: The entity ID does NOT change. 'file:h(src/old.ts)' retains its identity
even though its path attribute changed. This is the key insight — identity
tracking survives renames.
```

---

## 3. Pillar 1: The Causal Stream

> A fine-grained, immutable ledger of every semantic change.

### 3.1 Design Principle

The causal stream is the **append-only backbone** of TrellisVCS. Every change — from a file save to a branch creation — is recorded as a `VcsOp` in the stream. The stream is:

- **Immutable** — ops are never modified or deleted.
- **Causally ordered** — each op references its predecessor via `previousHash`.
- **Content-addressed** — each op's hash covers its content + causal link.
- **Agent-attributed** — every op carries an `agentId` (human or CI).

### 3.2 Mapping to Kernel

The causal stream maps directly onto the existing `KernelBackend` interface:

```
Causal Stream Concept    →  Kernel Primitive
──────────────────────────────────────────────
Stream                   →  ops table in SqliteKernelBackend
Append                   →  backend.append(op)
Read full history        →  backend.readAll()
Read up to a point       →  backend.readUntil(hash)
Read from a point        →  backend.readAfter(hash)
Read by time             →  backend.readUntilTimestamp(iso)
Latest state             →  backend.getLastOp()
Snapshot for fast boot   →  backend.saveSnapshot() / loadLatestSnapshot()
```

**No changes to `KernelBackend` are required** for basic causal stream functionality. The interface already supports everything we need.

### 3.3 File Watcher → Op Emitter Pipeline

The bridge between the filesystem and the causal stream is a **watcher pipeline**:

```
[Filesystem]                [Watcher]              [Ingestion]           [Kernel]
     │                          │                       │                    │
     │  fs.watch / chokidar     │                       │                    │
     │ ───────────────────────> │                       │                    │
     │                          │  debounce + filter    │                    │
     │                          │ ────────────────────> │                    │
     │                          │                       │  hash content      │
     │                          │                       │  detect op kind    │
     │                          │                       │  create VcsOp      │
     │                          │                       │ ─────────────────> │
     │                          │                       │                    │  kernel.mutate(op)
     │                          │                       │                    │  → VcsMiddleware
     │                          │                       │                    │  → decompose to facts
     │                          │                       │                    │  → store + persist
```

```typescript
interface FileWatcherConfig {
  rootPath: string;
  ignorePatterns: string[]; // e.g. ['node_modules', '.git', '*.log']
  debounceMs: number; // default: 300
  hashAlgorithm: 'sha256';
}

interface FileChangeEvent {
  type: 'add' | 'modify' | 'delete' | 'rename';
  path: string;
  oldPath?: string; // for renames
  contentHash?: string; // for add/modify
  timestamp: string;
}
```

The watcher's responsibilities:

1. **Debounce** rapid saves into a single change event.
2. **Filter** ignored paths (node_modules, build artifacts, etc.).
3. **Detect renames** — correlate a delete + add of identical content hashes.
4. **Hash content** — compute SHA-256 of file content for change detection.
5. **Emit `FileChangeEvent`s** to the ingestion layer.

### 3.4 Granularity Tiers

The causal stream operates at increasing levels of granularity:

| Tier  | Granularity    | Op Kinds                                                         | Captured Info                                                   | When Available          |
| :---- | :------------- | :--------------------------------------------------------------- | :-------------------------------------------------------------- | :---------------------- |
| **0** | File-as-blob   | `fileAdd`, `fileModify`, `fileDelete`, `fileRename`              | Path, content hash, size, timestamp                             | Day one                 |
| **1** | File-as-entity | Same as Tier 0 + line-level metadata                             | Path, content hash, line count, language, line-level diff hunks | Day one (enhanced)      |
| **2** | AST-as-graph   | `symbolRename`, `symbolMove`, `symbolExtract`, `signatureChange` | AST node identities, structural diffs, cross-file refactors     | Requires parser adapter |

Tiers are **additive** — Tier 2 ops coexist with Tier 0 ops in the same stream. A file change might be recorded as both a `vcs:fileModify` (Tier 0) and a `vcs:symbolRename` (Tier 2) for richer queryability. The Tier 0 op is always present as a fallback.

### 3.5 Branch-Scoped Streams

Each branch maintains a pointer to its head op in the causal stream:

```
main:       [op1] ← [op2] ← [op3] ← [op4]  ← HEAD(main)
                                 ↖
feature-x:                        [op5] ← [op6]  ← HEAD(feature-x)
```

A branch is a graph entity with a `headOpHash` attribute. "Advancing" a branch is a `vcs:branchAdvance` op that updates this attribute. The kernel's existing `readUntil(hash)` and `readAfter(hash)` methods naturally scope reads to a branch by using the branch's head pointer.

#### Branch Concurrency Policy

Each branch carries a **concurrency mode** flag:

```typescript
interface BranchPolicy {
  /** If true, the branch accepts only fast-forward appends (one writer). */
  /** If false, concurrent appends are allowed and reconciled via CRDT. */
  linear: boolean;
}
```

| Mode            | Behavior                                                                                                                                        | Use Case                                         |
| :-------------- | :---------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------- |
| `linear: true`  | Classic Git behavior — one head, fast-forward only. Push rejected if remote has diverged.                                                       | `main`, release branches, CI-gated branches      |
| `linear: false` | CRDT-style concurrent appends. A background reconciler merges divergent op sub-chains into a consistent state using patch commutativity (§4.4). | Feature branches, multi-device real-time editing |

Ship `linear: true` as the default for P0. The `linear: false` path is the clear upgrade toward the "Live Repository" vision — it requires the merkle-CRDT reconciler but no changes to the `KernelBackend` interface.

For branch-divergence scenarios, we need one new backend method:

```typescript
interface KernelBackend {
  // ... existing methods ...

  /** Find the common ancestor op of two op hashes. */
  findCommonAncestor(hashA: string, hashB: string): KernelOp | undefined;
}
```

This enables three-way comparison for merge operations.

---

## 4. Pillar 2: Semantic Patching

> Understanding code as a tree (AST) rather than lines of text, enabling conflict-free merges.

### 4.1 Design Principle

Instead of treating changes as line diffs, TrellisVCS records changes as **structured semantic patches** that describe _what happened_ in terms of code structure, not text layout. A variable rename across 47 lines is one `vcs:symbolRename` op, not 47 line-level edits.

Semantic patching requires two components:

1. A **parser adapter** that decomposes source files into AST-level graph entities.
2. A **diff/merge engine** that operates on the graph rather than on text.

### 4.2 Parser Adapter Interface

```typescript
interface ParserAdapter {
  /** Languages this adapter supports (e.g. ['typescript', 'javascript']). */
  languages: string[];

  /**
   * Parse a source file into a set of AST-level entities.
   * Each entity gets a stable ID derived from its structural position
   * (not line number) so that identity survives reformatting.
   */
  parse(content: string, filePath: string): ParseResult;

  /**
   * Given two parse results (old and new), compute the minimal set
   * of semantic patches that transform one into the other.
   */
  diff(oldResult: ParseResult, newResult: ParseResult): SemanticPatch[];
}

interface ParseResult {
  /** The file entity this parse belongs to. */
  fileEntityId: string;

  /** Top-level declarations found in the file. */
  declarations: ASTEntity[];

  /** Import/export relationships. */
  imports: ImportRelation[];
  exports: ExportRelation[];
}

interface ASTEntity {
  /** Stable ID derived from structural signature (name + kind + scope path). */
  id: string;

  /** Entity type: 'FunctionDef' | 'ClassDef' | 'InterfaceDef' | 'VariableDecl' | ... */
  kind: string;

  /** Human-readable name. */
  name: string;

  /** Scope path for disambiguation (e.g. 'MyClass.myMethod'). */
  scopePath: string;

  /** Byte range in source for roundtrip (start, end). */
  span: [number, number];

  /** Raw source text of this declaration (for roundtrip fidelity). */
  rawText: string;

  /** Structural signature for identity matching (excludes whitespace/comments). */
  signature: string;

  /** Child entities (nested functions, inner classes, etc.). */
  children: ASTEntity[];
}
```

**Implementation note:** The initial parser adapter would wrap [tree-sitter](https://tree-sitter.github.io/) via its Node/WASM bindings. Tree-sitter provides incremental parsing and grammars for 100+ languages, making it the natural choice.

### 4.3 Semantic Patch Types

```typescript
type SemanticPatch =
  | { kind: 'symbolAdd'; entity: ASTEntity }
  | { kind: 'symbolRemove'; entityId: string }
  | {
      kind: 'symbolModify';
      entityId: string;
      oldSignature: string;
      newSignature: string;
      newRawText: string;
    }
  | { kind: 'symbolRename'; entityId: string; oldName: string; newName: string }
  | { kind: 'symbolMove'; entityId: string; oldFile: string; newFile: string }
  | { kind: 'importAdd'; fileId: string; source: string; specifiers: string[] }
  | { kind: 'importRemove'; fileId: string; source: string }
  | {
      kind: 'importModify';
      fileId: string;
      source: string;
      oldSpecifiers: string[];
      newSpecifiers: string[];
    };
```

### 4.4 Patch Commutativity and Conflict Detection

Two patches **commute** (can be applied in either order with the same result) when they operate on disjoint entities. Two patches **conflict** when they both modify the same entity in incompatible ways.

| Patch A                          | Patch B                 | Commutes? | Resolution                                                                                |
| :------------------------------- | :---------------------- | :-------- | :---------------------------------------------------------------------------------------- |
| `symbolModify(f1)`               | `symbolModify(f2)`      | Yes       | Apply both                                                                                |
| `symbolModify(f1)`               | `symbolModify(f1)`      | **No**    | Structural conflict — present both versions                                               |
| `symbolRename(f1, "old", "new")` | `symbolModify(f1)`      | **No**    | The modify references the old name — auto-resolve by applying rename to the modified body |
| `symbolMove(f1, A→B)`            | `symbolModify(f1)`      | Yes       | Apply modify to f1 at its new location                                                    |
| `symbolRemove(f1)`               | `symbolModify(f1)`      | **No**    | Delete/edit conflict — requires human decision                                            |
| `importAdd(fileX, mod)`          | `importAdd(fileX, mod)` | Yes       | Deduplicate (idempotent)                                                                  |

The merge engine computes commutativity by checking entity ID overlap between patch sets. When patches don't commute, it produces a **structured conflict** (not `<<<<<<<` text markers) that names the entities and operations involved:

```typescript
interface MergeConflict {
  entityId: string;
  entityName: string;
  entityKind: string;
  filePath: string;
  ours: SemanticPatch;
  theirs: SemanticPatch;
  suggestion?: 'accept-ours' | 'accept-theirs' | 'combine';
}
```

### 4.5 Diff Engine

The graph-native diff compares two graph states (identified by op hashes or branch heads) and produces a list of semantic patches:

```typescript
interface DiffResult {
  /** Patches to transform state A into state B. */
  patches: SemanticPatch[];

  /** Files affected. */
  filesChanged: string[];

  /** Summary statistics. */
  stats: {
    added: number;
    modified: number;
    removed: number;
    renamed: number;
    moved: number;
  };
}
```

At Tier 0 (before AST parsing is available), the diff engine falls back to file-level comparison:

```typescript
interface FileLevelDiff {
  kind: 'fileAdded' | 'fileModified' | 'fileDeleted' | 'fileRenamed';
  path: string;
  oldPath?: string;
  oldContentHash?: string;
  newContentHash?: string;
  unifiedDiff?: string; // classic unified diff as fallback
}
```

---

## 5. Pillar 3: Narrative Milestones

> Human-curated "stories" that sit on top of the stream for collaboration and clarity.

### 5.1 The Three-Tier History Model

TrellisVCS separates history into three tiers of significance:

```
┌─────────────────────────────────────────────────────┐
│  NARRATIVE LAYER (human-curated)                    │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐         │
│  │Milestone│───>│Milestone│───>│Milestone│         │
│  │ "init"  │    │"feature"│    │"bugfix" │         │
│  └────┬────┘    └────┬────┘    └────┬────┘         │
│       │              │              │               │
│  ─────┼──────────────┼──────────────┼───────────── │
│  STABILITY LAYER (auto-generated)                   │
│   [ckpt]         [ckpt]  [ckpt]   [ckpt]          │
│       │              │              │               │
│  ─────┼──────────────┼──────────────┼───────────── │
│  CAUSAL LAYER (continuous)                          │
│  [op][op][op][op][op][op][op][op][op][op][op][op]  │
└─────────────────────────────────────────────────────┘
```

| Layer         | Unit         | Created By                        | Frequency                  | Purpose                           |
| :------------ | :----------- | :-------------------------------- | :------------------------- | :-------------------------------- |
| **Causal**    | `VcsOp`      | System (file watcher)             | Every save / change        | Immutable record of everything    |
| **Stability** | `Checkpoint` | System (on green build, interval) | Every stable state         | Fast restore points, bisection    |
| **Narrative** | `Milestone`  | Human (guided by system)          | Every logical unit of work | Collaboration, review, deployment |

### 5.2 Milestone Operations

Creating a milestone:

```typescript
// User creates a milestone covering their recent work
await kernel.mutate(
  createVcsOp('vcs:milestoneCreate', {
    agentId: 'identity:alice',
    vcs: {
      milestoneId: 'milestone:' + hash,
      message: 'fix: handle null auth tokens',
      fromOpHash: 'trellis:op:start...', // start of op range
      toOpHash: 'trellis:op:end...', // end of op range (current head)
    },
  }),
);
```

This decomposes into:

1. `addFacts` for the milestone entity (message, timestamps, op range).
2. `addLinks` for milestone→branch, milestone→parentMilestone, milestone→identity.

### 5.3 Milestone Querying

Because milestones are graph entities, they're queryable via standard EQL-S:

```sql
-- Find all milestones by Alice on the main branch
FIND Milestone AS ?m
WHERE ?m.createdBy = "identity:alice"
RETURN ?m.message, ?m.createdAt
ORDER BY ?m.createdAt DESC

-- Find milestones that touched a specific file
FIND Milestone AS ?m
WHERE ?m.affectsFile = "src/auth/provider.ts"
RETURN ?m.message, ?m.createdBy
```

The `affectsFile` attribute would be computed by the VCS middleware when a milestone is created — it inspects the ops in the milestone's range and extracts the set of affected file paths, storing them as multi-valued facts on the milestone entity.

### 5.4 Auto-Proposed Milestones

The system can propose milestones by detecting logical boundaries in the causal stream:

```typescript
interface MilestoneProposal {
  fromOpHash: string;
  toOpHash: string;
  suggestedMessage: string; // AI-drafted from semantic patches
  confidence: number; // 0-1
  reason: string; // e.g. "Tests passed after 12 patches to auth module"
  affectedFiles: string[];
}

interface MilestoneProposalStrategy {
  name: string;
  evaluate(recentOps: VcsOp[]): MilestoneProposal | null;
}
```

Built-in strategies:

- **Green-build boundary** — Propose after tests pass following a series of changes.
- **Context-switch detector** — Propose when the user starts editing a different module.
- **Time-based** — Propose after N minutes of continuous work without a milestone.
- **Size-based** — Propose after N ops accumulate without a milestone.

### 5.5 CLI Sketch

```bash
# Work, work, work... (causal stream records everything)

# See what's happened since last milestone
trellis status

# Create a milestone from recent work
trellis milestone create --message "fix: handle null auth tokens"

# Create a milestone from a specific time range
trellis milestone create --from "30 minutes ago" --message "refactor auth"

# List milestones
trellis milestone list

# Show the semantic diff for a milestone
trellis milestone show <milestone-id>

# Share milestones with peers
trellis push
```

---

## 6. Pillar 4: The Governance Subgraph

> Identity and permissions built directly into the data structure, not a third-party server.

### 6.1 Identity Model

Every actor (human, CI runner, bot) is an `Identity` entity in the graph with a cryptographic key pair.

```typescript
interface IdentityConfig {
  displayName: string;
  keyPair: {
    publicKey: Uint8Array; // Ed25519
    privateKey: Uint8Array; // Ed25519 (local only, never synced)
  };
  did: string; // did:key:z6Mk... derived from public key
}
```

The private key is stored locally (outside the graph). The public key and DID are graph entities that get replicated to peers.

### 6.2 Op Signing

Every op can be cryptographically signed by its author:

```typescript
// In VcsOp.vcs:
signature?: string;         // Ed25519 signature over op hash
signedBy?: string;          // identity entity ref
```

A **signing middleware** verifies signatures on incoming remote ops:

```typescript
class SignatureVerificationMiddleware implements KernelMiddleware {
  name = 'signature-verification';

  async handleOp(op: KernelOp, ctx: MiddlewareContext, next: OpMiddlewareNext) {
    // Skip verification for local ops (signed on creation)
    if (!ctx.remote) return next(op, ctx);

    const vcsOp = op as VcsOp;
    if (vcsOp.vcs?.signature && vcsOp.vcs?.signedBy) {
      const identity = this.resolveIdentity(vcsOp.vcs.signedBy);
      const valid = await verify(
        vcsOp.hash,
        vcsOp.vcs.signature,
        identity.publicKey,
      );
      if (!valid) throw new Error(`Invalid signature on op ${op.hash}`);
    }

    return next(op, ctx);
  }
}
```

### 6.3 Policy Nodes

Branch protection and governance rules are expressed as **Policy** entities in the graph:

```typescript
interface PolicyRule {
  /** What this policy protects. */
  target: 'branch' | 'path' | 'entityType';
  targetPattern: string; // e.g. 'main', 'src/auth/**', 'Milestone'

  /** What action requires authorization. */
  action: 'push' | 'merge' | 'createMilestone' | 'deleteBranch';

  /** Who is authorized. */
  requiredSigners: string[]; // identity entity refs
  minSignatures: number; // e.g. 2 of 3 maintainers

  /** Optional: CI attestation required. */
  requireAttestation?: {
    type: 'test-pass' | 'build-pass' | 'review-approved';
    from: string; // identity of CI runner
  };
}
```

Stored as EAV facts:

| Entity ID             | Attribute        | Value              |
| :-------------------- | :--------------- | :----------------- |
| `policy:protect-main` | `type`           | `"Policy"`         |
|                       | `target`         | `"branch"`         |
|                       | `targetPattern`  | `"main"`           |
|                       | `action`         | `"push"`           |
|                       | `minSignatures`  | `2`                |
|                       | `requiredSigner` | `"identity:alice"` |
|                       | `requiredSigner` | `"identity:bob"`   |
|                       | `requiredSigner` | `"identity:carol"` |

### 6.4 Governance Middleware

A **governance middleware** enforces policies by intercepting VCS ops:

```typescript
class GovernanceMiddleware implements KernelMiddleware {
  name = 'governance';

  async handleOp(op: KernelOp, ctx: MiddlewareContext, next: OpMiddlewareNext) {
    const vcsOp = op as VcsOp;

    // Find applicable policies
    const policies = this.findPolicies(vcsOp);

    for (const policy of policies) {
      // Check signature requirements
      if (policy.minSignatures > 0) {
        const signatures = this.collectSignatures(vcsOp);
        const validSigners = signatures.filter((s) =>
          policy.requiredSigners.includes(s.signedBy),
        );
        if (validSigners.length < policy.minSignatures) {
          throw new Error(
            `Policy ${policy.id} requires ${policy.minSignatures} signatures ` +
              `from [${policy.requiredSigners.join(', ')}], ` +
              `got ${validSigners.length}.`,
          );
        }
      }

      // Check attestation requirements
      if (policy.requireAttestation) {
        // ... verify attestation link on the milestone
      }
    }

    return next(op, ctx);
  }
}
```

This maps cleanly onto the existing `KernelMiddleware` contract — the `handleOp(op, ctx, next)` signature is exactly what we need. The governance middleware slots into the middleware chain alongside the existing `SecurityMiddleware`.

---

## 7. Pillar 5: The Idea Garden

> A permanent, searchable archive of all exploration, making every "abandoned" idea a reusable asset.

### 7.1 Design Principle

In Git, abandoned work (stale branches, stash entries, lost local commits) is effectively invisible. In TrellisVCS, because the causal stream is immutable and every op is preserved, abandoned work remains in the stream. The Idea Garden is a **query layer** over un-milestoned ops that surfaces, clusters, and makes abandoned exploration searchable.

### 7.2 Idea Clusters

An **Idea Cluster** is a contiguous sequence of ops in the causal stream that were never incorporated into a milestone and were later diverged from (the user switched to different work).

```typescript
interface IdeaCluster {
  id: string;
  ops: VcsOp[];
  firstOp: string; // hash of first op in cluster
  lastOp: string; // hash of last op in cluster
  affectedFiles: string[];
  affectedSymbols: string[]; // Tier 2
  estimatedIntent: string; // AI-generated summary (stored as EAV fact)
  intentEmbedding?: number[]; // Vector embedding for semantic search
  createdAt: string; // timestamp of first op
  abandonedAt: string; // timestamp when user diverged
  status: 'abandoned' | 'draft' | 'revived';
}
```

### 7.3 Intent Summarization

`estimatedIntent` is stored as a **materialized EAV fact** on the cluster entity, not computed on the fly. A background job handles generation and updates:

1. **Detection trigger:** When the cluster detector (§7.4) identifies a new cluster, it queues an intent summarization job.
2. **LLM call:** The job calls a small LLM (local via Ollama, or remote via the kernel's `NaturalLanguageQueryProvider`) with the cluster's semantic patches as context.
3. **Storage:** The one-sentence summary is written as `{ e: 'cluster:{id}', a: 'estimatedIntent', v: '...' }`. A vector embedding is also stored for semantic search.
4. **Recomputation:** If the cluster's ops change (rare — only on revive/extend), the intent is regenerated.

This turns the garden into a genuine "search your memory" tool — both keyword (`CONTAINS`) and semantic (vector similarity) search work against materialized facts.

### 7.4 Cluster Detection Heuristics

The system identifies idea clusters by analyzing the causal stream:

1. **Context-switch detection:** When the set of files being modified shifts abruptly (e.g., from `src/auth/*` to `src/dashboard/*`), the preceding ops that don't belong to a milestone form a candidate cluster.

2. **Branch abandonment:** When a branch hasn't received a new op in N days, its un-milestoned ops are flagged as an idea cluster.

3. **Revert detection:** When a series of ops is followed by ops that undo them (file content hash returns to a prior value), the reverted ops form a cluster.

```typescript
interface ClusterDetector {
  name: string;
  detect(stream: VcsOp[], milestones: Milestone[]): IdeaCluster[];
}
```

### 7.4 Searching the Garden

Because idea clusters are derived from ops which are graph entities, they're queryable:

```sql
-- "Did I ever try to implement caching in the auth module?"
FIND IdeaCluster AS ?c
WHERE ?c.affectedFile CONTAINS "auth"
  AND ?c.estimatedIntent CONTAINS "caching"
RETURN ?c.estimatedIntent, ?c.createdAt, ?c.affectedFiles
```

For deeper semantic search (e.g., "find abandoned code that does recursive tree traversal"), the system can leverage the AI interop layer:

```typescript
// NL query → search across idea clusters
const results = await kernel.queryNatural(
  'find abandoned attempts at recursive tree traversal',
  { provider: nlProvider },
);
```

### 7.5 Reviving an Idea

Turning an abandoned cluster back into active work:

```bash
# List idea clusters
trellis garden list

# Show details of a cluster
trellis garden show <cluster-id>

# Revive a cluster into a new branch
trellis garden revive <cluster-id> --branch "retry-caching"
```

Reviving replays the cluster's ops onto the current branch head, using the semantic merge engine to handle conflicts with changes that happened since the cluster was abandoned.

### 7.6 Retention Policy

Unlike Git's aggressive garbage collection, TrellisVCS retains all ops by default. Users can set retention policies:

```typescript
interface RetentionPolicy {
  /** Auto-archive clusters older than this. */
  archiveAfterDays?: number;

  /** Compress archived clusters (store only summary + entry point). */
  compressArchived?: boolean;

  /** Never delete. Default: true. */
  neverPurge: boolean;
}
```

---

## 8. Module Layout

### 8.1 Directory Structure

VCS-specific code lives in a new `src/vcs/` module within the TrellisVCS workspace, consuming `trellis-core` as a dependency. This keeps the kernel clean and the VCS layer as an application on top.

```
TrellisVCS/
├── DESIGN.md                    # This document
├── PILLARS.md                   # The Five Pillars
├── SCRATCH.md                   # Design conversations
│
├── trellis-core/                # The semantic kernel (dependency)
│   └── src/
│       ├── store/               # EAV engine
│       ├── query/               # EQL-S + Datalog
│       ├── persist/             # SQLite backend
│       ├── kernel/              # Kernel API + middleware
│       └── ...
│
├── src/                         # TrellisVCS application layer
│   ├── vcs/
│   │   ├── index.ts             # Public surface
│   │   ├── types.ts             # VcsOp, VcsOpKind, entity types
│   │   ├── ops.ts               # VcsOp creation helpers
│   │   ├── decompose.ts         # VcsOp → primitive store ops
│   │   ├── vcs-middleware.ts    # Op decomposition middleware
│   │   ├── branch.ts            # Branch model and operations
│   │   ├── milestone.ts         # Milestone and checkpoint logic
│   │   ├── diff.ts              # Graph-native diff engine
│   │   ├── merge.ts             # Semantic merge engine
│   │   └── README.md
│   │
│   ├── watcher/
│   │   ├── index.ts             # File watcher entry point
│   │   ├── fs-watcher.ts        # Filesystem change detection
│   │   ├── ingestion.ts         # Change event → VcsOp pipeline
│   │   └── README.md
│   │
│   ├── parser/
│   │   ├── index.ts             # Parser adapter interface
│   │   ├── tree-sitter.ts       # Tree-sitter implementation
│   │   └── README.md
│   │
│   ├── identity/
│   │   ├── index.ts             # Identity management
│   │   ├── keys.ts              # Ed25519 key generation and storage
│   │   ├── signing.ts           # Op signing and verification
│   │   └── README.md
│   │
│   ├── governance/
│   │   ├── index.ts             # Policy model
│   │   ├── governance-middleware.ts
│   │   └── README.md
│   │
│   ├── garden/
│   │   ├── index.ts             # Idea Garden query layer
│   │   ├── cluster-detector.ts  # Abandoned cluster heuristics
│   │   └── README.md
│   │
│   ├── cli/
│   │   ├── index.ts             # CLI entry point
│   │   ├── commands/
│   │   │   ├── init.ts
│   │   │   ├── status.ts
│   │   │   ├── milestone.ts
│   │   │   ├── branch.ts
│   │   │   ├── diff.ts
│   │   │   ├── merge.ts
│   │   │   ├── garden.ts
│   │   │   └── push.ts
│   │   └── README.md
│   │
│   └── index.ts                 # TrellisVCS main entry point
│
├── test/
│   ├── vcs/
│   ├── watcher/
│   ├── parser/
│   ├── identity/
│   ├── governance/
│   └── garden/
│
├── package.json
└── tsconfig.json
```

### 8.2 Dependency Direction

```
CLI
 │
 ▼
TrellisVCS (src/vcs/, src/watcher/, src/garden/, etc.)
 │
 ▼
trellis-core (kernel, store, query, persist)
```

The VCS layer depends on the kernel. The kernel **never** depends on VCS-specific code. This means:

- VCS op kinds are defined in the VCS layer, not in `trellis-core/src/persist/backend.ts`.
- The VCS middleware runs in the kernel's middleware chain but is registered by the VCS application, not by the kernel itself.
- The kernel's `KernelOp.kind` type can be widened to `string` (it's already used as a discriminator) to allow VCS-specific kinds without modifying the kernel.

### 8.3 Package Exports

```typescript
// package.json exports (TrellisVCS package)
{
  ".": "./dist/index.js",
  "./vcs": "./dist/vcs/index.js",
  "./watcher": "./dist/watcher/index.js",
  "./parser": "./dist/parser/index.js",
  "./identity": "./dist/identity/index.js",
  "./governance": "./dist/governance/index.js",
  "./garden": "./dist/garden/index.js",
  "./cli": "./dist/cli/index.js"
}
```

---

## 9. Layered Ingestion Strategy

The ingestion layer bridges the gap between the filesystem and the Trellis graph. It operates in three tiers, each building on the previous.

### 9.1 Tier 0: File-as-Blob

**Available:** Day one. No parser required.

The watcher detects file changes and creates `vcs:fileAdd` / `vcs:fileModify` / `vcs:fileDelete` / `vcs:fileRename` ops. Each file is a graph entity identified by a hash of its path.

**What's stored:**

- File path, content hash (SHA-256), size, last modified timestamp.
- Language detection via file extension.
- Directory tree as `DirectoryNode` entities with `contains` links.

**What's queryable:**

- "Which files changed in the last hour?"
- "Who last modified `auth.ts`?"
- "Show me the history of `src/utils/math.ts`."

**Limitations:**

- Diffs are file-level (changed/not changed). No line-level or structural info.
- Merge conflicts require falling back to text-based three-way merge.

### 9.2 Tier 1: File-as-Entity (Enhanced)

**Available:** Day one with minimal extra work.

Builds on Tier 0 by storing additional metadata:

- **Line count** and **line-level diff hunks** as facts on the file entity.
- **Content snippets** (first N lines, function signatures found via regex) for search.
- **Unified diff** stored as an op payload for `vcs:fileModify`.

**What's queryable (additionally):**

- "Which files grew by more than 100 lines this week?"
- "Show me the unified diff for this milestone."
- "Find files that contain 'TODO' in their first 10 lines."

### 9.3 Tier 2: AST-as-Graph

**Available:** After parser adapter implementation.

The parser adapter (§4.2) decomposes each file into AST-level entities:

```
file:h(src/auth/provider.ts)
  │
  ├──[definedIn]──> module:h(src/auth/provider.ts)
  │                   │
  │                   ├──[exports]──> class:AuthProvider
  │                   │                 │
  │                   │                 ├──[exports]──> function:AuthProvider.login
  │                   │                 ├──[exports]──> function:AuthProvider.logout
  │                   │                 └──[exports]──> function:AuthProvider.refresh
  │                   │
  │                   └──[exports]──> function:validateToken
  │
  └──[imports]──> file:h(src/utils/crypto.ts)
```

Each AST entity is a graph node with attributes:

- `name`, `kind`, `scopePath`, `signature` (structural, whitespace-independent)
- `rawText` (exact source text for roundtrip fidelity)
- `span` (byte range in source file)

**What's queryable (additionally):**

- "Show me the evolution of function `AuthProvider.login` across all branches."
- "Which functions call `validateToken`?"
- "Find all classes that implement `SyncProvider`."
- "Did anyone ever try to add a `refresh` method to `AuthProvider`?" (Idea Garden)

### 9.4 Roundtrip Fidelity

A critical requirement: reconstructing the exact file (byte-for-byte) from the graph.

**Strategy:** At all tiers, the **content hash** is stored as a fact on the file entity, and the **raw file content** is stored in a content-addressable blob store (a simple directory of `{hash} → content` files, or a dedicated SQLite table). The graph contains the structural decomposition for querying; the blob store provides the source of truth for file reconstruction.

```
Graph (queryable structure)     Blob Store (byte-exact content)
┌──────────────────────┐        ┌────────────────────┐
│ file entity           │        │ sha256:abc → bytes │
│ ├── path: "auth.ts"  │───────>│ sha256:def → bytes │
│ ├── contentHash: abc  │        │ sha256:ghi → bytes │
│ └── language: ts      │        └────────────────────┘
│                       │
│ function entities     │  (derived from blob, for querying)
│ ├── AuthProvider.login│
│ └── validateToken     │
└──────────────────────┘
```

This dual-storage approach means:

- **Checkout** reads from the blob store (fast, exact).
- **Query/search** reads from the graph (rich, structural).
- The graph is a **derived index** over the blob store — it can be rebuilt from blobs + ops.

---

## 10. Open Questions & Risks

### 10.1 Roundtrip Fidelity at Tier 2

**Risk:** If the graph becomes the primary representation and we reconstruct files from AST entities, whitespace, comments, and formatting may be lost or altered.

**Mitigation:** The blob store remains the source of truth for file content. AST entities store `rawText` for their span, and the parser adapter is responsible for ensuring that concatenating `rawText` spans reproduces the original file. If it can't, we fall back to blob-store reconstruction.

**Open question:** Should the graph ever be authoritative over the blob store, or should it always be a derived index? If always derived, the graph is lossy-safe. If authoritative, we need bit-exact reconstruction guarantees.

**Recommendation:** Graph is always derived. Blob store is authoritative. This eliminates an entire class of bugs.

### 10.2 Parser Coverage

**Risk:** Tree-sitter has grammars for 100+ languages, but quality varies. Some languages (TypeScript, Python, Go) have excellent grammars; others (niche DSLs, config formats) may not.

**Mitigation:** Tier 2 is opt-in per language. Files without a parser adapter degrade gracefully to Tier 0/1. The `ParserAdapter` interface makes it easy to add new language support incrementally.

**Open question:** Should we support user-contributed parser adapters (plugin system), or keep the set of supported languages curated?

### 10.3 Performance at Scale

**Risk:** A large repository with millions of fine-grained ops could make `readAll()` and full replays slow.

**Mitigation:**

- **Snapshots** already exist in the kernel (`checkpoint()` / `loadLatestSnapshot()`). Frequent snapshots reduce replay cost.
- **Branch-scoped reads** (§3.5) avoid reading the full stream.
- **Op compression** — consecutive file-level ops on the same file can be compacted into a single op during archival.
- **Lazy loading** — the graph for old files / AST entities doesn't need to be in memory; load on demand.

**Open question:** What's the target scale? A single developer's project (thousands of ops)? A team project (millions of ops)? A Linux-kernel-scale monorepo (billions)?

**Recommendation:** Design for millions, defer billions. Snapshots + branch scoping handle millions comfortably.

### 10.4 Git Interop Bridge

**Risk:** TrellisVCS can't replace Git overnight. Developers need to collaborate with Git-based teammates and push to GitHub/GitLab.

**Mitigation:** A **Git bridge** that serializes milestones into Git commits and translates Git commits into milestones on import. The bridge operates at Tier 0 (file-level), since Git doesn't understand AST structure.

```
TrellisVCS                          Git
┌─────────────┐    bridge    ┌────────────┐
│  Milestones  │ ──────────> │  Commits   │
│  (semantic)  │             │  (text)    │
│              │ <────────── │            │
└─────────────┘              └────────────┘
```

**Open question:** Is the bridge bidirectional (full sync) or one-way (export only)? Bidirectional is significantly harder because Git commits may not map cleanly to the semantic model.

**Recommendation:** The bridge should be **bidirectional from day one**, but asymmetric:

- **Export (Trellis → Git):** Serialize milestones into Git commits. Straightforward.
- **Import (Git → Trellis):** A one-time `trellis import` command that bootstraps an existing Git repo into TrellisVCS. This is the **only realistic adoption on-ramp** — without it, no one can try TrellisVCS on a real project.

#### `trellis import` Design

```bash
# Import from a local Git repo
trellis import --from /path/to/git-repo

# Import from a remote Git repo
trellis import --from https://github.com/user/repo.git
```

The import command:

1. Reads the Git repo's commit graph (topological order).
2. Translates each commit into a `vcs:milestoneCreate` op (commit message → milestone message, author → identity).
3. Expands each commit's tree diff into a sequence of Tier 0 file-level ops (`vcs:fileAdd`, `vcs:fileModify`, `vcs:fileDelete`, `vcs:fileRename`).
4. Stores file content from each commit's tree into the blob store.
5. Leaves the original Git repo untouched.

The result: a TrellisVCS repo with a milestone for every Git commit, fully queryable, with the ability to push new milestones back to Git via the export bridge. This gives users "clone from Git, work in Trellis, optionally push back to Git."

### 10.5 Concurrency and Conflict in the Causal Stream

**Risk:** If two devices (or two watcher processes) are writing to the same causal stream concurrently, `previousHash` chaining breaks.

**Mitigation:** Each device maintains its own local causal chain. Sync (via `SyncProvider`) reconciles divergent chains. This is where the CRDT-like properties of semantic patches (§4.4) become important — patches that commute can be auto-merged; patches that conflict are surfaced to the user.

**Open question:** Should the causal stream be strictly linear (one chain per branch, like Git), or should it support concurrent appends that are later reconciled (like a CRDT)?

**Recommendation:** Use the **branch concurrency policy flag** (§3.5). Default to `linear: true` (one writer, fast-forward only). Branches with `linear: false` accept concurrent appends and reconcile via a background merkle-CRDT reconciler. This ships the safe mode immediately while leaving a clear, flag-gated path toward real-time collaboration.

### 10.6 Content-Addressable Blob Storage

**Open question:** Should the blob store be a flat directory of files (`objects/sha256:abc...`), a SQLite table, or integrated into the existing `SqliteKernelBackend`?

**Recommendation:** A new SQLite table in the same database (`blobs(hash TEXT PRIMARY KEY, content BLOB)`). This keeps everything in one file, benefits from WAL mode, and avoids filesystem overhead for many small files.

### 10.7 Snapshot Frequency Policy

**Risk:** A fine-grained causal stream (every file save) means replaying from genesis on every boot could be slow for long-lived repos.

**Recommendation:** A **hybrid snapshot strategy** (modeled on Kafka log compaction):

| Trigger                | When                             | Rationale                                   |
| :--------------------- | :------------------------------- | :------------------------------------------ |
| **Op count threshold** | Every 1,000 ops                  | Bounds worst-case replay to 1,000 ops       |
| **Milestone creation** | On every `vcs:milestoneCreate`   | Milestones are natural stability boundaries |
| **Manual**             | `trellis checkpoint` CLI command | Escape hatch for power users                |

On boot: load latest snapshot → replay only ops after it. This is already supported by the kernel's `loadLatestSnapshot()` / `readAfter(hash)` flow — we just need to wire the automatic triggers.

### 10.8 GUI / IDE Plugin

**Open question:** The document focuses on CLI and kernel APIs, but the real breakthrough is the "no commit, just work" paradigm. That demands a visual layer that shows:

- A **timeline** with milestones as "story beats" and the causal stream flowing between them.
- A **garden view** with abandoned idea clusters as browsable cards.
- A **merge conflict UI** that shows _semantic_ conflicts ("Alice changed the return type; Bob still returns string") rather than text markers.

**Recommendation:** Add a **P0.5 phase** to the roadmap: a VS Code extension (or Electron app) that wraps the CLI and provides a visual timeline. Without it, the causal stream is invisible to the user and the "just work" paradigm feels indistinguishable from autosave. The extension needs only three views to be compelling:

1. **Stream timeline** — scrollable list of ops, grouped by checkpoint/milestone.
2. **Status panel** — current branch, ops since last milestone, pending changes.
3. **Milestone composer** — select an op range, see semantic diff, write a message.

---

## Appendix A: Kernel Extension Summary

Changes needed in `trellis-core` (minimal, non-breaking):

| Change                                                     | File                            | Type            |
| :--------------------------------------------------------- | :------------------------------ | :-------------- |
| Widen `KernelOpKind` to `string` (or union with VCS kinds) | `src/persist/backend.ts`        | Type change     |
| Add `findCommonAncestor(hashA, hashB)`                     | `src/persist/backend.ts`        | New method      |
| Add blobs table to SQLite schema                           | `src/persist/sqlite-backend.ts` | Schema addition |
| Add `readOpsForBranch(branchHead)` convenience             | `src/persist/sqlite-backend.ts` | New method      |

Everything else (VCS ops, middleware, watcher, parser, identity, garden) lives in the TrellisVCS layer and consumes the kernel via its public API.

## Appendix B: Prototype Roadmap

Based on the sequencing from SCRATCH.md, adapted for this architecture:

| Phase    | Deliverable                                                                    | Pillars     | Tier |
| :------- | :----------------------------------------------------------------------------- | :---------- | :--- |
| **P0**   | Causal stream engine + file watcher + basic CLI (`init`, `status`, `log`)      | 1           | 0    |
| **P0.5** | VS Code extension / visual timeline (stream, status panel, milestone composer) | 1, 3        | 0    |
| **P1**   | Git import bridge (`trellis import`) + milestone export to Git                 | —           | 0    |
| **P2**   | Branch model + milestone creation + auto-checkpoints                           | 1, 3        | 0    |
| **P3**   | File-level diff + merge (text-based fallback)                                  | 2 (partial) | 1    |
| **P4**   | Identity + op signing + governance middleware                                  | 4           | —    |
| **P5**   | Tree-sitter parser adapter + AST entity ingestion                              | 2           | 2    |
| **P6**   | Semantic diff + merge engine                                                   | 2           | 2    |
| **P7**   | Idea Garden: cluster detection + search                                        | 5           | 0-2  |

Each phase is independently useful and builds on the previous. Git import (P1) is deliberately early — it's the only realistic on-ramp for adoption on real projects.
