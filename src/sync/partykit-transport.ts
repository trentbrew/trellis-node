import type {
  PeerId,
  SyncMessage,
  SyncMessageHandler,
  SyncTransport,
} from './types.js';

type WebSocketState = 0 | 1 | 2 | 3;

interface WebSocketLike {
  readyState: WebSocketState;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void | Promise<void>) | null;
  onclose: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

type WebSocketCtor = new (url: string) => WebSocketLike;

export interface PartyKitReconnectOptions {
  /** Max reconnect attempts (0 = unlimited). Default: unlimited. */
  maxAttempts?: number;
  /** Initial backoff in ms. Default: 500. */
  baseDelayMs?: number;
  /** Max backoff in ms. Default: 30_000. */
  maxDelayMs?: number;
}

export interface PartyKitRoomTransportOptions {
  /** Local client/peer identity. */
  peerId: string;
  /** Full PartyKit room WebSocket URL. */
  roomUrl: string;
  /** Optional auth token appended as `?token=` on the WebSocket URL. */
  auth?: string;
  /** Logical room peer ID used by SyncEngine calls. Default: `room`. */
  roomId?: string;
  /** Human-readable room name. */
  roomName?: string;
  /** Test hook or non-browser WebSocket implementation. */
  WebSocketImpl?: WebSocketCtor;
  /**
   * Reconnect with exponential backoff after unexpected close.
   * Default: enabled.
   */
  reconnect?: boolean | PartyKitReconnectOptions;
  /** Called after a successful reconnect (e.g. to re-sync). */
  onReconnect?: () => void | Promise<void>;
  /** Called when the connection drops. */
  onDisconnect?: (reason?: string) => void;
}

const DEFAULT_RECONNECT: PartyKitReconnectOptions = {
  baseDelayMs: 500,
  maxDelayMs: 30_000,
};

/**
 * SyncTransport for a PartyKit-style room relay.
 *
 * The server side should implement the same room semantics as SyncRoomCore:
 * canonical catch-up log, full-op catch-up, and broadcast of newly accepted ops.
 */
export class PartyKitRoomTransport implements SyncTransport {
  private peerId: string;
  private room: PeerId;
  private roomUrl: string;
  private WebSocketImpl: WebSocketCtor;
  private ws: WebSocketLike | null = null;
  private messageHandler: SyncMessageHandler | null = null;
  private intentionalClose = false;
  private reconnectEnabled: boolean;
  private reconnectOpts: PartyKitReconnectOptions;
  private reconnectAttempt = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private connectPromise: Promise<void> | null = null;
  private onReconnect?: () => void | Promise<void>;
  private onDisconnect?: (reason?: string) => void;

  constructor(opts: PartyKitRoomTransportOptions) {
    this.peerId = opts.peerId;
    this.roomUrl = PartyKitRoomTransport.withAuth(opts.roomUrl, opts.auth);
    this.room = {
      id: opts.roomId ?? 'room',
      name: opts.roomName ?? opts.roomId ?? 'room',
    };
    this.onReconnect = opts.onReconnect;
    this.onDisconnect = opts.onDisconnect;

    const reconnect = opts.reconnect ?? true;
    this.reconnectEnabled = reconnect !== false;
    this.reconnectOpts = {
      ...DEFAULT_RECONNECT,
      ...(reconnect === true ? {} : reconnect),
    };

    const WebSocketGlobal = globalThis.WebSocket as
      | WebSocketCtor
      | undefined;
    const WebSocketImpl = opts.WebSocketImpl ?? WebSocketGlobal;
    if (!WebSocketImpl) {
      throw new Error(
        'PartyKitRoomTransport requires WebSocket or opts.WebSocketImpl.',
      );
    }
    this.WebSocketImpl = WebSocketImpl;
  }

  async connect(): Promise<void> {
    if (this.ws?.readyState === 1) return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = this.openSocket();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  async send(peerId: string, message: SyncMessage): Promise<void> {
    if (peerId !== this.room.id) {
      throw new Error(`PartyKitRoomTransport can only send to ${this.room.id}.`);
    }
    await this.connect();
    this.ws!.send(JSON.stringify(message));
  }

  onMessage(handler: SyncMessageHandler): void {
    this.messageHandler = handler;
  }

  peers(): PeerId[] {
    return [this.room];
  }

  close(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.ws?.close();
    this.ws = null;
  }

  getPeerId(): string {
    return this.peerId;
  }

  getRoomPeer(): PeerId {
    return { ...this.room };
  }

  /** Whether the WebSocket is open. */
  isConnected(): boolean {
    return this.ws?.readyState === 1;
  }

  private openSocket(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new this.WebSocketImpl(this.roomUrl);
      this.ws = ws;

      ws.onopen = () => {
        this.reconnectAttempt = 0;
        resolve();
      };

      ws.onerror = (event) => {
        reject(new Error(`PartyKit room connection failed: ${String(event)}`));
      };

      ws.onmessage = async (event) => {
        const message = this.parseMessage(event.data);
        if (!message || !this.messageHandler) return;
        await this.messageHandler(message);
      };

      ws.onclose = () => {
        if (this.ws === ws) {
          this.ws = null;
        }
        this.onDisconnect?.('closed');
        if (!this.intentionalClose && this.reconnectEnabled) {
          this.scheduleReconnect();
        }
      };
    });
  }

  private scheduleReconnect(): void {
    const max = this.reconnectOpts.maxAttempts ?? 0;
    if (max > 0 && this.reconnectAttempt >= max) return;

    const base = this.reconnectOpts.baseDelayMs ?? 500;
    const cap = this.reconnectOpts.maxDelayMs ?? 30_000;
    const delay = Math.min(base * 2 ** this.reconnectAttempt, cap);
    this.reconnectAttempt++;

    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.tryReconnect();
    }, delay);
  }

  private async tryReconnect(): Promise<void> {
    if (this.intentionalClose) return;
    try {
      await this.connect();
      await this.onReconnect?.();
    } catch {
      if (!this.intentionalClose && this.reconnectEnabled) {
        this.scheduleReconnect();
      }
    }
  }

  private static withAuth(roomUrl: string, auth?: string): string {
    if (!auth) return roomUrl;
    try {
      const url = new URL(roomUrl);
      url.searchParams.set('token', auth);
      return url.toString();
    } catch {
      const sep = roomUrl.includes('?') ? '&' : '?';
      return `${roomUrl}${sep}token=${encodeURIComponent(auth)}`;
    }
  }

  private parseMessage(data: unknown): SyncMessage | null {
    try {
      const raw = typeof data === 'string' ? data : String(data);
      const parsed = JSON.parse(raw) as SyncMessage;
      return parsed && typeof parsed.type === 'string' ? parsed : null;
    } catch {
      return null;
    }
  }
}
