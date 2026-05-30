# Changelog

## 3.1.32

- **Agent Lanes (W1–W4):** `trellis lane` — isolated per-agent op journals under `.trellis/lanes/`, `create` / `enter` / `leave` / `status` / `diff` / `promote` / `drop`.
- **`trellis lane promote`:** replay lane ops onto integration with `--dry-run`, `--explain`, and hard/soft/file conflict detection.
- **`trellis issue start`:** auto-creates and enters a lane (opt out with `--no-lane`).
- **`TRELLIS_LANE_ID`:** subprocess agents auto-enter the lane via `syncEnvLaneFromEnv()`.
- **Lazy replay (W4):** integration materialization cache; `leaveLane` restores integration view without full journal replay.
- **`getBranchHeadOpHash`:** latest `headOpHash` fact wins (fixes stale head during promote).
- **Op log lock:** configurable timeout via `TRELLIS_OPLOG_LOCK_MS`.

## 3.1.14

- CLI `trellis --version` now reports the real package version from `package.json` (was hardcoded `0.1.0`).
- CLI `-p` / cwd resolution walks up to the nearest `.trellis` repo root (monorepo subfolders work without passing the root path).
- Clearer "not a repository" errors: show looked-from path, cwd, and `-p` hint.
- `issue create` accepts `--description` as an alias for `--desc`.
- `bin/trellis.mjs` launcher finds Homebrew Bun when Node's `PATH` is minimal (`npx trellis` / agent shells).

## 3.1.2

- Fixed `trellis/cms` collection reads for inferred collections whose normalized key differs from the stored entity type casing, such as `blogpost` reading `BlogPost` entities.
- Added graph-link awareness to CMS entries so reference links such as `post --author--> author` appear in `fields` and can be expanded.
- Added `status` fact fallback when `cms_status` is absent, preserving content created by agents or lower-level store tools.
- Added shared polling for CMS subscriptions so duplicate subscribers to the same collection or entry reuse one poll stream.
- Added `onError` and custom `equals` subscription options.
- Fixed CMS entity pagination to respect the opencode store route's 1000-entity page limit.
- Added CMS client/scaffold tests and included them in the default test script.
- Added `directory` support to CMS consumer scaffolds for multi-instance opencode routing.

## 3.1.1

- Published the first `trellis/cms` SDK package update after adding scaffold helpers.

## 3.1.0

- Added the `trellis/cms` subpath with `createCmsClient`, collection reads, entry reads, polling subscriptions, reference expansion, collection discovery, and consumer scaffold helpers for vanilla, React, Solid, and Vue.
