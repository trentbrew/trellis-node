# State demo — Todo list + causal DAG

Browser demo for trellis.computer: **Alice** and **Bob** todo lists with a merged **VcsOp** DAG on the right.

Uses real `createVcsOp` hashing, `SyncEngine`, and `MemorySyncRoom` (no full `TrellisVcsEngine` — keeps the static bundle small).

## Run locally

```bash
npm run build:state-demo-bundle
# open demo/state-demo/index.html via any static server, or:
python3 -m http.server 8240
# → http://localhost:8240/demo/state-demo/index.html
```

## Sync to trellis.computer

```bash
just docs-state-demo-sync
```

Serves at `/demos/state/index.html?embed=1` on the docs site.
