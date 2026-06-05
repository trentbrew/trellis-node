/**
 * Trellis DB — Deprecated Compatibility Shim
 *
 * ⚠️  `trellis/db` is deprecated. Use `trellis/server` and `trellis/client` instead.
 *
 *   import { startServer } from 'trellis/server';
 *   import { TrellisClient } from 'trellis/client';
 *
 * This module re-exports everything from both for backward compatibility.
 *
 * @deprecated Use `trellis/server` and `trellis/client` instead.
 * @module trellis/db
 */

import { TrellisDb } from '../client/index.js';

// Client exports
export {
  FetchError,
  readConfig,
  writeConfig,
  updateConfig,
  hasConfig,
  configPath,
  defaultLocalConfig,
  CONFIG_FILE,
} from '../client/index.js';
export { TrellisDb };
export { TrellisDb as TrellisClient };
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
  TrellisDbConfig,
  DbMode,
} from '../client/index.js';

// Server exports
export {
  startServer,
  resolveAuth,
  signJwt,
  verifyJwt,
  buildOAuthUrl,
  exchangeOAuthCode,
  GOOGLE_PROVIDER,
  GITHUB_PROVIDER,
  ANONYMOUS,
  PermissionRegistry,
  PermissionError,
  PUBLIC_READ,
  FULLY_PUBLIC,
  OWNER_ONLY,
  ADMIN_ONLY,
  TenantPool,
  DEFAULT_TENANT,
  SubscriptionManager,
  importFile,
  importRecords,
  deploy,
} from '../server/index.js';
export type {
  ServerConfig,
  AuthContext,
  AuthConfig,
  OAuthProvider,
  PermissionRule,
  PermissionsDef,
  CrudOp,
  RealtimeSubscription,
  WsClient,
  ImportOptions,
  ImportResult,
  DeployOptions,
  DeployResult,
} from '../server/index.js';
