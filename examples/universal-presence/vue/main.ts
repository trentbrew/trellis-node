import { createApp, defineComponent, h } from 'vue';
import { useRoom } from 'trellis/vue';
import { joinPresence } from 'trellis/realtime';
import {
  normalize,
  makeIdentity,
  OFFSCREEN,
  RELAY_URL,
  ROOM,
  formatOnline,
  type CursorPresence,
} from '../shared';
import '../styles.css';

const me = makeIdentity('Vue');

const pointer = () =>
  h('svg', { width: 20, height: 20, viewBox: '0 0 20 20', 'aria-hidden': 'true' }, [
    h('path', {
      d: 'M2 2 L2 16 L6 12 L9 18 L11 17 L8 11 L14 11 Z',
      fill: 'currentColor',
      stroke: 'white',
      'stroke-width': 1,
    }),
  ]);

const App = defineComponent(() => {
  const { room, presence } = useRoom<CursorPresence>(() =>
    joinPresence<CursorPresence>({
      peerId: me.peerId,
      room: ROOM,
      initialPresence: { name: me.name, color: me.color, x: OFFSCREEN, y: OFFSCREEN },
      relayUrl: RELAY_URL,
    }),
  );

  const onMove = (event: PointerEvent) => room.setPresence(normalize(event));
  const onLeave = () => room.setPresence({ x: OFFSCREEN, y: OFFSCREEN });

  return () => {
    // Render everyone on-surface — self included — so your own cursor is visible.
    const visible = presence.value.filter((p) => p.state.x >= 0 && p.state.y >= 0);
    return h('div', { class: 'app' }, [
      h('header', [
        h('h1', 'Vue'),
        h('span', { class: 'count' }, formatOnline(presence.value.length)),
      ]),
      h(
        'p',
        { class: 'hint' },
        'Same room as the React & Svelte tabs — one BroadcastChannel mesh, three frameworks.',
      ),
      h(
        'div',
        { class: 'surface', onPointermove: onMove, onPointerleave: onLeave },
        visible.map((peer) =>
          h(
            'div',
            {
              key: peer.id,
              class: peer.self ? 'cursor self' : 'cursor',
              style: {
                left: `${peer.state.x * 100}%`,
                top: `${peer.state.y * 100}%`,
                color: peer.state.color,
              },
            },
            [
              pointer(),
              h(
                'span',
                { class: 'label', style: { background: peer.state.color } },
                peer.state.name + (peer.self ? ' (you)' : ''),
              ),
            ],
          ),
        ),
      ),
    ]);
  };
});

createApp(App).mount('#app');
