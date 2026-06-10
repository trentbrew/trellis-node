---
title: TurtleDB Cloud — pricing model
description: Usage-based meters (graph I/O, storage, egress) for managed Trellis relay and backup.
created: 2026-06-10
updated: 2026-06-10
issue: TRL-37
related:
  - ../ARCHITECTURE.md
  - ../VISION.md
  - turtle-cloud-c0-spec.md
  - ../../cloud/docs/turtledb.md
---

# TurtleDB Cloud — pricing model

**Status:** draft (public meters not finalized)  
**Issue:** TRL-37 (C0 deploy + C1 metering)  
**Product boundary:** TurtleDB Cloud is **not** Studio Cloud. Studio bills compute + AI tokens; TurtleDB bills graph relay, durable mirror, and egress.

## Positioning

Trellis invariant: **local graph is primary; cloud accelerates.**

| Vendor framing | What you pay for |
| -------------- | ---------------- |
| Jazz / Convex | Hosted database authority + reactive fanout |
| **TurtleDB Cloud** | Relay, browser bridge, durable mirror, backup — not ownership of primary state |

Local-only ops (desktop kernel, offline browser with hydrated cache) should bill **$0** on cloud meters. That is the differentiation vs MAU- or seat-based BaaS.

## Two products, one desk

| Product | Repo | Billing today |
| ------- | ---- | ------------- |
| **Studio Cloud** | `cloud/` | Flat tier + metered LLM tokens (`billing.ts`) |
| **TurtleDB Cloud** | `trellis-node` + `cloud/` broker | Not shipped — this document |

Studio sandboxes may **host** a Trellis sidecar (`demo/realtime-app`); managed TurtleDB is a separate SKU and meter set.

---

## Meters (three physical bottlenecks)

Following the Jazz v2 rationale: bill irreducible infrastructure, not MAU/seats/connections.

### 1. Graph I/O — `$0.12 / 1M operations` (draft)

Counts **server-side** work at the kernel / room-node boundary:

| Operation | Weight |
| --------- | ------ |
| `assert` / `retract` / `link` applied on room mirror | 1 op |
| EQL query execution (including subscription re-runs) | 1 op per execution |
| Op-log read during sync catch-up (per 1KB read, rounded up) | 1 op per 1KB |
| Snapshot materialization / compaction | 1 op per 1KB written |

**Does not count:** client-local kernel ops with no cloud contact; WebSocket ping/pong; auth handshake.

### 2. Storage — `$0.40 / GB-month` (draft)

Per-tenant durable footprint on the room node:

| Component | Included |
| --------- | -------- |
| SQLite (EAV + op log + indexes) | yes |
| Content-addressed blob store | yes |
| Snapshot / backup replicas in object storage | yes (when C3 ships) |

Measured as **logical GB-month** (daily sample, monthly average). Op-log growth is not hidden — it is part of storage.

### 3. Egress — `$0.09 / GB` (draft)

Passthrough at cost (no markup target):

| Kind | Included |
| ---- | -------- |
| WebSocket subscription payloads | yes |
| Blob download to clients | yes |
| Initial sync / anti-entropy packs | yes |
| Export / backup download | yes |

---

## Tiers (draft)

| Tier | Monthly | Included | Overage |
| ---- | ------- | -------- | ------- |
| **Hobby** | $0 | 1 project, 1 GB storage, 10M graph I/O, 1 GB egress | Hard cap or upgrade prompt |
| **Pro** | $19 | 10 projects, hobby caps × 10 | Pay-as-you-go on meters |
| **Team** | Custom | SSO, backup SLA, dedicated room | Contract |

Studio AI billing remains on **token meters** — never conflate with graph meters.

---

## Cost estimator (reference scenario)

Same inputs as Jazz public calculator (June 2026):

- 1k MAU
- Daily use (~10 active hours / user / month)
- Form-like (~1 interaction / 30s while active)
- 32 MB blob storage / user

### Trellis-specific assumptions

