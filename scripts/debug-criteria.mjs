import { TrellisVcsEngine } from '../src/engine.js';
const root = '/Users/trentbrew/TURTLE/Projects/TRELLIS/trellis-node';
const e = new TrellisVcsEngine({ rootPath: root });
e.open();
await e.setCriterionStatus('TRL-40', 1, 'passed');
await e.setCriterionStatus('TRL-40', 13, 'passed');
await e.setCriterionStatus('TRL-40', 14, 'passed');
for (const id of ['ac-1','ac-13','ac-14']) {
  const facts = e.getStore().getFactsByEntity(`criterion:TRL-40:${id}`).filter(f => f.a === 'status');
  console.log(id, facts.map(f => f.v));
}
const close = await e.closeIssue('TRL-40', { confirm: true });
console.log('closed', !!close.op);
