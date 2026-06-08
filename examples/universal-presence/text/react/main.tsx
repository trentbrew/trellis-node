import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useRoom } from 'trellis/react/realtime';
import { joinPresence, RealtimeText } from 'trellis/realtime';
import {
  TEXT_ROOM,
  RELAY_URL,
  makeIdentity,
  textDiff,
  codePointLen,
  measureCaret,
  applyRemoteTextareaValue,
  scheduleCaretSync,
  hideTextCaret,
  syncTextCaretPresence,
  isTextEditorActive,
  bindTextCaretWindowHide,
  formatOnline,
  isRemoteCaretVisible,
  type TextPresence,
} from '../../shared';
import '../../styles.css';

const me = makeIdentity('React');

interface RemoteCaret {
  id: string;
  name: string;
  color: string;
  top: number;
  left: number;
}

function App() {
  const { room, presence } = useRoom<TextPresence>(
    () =>
      joinPresence<TextPresence>({
        peerId: me.peerId,
        room: TEXT_ROOM,
        initialPresence: { name: me.name, color: me.color, caret: -1 },
        relayUrl: RELAY_URL,
      }),
    [],
  );

  const docRef = useRef<RealtimeText | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const lastRef = useRef('');
  const applyingRef = useRef(false);
  const [charCount, setCharCount] = useState(0);
  const [remoteCarets, setRemoteCarets] = useState<RemoteCaret[]>([]);

  const syncCaret = useCallback(() => {
    if (!room || !taRef.current) return;
    syncTextCaretPresence(room, taRef.current);
  }, [room]);

  const scheduleSyncCaret = useCallback(() => {
    scheduleCaretSync(syncCaret);
  }, [syncCaret]);

  const presenceRef = useRef(presence);
  presenceRef.current = presence;

  const measureRemotes = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    const carets: RemoteCaret[] = [];
    for (const peer of presenceRef.current) {
      if (peer.self || !isRemoteCaretVisible(peer.state)) continue;
      const pos = measureCaret(ta, peer.state.caret);
      if (!pos) continue;
      carets.push({
        id: peer.id,
        name: peer.state.name,
        color: peer.state.color,
        top: pos.top,
        left: pos.left,
      });
    }
    setRemoteCarets(carets);
  }, []);

  const scheduleSyncCaretRef = useRef(scheduleSyncCaret);
  scheduleSyncCaretRef.current = scheduleSyncCaret;
  const measureRemotesRef = useRef(measureRemotes);
  measureRemotesRef.current = measureRemotes;

  useEffect(() => {
    if (!room) return;
    const unbindWindow = bindTextCaretWindowHide(room, () => taRef.current);
    return unbindWindow;
  }, [room]);

  useEffect(() => {
    if (!room) return;
    const doc = new RealtimeText({ peerId: room.selfId, room });
    docRef.current = doc;

    const unsub = doc.onChange((next) => {
      if (next === lastRef.current) return;
      // Local insert/delete emits synchronously — sync lastRef only, don't touch DOM.
      if (applyingRef.current) {
        lastRef.current = next;
        setCharCount(codePointLen(next));
        return;
      }
      applyingRef.current = true;
      const ta = taRef.current;
      if (ta) applyRemoteTextareaValue(ta, next, lastRef.current);
      lastRef.current = next;
      setCharCount(codePointLen(next));
      applyingRef.current = false;
      if (ta && isTextEditorActive(ta)) scheduleSyncCaretRef.current();
      measureRemotesRef.current();
    });

    const initial = doc.toString();
    const ta = taRef.current;
    if (initial && ta && ta.value !== initial) {
      applyRemoteTextareaValue(ta, initial, ta.value);
      lastRef.current = initial;
      setCharCount(codePointLen(initial));
    } else if (initial) {
      lastRef.current = initial;
      setCharCount(codePointLen(initial));
    }

    return () => {
      unsub();
      doc.dispose();
      docRef.current = null;
    };
  }, [room]);

  useEffect(() => {
    measureRemotes();
    const tick = setInterval(measureRemotes, 500);
    return () => clearInterval(tick);
  }, [measureRemotes, room]);

  const onInput = (event: React.FormEvent<HTMLTextAreaElement>) => {
    if (!docRef.current) return;
    const ta = event.currentTarget;
    const next = ta.value;
    applyingRef.current = true;
    const d = textDiff(lastRef.current, next);
    if (d.removed > 0) docRef.current.delete(d.index, d.removed);
    if (d.inserted) docRef.current.insert(d.index, d.inserted);
    lastRef.current = docRef.current.toString();
    setCharCount(codePointLen(lastRef.current));
    applyingRef.current = false;
    scheduleSyncCaret();
  };

  return (
    <div className="app">
      <header>
        <h1>React · Text</h1>
        <span className="count">
          {formatOnline(presence.length)} · {charCount} chars
        </span>
      </header>
      <p className="hint">
        Uncontrolled textarea — avoids dropped keystrokes at speed. Remote carets
        via presence.
      </p>
      <div className="text-editor-wrap">
        <div className="text-caret-layer" aria-hidden="true">
          {remoteCarets.map((c) => (
            <div
              key={c.id}
              className="text-remote-caret"
              style={{ top: c.top, left: c.left, background: c.color }}
            >
              <span className="caret-label" style={{ background: c.color }}>
                {c.name}
              </span>
            </div>
          ))}
        </div>
        <textarea
          ref={taRef}
          className="text-editor"
          spellCheck={false}
          defaultValue=""
          onInput={onInput}
          onFocus={scheduleSyncCaret}
          onSelect={scheduleSyncCaret}
          onKeyDown={scheduleSyncCaret}
          onKeyUp={scheduleSyncCaret}
          onClick={scheduleSyncCaret}
          onMouseUp={scheduleSyncCaret}
          onBlur={() => room && hideTextCaret(room)}
          placeholder="Start typing — edits sync across editors…"
          disabled={!room}
        />
      </div>
      <div className="text-foot">
        <span>{me.name} (you)</span>
        <span>room: {TEXT_ROOM}</span>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
