/**
 * Cross-framework contract: the Vue composable and the Svelte store adapter are
 * thin bridges over the *same* framework-agnostic {@link RealtimeRoom}. This
 * proves the "universal SDK" claim where it can be exercised headlessly:
 *
 *   - Vue reactivity (`effectScope`, `shallowRef`, `computed`) runs without a
 *     DOM, so `useRoom` is tested for real here.
 *   - The Svelte adapter (`createRoom`/`toStore`) is plain TS implementing the
 *     store contract, also DOM-free.
 *   - React's `useRoom` is the identical `useSyncExternalStore(signal.subscribe,
 *     signal.peek)` bridge; it needs a renderer (react-dom) to mount, so it is
 *     covered by `tsc` + the shared-engine tests rather than re-mounted here.
 *
 * The decisive assertion is that a Vue peer and a Svelte peer joined to one
 * {@link MemoryHub} see each other and observe each other's presence updates —
 * i.e. both adapters faithfully reflect the same room.
 */

import { describe, test, expect } from 'vitest';
import { effectScope } from 'vue';
import { useRoom as useVueRoom } from '../../src/vue/hooks.js';
import { createRoom as createSvelteRoom, toStore } from '../../src/svelte/stores.js';
import { RealtimeRoom } from '../../src/realtime/room.js';
import { MemoryHub } from '../../src/realtime/memory-hub.js';
import { PersistentChannel } from '../../src/realtime/persistent-channel.js';
import type { PresencePeer, PresenceState } from '../../src/realtime/types.js';

interface Demo extends PresenceState {
  name: string;
}

const join = (hub: MemoryHub, id: string, name: string) =>
  RealtimeRoom.join<Demo>({
    transport: hub.connect(id),
    initialPresence: { name },
    heartbeatMs: 0,
  });

describe('framework adapters over one RealtimeRoom', () => {
  test('Vue useRoom reflects peers and tears down on scope stop', () => {
    const hub = new MemoryHub();
    const scope = effectScope();
    let handle!: ReturnType<typeof useVueRoom<Demo>>;
    scope.run(() => {
      handle = useVueRoom<Demo>(() => join(hub, 'vue', 'Vue'));
    });

    // Self is present and listed first.
    expect(handle.presence.value[0].self).toBe(true);
    expect(handle.presence.value[0].id).toBe('vue');

    const peer = join(hub, 'peer', 'Peer');
    expect(handle.others.value.map((p) => p.id)).toContain('peer');

    // Remote presence update flows into the Vue ref.
    peer.setPresence({ name: 'Renamed' });
    expect(handle.others.value.find((p) => p.id === 'peer')?.state.name).toBe(
      'Renamed',
    );

    peer.leave();
    expect(handle.others.value).toHaveLength(0);

    // Scope stop disposes the subscription and leaves the room.
    scope.stop();
    expect(handle.room.getOthers()).toHaveLength(0);
  });

  test('Vue and Svelte adapters see each other on the same hub', () => {
    const hub = new MemoryHub();
    const scope = effectScope();
    let vue!: ReturnType<typeof useVueRoom<Demo>>;
    scope.run(() => {
      vue = useVueRoom<Demo>(() => join(hub, 'vue', 'Vue'));
    });

    const svelte = createSvelteRoom<Demo>(() => join(hub, 'svelte', 'Svelte'));
    let sveltePeers: PresencePeer<Demo>[] = [];
    const unsub = svelte.presence.subscribe((v) => (sveltePeers = v));

    // Each framework's view contains the other framework's peer.
    expect(vue.others.value.map((p) => p.id)).toContain('svelte');
    expect(sveltePeers.map((p) => p.id)).toContain('vue');

    // A Vue-side presence change is observed by the Svelte store.
    vue.room.setPresence({ name: 'Vue2' });
    expect(sveltePeers.find((p) => p.id === 'vue')?.state.name).toBe('Vue2');

    // And a Svelte-side change is observed by the Vue ref.
    svelte.room.setPresence({ name: 'Svelte2' });
    expect(vue.others.value.find((p) => p.id === 'svelte')?.state.name).toBe(
      'Svelte2',
    );

    unsub();
    svelte.destroy();
    scope.stop();
  });

  test('Vue and Svelte PersistentChannel replicas converge on the same hub', async () => {
    const hub = new MemoryHub();
    const scope = effectScope();
    let vue!: ReturnType<typeof useVueRoom<Demo>>;
    scope.run(() => {
      vue = useVueRoom<Demo>(() => join(hub, 'vue', 'Vue'));
    });

    const svelte = createSvelteRoom<Demo>(() => join(hub, 'svelte', 'Svelte'));
    const vueChat = PersistentChannel.create<{ text: string }>(vue.room, 'chat');
    const svelteChat = PersistentChannel.create<{ text: string }>(
      svelte.room,
      'chat',
    );
    const svelteMsgs = toStore(svelteChat.messages);
    let svelteLog: { text: string }[] = [];
    const unsub = svelteMsgs.subscribe((records) => {
      svelteLog = records.map((r) => r.payload);
    });

    vueChat.send({ text: 'from vue' });
    await new Promise((r) => setTimeout(r, 0));
    expect(svelteLog.map((m) => m.text)).toContain('from vue');

    svelteChat.send({ text: 'from svelte' });
    await new Promise((r) => setTimeout(r, 0));
    expect(vueChat.snapshot().map((m) => m.payload.text)).toEqual([
      'from vue',
      'from svelte',
    ]);

    unsub();
    vueChat.dispose();
    svelteChat.dispose();
    svelte.destroy();
    scope.stop();
  });
});
