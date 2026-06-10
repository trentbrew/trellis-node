/**
 * Trellis Browser — remote DB, schema, realtime, and live-read primitives.
 *
 * Import from `trellis/browser` in browser applications to avoid Node/server
 * modules such as filesystem config, embedded tenancy, or local SQLite.
 *
 * @module trellis/browser
 */

export { TrellisDb, FetchError } from '../client/sdk.browser.js';
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
} from '../client/sdk.browser.js';

export { Signal, BatchSignal } from '../client/reactive.js';
export { liveQuery, liveEntities, liveEntity } from '../client/live.js';
export type {
  LiveEntitiesOptions,
  LiveEntityOptions,
  LiveResource,
  ReadState,
} from '../client/live.js';

export {
  defineType,
  rel,
  rollup,
  formula,
  entitiesQuery,
  entityQuery,
  escapeValue,
  formatEqlLiteral,
  isWhereFilter,
  whereCondition,
  entityMutations,
  resolveRelations,
  inverseForeignKey,
  bindingEntityId,
  bindingToEntity,
  entityRecordToPlain,
  hydrateBindings,
  isSparseBinding,
} from '../schema/index.js';
export type {
  AnyType,
  ComputedField,
  ComputedMap,
  DefineTypeOptions,
  EntityMutations,
  InferEntitiesRead,
  InferEntityRead,
  InferResolvedType,
  InferType,
  Ref,
  Relation,
  RelationMap,
  RelTarget,
  ResolveSpec,
  ResolveSpecFor,
  TrellisType,
  WhereFilter,
  WhereInput,
  WhereOp,
  WhereValue,
} from '../schema/index.js';

export {
  RealtimeRoom,
  MemoryHub,
  MemoryRealtimeTransport,
  BroadcastChannelTransport,
  WebSocketRelayTransport,
  DurableObjectRelayTransport,
  joinPresence,
  createPresenceTransport,
  PersistentChannel,
  localStorageChannelStore,
  DEFAULT_MAX_RECORDS,
  RealtimeText,
  REALTIME_PROTOCOL,
} from '../realtime/index.js';
export type {
  BroadcastChannelTransportOptions,
  BroadcastEvent,
  ChannelRecord,
  ChannelStore,
  DurableObjectRelayReconnect,
  DurableObjectRelayTransportOptions,
  PersistentChannelOptions,
  PresenceOptions,
  PresencePeer,
  PresenceState,
  RealtimeMessage,
  RealtimeRoomOptions,
  RealtimeTransport,
  RealtimeTextOptions,
  TextNode,
  TextOp,
  WebSocketRelayTransportOptions,
} from '../realtime/index.js';
