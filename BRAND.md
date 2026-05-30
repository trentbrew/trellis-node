# Trellis Brand

> A living reference for the visual and verbal language of Trellis and Trellis Studio. Captures what's true today, flags what's drifted, and points to the canonical sources.

This document is intentionally short. It records reality so the surfaces can converge on it; it does not prescribe a redesign.

---

## Three-layer brand stack

Keep these names consistent across docs, blog, CLI, and marketing.

| Layer                    | Name               | Where                                                       |
| ------------------------ | ------------------ | ----------------------------------------------------------- |
| Engine                   | **Trellis**        | npm package, AGPL-3.0                                       |
| Workspace / UI surface   | **Trellis Studio** | `npx trellis studio`, the canonical product                 |
| Internal repo / codename | **turtlecode**     | [turtlecode/ide/](../turtlecode/ide/), npm launcher package |

In user-facing copy (docs, blog, marketing, decks): use **Trellis Studio** for the workspace and **Trellis** for the engine. Avoid "Trellis IDE" and "turtlecode" in user-facing prose. In code, architecture conversations, and internal docs: `turtlecode` is fine.

---

## Voice & metaphor

The dominant metaphor is the trellis itself: a structural grid for things that grow but can't hold their own weight. Code, decisions, and the reasoning of AI agents are the vines.

- **Lead with the metaphor in positioning, marketing, and long-form writing.** The trellis/vine/garden imagery is load-bearing in the founding essay and gives the product an identity that pure technical claims don't.
- **Drop the metaphor in product UI and reference docs.** Studio surfaces and API reference should be concrete, terse, and technical. Metaphor in a tooltip is noise.
- **No em-dashes.** Replace contextually with commas, parens, colons, or new sentences. See [[feedback_no_emdashes]] in user memory for replacement patterns.
- **No emoji in shipped writing** unless the user explicitly asks.
- **Tone:** plainspoken, opinionated, technical. Closer to Stripe's docs or Linear's blog than to corporate B2B copy. Confidence without bombast.

---

## Source of truth: design tokens

**Canonical:** [`turtlecode/ide/packages/ui/src/styles/theme.css`](../turtlecode/ide/packages/ui/src/styles/theme.css)

This is the active token system in Trellis Studio. All other surfaces should converge on it over time.

### Typography

```css
--font-family-sans:
  ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI',
  sans-serif;
--font-family-mono:
  ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
  'Courier New', monospace;
--font-family-header:
  'Berkley Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
```

| Size | Token                 | Use                |
| ---- | --------------------- | ------------------ |
| 13px | `--font-size-small`   | metadata, captions |
| 14px | `--font-size-base`    | body               |
| 16px | `--font-size-large`   | section leads      |
| 20px | `--font-size-x-large` | hero text          |

| Weight | Token                   |
| ------ | ----------------------- |
| 400    | `--font-weight-regular` |
| 500    | `--font-weight-medium`  |

Line height: 130% normal / 150% large / 180% x-large / 200% 2x-large.

**Note on Berkley Mono:** proprietary OTF, loaded from `packages/ui/src/assets/fonts/`. Used for headers and wordmarks in Studio. Anywhere we can't ship the OTF (public web, exported PDFs), the fallback is the system mono stack.

### Color (light)

| Role                  | Token                       | Value                    |
| --------------------- | --------------------------- | ------------------------ |
| Page background       | `--background-base`         | `#f8f8f8`                |
| Body text             | `--text-base`               | `#6f6f6f`                |
| Heading / strong text | `--text-strong`             | `#171717`                |
| Secondary text        | `--text-weak`               | `#8f8f8f`                |
| Tertiary text         | `--text-weaker`             | `#c7c7c7`                |
| Brand accent          | `--surface-brand-base`      | `#dcde8d` (yellow-green) |
| Interactive / link    | `--text-interactive-base`   | `#034cff`                |
| Success               | `--surface-success-strong`  | `#12c905`                |
| Warning               | `--surface-warning-strong`  | `#fbdd46`                |
| Critical              | `--surface-critical-strong` | `#fc533a`                |
| Info                  | `--surface-info-strong`     | `#a753ae`                |

### Color (dark)

| Role            | Token               | Value                        |
| --------------- | ------------------- | ---------------------------- |
| Page background | `--background-base` | `#101010`                    |
| Body text       | `--text-base`       | `rgba(255, 255, 255, 0.618)` |

The dark mode body text uses `0.618` — the golden ratio — as the opacity. Keep this; it's intentional.

### Spacing

`--spacing: 0.25rem` (4px base). Multiply for larger gaps.

### Radius

| Token         | Value |
| ------------- | ----- |
| `--radius-xs` | 2px   |
| `--radius-sm` | 4px   |
| `--radius-md` | 6px   |
| `--radius-lg` | 8px   |
| `--radius-xl` | 10px  |

### Shadows

Tokens `--shadow-xs` / `--shadow-md` / `--shadow-lg`, plus a family of border-shadow tokens (`--shadow-xs-border`, `--shadow-xs-border-focus`, etc.) used for inputs and focus rings. See `theme.css` for full definitions.

---

## Logo

Canonical SVG: [`trellis-package/logo.svg`](./logo.svg)

