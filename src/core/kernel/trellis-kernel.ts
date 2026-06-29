/**
 * TrellisKernel — Generic Graph Kernel
 *
 * The composition root for the Trellis semantic kernel. Orchestrates the
 * EAV store, persistence backend, middleware chain, and snapshot lifecycle.
 *
 * The VCS engine (`TrellisVcsEngine`) sits on top of this generic kernel.
 * Non-VCS consumers can use TrellisKernel directly for pure graph CRUD.
 *
 * @module trellis/core
 */

import { EAVStore } from '../store/eav-store.js';
import type { Fact, Link, Atom } from '../store/eav-store.js';
import type {
  KernelOp,
  KernelOpKind,
  KernelBackend,
} from '../persist/backend.js';
import type {
  KernelMiddleware,
  MiddlewareContext,
  OpMiddlewareNext,
} from './middleware.js';
import { QueryEngine } from '../query/engine.js';
import type { Query } from '../query/types.js';
import type { QueryResult } from '../query/engine.js';
import type {
  SchemaDefinition,
  WorkspaceConfig,
  OntologyTier,
} from '../ontology/types.js';
import { CORE_ONTOLOGY } from '../ontology/core-ontology.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KernelConfig {
  /** Persistence backend (SQLite or in-memory). */
  backend: KernelBackend;
  /** Agent ID for attributing operations. */
  agentId: string;
  /** Middleware chain applied to every mutation. */
  middleware?: KernelMiddleware[];
  /** Auto-snapshot after this many ops (0 = disabled). */
  snapshotThreshold?: number;
  /** Auto-replay ops from backend on boot (default: true). */
  autoReplay?: boolean;
}

export interface MutateResult {
  op: KernelOp;
  factsDelta: { added: number; deleted: number };
  linksDelta: { added: number; deleted: number };
}

export interface EntityRecord {
  id: string;
  type: string;
  facts: Fact[];
  links: Link[];
}

// ---------------------------------------------------------------------------
// Content-addressed hash
// ---------------------------------------------------------------------------

async function hashOp(
  kind: string,
  timestamp: string,
  agentId: string,
  previousHash: string | undefined,
  payload: string,
): Promise<string> {
  const data = `${kind}|${timestamp}|${agentId}|${previousHash ?? ''}|${payload}`;
  const buf = new TextEncoder().encode(data);
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  const hex = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `trellis:op:${hex}`;
}

// ---------------------------------------------------------------------------
// Kernel
// ---------------------------------------------------------------------------

export class TrellisKernel {
  private store: EAVStore;
  private backend: KernelBackend;
  private middleware: KernelMiddleware[];
  private agentId: string;
  private snapshotThreshold: number;
  private opsSinceSnapshot: number = 0;
  private _booted: boolean = false;
  private ontologies: Map<string, SchemaDefinition> = new Map();
  private workspaceConfig: WorkspaceConfig | null = null;
  private autoReplay: boolean = true;

