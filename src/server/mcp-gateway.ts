/**
 * Streamable HTTP MCP gateway for Trellis room graph tools.
 *
 * @module trellis/server
 */

import { createRoomMcpServer, type RoomMcpContext } from '../mcp/room.js';
import type { AuthContext } from './auth.js';
import type { PermissionRegistry } from './permissions.js';
import type { SubscriptionManager } from './realtime.js';
import type { TenantPool } from './tenancy.js';
import type { UsageMeter } from './usage-meter.js';
import type { TrellisDbConfig } from '../client/config.js';
import { StreamableMcpGateway } from './streamable-mcp-gateway.js';

export interface McpGatewayRouteCtx {
  pool: TenantPool;
  permissions: PermissionRegistry | null;
  subs: SubscriptionManager;
  meter: UsageMeter;
  authConfig: import('./auth.js').AuthConfig;
  config: TrellisDbConfig;
}

export class RoomMcpGateway {
  private gateway = new StreamableMcpGateway();

  async handle(
    req: Request,
    ctx: McpGatewayRouteCtx,
    auth: AuthContext,
    tenantId: string | null,
  ): Promise<Response> {
    const roomCtx: RoomMcpContext = {
      pool: ctx.pool,
      permissions: ctx.permissions,
      subs: ctx.subs,
      meter: ctx.meter,
      auth,
      tenantId,
      headerLane: req.headers.get('x-trellis-lane'),
      headerTenant: req.headers.get('x-trellis-tenant'),
    };

    return this.gateway.handle(req, () => createRoomMcpServer(roomCtx));
  }

  async close(): Promise<void> {
    await this.gateway.close();
  }
}

/** Shared gateway instance for the process lifetime. */
export const roomMcpGateway = new RoomMcpGateway();
