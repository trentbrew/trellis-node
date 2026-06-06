import { useCallback } from 'react';
import { createRoot } from 'react-dom/client';
// Realtime-only entry: browser-safe, no Node engine. (The `trellis/react` root
// barrel also exports the DB/SSR hooks, which pull in Node `fs`.)
import { useRoom } from 'trellis/react/realtime';
import { joinPresence } from 'trellis/realtime';
import {
  normalize,
  makeIdentity,
  OFFSCREEN,
  RELAY_URL,
  ROOM,
  type CursorPresence,
} from '../shared';
import '../styles.css';

const me = makeIdentity('React');

function Pointer() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M2 2 L2 16 L6 12 L9 18 L11 17 L8 11 L14 11 Z"
        fill="currentColor"
        stroke="white"
        strokeWidth={1}
      />
    </svg>
  );
}

function App() {
  const { room, presence, others } = useRoom<CursorPresence>(
    () =>
      joinPresence<CursorPresence>({
        peerId: me.peerId,
        room: ROOM,
        initialPresence: { name: me.name, color: me.color, x: OFFSCREEN, y: OFFSCREEN },
        relayUrl: RELAY_URL,
      }),
    [],
  );

  const onMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!room) return;
      room.setPresence(normalize(event));
    },
    [room],
  );

  // Render everyone on-surface — self included — so you can see your own cursor
  // (the surface hides the native pointer).
  const visible = presence.filter((p) => p.state.x >= 0 && p.state.y >= 0);
  const otherCount = others.filter((p) => p.state.x >= 0).length;

  return (
    <div className="app">
      <header>
        <h1>React</h1>
        <span className="count">{otherCount} other cursor(s)</span>
      </header>
      <p className="hint">
        Same room as the Vue & Svelte tabs — open all three to watch one
        BroadcastChannel mesh drive every framework.
      </p>
      <div className="surface" onPointerMove={onMove}>
        {visible.map((peer) => (
          <div
            key={peer.id}
            className={peer.self ? 'cursor self' : 'cursor'}
            style={{
              left: `${peer.state.x * 100}%`,
              top: `${peer.state.y * 100}%`,
              color: peer.state.color,
            }}
          >
            <Pointer />
            <span className="label" style={{ background: peer.state.color }}>
              {peer.state.name}
              {peer.self ? ' (you)' : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// No StrictMode: its dev-only double-mount would briefly double-join the room.
createRoot(document.getElementById('app')!).render(<App />);
