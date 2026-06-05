# Trellis PartyKit room

Minimal PartyKit server for Trellis VCS multiplayer sync.

## Handler

```ts
// partykit/trellis-room.ts
import { createPartyKitRoomHandler } from 'trellis/sync';

const handler = createPartyKitRoomHandler({
  welcomeSnapshot: true,
  welcomeSnapshotMaxOps: 500,
});

export default handler;
```

Clients connect with `peerId` in the query string:

```
wss://your-party.host/parties/main/PROJECT_ID?peerId=alice&token=OPTIONAL_JWT
```

## Client

```ts
import { TrellisClient } from 'trellis/client';

const client = await TrellisClient.open({
  repo: 'my-project',
  persist: 'indexeddb',
  sync: {
    url: 'wss://your-party.host/parties/main/PROJECT_ID?peerId=alice',
    auth: jwt,
    snapshotMaxOps: 500,
    reconnect: true,
  },
});
```

On connect and after reconnect, the client requests a tail snapshot then runs a full `syncWith` to fill any gap before the snapshot head.
