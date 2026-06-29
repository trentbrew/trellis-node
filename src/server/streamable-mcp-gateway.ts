/**
 * Streamable HTTP MCP gateway — shared session transport for room + discovery.
 *
 * @module trellis/server
 */

import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

type SessionEntry = {
  transport: WebStandardStreamableHTTPServerTransport;
};

function mcpError(status: number, message: string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message },
      id: null,
    }),
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

export class StreamableMcpGateway {
  private sessions = new Map<string, SessionEntry>();

  async handle(
    req: Request,
    createServer: () => McpServer | Promise<McpServer>,
  ): Promise<Response> {
    const sessionId = req.headers.get('mcp-session-id');

    if (sessionId) {
      const entry = this.sessions.get(sessionId);
      if (!entry) {
        return mcpError(400, 'Invalid or expired MCP session');
      }
      return entry.transport.handleRequest(req);
    }

    if (req.method === 'POST') {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return mcpError(400, 'Invalid JSON body');
      }

      if (!isInitializeRequest(body)) {
        return mcpError(
          400,
          'Bad Request: POST without mcp-session-id must be an initialize request',
        );
      }

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          this.sessions.set(sid, { transport });
        },
        onsessionclosed: (sid) => {
          this.sessions.delete(sid);
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) this.sessions.delete(sid);
      };

      const server = await createServer();
      await server.connect(transport);

      return transport.handleRequest(req, { parsedBody: body });
    }

    return mcpError(400, 'MCP session required');
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.sessions.values()].map(({ transport }) => transport.close()),
    );
    this.sessions.clear();
  }
}
