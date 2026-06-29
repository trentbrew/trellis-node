import { TrellisVcsEngine } from '../src/engine.js';

const root = '/Users/trentbrew/TURTLE/Projects/TRELLIS/trellis-node';
const e = new TrellisVcsEngine({ rootPath: root });
e.open();
e.switchBranch('main');
await e.runCriteria('TRL-40', root);
const info = e.getIssue('TRL-40');
console.log('failing', info.criteria.filter((c) => c.status !== 'passed').length);
const close = await e.closeIssue('TRL-40', { confirm: true });
console.log('closed TRL-40', !!close.op);
