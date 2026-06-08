import { createApp, defineComponent, h, onScopeDispose, ref } from 'vue';
import { useRoom } from 'trellis/vue';
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

const me = makeIdentity('Vue');

const App = defineComponent(() => {
  const { room, presence } = useRoom(() =>
    joinPresence({
      peerId: me.peerId,
      room: CHAT_ROOM,
      initialPresence: { name: me.name, color: me.color },
      relayUrl: RELAY_URL,
    }),
  );

  const messages = ref<ChannelRecord<ChatPayload>[]>([]);
  const draft = ref('');
  const sending = ref(false);
  const typing = ref<TypingPeer[]>([]);

  const typingTracker = createTypingTracker(room, me);
  typingTracker.subscribe((peers) => {
    typing.value = peers;
  });

  const chat = PersistentChannel.create<ChatPayload>(room, 'chat', {
    store: localStorageChannelStore(storageKey('chat', CHAT_ROOM)),
    resolveMeta: (event) => {
      const peer = room.getPresence().find((p) => p.id === event.from);
      if (!peer) return undefined;
      return { name: peer.state.name, color: peer.state.color };
    },
  });
  const unsub = chat.messages.subscribe((msgs) => {
    messages.value = msgs;
  });

  onScopeDispose(() => {
    typingTracker.dispose();
    unsub();
    chat.dispose();
  });

  const submit = (event: Event) => {
    event.preventDefault();
    const text = draft.value.trim();
    if (!text || sending.value || !chat) return;
    sending.value = true;
    draft.value = '';
    typingTracker.stop();
    chat.send({ text }, { name: me.name, color: me.color });
    sending.value = false;
  };

  return () =>
    h('div', { class: 'app chat-layout' }, [
      h('header', [
        h('h1', 'Vue · Chat'),
        h('span', { class: 'count' }, formatOnline(presence.value.length)),
      ]),
      h(
        'p',
        { class: 'hint' },
        'Same room as React & Svelte — PersistentChannel grow-only set over one RealtimeRoom.',
      ),
      h(
        'div',
        { class: 'chat-log' },
        messages.value.map((msg) => {
          const name = (msg.meta?.name as string) ?? msg.from;
          const color = (msg.meta?.color as string) ?? '#6d5bfa';
          const mine = msg.from === me.peerId;
          return h('div', { key: msg.id, class: mine ? 'chat-msg mine' : 'chat-msg' }, [
            h(
              'span',
              { class: 'chat-avatar', style: { background: color } },
              (name[0] ?? '?').toUpperCase(),
            ),
            h('div', { class: 'chat-body' }, [
              h('div', { class: 'chat-meta' }, [
                h('span', { style: { color } }, name),
                h('span', timeFmt.format(msg.ts)),
              ]),
              h('span', { class: 'chat-bubble' }, msg.payload.text),
            ]),
          ]);
        }),
      ),
      h('p', { class: 'typing-indicator' }, formatTyping(typing.value)),
      h('form', { class: 'chat-form', onSubmit: submit }, [
        h('input', {
          value: draft.value,
          placeholder: 'Message the room…',
          onInput: (e: Event) => {
            const v = (e.target as HTMLInputElement).value;
            draft.value = v;
            if (v.trim()) typingTracker.ping();
            else typingTracker.stop();
          },
        }),
        h(
          'button',
          { type: 'submit', disabled: !draft.value.trim() || sending.value },
          'Send',
        ),
      ]),
    ]);
});

createApp(App).mount('#app');
