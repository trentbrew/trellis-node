import { createApp, defineComponent, h, onMounted, onScopeDispose, onUpdated, ref, watch } from 'vue';
import { useRoom } from 'trellis/vue';
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

const me = makeIdentity('Vue');

interface RemoteCaret {
  id: string;
  name: string;
  color: string;
  top: number;
  left: number;
}

function sameRemoteCarets(a: RemoteCaret[], b: RemoteCaret[]): boolean {
  return (
    a.length === b.length &&
    a.every((caret, i) => {
      const next = b[i];
      return (
        caret.id === next.id &&
        caret.name === next.name &&
        caret.color === next.color &&
        caret.top === next.top &&
        caret.left === next.left
      );
    })
  );
}

const App = defineComponent(() => {
  const { room, presence } = useRoom<TextPresence>(() =>
    joinPresence<TextPresence>({
      peerId: me.peerId,
      room: TEXT_ROOM,
      initialPresence: { name: me.name, color: me.color, caret: -1 },
      relayUrl: RELAY_URL,
    }),
  );

  const charCount = ref(0);
  const last = ref('');
  const applying = ref(false);
  const taEl = ref<HTMLTextAreaElement | null>(null);
  const remoteCarets = ref<RemoteCaret[]>([]);

  const doc = new RealtimeText({ peerId: room.selfId, room });

  const syncCaret = () => {
    const ta = taEl.value;
    if (!ta) return;
    syncTextCaretPresence(room, ta);
  };

  const scheduleSyncCaret = () => scheduleCaretSync(syncCaret);

  function measureRemotes() {
    const ta = taEl.value;
    if (!ta) return;
    const next = presence.value
      .filter((p) => !p.self && isRemoteCaretVisible(p.state))
      .map((p) => {
        const pos = measureCaret(ta, p.state.caret);
        if (!pos) return null;
        return {
          id: p.id,
          name: p.state.name,
          color: p.state.color,
          top: pos.top,
          left: pos.left,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
    if (!sameRemoteCarets(remoteCarets.value, next)) {
      remoteCarets.value = next;
    }
  }

  const unsub = doc.onChange((next) => {
    if (next === last.value) return;
    if (applying.value) {
      last.value = next;
      charCount.value = codePointLen(next);
      return;
    }
    applying.value = true;
    const ta = taEl.value;
    if (ta) applyRemoteTextareaValue(ta, next, last.value);
    last.value = next;
    charCount.value = codePointLen(next);
    applying.value = false;
    if (ta && isTextEditorActive(ta)) scheduleSyncCaret();
    measureRemotes();
  });

  watch(presence, measureRemotes, { deep: true });

  let caretTick: ReturnType<typeof setInterval> | undefined;
  let unbindWindow: (() => void) | undefined;

  onMounted(() => {
    unbindWindow = bindTextCaretWindowHide(room, () => taEl.value);
    const initial = doc.toString();
    if (initial && taEl.value) {
      taEl.value.value = initial;
      last.value = initial;
      charCount.value = codePointLen(initial);
    }
    caretTick = setInterval(measureRemotes, 500);
  });

  onUpdated(measureRemotes);

  onScopeDispose(() => {
    if (caretTick) clearInterval(caretTick);
    unbindWindow?.();
    unsub();
    doc.dispose();
  });

  const onInput = (event: Event) => {
    const ta = event.target as HTMLTextAreaElement;
    const next = ta.value;
    applying.value = true;
    const d = textDiff(last.value, next);
    if (d.removed > 0) doc.delete(d.index, d.removed);
    if (d.inserted) doc.insert(d.index, d.inserted);
    last.value = doc.toString();
    charCount.value = codePointLen(last.value);
    applying.value = false;
    scheduleSyncCaret();
  };

  return () =>
    h('div', { class: 'app' }, [
      h('header', [
        h('h1', 'Vue · Text'),
        h('span', { class: 'count' }, `${formatOnline(presence.value.length)} · ${charCount.value} chars`),
      ]),
      h(
        'p',
        { class: 'hint' },
        'Uncontrolled textarea — same doc as React & Svelte.',
      ),
      h('div', { class: 'text-editor-wrap' }, [
        h(
          'div',
          { class: 'text-caret-layer', 'aria-hidden': 'true' },
          remoteCarets.value.map((c) =>
            h('div', {
              key: c.id,
              class: 'text-remote-caret',
              style: { top: `${c.top}px`, left: `${c.left}px`, background: c.color },
            }, [
              h('span', {
                class: 'caret-label',
                style: { background: c.color },
              }, c.name),
            ]),
          ),
        ),
        h('textarea', {
          ref: taEl,
          class: 'text-editor',
          spellcheck: 'false',
          placeholder: 'Start typing — edits sync across editors…',
          onInput,
          onFocus: scheduleSyncCaret,
          onSelect: scheduleSyncCaret,
          onKeydown: scheduleSyncCaret,
          onKeyup: scheduleSyncCaret,
          onClick: scheduleSyncCaret,
          onMouseup: scheduleSyncCaret,
          onBlur: () => hideTextCaret(room),
        }),
      ]),
      h('div', { class: 'text-foot' }, [
        h('span', `${me.name} (you)`),
        h('span', `room: ${TEXT_ROOM}`),
      ]),
    ]);
});

createApp(App).mount('#app');
