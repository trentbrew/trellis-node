/**
 * Trellis Client — Public API Surface
 *
 * Isomorphic SDK for interacting with Trellis (local or remote).
 * Import from `trellis/client`:
 *
 *   import { TrellisClient } from 'trellis/client';
 *
 * @module trellis/client
 */

// Legacy DB SDK
export { TrellisDb, FetchError } from './sdk.js';
export type {
  EntityData,
  ListResult,
  QueryResult,
  UploadResult,
  AuthResult,
  Subscription,
  SubscriptionCallback,
  TrellisDbLocalOptions,
  TrellisDbRemoteOptions,
  TrellisDbOptions,
} from './sdk.js';

// Config
export {
  readConfig,
  writeConfig,
  updateConfig,
  hasConfig,
  configPath,
  defaultLocalConfig,
  CONFIG_FILE,
} from './config.js';
export type { TrellisDbConfig, DbMode } from './config.js';

// New Reactive VCS Client
export { TrellisClient } from './vcs-client.js';
export type {
  TrellisClientOptions,
  TrellisClientSyncOptions,
  TrellisClientTopic,
  SyncStatus,
} from './vcs-client.js';

// Reactive primitives (for framework adapters)
export { Signal, BatchSignal } from './reactive.js';

// Signal-first live reads
export { liveQuery, liveEntities, liveEntity } from './live.js';
export type {
  LiveEntitiesOptions,
  LiveEntityOptions,
  ReadState,
  LiveResource,
} from './live.js';
