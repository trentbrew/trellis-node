/**
 * Local stand-in for the WebContainer SDK script.
 * Run from trellis-node root: node test/webcontainer/sdk-smoke.mjs
 */
import { mkdirSync, rmSync } from 'node:fs';
import { TrellisVcsEngine } from '../../dist/index.js';
import { createKernelBackend } from '../../dist/core/persist/factory.js';

const repoRoot = 'demo/sdk-repo';
try { rmSync(repoRoot, { recursive: true, force: true }); } catch {}
mkdirSync(repoRoot, { recursive: true });

const engine = new TrellisVcsEngine({ rootPath: repoRoot, agentId: 'agent:wc' });
const { opsCreated, context } = await engine.initRepo();
console.log('✓ initRepo:', opsCreated, 'ops | framework:', context.framework ?? 'unknown');

await engine.createMilestone('Hello from WebContainer');
const issueOp = await engine.createIssue('SDK smoke issue', {
  description: 'Created via TrellisVcsEngine',
  priority: 'high',
});
console.log('✓ issue:', issueOp.vcs?.issueId);
console.log('✓ counts — issues:', engine.listIssues().length,
  '| milestones:', engine.listMilestones().length,
  '| ops:', engine.getOps().length);

const backend = await createKernelBackend('demo/kernel.db', { backend: 'sqljs' });
backend.close();
console.log('✓ sql.js kernel backend ready');
console.log('\n🎉 SDK smoke passed');
