import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

async function smoke(label, mcpUrl, opts = {}) {
  const client = new Client({ name: 'smoke-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), opts.transportOptions ?? {});
  const t0 = Date.now();
  await client.connect(transport);
  const tools = (await client.listTools()).tools.map((t) => t.name);
  const list = await client.callTool({ name: 'list_rooms', arguments: {} });
  const text = list.content?.[0]?.text ?? '';
  const data = JSON.parse(text);
  const connect = await client.callTool({ name: 'connect_room', arguments: { name: 'fractals-demo-0610' } });
  const connectText = connect.content?.[0]?.text ?? '';
  const redacted = connectText.replace(/spk_[A-Za-z0-9_-]+/g, 'spk_[REDACTED]');
  await transport.close();
  return { label, mcpUrl, ms: Date.now() - t0, tools, roomCount: data.count, rooms: data.rooms?.map((r) => r.name), connectPreview: redacted.slice(0, 500) };
}

const results = { paths: {} };
try {
  const urlMcp = 'https://mcp-gateway-bnsoz.sprites.app/mcp';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const transport = new StreamableHTTPClientTransport(new URL(urlMcp), { requestInit: { signal: ctrl.signal } });
    const client = new Client({ name: 'smoke-test', version: '1.0.0' });
    await client.connect(transport);
    results.paths['/mcp'] = 'connected';
    await transport.close();
  } catch (e) {
    results.paths['/mcp'] = { error: e.message || String(e) };
  } finally {
    clearTimeout(timer);
  }
} catch (e) {
  results.paths['/mcp'] = { error: String(e) };
}

results.gateway = await smoke('gateway', 'https://mcp-gateway-bnsoz.sprites.app/gateway/mcp');
console.log(JSON.stringify(results, null, 2));
