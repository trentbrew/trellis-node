---
title: One surface, three axes
description: Why Trellis doesn't split config and render into two panels — and what the Game Boy has to do with it.
created: 2026-06-10
audience: public
receipts: ../adr/0012-graph-overlay-config-surface.md
related:
  - ../adr/0011-app-shell-three-bands.md
  - ../adr/0012-graph-overlay-config-surface.md
---

# One surface, three axes

Every builder eventually draws two rectangles on a whiteboard: **the thing users see** and **the panel where you configure it**. Squarespace. Webflow. Notion's property column. DevTools docked to the right. The split feels inevitable.

It isn't. It's one answer to a question that has better variables.

## The two felt axes

Before layout, two pressures decide whether a second panel helps or hurts:

**Loop tightness** — how fast must edit become visible? Styling and spatial layout are high-frequency diff tasks. A 200ms toggle isn't annoyance; it's amnesia — you lose the before/after in working memory. Terminal panes and backend config are low-frequency dwell tasks; toggling is cheap.

**Referential coupling** — does config need to *point at* the render, or the render at config? DevTools starts at the artifact and asks why. Webflow starts at controls and asks show me. The kitchen is unidirectional by design: diners never see the pass.

Those aren't three layouts. They're three **permission models** for who gets to see which direction of the arrow.

## Preview mode is the wrong abstraction

In most tools, "edit mode" is UI state. Flip a switch; same chrome tree; different affordances painted on.

In Trellis, **band is authorization projection**. A visitor on L1 doesn't lack a preview toggle — the arrow from artifact to graph simply isn't in their render path. The layout question and the permission question are the same question. That's structural, not aesthetic, and it's the claim that survives a skeptical engineer: chrome isn't hidden; it's unrenderable for that principal.

| Band | Who | What they see |
| ---- | --- | ------------- |
| **L1 Published** | Visitors | The dish — no kitchen door |
| **L2 Editor** | Content editors | The dish, with in-place utensils |
| **L3 Operator** | Builders, agents | Summoned tools for the graph itself |

## One surface, not two panels

Fractal Responsiveness adds a continuous axis: **vantage** — how close to the bone you're looking at one identity. Same entity id. Same live kernel. Different shell at different focal depth: node, row, card.

The configure/render split collapses:

- The **artifact** is the projection at high vantage (structure composed away).
- The **inspector** is the same Thing at low vantage (EAV bones visible).
- Scrubbing vantage *is* the toggle — if territories give you mode-like legibility.

The Game Boy Color wasn't a second panel beside the screen. It was the **same object** with the mechanism made visible — cartridge slot, battery door, the affordances of play made literal in the shell. Software version: inspect *in place* instead of context-switching to a separate inspector app.

That's the visceral version. The spec version is [ADR 0012](../adr/0012-graph-overlay-config-surface.md).

## When the inset still matters

In-place inspection breaks when config has its own deep structure with no spatial address on the page. DevTools keeps a dock for a reason: the Network tab has no place in the DOM tree.

So the answer is hybrid — but the hybrid is principled:

| Config type | Binding | Surface |
| ----------- | ------- | ------- |
| **Homomorphic** | Maps onto the focal entity | Vantage scrub, inline edit, highlight |
| **Heteromorphic** | Topological over the graph | Operator inset |

The leak is where good UX lives. A query editor is heteromorphic in the abstract — but a query **bound to your current selection** is a lens, not a separate app. ACL on the full matrix is topological; "who can see **this** card" is homomorphic. The inset should **dock onto selection** when one exists and float when it doesn't — same component, two mount semantics. DevTools is always docked-but-decoupled. Notion's panel is always coupled-but-shallow. Trellis aims for contextual docking.

## Legibility is not a compromise

Continuous axes have a cost modes don't. A Preview button tells you where you are. A slider asks you to hold a dimension in your head.

The answer isn't abandoning continuity — it's **detents**. Twenty-one levels in seven territories sounds abstract; "Kanban card · editing" on screen is not. Named territory stops, a visible position indicator, snap for visitors, fine scrub for builders. Crossfade only between adjacent territories — otherwise you get mush, not translucency.

If a non-builder can't answer "what am I looking at right now?" in one glance, the experiment failed — even if builders love the slider.

## Two fractal muscles

We're building two related capabilities with confusing names; worth separating:

**Fractal responsiveness** — one identity, many representations. Vantage, shells, `--vantage`, dual-shell crossfade. The wedge lives in the Trellis explorer (`Thing.svelte`, `/fractal`).

**Fractal projection** — many entities, animated layout modes. One graph row per entity, FLIP motion, expand overlays. The sketchpad lives in `Sandbox/fractal-playground/fractals-playground` (`docs/fractal-projection-contract.md`).

Collections need both: responsive cards *and* reconcile that doesn't pop when a peer reorders the list.

## Craftpunk receipts

This essay is the artifact. [ADR 0012](../adr/0012-graph-overlay-config-surface.md) is the mechanism. Showing both is the point — same graph, same URL, the projection at one vantage and the bones at another, permission deciding which directions of the arrow you’re allowed to see.

The inspector isn't a separate app bolted on. It's the same Thing, closer to the bone — when your band says you're allowed to look.
