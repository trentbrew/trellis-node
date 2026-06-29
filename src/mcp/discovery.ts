/**
 * MCP discovery tools — list/get/connect registered Trellis rooms.
 *
 * Mounted at `/gateway/mcp` on room servers and on `trellis mcp gateway serve`.
 *
 * @module trellis/mcp
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  gatewayPublicUrl,
  getRegisteredRoom,
  listRegisteredRooms,
  type RoomRegistryOptions,
} from './room-registry.js';
import { playgroundRoomToTenant } from './room-helpers.js';

export interface DiscoveryMcpContext extends RoomRegistryOptions {
  /** Request origin for OAuth metadata hints (e.g. https://room.sprites.app). */
  origin?: string;
}

function text(content: string) {
  return { content: [{ type: 'text' as const, text: content }] };
}

function jsonText(data: unknown) {
  return text(JSON.stringify(data, null, 2));
}

export function createDiscoveryMcpServer(ctx: DiscoveryMcpContext = {}): McpServer {
  const server = new McpServer({
    name: 'trellis-mcp-gateway',
    version: '0.1.0',
  });

  server.registerTool(
    'list_rooms',
    {
      description:
        'List Trellis rooms known to this gateway (deployed Sprites + local config).',
      inputSchema: {},
    },
    async () => {
      const rooms = listRegisteredRooms(ctx).map(
        ({ name, url, mcpUrl, source, active, deployedAt }) => ({
          name,
          url,
          mcpUrl,
          source,
          active,
          deployedAt,
        }),
      );
      return jsonText({
        gateway: gatewayPublicUrl(ctx),
        count: rooms.length,
        rooms,
      });
    },
  );

  server.registerTool(
    'get_room',
    {
      description: 'Get details for a room by name or URL.',
      inputSchema: {
        name: z.string().describe('Room name or base URL'),
      },
    },
    async ({ name }) => {
      const room = getRegisteredRoom(name, ctx);
      if (!room) return text(`Room not found: ${name}`);
      return jsonText(room);
    },
  );

  server.registerTool(
    'connect_room',
    {
      description:
        'Return MCP client configuration to connect an agent to a room graph.',
      inputSchema: {
        name: z.string().describe('Room name or base URL'),
        client: z
          .string()
          .optional()
          .describe('Client hint: cursor | claude | generic'),
        playgroundRoom: z
          .string()
          .optional()
          .describe(
            'Playground ?room= slug — adds embed-{slug} tenant to bridge / headers',
          ),
      },
    },
    async ({ name, client, playgroundRoom }) => {
      const room = getRegisteredRoom(name, ctx);
      if (!room) return text(`Room not found: ${name}`);

      const tenantId = playgroundRoom?.trim()
        ? playgroundRoomToTenant(playgroundRoom)
        : undefined;

      const authHeader = room.apiKey
        ? { Authorization: `Bearer ${room.apiKey}` }
        : undefined;
      const tenantHeader = tenantId
        ? { 'X-Trellis-Tenant': tenantId }
        : undefined;
      const httpHeaders = {
        ...authHeader,
        ...tenantHeader,
      };

      const bridgeTenantArgs = tenantId
        ? playgroundRoom?.trim().startsWith('embed-')
          ? ['--tenant', tenantId]
          : ['--playground-room', playgroundRoom!.trim()]
        : [];

      const cursor = {
        mcpServers: {
          'trellis-room': {
            url: room.mcpUrl,
            ...(Object.keys(httpHeaders).length ? { headers: httpHeaders } : {}),
          },
        },
      };

      const claude = room.apiKey
        ? {
            mcpServers: {
              'trellis-room': {
                command: 'npx',
                args: [
                  'trellis',
                  'mcp',
                  'bridge',
                  '--room',
                  room.url,
                  '--api-key',
                  room.apiKey,
                  ...bridgeTenantArgs,
                ],
              },
            },
          }
        : {
            mcpServers: {
              'trellis-room': {
                command: 'npx',
                args: [
                  'trellis',
                  'mcp',
                  'bridge',
                  '--room',
                  room.url,
                  ...bridgeTenantArgs,
                ],
              },
            },
          };

      const oauth =
        ctx.origin != null
          ? {
              loginUrl: `${ctx.origin}/auth/oauth/google`,
              tokenUse: 'Authorization: Bearer <jwt>',
              protectedResource: `${ctx.origin}/.well-known/oauth-protected-resource`,
            }
          : undefined;

      const configs: Record<string, unknown> = {
        cursor,
        claude,
        generic: {
          url: room.mcpUrl,
          ...(Object.keys(httpHeaders).length ? { headers: httpHeaders } : {}),
        },
      };

      return jsonText({
        room: {
          name: room.name,
          url: room.url,
          mcpUrl: room.mcpUrl,
        },
        ...(tenantId
          ? {
              playground: {
                roomSlug: playgroundRoom!.trim(),
                tenantId,
                urlHint: `https://playground.trellis.computer/?room=${encodeURIComponent(playgroundRoom!.trim())}`,
                mcpToolHint:
                  'Pass room or tenantId on each tool call, or set X-Trellis-Tenant header / bridge --playground-room',
              },
            }
          : {}),
        oauth,
        config:
          client && configs[client]
            ? configs[client]
            : { cursor, claude, generic: configs.generic },
      });
    },
  );

  return server;
}
