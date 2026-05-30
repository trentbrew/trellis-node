/**
 * Scaffold module index
 * @module trellis/scaffold
 */

export { inferProjectContext } from './infer.js';
export type { ProjectContext, InferenceConfidence, InferOptions } from './infer.js';

export {
  loadProfile,
  saveProfile,
  hasProfile,
  updateProfile,
  promptForProfile,
} from './profile.js';
export type { UserProfile } from './profile.js';

export { writeAgentScaffold, writeIdeScaffold } from './write.js';
export type { AgentScaffoldConfig, ScaffoldInput, IdeScaffoldInput, IdeType, WorkspaceFootprint, FrameworkType } from './write.js';

export { seedContext } from './seed.js';
export type { SeedResult } from './seed.js';
