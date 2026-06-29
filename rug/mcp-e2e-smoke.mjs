import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { readFileSync } from 'fs';

const cfg = JSON.parse(readFileSync('/Users/trentbrew/TURTLE/Projects/TRELLIS/fractal-playground/.trellis-db.json','utf8'));
const roomUrl = cfg.url.replace(/\/$/,'') + '/trellis/mcp';
const apiKey = cfg.apiKey;

async function roomClient() {
  const client = new Client({ name: 'crud-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(roomUrl), {
    requestInit: { headers: { Authorization: `Bearer ${apiKey}`, 'X-Trellis-Lane': 'agent:cursor' } },
  });
  await client.connect(transport);
  return { client, transport };
}

const gw = new Client({ name: 'gw-test', version: '1.0.0' });
let gatewayUrl = 'https://mcp.trellis.computer/gateway/mcp';
let gwTransport = new StreamableHTTPClientTransport(new URL(gatewayUrl));
try {
  await gw.connect(gwTransport);
} catch (e) {
  gatewayUrl = 'https://trellis-mcp-gateway.vercel.app/gateway/mcp';
  gwTransport = new StreamableHTTPClientTransport(new URL(gatewayUrl));
  await gw.connect(gwTransport);
}
const list = await gw.callTool({ name: 'list_rooms', arguments: {} });
const listData = JSON.parse(list.content[0].text);
await gwTransport.close();

const { client, transport } = await roomClient();
const tools = (await client.listTools()).tools.map(t => t.name);

const health = await client.callTool({ name: 'graph_health', arguments: {} });
const healthData = JSON.parse(health.content[0].text);

const testId = `mcp-smoke-${Date.now()}`;
const create = await client.callTool({
  name: 'create_node',
  arguments: {
    type: 'Note',
    properties: { title: testId, body: 'MCP CRUD smoke test from Wabi' },
    lane: 'agent:cursor',
  },
});
const createText = create.content[0].text;
let entityId = null;
try {
  const created = JSON.parse(createText);
  entityId = created.id || created.entityId;
} catch {
  entityId = createText.match(/[0-9a-f-]{36}/i)?.[0];
}

let read = null, updated = null, deleted = null;
if (entityId) {
  read = await client.callTool({ name: 'get_node', arguments: { id: entityId } });
  updated = await client.callTool({
    name: 'update_node',
    arguments: { id: entityId, properties: { body: 'updated via MCP' }, lane: 'agent:cursor' },
  });
  deleted = await client.callTool({ name: 'delete_node', arguments: { id: entityId, lane: 'agent:cursor' } });
}

await transport.close();

console.log(JSON.stringify({
  gateway: { url: gatewayUrl, roomCount: listData.count, rooms: listData.rooms?.map(r => r.name) },
  room: { url: roomUrl, tools, health: { entities: healthData.entities, ops: healthData.ops } },
  crud: {
    createOk: !create.isError,
    entityId,
    createPreview: createText.slice(0, 200),
    readOk: read && !read.isError,
    updateOk: updated && !updated.isError,
    deleteOk: deleted && !deleted.isError,
  },
}, null, 2));
