# Frontmatter Convention

All markdown docs and notes in this project use YAML frontmatter with `---` delimiters.

## Required Fields

| Field | Format | Description |
|-------|--------|-------------|
| `title` | string | Page title (sentence case) |
| `description` | string | One-line summary of the page |
| `created` | `YYYY-MM-DD` | Date the document was first created |
| `updated` | `YYYY-MM-DD` | Date of last significant edit |

## Example

```yaml
---
title: Getting Started
description: How to install and configure Trellis for your project.
created: 2026-05-30
updated: 2026-06-08
---
```

## Scope

- `apps/docs/content/**` — Nuxt Content documentation pages
- `docs/**` — Design documents, ADRs, specs
- `skills/**` — Agent skill definitions (adds to existing `name`/`description`)
- Root `README.md`

## Tooling

- Use `git log --follow --diff-filter=A` to find the creation date of a file.
- Use `git log -1` to find the last modification date.
- Update `updated` when making substantive edits (not just formatting).
