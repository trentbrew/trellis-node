import { TrellisVcsEngine } from '../src/engine.js';

const laneId = 'lane-cb52126d-64cf-473f-862d-9f9a10961b84';
const rootPath = '/Users/trentbrew/TURTLE/Projects/TRELLIS/trellis-node';

console.log('start');
const engine = new TrellisVcsEngine({ rootPath });
engine.open();
console.log('branch', engine.status().branch);

const dry = await engine.promoteLane(laneId, { dryRun: true });
console.log('dryRun canPromote', dry.canPromote);

if (!dry.canPromote) {
  console.error('Cannot promote');
  process.exit(1);
}

const result = await engine.promoteLane(laneId);
console.log('promoted', result.promoted, 'ops', result.integrationOpsAppended);
