/**
 * Trellis UI Server
 *
 * Lightweight HTTP server that exposes the TrellisVCS engine
 * as a JSON API and serves the System Visualizer client.
 *
 * Endpoints:
 *   GET /              → client.html (System Visualizer)
 *   GET /api/graph     → full graph (nodes + edges)
 *   GET /api/timeline  → causal op stream with branch lanes & markers
 *   GET /api/store     → EAV store overview (stats, catalog, entities)
 *   GET /api/store/entity/:id → full detail for one entity
 *   GET /api/system    → system architecture metadata
 *   GET /api/search    → semantic search (?q=...&limit=10&type=...)
 *   GET /api/node/:id  → node detail
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { startNodeServer } from '../server/node-adapter.js';
import { TrellisVcsEngine } from '../engine.js';
import {
  buildRefIndex,
  createResolverContext,
  getOutgoingRefs,
  getReferencedEntities,
  getBacklinks,
} from '../links/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GraphNode {
  id: string;
  label: string;
  type: 'file' | 'milestone' | 'issue' | 'branch';
  meta: Record<string, unknown>;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: 'milestone_file' | 'issue_branch' | 'wikilink' | 'causal';
  label?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ---------------------------------------------------------------------------
// Graph builder
// ---------------------------------------------------------------------------

function buildGraph(engine: TrellisVcsEngine): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();

  // --- Files ---
  const files = engine.trackedFiles();
  for (const f of files) {
    const id = `file:${f.path}`;
    nodes.push({
      id,
      label: f.path,
      type: 'file',
      meta: { contentHash: f.contentHash },
    });
    nodeIds.add(id);
  }

  // --- Milestones ---
  const milestones = engine.listMilestones();
  for (const m of milestones) {
    const id = `milestone:${m.id}`;
    nodes.push({
      id,
      label: m.message ?? m.id,
      type: 'milestone',
      meta: {
        createdAt: m.createdAt,
        affectedFiles: m.affectedFiles,
        fromOpHash: m.fromOpHash,
        toOpHash: m.toOpHash,
      },
    });
    nodeIds.add(id);

    // Edges: milestone → affected files
    for (const fp of m.affectedFiles ?? []) {
      const fileId = `file:${fp}`;
      if (nodeIds.has(fileId)) {
        edges.push({
          source: id,
          target: fileId,
          type: 'milestone_file',
        });
      }
    }
  }

  // --- Issues ---
  const issues = engine.listIssues();
  for (const iss of issues) {
    const id = `issue:${iss.id}`;
    nodes.push({
      id,
      label: iss.title ?? iss.id,
      type: 'issue',
      meta: {
        status: iss.status,
        priority: iss.priority,
        labels: iss.labels,
        assignee: iss.assignee,
        createdAt: iss.createdAt,
        description: iss.description,
        criteria: iss.criteria,
      },
    });
    nodeIds.add(id);

    // Edge: issue → its branch
    if (iss.branchName) {
      const branchId = `branch:${iss.branchName}`;
      if (nodeIds.has(branchId)) {
        edges.push({
          source: id,
          target: branchId,
          type: 'issue_branch',
        });
      }
    }
  }

  // --- Branches ---
  const branches = engine.listBranches();
  for (const b of branches) {
    const id = `branch:${b.name}`;
    if (!nodeIds.has(id)) {
      nodes.push({
        id,
        label: b.name,
        type: 'branch',
        meta: {
          isCurrent: b.isCurrent,
          createdAt: b.createdAt,
        },
      });
      nodeIds.add(id);
    }

    // Link issues that reference this branch
    for (const iss of issues) {
      if (iss.branchName === b.name) {
        edges.push({
          source: `issue:${iss.id}`,
          target: id,
          type: 'issue_branch',
        });
      }
    }
  }

  // --- Wiki-links (if markdown files exist) ---
  try {
    const mdFiles: Array<{ path: string; content: string }> = [];
    for (const f of files) {
      if (f.path.endsWith('.md')) {
        const absPath = join(engine.getRootPath(), f.path);
        if (existsSync(absPath)) {
          mdFiles.push({
            path: f.path,
            content: readFileSync(absPath, 'utf-8'),
          });
        }
      }
    }

    if (mdFiles.length > 0) {
      const ctx = createResolverContext({
        trackedFiles: () => files,
        listIssues: () => issues as any,
        listMilestones: () => milestones as any,
      } as any);

      const refIndex = buildRefIndex(mdFiles, ctx);

      for (const [filePath, refs] of refIndex.outgoing) {
        const sourceId = `file:${filePath}`;
        if (!nodeIds.has(sourceId)) continue;
        for (const ref of refs) {
          const targetId = `${ref.namespace}:${ref.target}`;
          // Normalize to our node IDs
          const candidateIds = [
            targetId,
            `file:${ref.target}`,
            `issue:${ref.target}`,
            `milestone:${ref.target}`,
          ];
          for (const cid of candidateIds) {
            if (nodeIds.has(cid) && cid !== sourceId) {
              edges.push({
                source: sourceId,
                target: cid,
                type: 'wikilink',
                label: ref.target,
              });
              break;
            }
          }
        }
      }
    }
  } catch {
    // Wiki-link indexing is best-effort
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Timeline builder
// ---------------------------------------------------------------------------

function buildTimeline(engine: TrellisVcsEngine): Record<string, unknown> {
  const ops = engine.getOps();
  const branches = engine.listBranches();
  const milestones = engine.listMilestones();
  const checkpoints = engine.listCheckpoints();

  // Build lightweight op summaries
  const opSummaries = ops.map((op, index) => ({
    index,
    hash: op.hash?.slice(0, 24) ?? '',
    kind: op.kind,
    timestamp: op.timestamp,
    agentId: op.agentId,
    filePath: op.vcs?.filePath,
    branchName: op.vcs?.branchName,
    message: op.vcs?.message,
  }));

  // Find milestone op positions
  const milestoneMarkers = milestones.map((m) => {
    const toIdx = ops.findIndex((o) => o.hash === m.toOpHash);
    return {
      id: m.id,
      message: m.message,
      createdAt: m.createdAt,
      atOpIndex: toIdx >= 0 ? toIdx : ops.length - 1,
      affectedFiles: m.affectedFiles?.length ?? 0,
    };
  });

  // Find checkpoint positions
  const checkpointMarkers = checkpoints.map((c) => {
    const atIdx = ops.findIndex((o) => o.hash === c.atOpHash);
    return {
      id: c.id,
      trigger: c.trigger,
      createdAt: c.createdAt,
      atOpIndex: atIdx >= 0 ? atIdx : ops.length - 1,
    };
  });

  return {
    ops: opSummaries,
    branches: branches.map((b) => ({
      name: b.name,
      isCurrent: b.isCurrent,
      createdAt: b.createdAt,
    })),
    milestones: milestoneMarkers,
    checkpoints: checkpointMarkers,
    totalOps: ops.length,
  };
}

// ---------------------------------------------------------------------------
// Store overview
// ---------------------------------------------------------------------------

function buildStoreOverview(engine: TrellisVcsEngine): Record<string, unknown> {
  const store = engine.getStore();
  const stats = store.getStats();
  const catalog = store.getCatalog();

  // Build entity type counts by scanning type facts
  const typeFacts = store.getFactsByAttribute('type');
  const entityTypes: Record<string, number> = {};
  const entityList: Array<{ id: string; type: string; factCount: number }> = [];

  for (const fact of typeFacts) {
    const typeName = String(fact.v);
    entityTypes[typeName] = (entityTypes[typeName] ?? 0) + 1;
    const entityFacts = store.getFactsByEntity(fact.e);
    entityList.push({
      id: fact.e,
      type: typeName,
      factCount: entityFacts.length,
    });
  }

  return {
    stats: {
      totalFacts: stats.totalFacts,
      totalLinks: stats.totalLinks,
      uniqueEntities: stats.uniqueEntities,
      uniqueAttributes: stats.uniqueAttributes,
    },
    catalog: catalog.map((c) => ({
      attribute: c.attribute,
      type: c.type,
      cardinality: c.cardinality,
      distinctCount: c.distinctCount,
      examples: c.examples.slice(0, 3),
    })),
    entityTypes,
    entities: entityList.slice(0, 500), // Cap for performance
  };
}

// ---------------------------------------------------------------------------
// Entity detail
// ---------------------------------------------------------------------------

function buildEntityDetail(
  engine: TrellisVcsEngine,
  entityId: string,
): Record<string, unknown> | null {
  const store = engine.getStore();
  const facts = store.getFactsByEntity(entityId);
  if (facts.length === 0) return null;

  const typeFact = facts.find((f) => f.a === 'type');
  const links = store.getLinksByEntity(entityId);

  return {
    id: entityId,
    type: typeFact?.v ?? 'unknown',
    facts: facts.map((f) => ({ a: f.a, v: f.v })),
    links: links.map((l) => ({
      a: l.a,
      source: l.e1,
      target: l.e2,
      direction: l.e1 === entityId ? 'outgoing' : 'incoming',
    })),
  };
}

// ---------------------------------------------------------------------------
// System metadata
// ---------------------------------------------------------------------------

function buildSystemInfo(engine: TrellisVcsEngine): Record<string, unknown> {
  const status = engine.status();
  const store = engine.getStore();
  const stats = store.getStats();

  // Check for embeddings
  const embeddingsAvailable = existsSync(
    join(engine.getRootPath(), '.trellis', 'embeddings.db'),
  );
  // Check for blob store
  const blobStoreAvailable = engine.getBlobStore() !== null;

  return {
    engine: {
      rootPath: engine.getRootPath(),
      branch: status.branch,
      totalOps: status.totalOps,
      trackedFiles: status.trackedFiles,
      lastOpAt: status.lastOp?.timestamp ?? null,
    },
    store: {
      totalFacts: stats.totalFacts,
      totalLinks: stats.totalLinks,
      uniqueEntities: stats.uniqueEntities,
      uniqueAttributes: stats.uniqueAttributes,
    },
    features: {
      embeddings: embeddingsAvailable,
      blobStore: blobStoreAvailable,
    },
    parsers: [
      'typescript',
      'javascript',
      'python',
      'go',
      'rust',
      'ruby',
      'java',
      'csharp',
    ],
  };
}

// ---------------------------------------------------------------------------
// Node detail (existing, preserved)
// ---------------------------------------------------------------------------

function getNodeDetail(
  engine: TrellisVcsEngine,
  nodeId: string,
): Record<string, unknown> | null {
  const [type, ...rest] = nodeId.split(':');
  const id = rest.join(':');

  switch (type) {
    case 'file': {
      const files = engine.trackedFiles();
      const file = files.find((f) => f.path === id);
      if (!file) return null;
      // Get recent ops for this file
      const ops = engine.log({ filePath: id, limit: 10 });
      return {
        type: 'file',
        path: id,
        contentHash: file.contentHash,
        recentOps: ops.map((o) => ({
          kind: o.kind,
          timestamp: o.timestamp,
          hash: o.hash.slice(0, 24),
        })),
      };
    }
    case 'milestone': {
      const milestones = engine.listMilestones();
      const m = milestones.find((ms) => ms.id === id);
      if (!m) return null;
      return { type: 'milestone', ...m };
    }
    case 'issue': {
      const issue = engine.getIssue(id);
      if (!issue) return null;
      return { type: 'issue', ...issue };
    }
    case 'branch': {
      const branches = engine.listBranches();
      const b = branches.find((br) => br.name === id);
      if (!b) return null;
      return { type: 'branch', ...b };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export interface UIServerOptions {
  rootPath: string;
  port?: number;
  open?: boolean;
}

export async function startUIServer(opts: UIServerOptions): Promise<{
  port: number;
  stop: () => void;
}> {
  const engine = new TrellisVcsEngine({ rootPath: opts.rootPath });
  engine.open();

  // Resolve client.html — works in dev (src/ui/) and production (dist/cli/ chunk)
  function findClientHtml(): string {
    const here = dirname(process.argv[1]);
    const candidates = [
      join(here, 'client.html'), // dev: src/ui/client.html
      join(here, '..', 'ui', 'client.html'), // built: dist/cli → dist/ui
      join(here, 'ui', 'client.html'), // built: dist/ → dist/ui
    ];
    // Also walk up from here looking for package root → dist/ui/client.html
    let dir = here;
    for (let i = 0; i < 5; i++) {
      candidates.push(join(dir, 'dist', 'ui', 'client.html'));
      candidates.push(join(dir, 'ui', 'client.html'));
      dir = dirname(dir);
    }
    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
    throw new Error(
      `Could not find client.html. Searched from: ${here}\nTry reinstalling the package or running \`bun run build\`.`,
    );
  }

  const clientHtml = readFileSync(findClientHtml(), 'utf-8');

  // Lazy-load embedding manager for search
  let embeddingManager: any = null;
  async function getEmbeddingManager() {
    if (!embeddingManager) {
      try {
        const { EmbeddingManager } = require('../embeddings/index.js');
        const dbPath = join(opts.rootPath, '.trellis', 'embeddings.db');
        if (existsSync(dbPath)) {
          embeddingManager = await EmbeddingManager.create(dbPath);
        }
      } catch {
        // Embeddings not available
      }
    }
    return embeddingManager;
  }

  const requestedPort = opts.port ?? 3333;

  const fetchHandler = async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      const path = url.pathname;

      // CORS headers
      const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };

      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers });
      }

      // --- API Routes ---

      if (path === '/api/graph') {
        const graph = buildGraph(engine);
        return Response.json(graph, { headers });
      }

      if (path === '/api/timeline') {
        const timeline = buildTimeline(engine);
        return Response.json(timeline, { headers });
      }

      if (path === '/api/store') {
        const overview = buildStoreOverview(engine);
        return Response.json(overview, { headers });
      }

      if (path.startsWith('/api/store/entity/')) {
        const entityId = decodeURIComponent(
          path.slice('/api/store/entity/'.length),
        );
        const detail = buildEntityDetail(engine, entityId);
        if (!detail) {
          return Response.json(
            { error: 'Entity not found' },
            { status: 404, headers },
          );
        }
        return Response.json(detail, { headers });
      }

      if (path === '/api/system') {
        const info = buildSystemInfo(engine);
        return Response.json(info, { headers });
      }

      if (path === '/api/search') {
        const query = url.searchParams.get('q');
        if (!query) {
          return Response.json(
            { error: 'Missing ?q= parameter' },
            { status: 400, headers },
          );
        }
        const limit = parseInt(url.searchParams.get('limit') ?? '10', 10);
        const typeFilter = url.searchParams.get('type');

        const mgr = await getEmbeddingManager();
        if (!mgr) {
          return Response.json(
            {
              results: [],
              message: 'No embedding index. Run `trellis reindex` first.',
            },
            { headers },
          );
        }

        try {
          const searchOpts: any = { limit };
          if (typeFilter) {
            searchOpts.types = typeFilter
              .split(',')
              .map((t: string) => t.trim());
          }
          const results = await mgr.search(query, searchOpts);
          return Response.json(
            {
              results: results.map((r: any) => ({
                score: r.score,
                chunkType: r.chunk.chunkType,
                filePath: r.chunk.filePath,
                entityId: r.chunk.entityId,
                content: r.chunk.content,
              })),
            },
            { headers },
          );
        } catch (err: any) {
          return Response.json(
            { error: err.message },
            { status: 500, headers },
          );
        }
      }

      if (path.startsWith('/api/node/')) {
        const nodeId = decodeURIComponent(path.slice('/api/node/'.length));
        const detail = getNodeDetail(engine, nodeId);
        if (!detail) {
          return Response.json(
            { error: 'Node not found' },
            { status: 404, headers },
          );
        }
        return Response.json(detail, { headers });
      }

      // --- Static ---
      if (path === '/' || path === '/index.html') {
        return new Response(clientHtml, {
          headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      return new Response('Not Found', { status: 404, headers });
  };

  const server = await startNodeServer({
    port: requestedPort,
    fetch: fetchHandler,
    // UI server is HTTP-only — no WebSocket needed.
    websocket: {
      open: () => {},
      message: () => {},
      close: () => {},
    },
  });

  return {
    port: server.port,
    stop: () => {
      server.stop();
      if (embeddingManager) {
        try {
          embeddingManager.close();
        } catch {}
      }
    },
  };
}
