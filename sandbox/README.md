# Sandbox

Isolated testing environment for Trellis features. Simulates a fresh user/developer experience.

## Quick Start

```bash
# Set up a sandbox with a Node/Bun preset (default)
just sandbox

# Run trellis init inside it
just sandbox-init

# Tear it down
just sandbox-clean
```

## Available Presets

| Preset | What it creates |
|--------|----------------|
| `node` | `package.json` (Bun + React), `src/`, `tsconfig.json` |
| `python` | `pyproject.toml`, `src/sandbox_ml/` |
| `rust` | `Cargo.toml`, `src/main.rs` |
| `go` | `go.mod`, `main.go` |
| `empty` | Empty directory (tests zero-context scaffold) |
| `large` | ~600 files across 6 directories |
| `monorepo` | Multi-package workspace with `packages/core, api, web` |

## Usage

```bash
# Setup with a specific preset
./sandbox/setup.sh rust

# Test first-run profile flow (removes ~/.trellis/profile.json)
./sandbox/setup.sh node --fresh-profile

# Test without README
./sandbox/setup.sh node --no-readme

# Run trellis commands in sandbox
cd sandbox/workspace
bun run ../../src/cli/index.ts init
bun run ../../src/cli/index.ts status
bun run ../../src/cli/index.ts season

# Clean up (restore profile if backed up)
./sandbox/teardown.sh --restore-profile
```

## Structure

```
sandbox/
├── setup.sh         # Creates sandbox workspace with chosen preset
├── teardown.sh      # Removes workspace, optionally restores profile
├── README.md        # This file
└── workspace/       # ← The actual sandbox (gitignored)
    ├── .trellis/    # Created by `trellis init`
    ├── package.json
    ├── src/
    └── ...
```

## just Recipes

All sandbox operations are exposed as `just` recipes:

```bash
just sandbox [preset]        # Setup (default: node)
just sandbox-fresh [preset]  # Setup + fresh profile
just sandbox-init            # Run trellis init in workspace
just sandbox-status          # Run trellis status in workspace
just sandbox-season          # Run trellis season in workspace
just sandbox-clean           # Teardown + restore profile
just sandbox-reset [preset]  # Clean + re-setup
```