| Assumption | Value | Notes |
| ---------- | ----- | ----- |
| Cloud-touch rate | 40% | 60% of interactions stay on local kernel |
| Server ops / cloud-touch interaction | 25 | write + sub re-query + op-log append |
| Devices / user | 1.2 | occasional second device |

### Calculation

**Graph I/O**

```text
1,000 × 1,200 interactions × 40% × 25 ops × 1.2 devices ≈ 14.4M ops
14.4 × $0.12 ≈ $1.73 / mo
```

**Storage**

```text
32 GB blobs + ~15% op-log overhead ≈ 37 GB
37 × $0.40 ≈ $14.80 / mo
```

**Egress**

```text
~5 GB (initial hydrate + occasional blob fetch) × $0.09 ≈ $0.45 / mo
```

**Total ≈ $17 / mo (~$0.017 / user / mo)**

### Sensitivity

| Profile | Cloud-touch | Dominant meter | ~Monthly @ 1k MAU |
| ------- | ----------- | -------------- | ----------------- |
| Desktop-heavy local-first | 20–40% | Storage | $15–18 |
| Browser-only SPA | 80–100% | Graph I/O | $25–32 |
| Collaborative / live | 100% | Graph I/O | $40+ |
| Media-heavy (500 MB / user) | any | Storage + egress | $200+ |

At browser-only saturation, Trellis converges toward Jazz-parity (~$32/mo for this scenario) — still cheaper when local-first is real.

---

## Workload → meter cheat sheet

| Workload | Spikes | Mitigation |
| -------- | ------ | ---------- |
| Agent lanes (VCS journal promote) | Graph I/O | Batch promote; meter op-log replay explicitly |
| Multi-device sync | Graph I/O × devices | Document in estimator |
| Wide subscriptions (full table) | Graph I/O + egress | Query-scoped subs (already in `realtime.ts`) |
| Large blob gallery | Storage + egress | Optional CDN tier later |
| Idle project with data | Storage only | True “scale to zero” on I/O, not storage |

---

## Instrumentation contract (C1)

Counters live at **kernel / server boundary** so self-hosted and cloud share definitions:

```typescript
// Illustrative — implement in TenantPool / startServer middleware
meter.record('graph_io', { tenantId, kind: 'assert' | 'query' | 'sync_read' });
meter.record('storage_bytes', { tenantId, component: 'sqlite' | 'blob' });
meter.record('egress_bytes', { tenantId, kind: 'ws' | 'blob' | 'export' });
```

Daily rollups → Stripe meters (same cron pattern as `cloud/scripts/stripe-meter-overage.ts` for AI tokens). Separate Stripe products: `trellis_graph_io`, `trellis_storage_gb`, `trellis_egress_gb`.

---

## Competitive anchors

| | Jazz (draft v2) | TurtleDB (draft) |
| - | --------------- | ---------------- |
| Graph / I/O | $0.15 / 1M | $0.12 / 1M |
| Storage | $0.45 / GB-mo | $0.40 / GB-mo |
| Egress | $0.09 / GB | $0.09 / GB |
| Free tier | unclear on v2 page | Hobby: 1 GB + 10M I/O |
| Primary state | Server replica | Client local; cloud = mirror |

---

## Open questions

1. **Blob CDN** — passthrough egress vs bundled CDN margin?
2. **Cross-region (C4)** — storage multiplier for geo replicas?
3. **P2P assist (C5)** — charge for Iroh relay bytes or treat as egress?
4. **Studio bundle** — single invoice (Studio + TurtleDB) vs separate products?
5. **Self-host parity** — publish meter definitions so self-hosters can estimate cloud migration cost.

---

## References

- Jazz pricing rationale: [What is Jazz?](https://jazz.tools/blog/what-is-jazz) — “three physical bottlenecks”
- Trellis invariants: [ARCHITECTURE.md](../ARCHITECTURE.md), [VISION.md](../VISION.md)
- Existing server surface: `src/server/` (`TenantPool`, `realtime.ts`, `deploy.ts`)
- Studio broker: `cloud/src/billing.ts` (token model — do not merge)
- C0 implementation spec: [turtle-cloud-c0-spec.md](./turtle-cloud-c0-spec.md)
