/**
 * Trellis Client — browser runtime surface
 *
 * This barrel is selected by the package `browser` condition. It exposes the
 * remote DB SDK and framework-agnostic live-read primitives without importing
 * filesystem config, embedded tenancy, or the VCS engine.
 *
 * @module trellis/client
 */

export { TrellisDb, FetchError } from './sdk.browser.js';
export type {
  AuthResult,
  EntityData,
  ListResult,
  QueryResult,
  Subscription,
  SubscriptionCallback,
  TrellisDbLocalOptions,
  TrellisDbOptions,
  TrellisDbRemoteOptions,
  UploadResult,
} from './sdk.browser.js';

export { Signal, BatchSignal } from './reactive.js';

export { liveQuery, liveEntities, liveEntity } from './live.js';
export type {
  LiveEntitiesOptions,
  LiveEntityOptions,
  LiveResource,
  ReadState,
} from './live.js';

export type { DbMode, TrellisDbConfig } from './config.js';

export const CONFIG_FILE = '.trellis-db.json';

/**
 * Filesystem-backed Trellis config is not available in browsers.
 */
export function hasConfig(_dir = '.'): boolean {
  return false;
}

/**
 * Filesystem-backed Trellis config is not available in browsers.
 */
export function readConfig(_dir = '.'): null {
  return null;
}

export function configPath(dir = '.'): string {
  const base = dir.endsWith('/') ? dir.slice(0, -1) : dir;
  return `${base}/${CONFIG_FILE}`;
}

export function writeConfig(): never {
  throw browserConfigError('writeConfig()');
}

export function updateConfig(): never {
  throw browserConfigError('updateConfig()');
}

export function defaultLocalConfig(
  dbPath: string,
  opts: Partial<import('./config.js').TrellisDbConfig> = {},
): import('./config.js').TrellisDbConfig {
  return {
    mode: 'local',
    dbPath,
    port: 3000,
    multiTenant: false,
    ...opts,
  };
}

function browserConfigError(feature: string): Error {
  return new Error(
    `${feature} is only available in Node. ` +
      'Browser apps should construct `new TrellisDb({ url })` directly.',
  );
}
