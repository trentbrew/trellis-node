# Trellis Client SDK Sketch

## General Shape

```ts
import { TrellisClient } from 'trellis/client';

const client = await TrellisClient.open({
  repo: 'my-project',
  sync: { url: 'wss://party.trellis.dev/room/123', auth: passkeyJwt },
  persist: 'indexeddb', // or 'opfs'
});

// Local-first: works immediately, offline-capable
await client.createIssue('Fix auth', {
  priority: 'high',
  lane: 'agent:cursor',
});

// Reactive
client.subscribe('issues', (issues) => render(issues));
client.subscribe('syncStatus', ({ pending, synced }) => updateUI(synced));

// Low-level
client.on('op', (op) => {
  /* custom handler */
});
await client.sync(); // force push/pull
```

## What you'd need to add for game-friendly sync

- Tick batching: Group multiple micro-updates into periodic snapshot ops (every 500ms–2s), not per-frame.
- Authoritative party: One party participant is the "game master" — validates moves, resolves collisions, emits canonical ops. Prevents desync without full CRDT merge.
- Delta compression for blobs: Game assets are huge. Content-addressed + peer seeding helps, but you'd want a real CDN fallback (Cloudflare/R2) with P2P acceleration.
- Latency-aware catch-up: New spectator shouldn't replay 10,000 ops from move 1. PartyKit streams a recent snapshot + live ops.
