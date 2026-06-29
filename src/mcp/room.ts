/**
 * Trellis Room MCP — graph query/CRUD tools backed by the TurtleDB kernel.
 *
 * Mounted at POST/GET/DELETE `/mcp` on `trellis db serve` and deployed rooms.
 * Tool names align with the trellis-graph skill for agent portability.
 *
 * @module trellis/mcp
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { parseSimple } from '../core/query/index.js';
import {
  entityRecordToPlain,
  hydrateBindings,
} from '../schema/entity-projection.js';
import type { AuthContext } from '../server/auth.js';
import type { PermissionRegistry } from '../server/permissions.js';
import { PermissionError } from '../server/permissions.js';
import type { SubscriptionManager } from '../server/realtime.js';
import type { TenantPool } from '../server/tenancy.js';
import {
  McpRateLimitError,
  resolveUsageTenantId,
  type UsageMeter,
} from '../server/usage-meter.js';
import { buildRoomGraphSummary } from './graph-summary.js';
import {
  assertMcpBudget,
  collectionSlugFromMetaId,
  resolveCollectionId,
  resolveMcpTenantId,
  writeContext,
} from './room-helpers.js';
import { scheduleRoomMcpAudit } from './room-audit.js';
import type { MiddlewareContext } from '../core/kernel/middleware.js';
import type { TrellisKernel } from '../core/kernel/trellis-kernel.js';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface RoomMcpContext {
  pool: TenantPool;
  permissions: PermissionRegistry | null;
  subs: SubscriptionManager;
  meter: UsageMeter | null;
  auth: AuthContext;
  tenantId: string | null;
  /** From `X-Trellis-Lane` header when present. */
  headerLane?: string | null;
  /** From `X-Trellis-Tenant` header when present. */
  headerTenant?: string | null;
}

interface TenantToolArgs {
  tenantId?: string;
  room?: string;
}

const laneSchema = z
  .string()
  .optional()
  .describe(
    'Draft lane for op attribution (e.g. agent:cursor). Defaults to authenticated user or agent:room-mcp.',
  );

const tenantIdSchema = z
  .string()
  .optional()
  .describe(
    'Tenant id (e.g. embed-design-review). Overrides session default. Use for Playground multi-tenant rooms.',
  );

const roomSchema = z
  .string()
  .optional()
  .describe(
    'Playground ?room= slug — resolves to tenant embed-{slug} (same as playground.trellis.computer session rooms).',
  );

function resolveToolTenant(
  ctx: RoomMcpContext,
  args: TenantToolArgs,
): string | null {
  return resolveMcpTenantId({
    defaultTenantId: ctx.tenantId,
    headerTenant: ctx.headerTenant,
    toolTenantId: args.tenantId,
    roomSlug: args.room,
  });
}

function text(content: string) {
  return { content: [{ type: 'text' as const, text: content }] };
}

function jsonText(data: unknown) {
  return text(JSON.stringify(data, null, 2));
}

function toolError(err: unknown) {
  if (err instanceof PermissionError || err instanceof McpRateLimitError) {
    return text(err.message);
  }
  return text(err instanceof Error ? err.message : String(err));
}

async function withMcpIo<T>(
  ctx: RoomMcpContext,
  tenantId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  assertMcpBudget(ctx.meter, tenantId);
  const result = await fn();
  ctx.meter?.recordGraphIo(resolveUsageTenantId(tenantId));
  return result;
}

