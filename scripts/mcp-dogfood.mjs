#!/usr/bin/env node
/**
 * Remote MCP dogfood — proves agent write → Playground tenant.
 *
 * Usage:
 *   TRELLIS_ROOM_URL=https://….sprites.app \
 *   TRELLIS_API_KEY=spk_… \
 *   TRELLIS_PLAYGROUND_ROOM=my-session-slug \
 *   node scripts/mcp-dogfood.mjs
 *
 * Optional: TRELLIS_MCP_PATH=/trellis/mcp (auto for *.sprites.app)
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const roomBase = process.env.TRELLIS_ROOM_URL?.trim();
const apiKey = process.env.TRELLIS_API_KEY?.trim();
const playgroundRoom =
  process.env.TRELLIS_PLAYGROUND_ROOM?.trim() ?? `dogfood-${Date.now()}`;
const collectionSlug =
  process.env.TRELLIS_DOGFOOD_COLLECTION?.trim() ?? 'mcp-dogfood';
const title = process.env.TRELLIS_DOGFOOD_TITLE?.trim() ?? 'MCP dogfood row';

function mcpPathFor(base) {
  const env = process.env.TRELLIS_MCP_PATH?.trim();
  if (env) return env.startsWith('/') ? env : `/${env}`;
  try {
    if (/\.sprites\.app$/i.test(new URL(base).hostname)) return '/trellis/mcp';
  } catch {
    /* ignore */
  }
  return '/mcp';
}

function resolveMcpUrl(base) {
  const trimmed = base.replace(/\/$/, '');
  if (trimmed.endsWith('/mcp') || trimmed.endsWith('/trellis/mcp')) {
    return trimmed;
  }
  return `${trimmed}${mcpPathFor(trimmed)}`;
}

function toolText(result) {
  const block = result.content?.find((c) => c.type === 'text');
  return block?.text ?? '';
}

async function main() {
  if (!roomBase) {
    console.error('Set TRELLIS_ROOM_URL (room base URL, not Playground UI).');
    process.exit(1);
  }

  const mcpUrl = resolveMcpUrl(roomBase);
  const tenant = playgroundRoom.startsWith('embed-')
    ? playgroundRoom
    : `embed-${playgroundRoom}`;

  console.log('Room MCP:', mcpUrl);
  console.log('Playground room:', playgroundRoom, '→ tenant', tenant);
  console.log('');

  const headers = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const client = new Client({ name: 'trellis-mcp-dogfood', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers },
  });

  await client.connect(transport);
  try {
    const summary = await client.callTool({
      name: 'get_graph_summary',
      arguments: { room: playgroundRoom },
    });
    console.log('get_graph_summary:', toolText(summary).slice(0, 400), '…\n');

    const stamp = new Date().toISOString();
    const created = await client.callTool({
      name: 'create_collection_record',
      arguments: {
        room: playgroundRoom,
        collectionSlug,
        title: `${title} @ ${stamp}`,
        body: 'Created by scripts/mcp-dogfood.mjs',
        ensureCollection: true,
        collectionTitle: 'MCP Dogfood',
        lane: 'agent:dogfood',
      },
    });
    const payload = JSON.parse(toolText(created));
    console.log('create_collection_record:', JSON.stringify(payload, null, 2));
    console.log('');
    console.log('Verify in browser:');
    console.log(
      `  https://playground.trellis.computer/?room=${encodeURIComponent(playgroundRoom)}`,
    );
    console.log(`  Open collection "${collectionSlug}" — look for title with stamp above.`);
  } finally {
    await transport.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
