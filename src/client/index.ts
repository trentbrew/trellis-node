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

// SDK
export { TrellisDb as TrellisClient, TrellisDb, FetchError } from './sdk.js';
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
