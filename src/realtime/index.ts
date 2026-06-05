/**
 * Trellis Realtime — Public Surface
 *
 * Ephemeral presence + broadcast primitives for multiplayer UI: active-user
 * avatars, chat, live cursors, and collaborative text. Distinct from the
 * persisted VCS op log — realtime data is mesh-broadcast and never written to
 * the causal history.
 *
 * @module trellis/realtime
 *
 *   import {
 *     RealtimeRoom,
 *     BroadcastChannelTransport,
 *     WebSocketRelayTransport,
 *   } from 'trellis/realtime';
 *
 *   const room = RealtimeRoom.join({
 *     transport: new BroadcastChannelTransport({ id, channel: 'room:42' }),
 *     initialPresence: { name: 'Ada', color: '#6d5bfa' },
 *   });
 *
 *   // Or relay across browsers:
 *   new WebSocketRelayTransport({ id, url: 'ws://localhost:8231/rt' });
 */

export { RealtimeRoom } from './room.js';
export type { RealtimeRoomOptions } from './room.js';

export { MemoryHub, MemoryRealtimeTransport } from './memory-hub.js';

export { BroadcastChannelTransport } from './broadcast-channel-transport.js';
export type { BroadcastChannelTransportOptions } from './broadcast-channel-transport.js';

export { WebSocketRelayTransport } from './websocket-relay-transport.js';
export type { WebSocketRelayTransportOptions } from './websocket-relay-transport.js';

export {
  RelayPersistence,
  DEFAULT_MAX_CHAT,
  DEFAULT_MAX_TEXT_OPS,
} from './relay-persistence.js';
export type { RelayPersistenceOptions } from './relay-persistence.js';

export {
  PersistentChannel,
  localStorageChannelStore,
  DEFAULT_MAX_RECORDS,
} from './persistent-channel.js';
export type {
  ChannelRecord,
  ChannelStore,
  PersistentChannelOptions,
} from './persistent-channel.js';

export { RealtimeText } from './text.js';
export type { RealtimeTextOptions, TextNode, TextOp } from './text.js';

export { REALTIME_PROTOCOL } from './types.js';
export type {
  PresenceState,
  PresencePeer,
  BroadcastEvent,
  RealtimeMessage,
  RealtimeTransport,
} from './types.js';