function auditWrite(
  kernel: TrellisKernel,
  wctx: Partial<MiddlewareContext>,
  toolName: string,
  params: Record<string, unknown>,
  payload: unknown,
  relatedEntities: string[] = [],
): void {
  const agentId = wctx.agentId ?? 'agent:room-mcp';
  const resultText =
    typeof payload === 'string' ? payload : JSON.stringify(payload);
  scheduleRoomMcpAudit(
    Promise.resolve(kernel),
    agentId,
    toolName,
    params,
    resultText,
    wctx,
    relatedEntities,
  );
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export function createRoomMcpServer(ctx: RoomMcpContext): McpServer {
  const server = new McpServer({
    name: 'trellis-room',
    version: '0.2.0',
  });

  server.registerTool(
    'get_graph_summary',
    {
      description:
        'Compact graph overview — health, entity types, ontologies, top attributes, links, recent ops. Call first.',
      inputSchema: {
        limit: z
          .number()
          .optional()
          .describe('Max items per section (default: 10)'),
        tenantId: tenantIdSchema,
        room: roomSchema,
      },
    },
    async ({ limit, tenantId, room }) => {
      try {
        const effectiveTenant = resolveToolTenant(ctx, { tenantId, room });
        return await withMcpIo(ctx, effectiveTenant, async () => {
          const kernel = await ctx.pool.preload(effectiveTenant);
          return jsonText(
            buildRoomGraphSummary(kernel, effectiveTenant, { limit }),
          );
        });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    'graph_health',
    {
      description:
        'Quick liveness check for the Trellis room graph (ops + entity counts).',
      inputSchema: {
        tenantId: tenantIdSchema,
        room: roomSchema,
      },
    },
    async ({ tenantId, room }) => {
      try {
        const effectiveTenant = resolveToolTenant(ctx, { tenantId, room });
        return await withMcpIo(ctx, effectiveTenant, async () => {
          const kernel = await ctx.pool.preload(effectiveTenant);
          const entities = kernel.listEntities();
          const byType: Record<string, number> = {};
          for (const e of entities) {
            byType[e.type] = (byType[e.type] ?? 0) + 1;
          }
          return jsonText({
            status: 'ok',
            ops: kernel.readAllOps().length,
            entities: entities.length,
            byType,
            tenantId: effectiveTenant,
          });
        });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    'query_graph',
    {
      description: 'Run an EQL-S query against the room graph.',
      inputSchema: {
        query: z.string().describe('EQL-S query string'),
        tenantId: tenantIdSchema,
        room: roomSchema,
      },
    },
    async ({ query, tenantId, room }) => {
      try {
        const effectiveTenant = resolveToolTenant(ctx, { tenantId, room });
        return await withMcpIo(ctx, effectiveTenant, async () => {
          const parsed = parseSimple(query);
          const kernel = await ctx.pool.preload(effectiveTenant);
          const result = await kernel.query(parsed);
          const bindings = hydrateBindings(
            kernel,
            result.bindings as Record<string, unknown>[],
          );
          return jsonText({
            bindings,
            executionTime: result.executionTime,
          });
        });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    'get_node',
    {
      description: 'Read a single entity by ID.',
      inputSchema: {
        id: z.string().describe('Entity ID'),
        tenantId: tenantIdSchema,
        room: roomSchema,
      },
    },
    async ({ id, tenantId, room }) => {
      try {
        const effectiveTenant = resolveToolTenant(ctx, { tenantId, room });
        return await withMcpIo(ctx, effectiveTenant, async () => {
          const kernel = await ctx.pool.preload(effectiveTenant);
          const entity = kernel.getEntity(id);
          if (!entity) return text(`Not found: ${id}`);
          ctx.permissions?.assert(ctx.auth, entity.type, 'read', entity);
          return jsonText(entityRecordToPlain(entity));
        });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    'create_node',
    {
      description:
        'Create a new entity in the room graph. Optionally pass links for relations.',
      inputSchema: {
        type: z.string().describe('Entity type name'),
        id: z
          .string()
          .optional()
          .describe('Optional explicit entity ID'),
        attributes: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Entity attributes'),
        links: z
          .array(
            z.object({
              attribute: z.string(),
              targetEntityId: z.string(),
            }),
          )
          .optional()
          .describe('Relation links to create with the entity'),
        lane: laneSchema,
        tenantId: tenantIdSchema,
        room: roomSchema,
      },
    },
    async ({ type, id, attributes, links, lane, tenantId, room }) => {
      try {
        const effectiveTenant = resolveToolTenant(ctx, { tenantId, room });
        ctx.permissions?.assert(ctx.auth, type, 'create');
        const wctx = writeContext(lane, ctx.auth, ctx.headerLane);
        return await withMcpIo(ctx, effectiveTenant, async () => {
          const kernel = await ctx.pool.preload(effectiveTenant);
          const entityId =
            id ?? `${type.toLowerCase()}:${crypto.randomUUID()}`;
          const attrs: Record<string, unknown> = { ...(attributes ?? {}) };
          if (ctx.auth.userId) attrs.createdBy = ctx.auth.userId;
          if (effectiveTenant) attrs.tenantId = effectiveTenant;
          attrs.laneId = wctx.agentId;

          const result = await kernel.createEntity(
            entityId,
            type,
            attrs as any,
            links,
            wctx,
          );
          await ctx.subs.notify(effectiveTenant);
          const payload = {
            id: entityId,
            op: result.op.hash,
            lane: wctx.agentId,
            tenantId: effectiveTenant,
          };
          auditWrite(
            kernel,
            wctx,
            'create_node',
            { type, id, attributes, links, lane, tenantId, room },
            payload,
            [entityId],
          );
          return jsonText(payload);
        });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    'update_node',
    {
      description: 'Partial update of an entity attributes.',
      inputSchema: {
        id: z.string().describe('Entity ID'),
        attributes: z
          .record(z.string(), z.unknown())
          .describe('Attributes to merge'),
        lane: laneSchema,
        tenantId: tenantIdSchema,
        room: roomSchema,
      },
    },
    async ({ id, attributes, lane, tenantId, room }) => {
      try {
        const effectiveTenant = resolveToolTenant(ctx, { tenantId, room });
        const wctx = writeContext(lane, ctx.auth, ctx.headerLane);
        return await withMcpIo(ctx, effectiveTenant, async () => {
          const kernel = await ctx.pool.preload(effectiveTenant);
          const entity = kernel.getEntity(id);
          if (!entity) return text(`Not found: ${id}`);
          ctx.permissions?.assert(ctx.auth, entity.type, 'update', entity);
          await kernel.updateEntity(id, attributes as any, wctx);
          await ctx.subs.notify(effectiveTenant);
          const payload = {
            id,
            updated: true,
            lane: wctx.agentId,
            tenantId: effectiveTenant,
          };
          auditWrite(
            kernel,
            wctx,
            'update_node',
            { id, attributes, lane, tenantId, room },
            payload,
            [id],
          );
          return jsonText(payload);
        });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    'delete_node',
    {
      description: 'Delete an entity by ID.',
      inputSchema: {
        id: z.string().describe('Entity ID'),
        lane: laneSchema,
        tenantId: tenantIdSchema,
        room: roomSchema,
      },
    },
    async ({ id, lane, tenantId, room }) => {
      try {
        const effectiveTenant = resolveToolTenant(ctx, { tenantId, room });
        const wctx = writeContext(lane, ctx.auth, ctx.headerLane);
        return await withMcpIo(ctx, effectiveTenant, async () => {
          const kernel = await ctx.pool.preload(effectiveTenant);
          const entity = kernel.getEntity(id);
          if (!entity) return text(`Not found: ${id}`);
          ctx.permissions?.assert(ctx.auth, entity.type, 'delete', entity);
          await kernel.deleteEntity(id, wctx);
          await ctx.subs.notify(effectiveTenant);
          const payload = {
            id,
            deleted: true,
            lane: wctx.agentId,
            tenantId: effectiveTenant,
          };
          auditWrite(
            kernel,
            wctx,
            'delete_node',
            { id, lane, tenantId, room },
            payload,
            [id],
          );
          return jsonText(payload);
        });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    'create_collection_record',
    {
      description:
        'Create a Playground CollectionRecord row (shows in Collections UI). ' +
        'Sets collectionId to collectionMeta:<slug> so recordBelongsToCollection matches. ' +
        'Optionally ensureCollection to create CollectionMeta when the collection is missing.',
      inputSchema: {
        collectionSlug: z
          .string()
          .optional()
          .describe('Collection slug (e.g. people, ideas). Required unless collectionId is set.'),
        collectionId: z
          .string()
          .optional()
          .describe('Explicit collection id (e.g. collectionMeta:people). Overrides slug.'),
        title: z.string().min(1).describe('Record title shown in the collection'),
        body: z.string().optional().describe('Optional record body / notes'),
        sortOrder: z.number().int().optional().describe('Row sort order within the collection'),
        attributes: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Extra typed fields (status, tags, etc.) merged into the record'),
        ensureCollection: z
          .boolean()
          .optional()
          .describe(
            'When true, create CollectionMeta with stable id collectionMeta:<slug> if missing.',
          ),
        collectionTitle: z
          .string()
          .optional()
          .describe('Title for CollectionMeta when ensureCollection creates it'),
        lane: laneSchema,
        tenantId: tenantIdSchema,
        room: roomSchema,
      },
    },
    async ({
      collectionSlug,
      collectionId,
      title,
      body,
      sortOrder,
      attributes,
      ensureCollection,
      collectionTitle,
      lane,
      tenantId,
      room,
    }) => {
      try {
        const effectiveTenant = resolveToolTenant(ctx, { tenantId, room });
        ctx.permissions?.assert(ctx.auth, 'CollectionRecord', 'create');
        const wctx = writeContext(lane, ctx.auth, ctx.headerLane);
        const resolvedCollectionId = resolveCollectionId({
          collectionSlug,
          collectionId,
        });
        const slug =
          collectionSlug?.trim() ||
          collectionSlugFromMetaId(resolvedCollectionId) ||
          resolvedCollectionId;

        return await withMcpIo(ctx, effectiveTenant, async () => {
          const kernel = await ctx.pool.preload(effectiveTenant);
          let collectionCreated = false;

          if (ensureCollection) {
            const existingMeta = kernel.getEntity(resolvedCollectionId);
            if (!existingMeta) {
              ctx.permissions?.assert(ctx.auth, 'CollectionMeta', 'create');
              const metaAttrs: Record<string, unknown> = {
                title: collectionTitle?.trim() || slug,
                slug,
                sortOrder: 0,
              };
              if (ctx.auth.userId) metaAttrs.createdBy = ctx.auth.userId;
              if (effectiveTenant) metaAttrs.tenantId = effectiveTenant;
              metaAttrs.laneId = wctx.agentId;

              await kernel.createEntity(
                resolvedCollectionId,
                'CollectionMeta',
                metaAttrs as any,
                undefined,
                wctx,
              );
              collectionCreated = true;
            }
          }

          const recordId = `collectionRecord:${crypto.randomUUID()}`;
          const recordAttrs: Record<string, unknown> = {
            ...(attributes ?? {}),
            collectionId: resolvedCollectionId,
            title,
          };
          if (body !== undefined) recordAttrs.body = body;
          if (sortOrder !== undefined) recordAttrs.sortOrder = sortOrder;
          if (ctx.auth.userId) recordAttrs.createdBy = ctx.auth.userId;
          if (effectiveTenant) recordAttrs.tenantId = effectiveTenant;
          recordAttrs.laneId = wctx.agentId;

          const result = await kernel.createEntity(
            recordId,
            'CollectionRecord',
            recordAttrs as any,
            undefined,
            wctx,
          );
          await ctx.subs.notify(effectiveTenant);

          const payload = {
            id: recordId,
            collectionId: resolvedCollectionId,
            collectionCreated,
            op: result.op.hash,
            lane: wctx.agentId,
            tenantId: effectiveTenant,
          };
          auditWrite(
            kernel,
            wctx,
            'create_collection_record',
            {
              collectionSlug,
              collectionId,
              title,
              body,
              sortOrder,
              attributes,
              ensureCollection,
              collectionTitle,
              lane,
              tenantId,
              room,
            },
            payload,
            collectionCreated
              ? [recordId, resolvedCollectionId]
              : [recordId],
          );
          return jsonText(payload);
        });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    'link_nodes',
    {
      description:
        'Create a semantic link between two entities (assignedTo, belongsTo, references, dependsOn, …).',
      inputSchema: {
        e1: z.string().describe('Source entity ID'),
        relation: z.string().describe('Relation attribute name'),
        e2: z.string().describe('Target entity ID'),
        lane: laneSchema,
        tenantId: tenantIdSchema,
        room: roomSchema,
      },
    },
    async ({ e1, relation, e2, lane, tenantId, room }) => {
      try {
        const effectiveTenant = resolveToolTenant(ctx, { tenantId, room });
        const wctx = writeContext(lane, ctx.auth, ctx.headerLane);
        return await withMcpIo(ctx, effectiveTenant, async () => {
          const kernel = await ctx.pool.preload(effectiveTenant);
          const source = kernel.getEntity(e1);
          const target = kernel.getEntity(e2);
          if (!source) return text(`Not found: ${e1}`);
          if (!target) return text(`Not found: ${e2}`);
          ctx.permissions?.assert(ctx.auth, source.type, 'update', source);
          const result = await kernel.addLink(e1, relation, e2, wctx);
          await ctx.subs.notify(effectiveTenant);
          const payload = {
            e1,
            relation,
            e2,
            op: result.op.hash,
            lane: wctx.agentId,
            tenantId: effectiveTenant,
          };
          auditWrite(
            kernel,
            wctx,
            'link_nodes',
            { e1, relation, e2, lane, tenantId, room },
            payload,
            [e1, e2],
          );
          return jsonText(payload);
        });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  return server;
}
