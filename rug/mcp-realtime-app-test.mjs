import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { readFileSync } from 'fs';

const cfg = JSON.parse(readFileSync('/Users/trentbrew/TURTLE/Projects/TRELLIS/fractal-playground/.trellis-db.json','utf8'));
const url = cfg.url.replace(/\/$/,'') + '/trellis/mcp';
const client = new Client({ name: 'realtime-app-test', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: {
    headers: {
      Authorization: 'Bearer ' + cfg.apiKey,
      'X-Trellis-Lane': 'agent:cursor',
    },
  },
});
await client.connect(transport);

const health = await client.callTool({
  name: 'graph_health',
  arguments: { room: 'realtime-app' },
});
const healthData = JSON.parse(health.content[0].text);

const summary = await client.callTool({
  name: 'get_graph_summary',
  arguments: { room: 'realtime-app', limit: 5 },
});
const summaryData = JSON.parse(summary.content[0].text);

const created = await client.callTool({
  name: 'create_node',
  arguments: {
    type: 'Note',
    attributes: {
      title: 'MCP → realtime-app tenant',
      body: 'Created by Wabi via room=realtime-app at ' + new Date().toISOString(),
    },
    room: 'realtime-app',
    lane: 'agent:cursor',
  },
});
const createdData = JSON.parse(created.content[0].text);

const read = await client.callTool({
  name: 'get_node',
  arguments: { id: createdData.id, room: 'realtime-app' },
});
const readData = JSON.parse(read.content[0].text);

console.log(JSON.stringify({
  tenantId: healthData.tenantId,
  entitiesBefore: healthData.entities,
  entityTypes: summaryData.entityTypes?.slice?.(0, 5) ?? summaryData.entityTypes,
  created: { id: createdData.id, tenantId: createdData.tenantId, title: readData.title },
  playgroundUrl: 'https://playground.trellis.computer/?room=realtime-app',
}, null, 2));

await transport.close();
