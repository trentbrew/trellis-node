import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { readFileSync } from 'fs';

async function main() {
  const results = {};

  async function testGateway(path) {
    const url = `https://mcp-gateway-bnsoz.sprites.app${path}`;
    const client = new Client({ name: 'smoke', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(url));
    await client.connect(transport);
    const list = await client.callTool({ name: 'list_rooms', arguments: {} });
    const text = list.content?.[0]?.text ?? '';
    const data = JSON.parse(text);
    await transport.close();
    return { path, count: data.count, rooms: data.rooms?.map(r => r.name) };
  }

  for (const path of ['/mcp', '/gateway/mcp']) {
    const key = path === '/mcp' ? 'gatewayMcp' : 'gatewayGatewayMcp';
    try {
      results[key] = await testGateway(path);
    } catch (e) {
      results[key] = { error: String(e), stack: e?.stack };
    }
  }

  try {
    const cfg = JSON.parse(readFileSync('/Users/trentbrew/TURTLE/Projects/TRELLIS/fractal-playground/.trellis-db.json','utf8'));
    const url = cfg.url.replace(/\/$/,'') + '/mcp';
    const client = new Client({ name: 'smoke', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${cfg.apiKey}` } },
    });
    await client.connect(transport);
    const tools = (await client.listTools()).tools.map(t => t.name);
    const health = await client.callTool({ name: 'graph_health', arguments: {} });
    const healthText = health.content?.[0]?.text?.slice(0, 200);
    await transport.close();
    results.room = { url, tools: tools.slice(0, 8), healthPreview: healthText };
  } catch (e) {
    results.room = { error: String(e), stack: e?.stack };
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ fatal: String(e), stack: e?.stack }, null, 2));
  process.exit(1);
});
