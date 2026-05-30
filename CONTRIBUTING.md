# Contributing to Trellis

Thanks for your interest. Trellis is in active development and the public API surface is still hardening, so contributions are handled deliberately for now.

## Current Status

**Issues:** open. File bugs, feature requests, and design questions freely.

**Pull requests:** paused until the v4 API freeze. We are not merging external PRs while internal architecture is still moving. If you have a fix you want landed, open an issue describing the problem and we will pull it in directly — credit preserved.

This policy will lift after the v4 release. The current target is summer 2026.

## Filing a Good Issue

Before opening:

1. Search existing issues — duplicates get closed.
2. Try the latest published version (`bun add trellis@latest` or `npm i trellis@latest`).
3. For bugs, include:
   - Trellis version, OS, Bun/Node version
   - Minimum reproduction (a few lines, or a gist)
   - What you expected vs. what happened

For design discussions, use [GitHub Discussions](https://github.com/trentbrew/trellis/discussions) once available, or tag the issue `discussion`.

## Discussions, Not Pull Requests

If you want to propose a larger architectural change:

1. Open an issue with the `proposal` label.
2. Sketch the motivation, alternatives considered, and rough API shape.
3. Wait for a maintainer response before investing time.

Proposals that align with the [ROADMAP](./ROADMAP.md) move faster.

## Local Development

```bash
# Requires Bun >= 1.0
bun install
bun test
bun run build
```

See [AGENTS.md](./AGENTS.md) for the conceptual framework and [DESIGN.md](./DESIGN.md) for the architecture specification.

## Licensing

Trellis is AGPL-3.0-or-later. By submitting issues, code samples, or any other contribution, you agree that your contribution can be incorporated under the same license. A formal Contributor License Agreement will be introduced before pull requests reopen.

## Code of Conduct

Participation in this project is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md). Be kind and assume good faith.

## Contact

For anything that doesn't fit an issue — security disclosures, partnership questions, commercial licensing — email `tbrew@turtle.tech`.
