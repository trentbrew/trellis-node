---
title: L3 operator inset — native Bits UI inspector
description: Migrate explorer operator chrome from Vue CE drop-in to canonical Svelte + Bits UI shell slot.
created: 2026-06-10
updated: 2026-06-10
issue: TRL-38
related:
  - ../adr/0011-app-shell-three-bands.md
  - ../adr/0012-graph-overlay-config-surface.md
  - ../sdk-typed-realtime.md
---

# L3 operator inset — native Bits UI inspector

**Status:** impl (TRL-38 — native Dialog-as-sheet inset in realtime-app)  
**Issue:** TRL-38  
**Depends on:** TRL-25 (fractal shell), ADR 0011 L3 band, ADR 0012 anchored inset binding  
**Does not block:** TRL-37 (TurtleDB Cloud C0)

## Goal

Replace the **explorer-embedded Vue CE** with a **native Svelte + Bits UI** L3 operator inset while keeping the **drop-in script** portable for non-Svelte scaffolds.

## Two-surface strategy (locked)

| Surface | Stack | Audience |
| ------- | ----- | -------- |
| Drop-in `/__trellis/inspector.js` | Vue custom element | Any scaffold (React/Vue/Svelte) |
| Explorer L3 inset | Svelte + Bits UI (`Sheet`, `Tabs`, scroll areas) | `demo/realtime-app` design reference |

Do not rewrite both at once. TRL-38 covers the explorer inset only.

## Interim (shipped)

- `TrellisInspectorLoader.svelte` embeds Vue CE via same-origin Vite proxy
- FAB bottom-right, panel closed by default
- `:3920` remains dev-only bare landing

## Target UX (Bits UI)

| Piece | Bits primitive | Notes |
| ----- | -------------- | ----- |
| FAB trigger | `Button` (icon) fixed bottom-right | L3-gated when ACL exists; dev always-on |
| Panel | `Sheet` (side=right) or draggable `Dialog` | Prefer sheet for keyboard trap + mobile |
| Tabs | `Tabs` | entities / query / stats |
| Entity list | `ScrollArea` + typed rows | reuse EQL from `$lib/trellis` |
| Query | `Textarea` + `Button` | EQL-S examples |

Mount inside `AppShell` L3 slot (not global body injection).

## Acceptance criteria

- [ ] L3 inset opens from FAB without leaving current route (`/chat`, `/collab`, collections)
- [ ] Entity list reads same data as CE (EQL / HTTP via sidecar proxy)
- [ ] Query tab runs `POST /query` and renders JSON
- [ ] Stats tab shows `/health` + entity type counts
- [ ] Drop-in script still works independently (no regression in `build:inspector`)
- [ ] `PUBLIC_TRELLIS_INSPECTOR` toggles CE loader; native inset gated on L3 permission flag (stub ok)
- [ ] test: explorer e2e asserts FAB visible in dev

## Non-goals

- Full ontology editor / ACL matrix (future L3 modules)
- Replacing Vue CE for scaffolds
- Blocking TRL-37 cloud work

## References

- ADR 0011 — L3 operator band, bottom-right control
- `src/server/inspector/` — Vue CE source
- `demo/realtime-app/src/lib/ui/AppShell.svelte` — mount point
