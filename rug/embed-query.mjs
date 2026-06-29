import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { readFileSync } from 'fs';

const cfg = JSON.parse(readFileSync('/Users/trentbrew/TURTLE/Projects/TRELLIS/fractal-playground/.trellis-db.json','utf8'));
const mcpUrl = cfg.url.replace(/\/$/,'') + '/trellis/mcp';
console.error('connecting', mcpUrl);
const client = new Client({ name: 'embed-query', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
  requestInit: {
    headers: {
      Authorization: 'Bearer ' + cfg.apiKey,
      'X-Trellis-Lane': 'agent:cursor',
    },
  },
});

try {
  await client.connect(transport);
  console.error('connected');
} catch (e) {
  console.error('connect fail', e);
  process.exit(1);
}

async function callTool(name, args) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? JSON.stringify(r);
  try { return JSON.parse(text); } catch { return { raw: text, isError: r.isError }; }
}

const noteId = 'note:a549a2f5-545e-423e-9abe-5530bbef2a0f';
const room = 'realtime-app';
const out = { room, expectedTenant: 'embed-realtime-app' };

out.graph_health = await callTool('graph_health', { room });
out.get_graph_summary = await callTool('get_graph_summary', { room, limit: 10 });
out.get_node = await callTool('get_node', { id: noteId, room });

const queries = [
  'find ?e where type = "Note"',
  'find ?e where type = "CollectionRecord"',
  'find ?e where type = "CollectionMeta"',
];
out.query_graph = {};
for (const q of queries) {
  const res = await callTool('query_graph', { query: q, room });
  out.query_graph[q] = {
    bindingCount: Array.isArray(res.bindings) ? res.bindings.length : null,
    executionTime: res.executionTime,
    sampleIds: Array.isArray(res.bindings) ? res.bindings.slice(0, 8).map(b => {
      const e = b.e;
      if (e && typeof e === 'object') return { id: e.id, type: e.type, title: e.title ?? e.name };
      return b;
    }) : res,
  };
}

await transport.close();
console.log(JSON.stringify(out, null, 2));
