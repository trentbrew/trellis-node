/**
 * TrellisVCS Core — Public Surface
 *
 * @module vcs
 *
 * Re-exports all core VCS primitives: op types and constructors, EAV
 * decomposition, branch/milestone/checkpoint management, file-level
 * diff and three-way merge, the content-addressed blob store, and the
 * shared {@link EngineContext} interface.
 */

export * from './types.js';
export * from './ops.js';
export * from './decompose.js';
export * from './vcs-middleware.js';
export * from './blob-store.js';
export * from './engine-context.js';
export * from './branch.js';
export * from './milestone.js';
export * from './checkpoint.js';
export * from './diff.js';
export * from './merge.js';
export * from './issue.js';
export * from './op-log.js';
export * from './lane.js';
