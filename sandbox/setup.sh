#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Trellis Sandbox Setup
#
# Creates a clean, realistic project environment for testing trellis features
# as if you're a brand-new user. Run from the trellis repo root:
#
#   ./sandbox/setup.sh [preset]
#
# Presets:
#   node      — Node/Bun project with React deps (default)
#   python    — Python project with pyproject.toml
#   rust      — Rust project with Cargo.toml
#   go        — Go project with go.mod
#   empty     — Completely empty directory
#   large     — Simulates a large repo (500+ files)
#   monorepo  — Multi-package workspace
#
# Flags:
#   --fresh-profile   Also remove ~/.trellis/profile.json to test first-run
#   --no-readme       Skip README.md generation
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRELLIS_ROOT="$(dirname "$SCRIPT_DIR")"
SANDBOX_DIR="$SCRIPT_DIR/workspace"

# Parse args
PRESET="${1:-node}"
FRESH_PROFILE=false
NO_README=false

for arg in "$@"; do
  case "$arg" in
    --fresh-profile) FRESH_PROFILE=true ;;
    --no-readme)     NO_README=true ;;
  esac
done

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------

echo "┌─────────────────────────────────────────┐"
echo "│  Trellis Sandbox Setup                  │"
echo "│  Preset: $PRESET"
echo "└─────────────────────────────────────────┘"
echo ""

# Nuke existing sandbox workspace
if [ -d "$SANDBOX_DIR" ]; then
  echo "  Cleaning previous sandbox..."
  rm -rf "$SANDBOX_DIR"
fi

mkdir -p "$SANDBOX_DIR"

# Optionally reset global profile
if [ "$FRESH_PROFILE" = true ]; then
  PROFILE_PATH="$HOME/.trellis/profile.json"
  if [ -f "$PROFILE_PATH" ]; then
    echo "  Backing up profile → ~/.trellis/profile.json.bak"
    cp "$PROFILE_PATH" "$PROFILE_PATH.bak"
    rm "$PROFILE_PATH"
    echo "  ✓ Profile removed (backup saved)"
  fi
fi

# ---------------------------------------------------------------------------
# Preset generators
# ---------------------------------------------------------------------------

generate_readme() {
  if [ "$NO_README" = true ]; then return; fi
  local name="$1"
  local desc="$2"
  cat > "$SANDBOX_DIR/README.md" << EOF
# $name

$desc

## Getting Started

Install dependencies and run the development server.

## License

MIT
EOF
  echo "  ✓ README.md"
}

preset_node() {
  cat > "$SANDBOX_DIR/package.json" << 'EOF'
{
  "name": "sandbox-app",
  "version": "0.1.0",
  "description": "A sample web application for testing Trellis onboarding",
  "type": "module",
  "scripts": {
    "dev": "echo 'dev server'",
    "build": "echo 'build'"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.0.0"
  },
  "engines": {
    "bun": ">=1.0.0"
  }
}
EOF
  echo "  ✓ package.json (bun + react)"

  mkdir -p "$SANDBOX_DIR/src"
  cat > "$SANDBOX_DIR/src/index.ts" << 'EOF'
import { useState } from 'react';

export function App() {
  const [count, setCount] = useState(0);
  return { count, increment: () => setCount(c => c + 1) };
}
EOF
  echo "  ✓ src/index.ts"

  cat > "$SANDBOX_DIR/src/utils.ts" << 'EOF'
export function greet(name: string): string {
  return `Hello, ${name}!`;
}

export function sum(a: number, b: number): number {
  return a + b;
}
EOF
  echo "  ✓ src/utils.ts"

  cat > "$SANDBOX_DIR/tsconfig.json" << 'EOF'
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
EOF
  echo "  ✓ tsconfig.json"

  generate_readme "Sandbox App" "A sample Bun + React application used to test Trellis initialization and agent onboarding."
}

