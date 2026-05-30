/**
 * Trellis Server — Public API Surface
 *
 * HTTP+WebSocket server, auth, permissions, multi-tenancy, and deployment.
 * Import from `trellis/server`:
 *
 *   import { startServer } from 'trellis/server';
 *
 * @module trellis/server
 */

// Server
export { startServer, startServerCrossRuntime } from './server.js';
export type { ServerConfig, TrellisHttpServer } from './server.js';

// Auth
export {
  resolveAuth,
  signJwt,
  verifyJwt,
  buildOAuthUrl,
  exchangeOAuthCode,
  GOOGLE_PROVIDER,
  GITHUB_PROVIDER,
  ANONYMOUS,
} from './auth.js';
export type { AuthContext, AuthConfig, OAuthProvider } from './auth.js';

// Permissions
export {
  PermissionRegistry,
  PermissionError,
  PUBLIC_READ,
  FULLY_PUBLIC,
  OWNER_ONLY,
  ADMIN_ONLY,
} from './permissions.js';
export type { PermissionRule, PermissionsDef, CrudOp } from './permissions.js';

// Multi-tenancy
export { TenantPool, DEFAULT_TENANT } from './tenancy.js';

// Realtime
export { SubscriptionManager } from './realtime.js';
export type {
  Subscription as RealtimeSubscription,
  WsClient,
} from './realtime.js';

// Import
export { importFile, importRecords } from './import.js';
export type { ImportOptions, ImportResult } from './import.js';

// Deploy
export { deploy } from './deploy.js';
export type { DeployOptions, DeployResult } from './deploy.js';

// Sprites
export {
  runSpriteCmd,
  runSpriteCopy,
  runSpriteInteractive,
  assertSpriteCli,
  resolveSprite,
} from './sprites.js';

// VM Config
export {
  loadVmConfig,
  saveVmConfig,
  getActiveSprite,
  setActiveSprite,
  trackSprite,
  untrackSprite,
  isSpriteTracked,
  getSprite,
  VmConfig,
} from './vm-config.js';
