/**
 * TrellisVCS — Graph-native, code-first version control
 *
 * @module trellisvcs
 *
 * Public API surface. Import {@link TrellisVcsEngine} as the main entry point,
 * plus core VCS types, the {@link FileWatcher}, and the {@link Ingestion}
 * pipeline.
 *
 * For sub-modules, import directly from:
 *   - `./garden/index.js`   — Idea Garden cluster detection + query
 *   - `./semantic/index.js` — Semantic parsing + diff/merge
 *   - `./sync/index.js`     — Peer sync + CRDT reconciler
 *   - `./identity/index.js` — Ed25519 identity + governance
 */

export { TrellisVcsEngine } from './engine.js';
export * from './vcs/index.js';
export { FileWatcher } from './watcher/fs-watcher.js';
export { Ingestion } from './watcher/ingestion.js';

// Core kernel (generic graph CRUD, independent of VCS)
export { TrellisKernel } from './core/kernel/trellis-kernel.js';
export { SqliteKernelBackend } from './core/persist/sqlite-backend.js';
export type {
  KernelConfig,
  MutateResult,
  EntityRecord,
} from './core/kernel/trellis-kernel.js';

// Scaffold (agent onboarding + context inference)
export {
  inferProjectContext,
  loadProfile,
  saveProfile,
  hasProfile,
  writeAgentScaffold,
} from './scaffold/index.js';
export type {
  ProjectContext,
  InferenceConfidence,
  UserProfile,
  ScaffoldInput,
} from './scaffold/index.js';
