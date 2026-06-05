/**
 * PartyKit / Durable Object room handler for Trellis sync.
 *
 * Deploy as a PartyKit server module:
 *
 *   import { createPartyKitRoomHandler } from 'trellis/sync/partykit-room';
 *   export default createPartyKitRoomHandler();
 *
 * Clients connect with `?peerId=<id>` (required) and optional `?token=`.
 */

import type { SyncMessage } from './types.js';
import {
  SyncRoomServer,
  type SyncRoomServerConnection,
} from './sync-room-server.js';

/** Minimal PartyKit room surface (avoids a hard dependency on `partykit`). */
export interface PartyKitRoomLike {
  id: string;
  getConnection(id: string): PartyKitConnectionLike | undefined;
  getConnections(): Iterable<PartyKitConnectionLike>;
}

export interface PartyKitConnectionLike {
  id: string;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface PartyKitRoomHandlerOptions {
  welcomeSnapshot?: boolean;
  welcomeSnapshotMaxOps?: number;
}

type RoomState = {
  server: SyncRoomServer;
};

/**
 * PartyKit `onConnect` / `onMessage` helpers backed by {@link SyncRoomServer}.
 */
export function createPartyKitRoomHandler(
  opts: PartyKitRoomHandlerOptions = {},
) {
  function getState(room: PartyKitRoomLike): RoomState {
    const bag = room as PartyKitRoomLike & { trellis?: RoomState };
    if (!bag.trellis) {
      bag.trellis = {
        server: new SyncRoomServer({
          roomId: 'room',
          roomName: room.id,
          welcomeSnapshot: opts.welcomeSnapshot,
          welcomeSnapshotMaxOps: opts.welcomeSnapshotMaxOps,
        }),
      };
    }
    return bag.trellis;
  }

  function peerIdFromConnection(
    connection: PartyKitConnectionLike,
    requestUrl?: string,
  ): string {
    if (requestUrl) {
      try {
        const peer = new URL(requestUrl).searchParams.get('peerId');
        if (peer) return peer;
      } catch {
        /* fall through */
      }
    }
    return connection.id;
  }

  return {
    async onConnect(
      connection: PartyKitConnectionLike,
      room: PartyKitRoomLike,
      request?: { url?: string },
    ): Promise<void> {
      const { server } = getState(room);
      const peerId = peerIdFromConnection(connection, request?.url);

      const conn: SyncRoomServerConnection = {
        peerId,
        send(message: SyncMessage) {
          connection.send(JSON.stringify(message));
        },
      };

      await server.connect(conn);
    },

    async onMessage(
      message: string | ArrayBuffer,
      connection: PartyKitConnectionLike,
      room: PartyKitRoomLike,
      request?: { url?: string },
    ): Promise<void> {
      const { server } = getState(room);
      const peerId = peerIdFromConnection(connection, request?.url);
      const raw =
        typeof message === 'string'
          ? message
          : new TextDecoder().decode(message);
      let parsed: SyncMessage;
      try {
        parsed = JSON.parse(raw) as SyncMessage;
      } catch {
        return;
      }
      if (!parsed || typeof parsed.type !== 'string') return;
      await server.handleMessage(peerId, parsed);
    },

    onClose(
      connection: PartyKitConnectionLike,
      room: PartyKitRoomLike,
      request?: { url?: string },
    ): void {
      const { server } = getState(room);
      const peerId = peerIdFromConnection(connection, request?.url);
      server.disconnect(peerId);
    },
  };
}
