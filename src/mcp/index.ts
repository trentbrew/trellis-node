#!/usr/bin/env node
/**
 * TrellisVCS MCP Server — stdio or HTTP/SSE entry point
 *
 * Run with: bun run src/mcp/index.ts
 * Or via MCP config: { "command": "bun", "args": ["run", "src/mcp/index.ts"] }
 *
 * Flags:
 *   --quiet    Suppress stderr startup message (for harness mode)
 *   --path     Repository root path (defaults to cwd)
 *   --http     Run HTTP/SSE server instead of stdio (for web clients)
 *   --port     HTTP port (default: 3333)
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createTrellisMcpServer } from './server.js';
import http from 'http';

async function main() {
  const quiet = process.argv.includes('--quiet');
  const httpMode = process.argv.includes('--http');
  const portArg = process.argv.find(
    (arg, i) => i > 0 && process.argv[i - 1] === '--port',
  );
  const port = portArg ? parseInt(portArg, 10) : 3333;

  const server = createTrellisMcpServer();

  if (httpMode) {
    // HTTP/SSE mode for web clients
    const httpServer = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${port}`);

      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // SSE endpoint for MCP
      if (url.pathname === '/sse') {
        const transport = new SSEServerTransport('/message', res);
        await server.connect(transport);
        if (!quiet) {
          console.error(`TrellisVCS MCP Server SSE connection established`);
        }
        return;
      }

      // Message endpoint for POST requests
      if (url.pathname === '/message' && req.method === 'POST') {
        // The SSE transport handles this internally
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      // Health check
      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'ok',
            name: 'trellis-vcs',
            version: '0.1.0',
          }),
        );
        return;
      }

      // Default: 404
      res.writeHead(404);
      res.end('Not found');
    });

    httpServer.listen(port, () => {
      if (!quiet) {
        console.error(
          `TrellisVCS MCP Server running on http://localhost:${port}`,
        );
        console.error(`  SSE endpoint: http://localhost:${port}/sse`);
        console.error(`  Health check: http://localhost:${port}/health`);
      }
    });
  } else {
    // Stdio mode (default)
    const transport = new StdioServerTransport();
    await server.connect(transport);
    if (!quiet) {
      console.error('TrellisVCS MCP Server running on stdio');
    }
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
