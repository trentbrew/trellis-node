/**
 * Standalone MCP discovery gateway HTTP server.
 *
 * `trellis mcp gateway serve` — discovery tools without a full room kernel.
 *
 * @module trellis/mcp
 */

import { discoveryMcpGateway } from '../server/discovery-mcp-gateway.js';
import {
  mcpServiceDocument,
  oauthAuthorizationServerMetadata,
  oauthProtectedResourceMetadata,
} from '../server/mcp-oauth-metadata.js';
import { corsPreflightResponse, withCors } from '../server/cors.js';

export interface GatewayServeOptions {
  port?: number;
  hostname?: string;
  configDir?: string;
  publicUrl?: string;
}

export async function createGatewayFetchHandler(
  opts: GatewayServeOptions = {},
): Promise<(req: Request) => Promise<Response>> {
  const configDir = opts.configDir ?? '.';
  const discoveryCtx = { configDir };

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') {
      return corsPreflightResponse(req);
    }

    const url = new URL(req.url);
    const path = url.pathname.replace(/\/$/, '') || '/';
    const origin =
      opts.publicUrl?.replace(/\/$/, '') ||
      `${url.protocol}//${url.host}`;

    const respond = (res: Response) => withCors(req, res);

    if (path === '/health') {
      return respond(
        new Response(
          JSON.stringify({
            status: 'ok',
            service: 'trellis-mcp-gateway',
            mcp: '/mcp',
            gateway: '/gateway/mcp',
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }

    if (path === '/.well-known/oauth-protected-resource') {
      return respond(
        new Response(JSON.stringify(oauthProtectedResourceMetadata(origin)), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }

    if (path === '/.well-known/oauth-authorization-server') {
      return respond(
        new Response(JSON.stringify(oauthAuthorizationServerMetadata(origin)), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }

    if (path === '/mcp' || path === '/gateway/mcp') {
      const res = await discoveryMcpGateway.handle(req, {
        ...discoveryCtx,
        origin,
        gatewayPublicUrl: origin,
      });
      return respond(res);
    }

    if (path === '/') {
      return respond(
        new Response(JSON.stringify(mcpServiceDocument(origin, {})), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }

    return respond(
      new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  };
}

export async function startGatewayServer(
  opts: GatewayServeOptions = {},
): Promise<{ port: number; stop: () => void }> {
  const port = opts.port ?? 3940;
  const fetch = await createGatewayFetchHandler(opts);

  if (typeof (globalThis as any).Bun !== 'undefined') {
    const server = (globalThis as any).Bun.serve({
      port,
      hostname: opts.hostname ?? '0.0.0.0',
      fetch,
    });
    return {
      port: server.port ?? port,
      stop: () => server.stop(true),
    };
  }

  const { startNodeServer } = await import('../server/node-adapter.js');
  const server = await startNodeServer({
    port,
    hostname: opts.hostname,
    fetch,
    websocket: {
      open() {},
      message() {},
      close() {},
    },
  });
  return {
    port: server.port,
    stop: () => server.stop(true),
  };
}
