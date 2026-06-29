import { TrellisVcsEngine } from '../src/engine.js';
const e = new TrellisVcsEngine({ rootPath: '/Users/trentbrew/TURTLE/Projects/TRELLIS/trellis-node' });
e.open();
e.switchBranch('main');
console.log('now on', e.getCurrentBranch());
