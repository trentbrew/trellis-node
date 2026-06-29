/**
 * Trellis Room MCP bridge — stdio proxy to a remote Streamable HTTP room.
 *
 * For MCP clients that only support stdio (Claude Desktop, older configs):
 *
 *   npx trellis mcp bridge --room https://my-room.sprites.app
 *
 * @module trellis/mcp
 */

import process from 'node:process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readConfig } from '../client/config.js';
import {
  resolveMcpTenantId,
} from './room-helpers.js';
import { roomMcpPathForUrl } from './room-registry.js';

export interface RoomMcpBridgeOptions {
  /** Room base URL or full `/mcp` URL. Falls back to `.trellis-db.json`. */
  room?: string;
  /** API key. Falls back to `.trellis-db.json`. */
  apiKey?: string;
  /** Directory containing `.trellis-db.json`. */
  configDir?: string;
  /** Default tenant for all tool calls (e.g. embed-design-review). */
  tenant?: string;
  /** Playground `?room=` slug → tenant `embed-{slug}`. */
  playgroundRoom?: string;
  /** Suppress stderr startup line (for harness / IDE configs). */
  quiet?: boolean;
}

export interface ResolvedRoomMcpBridgeConfig {
  url: string;
  apiKey?: string;
  tenantId?: string | null;
}

/** Normalize a room base URL to the Streamable HTTP MCP endpoint. */
export function resolveRoomMcpUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  if (trimmed.endsWith('/mcp') || trimmed.endsWith('/trellis/mcp')) {
    return trimmed;
  }
  return `${trimmed}${roomMcpPathForUrl(trimmed)}`;
}

/** Resolve room URL + API key from CLI flags or `.trellis-db.json`. */
export function resolveBridgeConfig(
  opts: RoomMcpBridgeOptions,
): ResolvedRoomMcpBridgeConfig {
  const configDir = opts.configDir ?? '.';
  const fileConfig = readConfig(configDir);

  const room =
    opts.room ??
    process.env.TRELLIS_ROOM_URL?.trim() ??
    fileConfig?.url ??
    (fileConfig?.mode === 'local' && fileConfig.port
      ? `http://localhost:${fileConfig.port}`
      : undefined);

  if (!room) {
    throw new Error(
      'Room URL required. Pass --room <url> or run from a directory with remote .trellis-db.json',
    );
  }

  const apiKey = opts.apiKey ?? fileConfig?.apiKey;

  const tenantId = resolveMcpTenantId({
    toolTenantId:
      opts.tenant?.trim() ||
      process.env.TRELLIS_TENANT_ID?.trim() ||
      undefined,
    roomSlug:
      opts.playgroundRoom?.trim() ||
      process.env.TRELLIS_PLAYGROUND_ROOM?.trim() ||
      undefined,
  });

  let url = resolveRoomMcpUrl(room);
  if (tenantId) {
    const parsed = new URL(url);
    parsed.searchParams.set('tenantId', tenantId);
    url = parsed.toString();
  }

  return {
    url,
    apiKey,
    tenantId,
  };
}

/** Connect an MCP client to a remote Trellis room. */
export async function connectRemoteRoomClient(
  config: ResolvedRoomMcpBridgeConfig,
): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const headers: Record<string, string> = {};
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }
  if (config.tenantId) {
    headers['X-Trellis-Tenant'] = config.tenantId;
  }

  const client = new Client({
    name: 'trellis-room-bridge',
    version: '0.1.0',
  });

  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: Object.keys(headers).length ? { headers } : undefined,
  });

  await client.connect(transport);
  return { client, transport };
}

/** Local MCP server that forwards tool calls to a remote room client. */
export function createRoomMcpProxyServer(remote: Client): Server {
  const server = new Server(
    { name: 'trellis-room-bridge', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => remote.listTools());

  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    remote.callTool(request.params),
  );

  return server;
}

/** Run stdio MCP bridge until stdin closes or the process is interrupted. */
export async function runRoomMcpBridge(opts: RoomMcpBridgeOptions): Promise<void> {
  const config = resolveBridgeConfig(opts);
  const { client, transport } = await connectRemoteRoomClient(config);
  const server = createRoomMcpProxyServer(client);
  const stdio = new StdioServerTransport();

  let closing = false;
  const shutdown = async (code = 0) => {
    if (closing) return;
    closing = true;
    try {
      await transport.close();
    } catch {
      /* ignore */
    }
    process.exit(code);
  };

  process.on('SIGINT', () => void shutdown(0));
  process.on('SIGTERM', () => void shutdown(0));
  process.stdin.on('end', () => void shutdown(0));

  if (!opts.quiet) {
    const tenant =
      config.tenantId != null ? ` tenant=${config.tenantId}` : '';
    console.error(`Trellis Room MCP bridge → ${config.url}${tenant}`);
  }

  await server.connect(stdio);
}
