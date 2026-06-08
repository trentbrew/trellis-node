import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useRoom } from 'trellis/react/realtime';
import {
  joinPresence,
  PersistentChannel,
  localStorageChannelStore,
  type ChannelRecord,
} from 'trellis/realtime';
import {
  CHAT_ROOM,
  RELAY_URL,
  makeIdentity,
  storageKey,
  timeFmt,
  createTypingTracker,
  formatTyping,
  formatOnline,
  type ChatPayload,
  type TypingPeer,
} from '../../shared';

const me = makeIdentity('React');

function App() {
  const { room, presence } = useRoom(
    () =>
      joinPresence({
        peerId: me.peerId,
        room: CHAT_ROOM,
        initialPresence: { name: me.name, color: me.color },
        relayUrl: RELAY_URL,
      }),
    [],
  );

  const chatRef = useRef<PersistentChannel<ChatPayload> | null>(null);
  const typingRef = useRef<ReturnType<typeof createTypingTracker> | null>(null);
  const [messages, setMessages] = useState<ChannelRecord<ChatPayload>[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState<TypingPeer[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!room) return;
    const tracker = createTypingTracker(room, me);
    typingRef.current = tracker;
    const unsubTyping = tracker.subscribe(setTyping);
    const chat = PersistentChannel.create<ChatPayload>(room, 'chat', {
      store: localStorageChannelStore(storageKey('chat', CHAT_ROOM)),
      resolveMeta: (event) => {
        const peer = room.getPresence().find((p) => p.id === event.from);
        if (!peer) return undefined;
        return { name: peer.state.name, color: peer.state.color };
      },
    });
    chatRef.current = chat;
    const unsub = chat.messages.subscribe(setMessages);
    return () => {
      unsubTyping();
      tracker.dispose();
      typingRef.current = null;
      unsub();
      chat.dispose();
      chatRef.current = null;
    };
  }, [room]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const text = draft.trim();
      if (!text || sending || !chatRef.current) return;
      setSending(true);
      setDraft('');
      typingRef.current?.stop();
      chatRef.current.send({ text }, { name: me.name, color: me.color });
      setSending(false);
    },
    [draft, sending],
  );

  return (
    <div className="app chat-layout">
      <header>
        <h1>React · Chat</h1>
        <span className="count">{formatOnline(presence.length)}</span>
      </header>
      <p className="hint">
        Grow-only set via <code>PersistentChannel</code> — deduped by id, ordered by
        (ts, id). Refresh repaints from localStorage, then merges relay replay.
      </p>
      <div className="chat-log" ref={logRef}>
        {messages.map((msg) => {
          const name = (msg.meta?.name as string) ?? msg.from;
          const color = (msg.meta?.color as string) ?? '#6d5bfa';
          const mine = msg.from === me.peerId;
          return (
            <div key={msg.id} className={mine ? 'chat-msg mine' : 'chat-msg'}>
              <span className="chat-avatar" style={{ background: color }}>
                {(name[0] ?? '?').toUpperCase()}
              </span>
              <div className="chat-body">
                <div className="chat-meta">
                  <span style={{ color }}>{name}</span>
                  <span>{timeFmt.format(msg.ts)}</span>
                </div>
                <span className="chat-bubble">{msg.payload.text}</span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="typing-indicator">{formatTyping(typing)}</p>
      <form className="chat-form" onSubmit={submit}>
        <input
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            setDraft(v);
            if (v.trim()) typingRef.current?.ping();
            else typingRef.current?.stop();
          }}
          placeholder="Message the room…"
          disabled={!room}
        />
        <button type="submit" disabled={!room || sending || !draft.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
