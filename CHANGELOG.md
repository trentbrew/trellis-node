# Changelog

Notable changes by release date and version. See [trellis.computer/changelog](https://trellis.computer/changelog) for the public site copy.

## trellis [3.2.0] — 2026-06-08

- **Typed realtime SDK:** `trellis/schema` — `defineType`, `entityQuery`, `WhereFilter` operators, nested `InferResolvedType`, server `hydrateAndResolve` on subscription push.
- **Live client:** `liveEntities` / `liveEntity` in `trellis/client` with id-scoped subscriptions (`entityQuery`) instead of full-type scans.
- **Framework hooks:** `trellis/svelte/typed`, `trellis/vue/typed`, `trellis/react/typed` — typed `useEntities` / `useEntity` adapters.
- **Studio plugin exports:** `trellis/plugins/plan-approval`, `proactive-watcher`, `idea-garden`, `agent-memory` ship in `dist/` for npm consumers (Trellis Studio / opencode).
- **Ontology:** idempotent `registerType` — duplicate schema registration returns quietly (409 swallowed client-side).
- **Realtime:** explorer graph-nav + collections demos; collab presence session lifecycle hardening.

## trellis [3.1.32] — 2026-05-29

- **Agent Lanes (W1–W4):** `trellis lane` — isolated per-agent op journals under `.trellis/lanes/`, `create` / `enter` / `leave` / `status` / `diff` / `promote` / `drop`.
- **`trellis lane promote`:** replay lane ops onto integration with `--dry-run`, `--explain`, and hard/soft/file conflict detection.
- **`trellis issue start`:** auto-creates and enters a lane (opt out with `--no-lane`).
- **`TRELLIS_LANE_ID`:** subprocess agents auto-enter the lane via `syncEnvLaneFromEnv()`.
- **Lazy replay (W4):** integration materialization cache; `leaveLane` restores integration view without full journal replay.
- **`getBranchHeadOpHash`:** latest `headOpHash` fact wins (fixes stale head during promote).
- **Op log lock:** configurable timeout via `TRELLIS_OPLOG_LOCK_MS`.

## trellis [3.1.14] — 2026-05-22

- CLI `trellis --version` now reports the real package version from `package.json` (was hardcoded `0.1.0`).
- CLI `-p` / cwd resolution walks up to the nearest `.trellis` repo root (monorepo subfolders work without passing the root path).
- Clearer "not a repository" errors: show looked-from path, cwd, and `-p` hint.
- `issue create` accepts `--description` as an alias for `--desc`.
- `bin/trellis.mjs` launcher finds Homebrew Bun when Node's `PATH` is minimal (`npx trellis` / agent shells).

## trellis [3.1.2] — 2026-05-12

- Fixed `trellis/cms` collection reads for inferred collections whose normalized key differs from the stored entity type casing, such as `blogpost` reading `BlogPost` entities.
- Added graph-link awareness to CMS entries so reference links such as `post --author--> author` appear in `fields` and can be expanded.
- Added `status` fact fallback when `cms_status` is absent, preserving content created by agents or lower-level store tools.
- Added shared polling for CMS subscriptions so duplicate subscribers to the same collection or entry reuse one poll stream.
- Added `onError` and custom `equals` subscription options.
- Fixed CMS entity pagination to respect the opencode store route's 1000-entity page limit.
- Added CMS client/scaffold tests and included them in the default test script.
- Added `directory` support to CMS consumer scaffolds for multi-instance opencode routing.

## trellis [3.1.1] — 2026-05-12

- Published the first `trellis/cms` SDK package update after adding scaffold helpers.

## trellis [3.1.0] — 2026-05-12

- Added the `trellis/cms` subpath with `createCmsClient`, collection reads, entry reads, polling subscriptions, reference expansion, collection discovery, and consumer scaffold helpers for vanilla, React, Solid, and Vue.
