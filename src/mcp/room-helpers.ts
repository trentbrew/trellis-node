/**
 * Shared helpers for room MCP tools — lanes, rate limits, write context.
 *
 * @module trellis/mcp
 */

import type { MiddlewareContext } from '../core/kernel/middleware.js';
import type { AuthContext } from '../server/auth.js';
import {
  McpRateLimitError,
  resolveUsageTenantId,
  type UsageMeter,
} from '../server/usage-meter.js';

/** Normalize lane / agent attribution for draft writes. */
export function resolveWriteAgentId(
  lane: string | undefined,
  auth: AuthContext,
  headerLane?: string | null,
): string {
  const explicit = lane?.trim() || headerLane?.trim();
  if (explicit) {
    if (explicit.startsWith('agent:')) return explicit;
    return `agent:${explicit}`;
  }
  if (auth.userId) {
    return auth.userId.startsWith('agent:')
      ? auth.userId
      : `agent:${auth.userId}`;
  }
  return 'agent:room-mcp';
}

export function writeContext(
  lane: string | undefined,
  auth: AuthContext,
  headerLane?: string | null,
): Partial<MiddlewareContext> {
  return {
    agentId: resolveWriteAgentId(lane, auth, headerLane),
  };
}

export function assertMcpBudget(
  meter: UsageMeter | null,
  tenantId: string | null,
): void {
  if (!meter) return;
  meter.assertGraphIoBudget(resolveUsageTenantId(tenantId));
}

/** Playground hosted app uses `embed-{slug}` tenants (see fractal-playground session-room). */
const PLAYGROUND_ROOM_SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export function playgroundRoomToTenant(slug: string): string {
  const trimmed = slug.trim();
  if (!trimmed || !PLAYGROUND_ROOM_SLUG_RE.test(trimmed)) {
    throw new Error(
      `Invalid playground room slug "${slug}" — use 1–64 chars [a-zA-Z0-9_-]`,
    );
  }
  if (trimmed.startsWith('embed-')) return trimmed;
  return `embed-${trimmed}`;
}

export interface ResolveMcpTenantOptions {
  /** Session default from `?tenantId=` on the MCP HTTP URL or auth JWT. */
  defaultTenantId?: string | null;
  /** `X-Trellis-Tenant` header on the MCP request. */
  headerTenant?: string | null;
  /** Per-tool explicit tenant id. */
  toolTenantId?: string;
  /** Playground `?room=` slug → `embed-{slug}`. */
  roomSlug?: string;
}

/**
 * Resolve effective tenant for a room MCP tool call.
 * Priority: tool `tenantId` → tool `room` → header → URL/auth default → null (showcase).
 */
export function resolveMcpTenantId(
  opts: ResolveMcpTenantOptions,
): string | null {
  const toolTenant = opts.toolTenantId?.trim();
  if (toolTenant) return toolTenant;

  const room = opts.roomSlug?.trim();
  if (room) return playgroundRoomToTenant(room);

  const header = opts.headerTenant?.trim();
  if (header) return header;

  return opts.defaultTenantId ?? null;
}

export function handleMcpError(err: unknown) {
  if (err instanceof McpRateLimitError) {
    return { content: [{ type: 'text' as const, text: err.message }] };
  }
  return null;
}

/** Stable CollectionMeta id used by Playground (`collectionMeta:<slug>`). */
export const COLLECTION_META_PREFIX = 'collectionMeta:' as const;

export function collectionMetaIdFromSlug(slug: string): string {
  const trimmed = slug.trim();
  if (!trimmed) {
    throw new Error('collection slug is required');
  }
  if (trimmed.startsWith(COLLECTION_META_PREFIX)) return trimmed;
  return `${COLLECTION_META_PREFIX}${trimmed}`;
}

export function resolveCollectionId(opts: {
  collectionSlug?: string;
  collectionId?: string;
}): string {
  const explicit = opts.collectionId?.trim();
  if (explicit) return explicit;
  const slug = opts.collectionSlug?.trim();
  if (!slug) {
    throw new Error('Provide collectionSlug or collectionId');
  }
  return collectionMetaIdFromSlug(slug);
}

export function collectionSlugFromMetaId(collectionId: string): string | null {
  if (!collectionId.startsWith(COLLECTION_META_PREFIX)) return null;
  const slug = collectionId.slice(COLLECTION_META_PREFIX.length).trim();
  return slug || null;
}
