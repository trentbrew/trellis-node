/**
 * Idea Garden — Public Surface
 *
 * @module garden
 *
 * Re-exports cluster detection heuristics (context-switch, revert, stale-branch)
 * and the {@link IdeaGarden} query/revive layer.
 *
 * @see DESIGN.md §7 for the full Idea Garden specification.
 */

export {
  detectClusters,
  defaultDetectors,
  contextSwitchDetector,
  revertDetector,
  staleBranchDetector,
} from './cluster.js';

export type { IdeaCluster, ClusterDetector } from './cluster.js';

export { IdeaGarden, buildMilestonedOpHashes } from './garden.js';

export type {
  ScoredCluster,
  GardenSearchOpts,
  GardenContext,
  GardenEmbedder,
} from './garden.js';
