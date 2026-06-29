import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { readFileSync } from 'fs';

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

async function testRoom() {
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
  return { url, tools: tools.slice(0, 8), healthPreview: healthText };
}

try {
  console.log(JSON.stringify({
    gatewayMcp: await testGateway('/mcp'),
    gatewayGatewayMcp: await testGateway('/gateway/mcp'),
    room: await testRoom(),
  }, null, 2));
} catch (e) {
  console.error(JSON.stringify({ error: String(e), stack: e?.stack, cause: e?.cause }, null, 2));
  process.exit(1);
}