Seven rotated squares arranged as a lattice. The center square is largest; six smaller satellites sit at the corners and edges. White fill by default; recolor via `fill` attribute when needed. Viewbox is `800×800`.

**Usage:**

- Minimum size 24px (the satellite shapes become unreadable below this).
- Pair with the wordmark "Trellis" or "Trellis Studio" in `--font-family-header` (Berkley Mono) at the same baseline.
- Clearspace: at least one center-square width on all sides.
- Don't recolor with gradients. Solid fills only.

Sister assets in [`turtlecode/ide/packages/identity/`](../turtlecode/ide/packages/identity/): `mark-96x96.png`, `mark-192x192.png`, `mark-512x512.png`, plus a light variant.

---

## Surfaces today

The brand stack is not fully aligned across surfaces. This is the honest state.

| Surface                                                                             | Tokens                                                                        | Fonts                                                | Status                                                                               |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Trellis Studio** ([turtlecode/ide/packages/app](../turtlecode/ide/packages/app/)) | Semantic tokens in `packages/ui/src/styles/theme.css`                         | Berkley Mono headers + system sans/mono              | **Canonical**                                                                        |
| **Docs site** ([trellis-docs/www](../trellis-docs/www/))                            | shadcn-style: `--background`, `--foreground`, `--primary`, `--accent` (oklch) | System sans, system mono                             | Diverges. Built on Reka UI + Tailwind v4 + Nuxt Content.                             |
| **Pitch deck kit** ([trellis-pitch/](../trellis-pitch/))                            | Custom paper/ink palette (`#f6f3eb` paper, `#0d1b14` ink, `#2f6f4e` accent)   | Söhne/Inter + Iowan Old Style serif + JetBrains Mono | Diverges. Marketing voice; metaphor-led, literary feel.                              |
| **brew.build blog** ([brew.build](../brew.build/))                                  | Astro theme tokens                                                            | Whatever the Astro theme ships                       | Not aligned with Trellis brand at all (it's a personal blog hosting Trellis essays). |

### Convergence plan (informal)

This is a sketch, not a commitment.

1. **Studio stays canonical.** All future tokens get added to `packages/ui/src/styles/theme.css` first.
2. **Docs site** should adopt Studio's tokens as the next major refresh, mapping the shadcn variable names onto Studio's semantic ones (e.g. `--background` → `--background-base`, `--muted-foreground` → `--text-weak`). The Reka UI components themselves can stay.
3. **Pitch deck and exec summary** are marketing artifacts and can keep a warmer voice, but the _brand colors_ and _headline font_ should align with Studio. Today's custom paper palette is a candidate for replacement with `--background-base` + a `--surface-brand-base` accent.
4. **brew.build** continues as a personal surface; no alignment required. Trellis posts there should still use the wordmark conventions above.

---

## Copy & writing rules

- **No em-dashes (—).** Replace with commas, parens, colons, or new sentences. See user memory.
- **Wordmark capitalization:** "Trellis" and "Trellis Studio." Never "trellis" mid-sentence as a product reference; use "trellis" lowercase only when referring to the metaphor itself ("the trellis the engine provides").
- **CLI commands** in monospace: `npx trellis studio`, `trellis milestone create`, etc. Use the `.kbd` style or markdown backticks.
- **File paths and tokens** in monospace too: `.trellis/`, `--text-base`.
- **No marketing superlatives.** "Industry-leading," "revolutionary," "next-generation" — cut them. The metaphor does the lifting.
- **Active voice. Short sentences. Specific nouns.** "Trellis captures the _why_" beats "Trellis enables organizations to capture decision rationale."

---

## Open questions

These are deliberately unanswered and worth revisiting when the product positioning settles further.

- **Does the docs site rebuild on Studio tokens, or does Studio adopt the shadcn variable names as aliases?** Studio's semantic system is richer (text-base / text-weak / text-weaker / text-strong); the shadcn system is simpler but less expressive.
- **What's the canonical color for the pitch deck and the founding essay's hero imagery?** The garden metaphor wants a warm earthy palette; Studio's brand color is yellow-green (`#dcde8d`). These can coexist but should be defined explicitly.
- **Logo lockup with wordmark:** is there a fixed "logo + Trellis" lockup, or do we use them independently? Today they're independent.
- **Do we need a Turtle Labs umbrella brand at all?** Currently turtle.tech is the parent URL but the brand is invisible. Defer until there's a second product worth disambiguating from.

---

## References

- [`turtlecode/ide/packages/ui/src/styles/theme.css`](../turtlecode/ide/packages/ui/src/styles/theme.css) — canonical Studio tokens
- [`trellis-package/logo.svg`](./logo.svg) — canonical logo
- [`trellis-docs/www/app/assets/css/theme.css`](../trellis-docs/www/app/assets/css/theme.css) — docs site tokens (diverges from Studio)
- [`trellis-pitch/`](../trellis-pitch/) — pitch kit with current marketing voice
- [`brew.build/src/content/posts/trellis-studio/`](../brew.build/src/content/posts/trellis-studio/) — founding essay, source of the trellis/vine/garden metaphor
- [`turtlecode/ide/packages/identity/`](../turtlecode/ide/packages/identity/) — logo PNG exports at standard sizes
