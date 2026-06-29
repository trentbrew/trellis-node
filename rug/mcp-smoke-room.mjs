import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const apiKey = process.env.API_KEY;
const url = 'https://fractals-demo-0610-bnsoz.sprites.app/mcp';
const client = new Client({ name: 'smoke-test', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
});
await client.connect(transport);
const tools = (await client.listTools()).tools.map((t) => t.name);
const summary = await client.callTool({ name: 'get_graph_summary', arguments: {} });
const text = summary.content?.[0]?.text ?? JSON.stringify(summary);
const redacted = text.replace(/spk_[A-Za-z0-9_-]+/g, 'spk_[REDACTED]');
let parsed;
try { parsed = JSON.parse(text); } catch { parsed = null; }
console.log(JSON.stringify({
  url,
  tools,
  graph_health: parsed?.graph_health ?? null,
  graphHealthWorks: parsed?.graph_health != null,
  summaryKeys: parsed ? Object.keys(parsed) : null,
  summaryPreview: redacted.slice(0, 700),
}, null, 2));
await transport.close();