preset_python() {
  cat > "$SANDBOX_DIR/pyproject.toml" << 'EOF'
[project]
name = "sandbox-ml"
version = "0.1.0"
description = "A sample Python ML pipeline for testing Trellis"
requires-python = ">=3.11"
dependencies = [
    "numpy>=1.26",
    "pandas>=2.1",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
EOF
  echo "  ✓ pyproject.toml"

  mkdir -p "$SANDBOX_DIR/src/sandbox_ml"
  cat > "$SANDBOX_DIR/src/sandbox_ml/__init__.py" << 'EOF'
"""Sandbox ML pipeline."""
__version__ = "0.1.0"
EOF

  cat > "$SANDBOX_DIR/src/sandbox_ml/pipeline.py" << 'EOF'
"""Main data processing pipeline."""

def transform(data: list[dict]) -> list[dict]:
    """Apply transformations to input data."""
    return [{"processed": True, **item} for item in data]

def validate(data: list[dict]) -> bool:
    """Validate processed data."""
    return all("processed" in item for item in data)
EOF
  echo "  ✓ src/sandbox_ml/"

  generate_readme "Sandbox ML" "A sample Python machine learning pipeline for testing Trellis onboarding with non-JS ecosystems."
}

preset_rust() {
  cat > "$SANDBOX_DIR/Cargo.toml" << 'EOF'
[package]
name = "sandbox-cli"
version = "0.1.0"
edition = "2021"
description = "A sample Rust CLI for testing Trellis"

[dependencies]
clap = { version = "4", features = ["derive"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
EOF
  echo "  ✓ Cargo.toml"

  mkdir -p "$SANDBOX_DIR/src"
  cat > "$SANDBOX_DIR/src/main.rs" << 'EOF'
use clap::Parser;

#[derive(Parser)]
#[command(name = "sandbox", about = "A sample CLI")]
struct Cli {
    #[arg(long)]
    name: Option<String>,
}

fn main() {
    let cli = Cli::parse();
    let name = cli.name.unwrap_or_else(|| "World".to_string());
    println!("Hello, {}!", name);
}
EOF
  echo "  ✓ src/main.rs"

  generate_readme "Sandbox CLI" "A sample Rust CLI tool for testing Trellis onboarding with Cargo-based projects."
}

preset_go() {
  cat > "$SANDBOX_DIR/go.mod" << 'EOF'
module github.com/example/sandbox-api

go 1.22.0

require (
	github.com/go-chi/chi/v5 v5.0.12
)
EOF
  echo "  ✓ go.mod"

  cat > "$SANDBOX_DIR/main.go" << 'EOF'
package main

import (
	"fmt"
	"net/http"
)

func main() {
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "Hello from sandbox API")
	})
	fmt.Println("Listening on :8080")
	http.ListenAndServe(":8080", nil)
}
EOF
  echo "  ✓ main.go"

  generate_readme "Sandbox API" "A sample Go HTTP API for testing Trellis onboarding with Go modules."
}

preset_empty() {
  echo "  (empty directory — no files)"
  generate_readme "Empty Project" "A blank project."
}

preset_large() {
  echo "  Generating ~600 files..."
  for dir in src lib test docs assets config; do
    mkdir -p "$SANDBOX_DIR/$dir"
    for i in $(seq 1 100); do
      echo "// Module $dir/$i" > "$SANDBOX_DIR/$dir/module_${i}.ts"
    done
  done
  echo "  ✓ 600 files across 6 directories"

  # Add a package.json so ecosystem is detectable
  cat > "$SANDBOX_DIR/package.json" << 'EOF'
{
  "name": "sandbox-large",
  "version": "1.0.0",
  "description": "A large project to test Trellis at scale"
}
EOF
  echo "  ✓ package.json"

  generate_readme "Sandbox Large" "A simulated large repository (~600 files) for testing Trellis behavior with mid-to-large codebases."
}

preset_monorepo() {
  cat > "$SANDBOX_DIR/package.json" << 'EOF'
{
  "name": "sandbox-monorepo",
  "private": true,
  "workspaces": ["packages/*"],
  "description": "A mono-repo workspace for testing Trellis"
}
EOF
  echo "  ✓ root package.json"

  for pkg in core api web; do
    mkdir -p "$SANDBOX_DIR/packages/$pkg/src"
    cat > "$SANDBOX_DIR/packages/$pkg/package.json" << EOF
{
  "name": "@sandbox/$pkg",
  "version": "0.1.0",
  "description": "The $pkg package",
  "main": "src/index.ts"
}
EOF
    echo "export const name = '$pkg';" > "$SANDBOX_DIR/packages/$pkg/src/index.ts"
  done
  echo "  ✓ packages/core, packages/api, packages/web"

  generate_readme "Sandbox Monorepo" "A workspace monorepo for testing Trellis behavior with multi-package projects."
}

# ---------------------------------------------------------------------------
# Run preset
# ---------------------------------------------------------------------------

case "$PRESET" in
  node)     preset_node ;;
  python)   preset_python ;;
  rust)     preset_rust ;;
  go)       preset_go ;;
  empty)    preset_empty ;;
  large)    preset_large ;;
  monorepo) preset_monorepo ;;
  *)
    echo "✗ Unknown preset: $PRESET"
    echo "  Available: node, python, rust, go, empty, large, monorepo"
    exit 1
    ;;
esac

echo ""
echo "✓ Sandbox ready at: $SANDBOX_DIR"
echo ""
echo "Next steps:"
echo "  cd $SANDBOX_DIR"
echo "  bun run $TRELLIS_ROOT/src/cli/index.ts init"
echo ""
echo "Or use just:"
echo "  just sandbox-init"
echo ""