  constructor(config: KernelConfig) {
    this.store = new EAVStore();
    this.backend = config.backend;
    this.agentId = config.agentId;
    this.middleware = config.middleware ?? [];
    this.snapshotThreshold = config.snapshotThreshold ?? 0;
    this.autoReplay = config.autoReplay ?? true;

    // Load core ontologies
    for (const schema of CORE_ONTOLOGY) {
      this.ontologies.set(schema['@id'], schema);
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Initialize the backend and replay persisted state.
   * Loads latest snapshot if available, then replays ops after it.
   */
  boot(): { opsReplayed: number; fromSnapshot: boolean } {
    this.backend.init();

    if (!this.autoReplay) {
      this._booted = true;
      return { opsReplayed: 0, fromSnapshot: false };
    }

    let opsReplayed = 0;
    let fromSnapshot = false;

    // Try loading from snapshot
    const snapshot = this.backend.loadLatestSnapshot();
    if (snapshot) {
      this.store.restore(snapshot.data);
      fromSnapshot = true;

      // Replay only ops after the snapshot
      const recentOps = this.backend.readAfter(snapshot.lastOpHash);
      for (const op of recentOps) {
        this._replayOp(op);
        opsReplayed++;
      }
    } else {
      // Full replay
      const allOps = this.backend.readAll();
      for (const op of allOps) {
        this._replayOp(op);
        opsReplayed++;
      }
    }

    this._booted = true;
    return { opsReplayed, fromSnapshot };
  }

  /**
   * Close the backend connection.
   */
  close(): void {
    this.backend.close?.();
    this._booted = false;
  }

  isBooted(): boolean {
    return this._booted;
  }

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  /**
   * Apply a mutation to the graph. Creates an op, runs it through middleware,
   * decomposes into EAV primitives, persists, and returns the result.
   */
  async mutate(
    kind: KernelOpKind | string,
    payload: {
      facts?: Fact[];
      links?: Link[];
      deleteFacts?: Fact[];
      deleteLinks?: Link[];
      meta?: Record<string, unknown>;
    },
    ctx?: Partial<MiddlewareContext>,
  ): Promise<MutateResult> {
    const timestamp = new Date().toISOString();
    const lastOp = this.backend.getLastOp();
    const agentId = ctx?.agentId ?? this.agentId;

    const payloadStr = JSON.stringify(payload);
    const hash = await hashOp(
      kind,
      timestamp,
      agentId,
      lastOp?.hash,
      payloadStr,
    );

    const op: KernelOp = {
      hash,
      kind: kind as KernelOpKind,
      timestamp,
      agentId,
      previousHash: lastOp?.hash,
      facts: [...(payload.facts ?? [])],
      links: [...(payload.links ?? [])],
      deleteFacts: payload.deleteFacts?.length
        ? [...payload.deleteFacts]
        : undefined,
      deleteLinks: payload.deleteLinks?.length
        ? [...payload.deleteLinks]
        : undefined,
    };

    // Attach meta as extra properties for middleware consumption
    const extOp = op as any;
    if (payload.meta) {
      for (const [k, v] of Object.entries(payload.meta)) {
        extOp[k] = v;
      }
    }

    // Run through middleware chain
    const mwCtx: MiddlewareContext = { agentId, ...ctx };
    await this._runMiddleware(op, mwCtx);

    // Apply to store
    let factsAdded = 0;
    let factsDeleted = 0;
    let linksAdded = 0;
    let linksDeleted = 0;

    if (payload.deleteFacts && payload.deleteFacts.length > 0) {
      this.store.deleteFacts(payload.deleteFacts);
      factsDeleted = payload.deleteFacts.length;
    }
    if (payload.deleteLinks && payload.deleteLinks.length > 0) {
      this.store.deleteLinks(payload.deleteLinks);
      linksDeleted = payload.deleteLinks.length;
    }
    if (payload.facts && payload.facts.length > 0) {
      this.store.addFacts(payload.facts);
      factsAdded = payload.facts.length;
    }
    if (payload.links && payload.links.length > 0) {
      this.store.addLinks(payload.links);
      linksAdded = payload.links.length;
    }

    // Persist
    this.backend.append(op);

    // Auto-snapshot
    this.opsSinceSnapshot++;
    if (
      this.snapshotThreshold > 0 &&
      this.opsSinceSnapshot >= this.snapshotThreshold
    ) {
      this.checkpoint();
    }

    return {
      op,
      factsDelta: { added: factsAdded, deleted: factsDeleted },
      linksDelta: { added: linksAdded, deleted: linksDeleted },
    };
  }

  /**
   * Create a snapshot of the current store state.
   */
  checkpoint(): void {
    const lastOp = this.backend.getLastOp();
    if (!lastOp) return;
    this.backend.saveSnapshot(lastOp.hash, this.store.snapshot());
    this.opsSinceSnapshot = 0;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /**
   * Get the underlying EAV store for direct queries.
   */
  getStore(): EAVStore {
    return this.store;
  }

  /**
   * Get the persistence backend.
   */
  getBackend(): KernelBackend {
    return this.backend;
  }

  /**
   * Get the agent ID.
   */
  getAgentId(): string {
    return this.agentId;
  }

  /**
   * Read all persisted ops.
   */
  readAllOps(): KernelOp[] {
    return this.backend.readAll();
  }

  /**
   * Get the last persisted op.
   */
  getLastOp(): KernelOp | undefined {
    return this.backend.getLastOp();
  }

  /**
   * Create a QueryEngine bound to this kernel's store.
   */
  createQueryEngine(): QueryEngine {
    return new QueryEngine(this.store);
  }

  /**
   * Execute an EQL-S query, routing through middleware handleQuery hooks.
   * If no middleware intercepts, the query runs directly against the store.
   */
  async query(q: Query): Promise<QueryResult> {
    const engine = new QueryEngine(this.store);
    const ctx: MiddlewareContext = {
      agentId: this.agentId,
      store: this.store,
    };

    // Build middleware chain for queries
    const chain = this.middleware.filter((m) => m.handleQuery);

    if (chain.length === 0) {
      return engine.execute(q);
    }

    let result: QueryResult | undefined;
    let idx = 0;

    const next = (query: unknown, context: MiddlewareContext): QueryResult => {
      if (idx < chain.length) {
        const mw = chain[idx++];
        return mw.handleQuery!(query, context, next);
      }
      result = engine.execute(query as Query);
      return result;
    };

    result = next(q, ctx);
    return result!;
  }

  /**
   * Time-travel: reconstruct the store state at a specific op hash.
   * Returns a new EAVStore with state replayed up to (and including) that op.
   */
  timeTravel(opHash: string): EAVStore {
    const ops = this.backend.readUntil(opHash);
    const snapshot = new EAVStore();

    for (const op of ops) {
      if (op.deleteFacts && op.deleteFacts.length > 0) {
        snapshot.deleteFacts(op.deleteFacts);
      }
      if (op.deleteLinks && op.deleteLinks.length > 0) {
        snapshot.deleteLinks(op.deleteLinks);
      }
      if (op.facts && op.facts.length > 0) {
        snapshot.addFacts(op.facts);
      }
      if (op.links && op.links.length > 0) {
        snapshot.addLinks(op.links);
      }
    }

    return snapshot;
  }

  // -------------------------------------------------------------------------
  // Entity CRUD (high-level graph operations)
  // -------------------------------------------------------------------------

  /**
   * Create a new entity with the given type and attributes.
   * Returns the entity ID.
   */
  async createEntity(
    entityId: string,
    type: string,
    attributes: Record<string, Atom> = {},
    links?: Array<{ attribute: string; targetEntityId: string }>,
    ctx?: Partial<MiddlewareContext>,
  ): Promise<MutateResult> {
    const facts: Fact[] = [{ e: entityId, a: 'type', v: type }];

    // Kernel metadata uses ISO strings; app schemas may define their own
    // `createdAt` (e.g. chat message epoch ms). Do not inject a duplicate.
    if (attributes.createdAt === undefined) {
      facts.push({ e: entityId, a: 'createdAt', v: new Date().toISOString() });
    }

    for (const [attr, value] of Object.entries(attributes)) {
      facts.push({ e: entityId, a: attr, v: value });
    }

    const linkRecords: Link[] = (links ?? []).map((l) => ({
      e1: entityId,
      a: l.attribute,
      e2: l.targetEntityId,
    }));

    return this.mutate(
      'addFacts',
      {
        facts,
        links: linkRecords.length > 0 ? linkRecords : undefined,
      },
      ctx,
    );
  }

  /**
   * Get an entity by ID, returning all its facts and links.
   */
  getEntity(entityId: string): EntityRecord | null {
    const facts = this.store.getFactsByEntity(entityId);
    if (facts.length === 0) return null;

    const typeFact = facts.find((f) => f.a === 'type');

    return {
      id: entityId,
      type: (typeFact?.v as string) ?? 'unknown',
      facts,
      links: this.store.getLinksByEntity(entityId),
    };
  }

  /**
   * Update an entity's attributes. Deletes old values and adds new ones.
   */
  async updateEntity(
    entityId: string,
    updates: Record<string, Atom>,
    ctx?: Partial<MiddlewareContext>,
  ): Promise<MutateResult> {
    const existingFacts = this.store.getFactsByEntity(entityId);
    const deleteFacts: Fact[] = [];
    const addFacts: Fact[] = [];

    for (const [attr, newValue] of Object.entries(updates)) {
      // Find existing facts for this attribute
      const existing = existingFacts.filter((f) => f.a === attr);
      deleteFacts.push(...existing);
      addFacts.push({ e: entityId, a: attr, v: newValue });
    }

    // Add updatedAt
    const updatedAtFacts = existingFacts.filter((f) => f.a === 'updatedAt');
    deleteFacts.push(...updatedAtFacts);
    addFacts.push({ e: entityId, a: 'updatedAt', v: new Date().toISOString() });

    return this.mutate(
      'addFacts',
      {
        facts: addFacts,
        deleteFacts,
      },
      ctx,
    );
  }

  /**
   * Delete an entity and all its facts and links.
   */
  async deleteEntity(
    entityId: string,
    ctx?: Partial<MiddlewareContext>,
  ): Promise<MutateResult> {
    const facts = this.store.getFactsByEntity(entityId);
    const links = this.store.getLinksByEntity(entityId);

    return this.mutate(
      'deleteFacts',
      {
        deleteFacts: facts,
        deleteLinks: links,
      },
      ctx,
    );
  }

  /**
   * List entities by type, with optional attribute filters.
   */
  listEntities(type?: string, filters?: Record<string, Atom>): EntityRecord[] {
    let entityIds: Set<string>;

    if (type) {
      const typeFacts = this.store.getFactsByValue('type', type);
      entityIds = new Set(typeFacts.map((f) => f.e));
    } else {
      const allTypeFacts = this.store.getFactsByAttribute('type');
      entityIds = new Set(allTypeFacts.map((f) => f.e));
    }

    // Apply attribute filters
    if (filters) {
      for (const [attr, value] of Object.entries(filters)) {
        const matchingFacts = this.store.getFactsByValue(attr, value);
        const matchingEntities = new Set(matchingFacts.map((f) => f.e));
        for (const id of entityIds) {
          if (!matchingEntities.has(id)) {
            entityIds.delete(id);
          }
        }
      }
    }

    return Array.from(entityIds)
      .map((id) => this.getEntity(id)!)
      .filter(Boolean);
  }

  /**
   * Add a link between two entities.
   */
  async addLink(
    sourceId: string,
    attribute: string,
    targetId: string,
    ctx?: Partial<MiddlewareContext>,
  ): Promise<MutateResult> {
    return this.mutate(
      'addLinks',
      {
        links: [{ e1: sourceId, a: attribute, e2: targetId }],
      },
      ctx,
    );
  }

  /**
   * Remove a link between two entities.
   */
  async removeLink(
    sourceId: string,
    attribute: string,
    targetId: string,
    ctx?: Partial<MiddlewareContext>,
  ): Promise<MutateResult> {
    return this.mutate(
      'deleteLinks',
      {
        deleteLinks: [{ e1: sourceId, a: attribute, e2: targetId }],
      },
      ctx,
    );
  }

  /**
   * Add a fact to an entity.
   */
  async addFact(
    entityId: string,
    attribute: string,
    value: Atom,
  ): Promise<MutateResult> {
    return this.mutate('addFacts', {
      facts: [{ e: entityId, a: attribute, v: value }],
    });
  }

  /**
   * Remove a fact from an entity.
   */
  async removeFact(
    entityId: string,
    attribute: string,
    value: Atom,
  ): Promise<MutateResult> {
    return this.mutate('deleteFacts', {
      deleteFacts: [{ e: entityId, a: attribute, v: value }],
    });
  }

  // -------------------------------------------------------------------------
  // Ontology CRUD
  // -------------------------------------------------------------------------

  /**
   * Get an ontology schema by ID.
   */
  getOntology(id: string): SchemaDefinition | undefined {
    return this.ontologies.get(id);
  }

  /**
   * List all ontologies.
   */
  listOntologies(): SchemaDefinition[] {
    return Array.from(this.ontologies.values());
  }

  /**
   * Create a new ontology schema.
   */
  createOntology(schema: SchemaDefinition): void {
    const tier = schema.tier ?? 'user';

    // Core ontologies are immutable
    if (tier === 'core') {
      throw new Error('Cannot modify core ontologies');
    }

    // Check if already exists (for system/user ontologies)
    if (this.ontologies.has(schema['@id'])) {
      throw new Error(`Ontology ${schema['@id']} already exists`);
    }

    this.ontologies.set(schema['@id'], schema);

    // Persist as facts in the graph
    const fact: Fact = {
      e: schema['@id'],
      a: 'schema',
      v: JSON.stringify(schema),
    };
    this.store.addFacts([fact]);
  }

  /**
   * Update an existing ontology schema.
   */
  updateOntology(id: string, updates: Partial<SchemaDefinition>): void {
    const existing = this.ontologies.get(id);
    if (!existing) {
      throw new Error(`Ontology ${id} not found`);
    }

    const tier = existing.tier ?? 'user';

    // Core ontologies are immutable
    if (tier === 'core') {
      throw new Error('Cannot modify core ontologies');
    }

    const updated = { ...existing, ...updates };
    this.ontologies.set(id, updated);

    // Update in the graph
    const existingFacts = this.store.getFactsByEntity(id);
    const schemaFacts = existingFacts.filter((f) => f.a === 'schema');
    const deleteFacts: Fact[] = [...schemaFacts];
    const addFacts: Fact[] = [
      {
        e: id,
        a: 'schema',
        v: JSON.stringify(updated),
      },
    ];

    this.store.deleteFacts(deleteFacts);
    this.store.addFacts(addFacts);
  }

  /**
   * Delete an ontology schema.
   */
  deleteOntology(id: string): void {
    const existing = this.ontologies.get(id);
    if (!existing) {
      throw new Error(`Ontology ${id} not found`);
    }

    const tier = existing.tier ?? 'user';

    // Core ontologies are immutable
    if (tier === 'core') {
      throw new Error('Cannot delete core ontologies');
    }

    this.ontologies.delete(id);

    // Remove from the graph
    const facts = this.store.getFactsByEntity(id);
    this.store.deleteFacts(facts);
  }

  // -------------------------------------------------------------------------
  // Workspace
  // -------------------------------------------------------------------------

  /**
   * Boot the kernel with a workspace configuration.
   * Loads ontologies, projections, and seed data.
   */
  bootWorkspace(config: WorkspaceConfig): void {
    this.workspaceConfig = config;

    // Load ontologies from config
    if (config.workspace.ontologies) {
      for (const [id, schema] of Object.entries(config.workspace.ontologies)) {
        if (!this.ontologies.has(id)) {
          this.ontologies.set(id, schema);
        }
      }
    }

    // Load seed graph data
    if (config.workspace.graph?.nodes) {
      for (const node of config.workspace.graph.nodes) {
        const n = node as Record<string, unknown>;
        if (n.id && n.type) {
          const facts: Fact[] = [
            { e: String(n.id), a: 'type', v: String(n.type) },
          ];
          for (const [key, value] of Object.entries(n)) {
            if (key !== 'id' && key !== 'type') {
              facts.push({ e: String(n.id), a: key, v: value as Atom });
            }
          }
          this.store.addFacts(facts);
        }
      }
    }

    // Load seed graph edges
    if (config.workspace.graph?.edges) {
      for (const edge of config.workspace.graph.edges) {
        const e = edge as Record<string, unknown>;
        if (e.source && e.target && e.relation) {
          this.store.addLinks([
            {
              e1: String(e.source),
              a: String(e.relation),
              e2: String(e.target),
            },
          ]);
        }
      }
    }

    // Boot the kernel (load from backend)
    this.boot();
  }

  /**
   * Export the current workspace configuration.
   */
  exportWorkspace(): WorkspaceConfig {
    const ontologies: Record<string, SchemaDefinition> = {};

    // Export non-core ontologies
    for (const [id, schema] of this.ontologies) {
      if (schema.tier !== 'core') {
        ontologies[id] = schema;
      }
    }

    // Export graph data
    const allFacts = this.store.getAllFacts();
    const nodes: Record<string, unknown>[] = [];
    const entityIds = new Set(allFacts.map((f) => f.e));

    for (const id of entityIds) {
      const facts = this.store.getFactsByEntity(id);
      const typeFact = facts.find((f) => f.a === 'type');
      const node: Record<string, unknown> = { id };
      if (typeFact) {
        node.type = typeFact.v;
      }
      for (const fact of facts) {
        if (fact.a !== 'type') {
          node[fact.a] = fact.v;
        }
      }
      nodes.push(node);
    }

    // Export edges
    const allLinks = this.store.getAllLinks();
    const edges = allLinks.map((l) => ({
      source: l.e1,
      relation: l.a,
      target: l.e2,
    }));

    return {
      workspace: {
        name: this.workspaceConfig?.workspace.name,
        description: this.workspaceConfig?.workspace.description,
        ontologies: Object.keys(ontologies).length > 0 ? ontologies : undefined,
        graph: { nodes, edges },
        projections: this.workspaceConfig?.workspace.projections,
        routes: this.workspaceConfig?.workspace.routes,
        app: this.workspaceConfig?.workspace.app,
      },
    };
  }

  // -------------------------------------------------------------------------
  // TQL Compatibility Aliases
  // -------------------------------------------------------------------------

  /**
   * Create a node (alias for createEntity with schema validation).
   */
  async createNode(
    id: string,
    data: Record<string, Atom>,
    type: string,
    ctx?: Partial<MiddlewareContext>,
  ): Promise<MutateResult> {
    return this.createEntity(id, type, data, undefined, ctx);
  }

  /**
   * Update a node (alias for updateEntity with schema validation).
   */
  async updateNode(
    id: string,
    data: Record<string, Atom>,
    type: string,
    ctx?: Partial<MiddlewareContext>,
  ): Promise<MutateResult> {
    return this.updateEntity(id, data, ctx);
  }

  /**
   * Delete a node (alias for deleteEntity).
   */
  async deleteNode(
    id: string,
    ctx?: Partial<MiddlewareContext>,
  ): Promise<MutateResult> {
    return this.deleteEntity(id, ctx);
  }

  /**
   * Link two nodes (alias for addLink).
   */
  async link(
    e1: string,
    a: string,
    e2: string,
    ctx?: Partial<MiddlewareContext>,
  ): Promise<MutateResult> {
    return this.addLink(e1, a, e2, ctx);
  }

  /**
   * Unlink two nodes (alias for removeLink).
   */
  async unlink(
    e1: string,
    a: string,
    e2: string,
    ctx?: Partial<MiddlewareContext>,
  ): Promise<MutateResult> {
    return this.removeLink(e1, a, e2, ctx);
  }

  // -------------------------------------------------------------------------
  // Middleware
  // -------------------------------------------------------------------------

  addMiddleware(mw: KernelMiddleware): void {
    this.middleware.push(mw);
  }

  removeMiddleware(name: string): void {
    this.middleware = this.middleware.filter((m) => m.name !== name);
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async _runMiddleware(
    op: KernelOp,
    ctx: MiddlewareContext,
  ): Promise<void> {
    const chain = [...this.middleware];
    let idx = 0;

    const next: OpMiddlewareNext = async (op, ctx) => {
      const mw = chain[idx++];
      if (mw?.handleOp) {
        await mw.handleOp(op, ctx, next);
      }
    };

    if (chain.length > 0) {
      await next(op, ctx);
    }
  }

  private _replayOp(op: KernelOp): void {
    // Replay without persisting or middleware — just apply to store
    // Deletions first, then additions (same order as mutate)
    if (op.deleteFacts && op.deleteFacts.length > 0) {
      this.store.deleteFacts(op.deleteFacts);
    }
    if (op.deleteLinks && op.deleteLinks.length > 0) {
      this.store.deleteLinks(op.deleteLinks);
    }
    if (op.facts && op.facts.length > 0) {
      this.store.addFacts(op.facts);
    }
    if (op.links && op.links.length > 0) {
      this.store.addLinks(op.links);
    }
  }
}
