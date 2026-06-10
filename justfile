# ---------------------------------------------------------------------------
# TrellisVCS — justfile
# ---------------------------------------------------------------------------

# Load .env if present (for NPM_TOKEN, VSCE_PAT)
set dotenv-load := true

# Default: show trellis status
trellis *args="status":
  bun run src/cli/index.ts {{args}}

# ---------------------------------------------------------------------------
# Development
# ---------------------------------------------------------------------------

# Start the app — graph explorer on current directory (inits repo if needed)
run port="4000" trellis_port="3920":
  #!/usr/bin/env bash
  set -euo pipefail
  ROOT="$(pwd)"
  if [ ! -f "$ROOT/.trellis/config.json" ]; then
    echo "⚠ No trellis repo at $ROOT — initializing…"
    bun run src/cli/index.ts init --path "$ROOT" --no-interactive
  fi
  just demo-ensure-build
  just realtime-evict "{{port}}"
  just realtime-evict "{{trellis_port}}"
  just realtime-evict "8231"
  echo "⚡ Starting live graph explorer on http://localhost:{{port}}"
  (sleep 2 && open "http://localhost:{{port}}") &
  bun run src/cli/index.ts ui --path "$ROOT" --port "{{port}}" --trellis-port "{{trellis_port}}"

# Run all tests
test:
  bun test

# Run targeted test suite (core modules only)
test-core:
  bun test test/vcs test/git test/p2 test/p3 test/p4 test/p5 test/p6 test/p7 test/engine.test.ts test/links/ test/embeddings/ test/decisions/ test/issue.test.ts

# Build npm package (bun build → dist/)
build:
  rm -rf dist
  bun run build

# Launch the System Visualizer (builds if needed, opens browser)
ui path="sandbox/workspace" port="4000" trellis_port="3920":
  #!/usr/bin/env bash
  set -euo pipefail
  ROOT="$(cd "{{path}}" && pwd)"
  if [ ! -f "$ROOT/.trellis/config.json" ]; then
    echo "⚠ No trellis repo at $ROOT — initializing…"
    bun run src/cli/index.ts init --path "$ROOT" --no-interactive
  fi
  echo "⚡ Starting live graph explorer on http://localhost:{{port}}"
  (sleep 2 && open "http://localhost:{{port}}") &
  bun run src/cli/index.ts ui --path "$ROOT" --port "{{port}}" --trellis-port "{{trellis_port}}"

# Sync Svelte realtime explorer from sandbox → demo/realtime-app
explorer-sync:
  node scripts/sync-realtime-app.mjs

# ---------------------------------------------------------------------------
# VS Code Extension
# ---------------------------------------------------------------------------

# Build the VS Code extension (compile TS → out/)
ext-build:
  cd vscode-extension && npx tsc -p ./

# Package the extension into a .vsix
ext-package: ext-build
  cd vscode-extension && npx @vscode/vsce package --no-dependencies

# Install the packaged extension into VS Code
ext-install: ext-package
  code --install-extension vscode-extension/trellis-vcs-*.vsix --force

# One-shot: build → package → install → reload hint
ext: ext-install
  @echo ""
  @echo "✓ Extension installed. Reload VS Code window (Cmd+Shift+P → Reload Window)"

# Watch mode: recompile extension on save (run in background)
ext-watch:
  cd vscode-extension && npx tsc -watch -p ./

# ---------------------------------------------------------------------------
# Secrets & Config
# ---------------------------------------------------------------------------

# Push secrets from .env to GitHub Actions via gh CLI
setup-secrets:
  #!/usr/bin/env bash
  set -euo pipefail
  if [ ! -f .env ]; then
    echo "✗ .env not found. Copy .env.example → .env and fill in your tokens."
    exit 1
  fi
  source .env
  if [ -n "${NPM_TOKEN:-}" ]; then
    echo "Setting NPM_TOKEN..."
    gh secret set NPM_TOKEN --body "$NPM_TOKEN"
    echo "✓ NPM_TOKEN set"
  else
    echo "⚠ NPM_TOKEN not set in .env, skipping"
  fi
  if [ -n "${VSCE_PAT:-}" ]; then
    echo "Setting VSCE_PAT..."
    gh secret set VSCE_PAT --body "$VSCE_PAT"
    echo "✓ VSCE_PAT set"
  else
    echo "⚠ VSCE_PAT not set in .env, skipping"
  fi
  echo ""
  echo "Done. Verify with: gh secret list"

# List configured GitHub secrets
list-secrets:
  gh secret list

# ---------------------------------------------------------------------------
# Version Bumping
# ---------------------------------------------------------------------------

# Get current npm package version
version:
  @node -p "require('./package.json').version"

# Get current extension version
ext-version:
  @node -p "require('./vscode-extension/package.json').version"

# Verify npm auth for local publishing
npm-auth:
  #!/usr/bin/env bash
  set -euo pipefail
  if [ -f .env ]; then
    set -a
    source .env
    set +a
  fi
  if [ -n "${NPM_TOKEN:-}" ]; then
    user=$(NODE_AUTH_TOKEN="$NPM_TOKEN" npm whoami --registry=https://registry.npmjs.org)
  else
    user=$(npm whoami --registry=https://registry.npmjs.org)
  fi
  echo "✓ npm authenticated as ${user}"

# Bump npm package version: just bump patch|minor|major
bump level="patch":
  #!/usr/bin/env bash
  set -euo pipefail
  current=$(node -p "require('./package.json').version")
  IFS='.' read -r major minor patch <<< "$current"
  case "{{level}}" in
    patch) patch=$((patch + 1)) ;;
    minor) minor=$((minor + 1)); patch=0 ;;
    major) major=$((major + 1)); minor=0; patch=0 ;;
    *) echo "✗ Invalid level: {{level}}. Use patch, minor, or major."; exit 1 ;;
  esac
  new="${major}.${minor}.${patch}"
  # Update package.json
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    pkg.version = '${new}';
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  "
  echo "✓ trellis: ${current} → ${new}"

# Bump extension version: just ext-bump patch|minor|major
ext-bump level="patch":
  #!/usr/bin/env bash
  set -euo pipefail
  current=$(node -p "require('./vscode-extension/package.json').version")
  IFS='.' read -r major minor patch <<< "$current"
  case "{{level}}" in
    patch) patch=$((patch + 1)) ;;
    minor) minor=$((minor + 1)); patch=0 ;;
    major) major=$((major + 1)); minor=0; patch=0 ;;
    *) echo "✗ Invalid level: {{level}}. Use patch, minor, or major."; exit 1 ;;
  esac
  new="${major}.${minor}.${patch}"
  # Update vscode-extension/package.json
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('vscode-extension/package.json', 'utf8'));
    pkg.version = '${new}';
    fs.writeFileSync('vscode-extension/package.json', JSON.stringify(pkg, null, 2) + '\n');
  "
  echo "✓ vscode-extension: ${current} → ${new}"

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

# Pre-publish validation for npm package
validate: build
  #!/usr/bin/env bash
  set -euo pipefail
  echo "── Validate npm package ──"
  version=$(node -p "require('./package.json').version")
  echo "  Version:  ${version}"

  # Check no private flag
  private=$(node -p "require('./package.json').private || false")
  if [ "$private" = "true" ]; then
    echo "✗ package.json has private:true — cannot publish"; exit 1
  fi
  echo "  ✓ Not private"

  # Check LICENSE exists
  [ -f LICENSE ] && echo "  ✓ LICENSE exists" || { echo "  ✗ LICENSE missing"; exit 1; }

  # Check dist/ has files
  count=$(find dist -name '*.js' | wc -l | tr -d ' ')
  echo "  ✓ dist/ contains ${count} JS files"

  # Check bin shim
  [ -x bin/trellis.mjs ] && echo "  ✓ bin/trellis.mjs executable" || { echo "  ✗ bin shim missing or not executable"; exit 1; }

  # Dry-run pack
  echo "  ── npm pack (dry-run) ──"
  npm pack --dry-run 2>&1 | tail -5
  echo ""
  echo "✓ npm package validation passed"

# Pre-publish validation for VS Code extension
ext-validate: ext-build
  #!/usr/bin/env bash
  set -euo pipefail
  echo "── Validate VS Code extension ──"
  version=$(node -p "require('./vscode-extension/package.json').version")
  echo "  Version:  ${version}"

  # Check publisher
  publisher=$(node -p "require('./vscode-extension/package.json').publisher")
  echo "  Publisher: ${publisher}"
  if [ "$publisher" = "undefined" ]; then
    echo "  ✗ publisher not set"; exit 1
  fi
  echo "  ✓ Publisher set"

  # Check icon
  icon=$(node -p "require('./vscode-extension/package.json').icon || ''")
  if [ -n "$icon" ] && [ -f "vscode-extension/$icon" ]; then
    echo "  ✓ Icon: ${icon}"
  else
    echo "  ⚠ Icon not set or missing (marketplace will show default)"
  fi

  # Check out/ compiled
  count=$(find vscode-extension/out -name '*.js' 2>/dev/null | wc -l | tr -d ' ')
  if [ "$count" -gt 0 ]; then
    echo "  ✓ out/ contains ${count} compiled JS files"
  else
    echo "  ✗ out/ is empty — extension not compiled"; exit 1
  fi

  echo ""
  echo "✓ VS Code extension validation passed"

# ---------------------------------------------------------------------------
# Deploy / Publish
# ---------------------------------------------------------------------------

# Local npm publish (prefer CI: gh workflow run publish-npm.yml — see tooling/RELEASING.md in desk)
# Full flow: commit → push → test → npm auth → bump → build → validate → npm publish → tag → push → release
publish level="patch" message="" otp="":
  #!/usr/bin/env bash
  set -euo pipefail

  if [ -f .env ]; then
    set -a
    source .env
    set +a
  fi

  if [ -n "$(git status --porcelain)" ]; then
    if [ -z "{{message}}" ]; then
      echo "✗ Working tree has changes. Re-run with a commit message: just publish {{level}} \"your message\""
      exit 1
    fi

    git add -A
    git commit -m "{{message}}"
    git push
    echo "✓ Committed and pushed working tree changes"
  fi

  just test-core

  if [ -n "${NPM_TOKEN:-}" ]; then
    user=$(NODE_AUTH_TOKEN="$NPM_TOKEN" npm whoami --registry=https://registry.npmjs.org)
  else
    user=$(npm whoami --registry=https://registry.npmjs.org)
  fi
  echo "✓ npm authenticated as ${user}"

  # Bump version
  just bump {{level}}
  version=$(node -p "require('./package.json').version")
  tag="v${version}"

  # Build & validate
  just validate

  # Publish to npm locally
  if [ -n "${NPM_TOKEN:-}" ]; then
    NODE_AUTH_TOKEN="$NPM_TOKEN" npm publish --access public
  else
    current_otp="{{otp}}"
    if [ -z "$current_otp" ]; then
      if [ -t 0 ]; then
        read -p "Enter npm OTP for publish writes (or press Enter to try web auth): " -r entered_otp
        current_otp=$(echo "$entered_otp" | xargs)
      fi
    fi

    if [ -n "$current_otp" ]; then
      npm publish --access public --otp="$current_otp"
    else
      npm publish --access public
    fi
  fi

  # Git commit, tag, push only after successful npm publish
  git add package.json
  git commit -m "release: trellis ${tag}"
  git tag -a "${tag}" -m "trellis ${tag}"
  git push origin HEAD "${tag}"

  # Create GitHub release to document the publish
  gh release create "${tag}" \
    --repo trentbrew/trellis \
    --title "trellis ${tag}" \
    --generate-notes

  echo ""
  echo "✓ Released ${tag}"
  echo "  Published to npm locally and pushed release metadata to GitHub."

# Resume a publish at the CURRENT version (no bump, no rebuild, just validate and publish).
# Use this when publish failed due to 2FA / auth timeout.
# Usage: just publish-resume
#        just publish-resume <otp>
publish-resume otp="":
  #!/usr/bin/env bash
  set -euo pipefail

  if [ -f .env ]; then
    set -a
    source .env
    set +a
  fi

  if [ -n "${NPM_TOKEN:-}" ]; then
    user=$(NODE_AUTH_TOKEN="$NPM_TOKEN" npm whoami --registry=https://registry.npmjs.org)
  else
    user=$(npm whoami --registry=https://registry.npmjs.org)
  fi
  echo "✓ npm authenticated as ${user}"

  version=$(node -p "require('./package.json').version")
  tag="v${version}"

  # Build & validate
  just validate

  # Publish to npm locally
  if [ -n "${NPM_TOKEN:-}" ]; then
    NODE_AUTH_TOKEN="$NPM_TOKEN" npm publish --access public
  else
    current_otp="{{otp}}"
    if [ -z "$current_otp" ]; then
      if [ -t 0 ]; then
        read -p "Enter npm OTP for publish writes (or press Enter to try web auth): " -r entered_otp
        current_otp=$(echo "$entered_otp" | xargs)
      fi
    fi

    if [ -n "$current_otp" ]; then
      npm publish --access public --otp="$current_otp"
    else
      npm publish --access public
    fi
  fi

  # Git commit, tag, push only after successful npm publish
  git add package.json
  git commit -m "release: trellis ${tag}" || true
  git tag -a "${tag}" -m "trellis ${tag}" || true
  git push origin HEAD "${tag}" || true

  # Create GitHub release to document the publish
  gh release create "${tag}" \
    --repo trentbrew/trellis \
    --title "trellis ${tag}" \
    --generate-notes || true

  echo ""
  echo "✓ Released ${tag}"
  echo "  Published to npm locally and pushed release metadata to GitHub."

# Dry-run the local npm publish flow without publishing
publish-dry-run level="patch": test-core npm-auth
  #!/usr/bin/env bash
  set -euo pipefail

  if [ -f .env ]; then
    set -a
    source .env
    set +a
  fi

  if [ -n "$(git status --porcelain)" ]; then
    echo "✗ Working tree is not clean. Commit or stash changes before dry run."
    exit 1
  fi

  just bump {{level}}
  version=$(node -p "require('./package.json').version")
  tag="v${version}"
  just validate
  if [ -n "${NPM_TOKEN:-}" ]; then
    NODE_AUTH_TOKEN="$NPM_TOKEN" npm publish --dry-run --access public
  else
    npm publish --dry-run --access public
  fi
  git restore package.json
  echo ""
  echo "✓ Local publish dry run passed for ${tag}"

# Full extension publish flow: test → bump → build → validate → tag → push → release
ext-publish level="patch":
  #!/usr/bin/env bash
  set -euo pipefail

  # Bump extension version
  just ext-bump {{level}}
  version=$(node -p "require('./vscode-extension/package.json').version")
  tag="ext-v${version}"

  # Build & validate
  just ext-validate

  # Git commit, tag, push
  git add vscode-extension/package.json
  git commit -m "release: vscode-extension ${tag}"
  git tag -a "${tag}" -m "vscode-extension ${tag}"
  git push origin HEAD "${tag}"

  # Create GitHub release (triggers publish-vsce.yml workflow)
  gh release create "${tag}" \
    --repo trentbrew/trellis \
    --title "TrellisVCS Extension ${tag}" \
    --generate-notes

  echo ""
  echo "✓ Released ${tag}"
  echo "  GitHub Actions will publish to VS Code Marketplace automatically."
  echo "  Watch: gh run watch"

# Publish both npm + extension
publish-all level="patch" message="":
  just publish {{level}} "{{message}}"
  just ext-publish {{level}}

# ---------------------------------------------------------------------------
# Demos — quick run recipes (impolite about ports)
# ---------------------------------------------------------------------------

# List runnable demos and their recipes
demos:
  @echo "Trellis demos (run from repo root):"
  @echo ""
  @echo "  Realtime primitives   just realtime-demo           → :8231/demo/realtime/"
  @echo "  SvelteKit explorer    just realtime-app              → :4000  (trellis :3920, relay :8231)"
  @echo "  Universal presence    just universal-presence        → :4100  (relay :8231, cross-browser)"
  @echo "  Graph nav (typed SDK) just graph-nav                   → :4200  (trellis :8230)"
  @echo "  State + causal DAG    just state-demo                → :8240/demo/state-demo/"
  @echo "  Query playground      just query-demo                → :8241/demo/query/"
  @echo "  Chat + graph          just chat-graph-demo           → :8243/demo/chat-graph/"
  @echo "  WebContainer host     just realtime-app-wc           → :4500"
  @echo ""
  @echo "  Build trellis dist    just demo-ensure-build"
  @echo "  Realtime unit tests   just realtime-test"
  @echo "  Stop a static demo    just realtime-stop [port]"

# Ensure dist/ exists and pnpm-linked copies match (demos import trellis from file:../..)
demo-ensure-build:
  #!/usr/bin/env bash
  set -euo pipefail
  if [ ! -f dist/client/index.js ]; then
    echo "Building trellis package…"
    just build
  fi
  node scripts/ensure-linked-trellis.mjs demo/realtime-app

# Build the browser bundle for demo/realtime/index.html
realtime-bundle:
  npm run build:realtime-bundle

# Sync all embed demos → trellis.computer www
docs-demos-sync www="":
  #!/usr/bin/env bash
  set -euo pipefail
  export TRELLIS_DOCS_WWW="{{www}}"
  if [ -z "${TRELLIS_DOCS_WWW}" ]; then
    export TRELLIS_DOCS_WWW="$(cd "{{justfile_directory()}}/../../Packages/trellis-docs/www" && pwd)"
  fi
  node scripts/sync-docs-demos.mjs

# Copy state-demo bundle + todo/DAG embed into trellis.computer (Packages/trellis-docs/www)
docs-state-demo-sync www="":
  #!/usr/bin/env bash
  set -euo pipefail
  export TRELLIS_DOCS_WWW="{{www}}"
  if [ -z "${TRELLIS_DOCS_WWW}" ]; then
    export TRELLIS_DOCS_WWW="$(cd "{{justfile_directory()}}/../../Packages/trellis-docs/www" && pwd)"
  fi
  node scripts/sync-state-demo-docs.mjs

# Copy realtime bundle + embed demo into trellis.computer (Packages/trellis-docs/www)
docs-realtime-sync www="":
  #!/usr/bin/env bash
  set -euo pipefail
  export TRELLIS_DOCS_WWW="{{www}}"
  if [ -z "${TRELLIS_DOCS_WWW}" ]; then
    export TRELLIS_DOCS_WWW="$(cd "{{justfile_directory()}}/../../Packages/trellis-docs/www" && pwd)"
  fi
  node scripts/sync-realtime-docs.mjs

# Kill whatever is listening on PORT and any prior demo/realtime/serve.mjs. No questions.
realtime-evict port="8231":
  #!/usr/bin/env bash
  set -euo pipefail
  port="{{port}}"
  pids=""
  if command -v lsof >/dev/null 2>&1; then
    pids=$(lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null || true)
  fi
  if [ -n "${pids}" ]; then
    echo "Port ${port} was occupied. Evicting without ceremony."
    for pid in ${pids}; do
      name=$(ps -p "${pid}" -o comm= 2>/dev/null || echo "pid ${pid}")
      echo "  → SIGKILL ${name} (${pid})"
      kill -9 "${pid}" 2>/dev/null || true
    done
    sleep 0.2
  fi
  if pkill -f "demo/realtime/serve.mjs" 2>/dev/null; then
    echo "Also cleared a lingering demo/realtime/serve.mjs."
  fi
  echo "Port ${port} belongs to Trellis now."

# Run realtime unit tests
realtime-test:
  ./node_modules/.bin/vitest run test/realtime

# Serve multiplayer demos — fixed port, no fallback, squatters get killed
realtime-demo port="8231" open="1":
  #!/usr/bin/env bash
  set -euo pipefail
  port="{{port}}"
  url="http://localhost:${port}/demo/realtime/index.html"

  just realtime-evict "${port}"

  if [ ! -f dist/realtime.bundle.js ] || [ ! -f dist/realtime/relay-persistence.js ]; then
    echo "Building realtime demo bundles…"
    just realtime-bundle
  fi

  echo ""
  echo "⚡ Realtime demos → ${url}"
  echo "   Simulated room in-page. Live relay (?live=1): WebSocket /rt — all browsers."
  echo "   This recipe does not share the port. Pick another: just realtime-demo 8242"
  echo ""

  if [ "{{open}}" = "1" ]; then
    (sleep 0.4 && open "${url}") &
  fi

  exec node demo/realtime/serve.mjs "${port}"

# Stop the demo server (same eviction — impolite, effective)
realtime-stop port="8231":
  just realtime-evict "{{port}}"

# SvelteKit realtime explorer — Vite (:4000) + Trellis sidecar (:3920)
realtime-app port="4000" trellis_port="3920" open="1":
  #!/usr/bin/env bash
  set -euo pipefail
  app="demo/realtime-app"
  url="http://localhost:{{port}}"

  just demo-ensure-build
  just realtime-evict "{{port}}"
  just realtime-evict "{{trellis_port}}"
  just realtime-evict "8231"

  if [ ! -d "${app}/node_modules" ]; then
    echo "Installing realtime-app deps…"
    (cd "${app}" && pnpm install)
  else
    node "${app}/scripts/ensure-trellis-build.mjs"
  fi

  echo ""
  echo "⚡ Realtime explorer → ${url}"
  echo "   Trellis inspector → http://localhost:{{trellis_port}}"
  echo "   Presence (relay, cross-browser): ${url}/presence"
  echo "   Relay → ws://localhost:8231/rt"
  echo ""

  if [ "{{open}}" = "1" ]; then
    (sleep 1.2 && open "${url}") &
  fi

  cd "${app}" && exec pnpm dev:all

# WebContainer playground for the explorer
realtime-app-wc port="4500" open="1":
  #!/usr/bin/env bash
  set -euo pipefail
  app="demo/realtime-app"
  url="http://localhost:{{port}}"

  just demo-ensure-build
  just realtime-evict "{{port}}"

  if [ ! -d "${app}/node_modules" ]; then
    echo "Installing realtime-app deps…"
    (cd "${app}" && pnpm install)
  fi

  echo ""
  echo "⚡ WebContainer host → ${url}"
  echo ""

  if [ "{{open}}" = "1" ]; then
    (sleep 0.6 && open "${url}") &
  fi

  cd "${app}" && WC_HOST_PORT="{{port}}" exec pnpm wc:host

# React / Vue / Svelte presence + chat + text (relay-backed cross-browser sync)
universal-presence port="4100" relay_port="8231" open="1":
  #!/usr/bin/env bash
  set -euo pipefail
  dir="examples/universal-presence"
  base="http://localhost:{{port}}"

  just demo-ensure-build
  just realtime-evict "{{port}}"
  just realtime-evict "{{relay_port}}"

  if [ ! -d "${dir}/node_modules" ]; then
    echo "Installing universal-presence deps…"
    npm install --prefix "${dir}"
  else
    node "${dir}/../../scripts/ensure-linked-trellis.mjs" "${dir}"
  fi

  echo ""
  echo "⚡ Universal presence → ${base}/"
  echo "   React   → ${base}/react/"
  echo "   Vue     → ${base}/vue/"
  echo "   Svelte  → ${base}/svelte/"
  echo "   Chat    → ${base}/chat/react/  (etc.)"
  echo "   Text    → ${base}/text/react/  (etc.)"
  echo "   Relay   → ws://localhost:{{relay_port}}/rt  (Chrome ↔ Safari, cross-device)"
  echo ""

  if [ "{{open}}" = "1" ]; then
    (sleep 0.8 && open "${base}/react/" && open "${base}/vue/" && open "${base}/svelte/") &
  fi

  cd "${dir}" && PORT="{{port}}" RELAY_PORT="{{relay_port}}" exec npm run dev:all

# Typed SDK graph nav — React / Vue / Svelte share one Trellis entity graph
graph-nav port="4200" trellis_port="8230" open="1":
  #!/usr/bin/env bash
  set -euo pipefail
  dir="examples/graph-nav"
  base="http://localhost:{{port}}"

  just demo-ensure-build
  just realtime-evict "{{port}}"
  just realtime-evict "{{trellis_port}}"

  if [ ! -d "${dir}/node_modules" ]; then
    echo "Installing graph-nav deps…"
    (cd "${dir}" && pnpm install)
  else
    node "${dir}/../../scripts/ensure-linked-trellis.mjs" "${dir}"
  fi

  echo ""
  echo "⚡ Graph nav → ${base}/"
  echo "   React   → ${base}/react/"
  echo "   Vue     → ${base}/vue/"
  echo "   Svelte  → ${base}/svelte/"
  echo "   Trellis → http://localhost:{{trellis_port}}  (/realtime WS — cross-browser by default)"
  echo ""

  if [ "{{open}}" = "1" ]; then
    (sleep 0.8 && open "${base}/react/" && open "${base}/vue/") &
  fi

  cd "${dir}" && PORT="{{port}}" TRELLIS_PORT="{{trellis_port}}" exec pnpm dev:all

# Stop graph-nav stack (Vite + Trellis entity server)
graph-nav-stop port="4200" trellis_port="8230":
  just realtime-evict "{{port}}"
  just realtime-evict "{{trellis_port}}"

# Todo lists + merged VcsOp DAG (browser bundle)
state-demo port="8240" open="1":
  #!/usr/bin/env bash
  set -euo pipefail
  url="http://localhost:{{port}}/demo/state-demo/index.html"

  just realtime-evict "{{port}}"

  if [ ! -f dist/state-demo.bundle.js ]; then
    echo "Building state-demo bundle…"
    npm run build:state-demo-bundle
  fi

  echo ""
  echo "⚡ State demo → ${url}"
  echo ""

  if [ "{{open}}" = "1" ]; then
    (sleep 0.4 && open "${url}") &
  fi

  exec node demo/realtime/serve.mjs "{{port}}"

# EQL-S query playground (static HTML, inline fixture graph)
query-demo port="8241" open="1":
  #!/usr/bin/env bash
  set -euo pipefail
  url="http://localhost:{{port}}/demo/query/index.html"

  just realtime-evict "{{port}}"

  echo ""
  echo "⚡ Query playground → ${url}"
  echo ""

  if [ "{{open}}" = "1" ]; then
    (sleep 0.4 && open "${url}") &
  fi

  exec node demo/realtime/serve.mjs "{{port}}"

# Chat + graph visualization (uses dist/realtime.bundle.js)
chat-graph-demo port="8243" open="1":
  #!/usr/bin/env bash
  set -euo pipefail
  url="http://localhost:{{port}}/demo/chat-graph/index.html"

  just realtime-evict "{{port}}"

  if [ ! -f dist/realtime.bundle.js ]; then
    echo "Building realtime bundle…"
    just realtime-bundle
  fi

  echo ""
  echo "⚡ Chat + graph → ${url}"
  echo ""

  if [ "{{open}}" = "1" ]; then
    (sleep 0.4 && open "${url}") &
  fi

  exec node demo/realtime/serve.mjs "{{port}}"

# Stop explorer stack (Vite + Trellis sidecar + presence relay)
realtime-app-stop port="4000" trellis_port="3920" relay_port="8231":
  just realtime-evict "{{port}}"
  just realtime-evict "{{trellis_port}}"
  just realtime-evict "{{relay_port}}"

# ---------------------------------------------------------------------------
# Sandbox — test trellis as a fresh user
# ---------------------------------------------------------------------------

# Set up sandbox workspace (presets: node, python, rust, go, empty, large, monorepo)
sandbox preset="node":
  chmod +x sandbox/setup.sh
  ./sandbox/setup.sh {{preset}}

# Set up sandbox with fresh profile (first-run experience)
sandbox-fresh preset="node":
  chmod +x sandbox/setup.sh
  ./sandbox/setup.sh {{preset}} --fresh-profile

# Run `trellis init` inside the sandbox
sandbox-init:
  bun run src/cli/index.ts init --path sandbox/workspace

# Run `trellis status` inside the sandbox
sandbox-status:
  bun run src/cli/index.ts status --path sandbox/workspace

# Run `trellis season` inside the sandbox
sandbox-season:
  bun run src/cli/index.ts season --path sandbox/workspace

# Run `trellis log` inside the sandbox
sandbox-log:
  bun run src/cli/index.ts log --path sandbox/workspace

# Run any trellis command inside the sandbox
sandbox-run *args:
  bun run src/cli/index.ts {{args}} --path sandbox/workspace

# Clean up sandbox and restore profile backup
sandbox-clean:
  chmod +x sandbox/teardown.sh
  ./sandbox/teardown.sh --restore-profile

# Full reset: clean + re-setup
sandbox-reset preset="node":
  just sandbox-clean
  just sandbox {{preset}}

# ---------------------------------------------------------------------------
# Sandbox smoke (delegates to desk — tarball paths resolve in sandbox-smoke.ts)
# ---------------------------------------------------------------------------

smoke *ARGS:
  cd ".." && just smoke {{ARGS}}

smoke-kernel *ARGS:
  cd ".." && just smoke-kernel {{ARGS}}

# ---------------------------------------------------------------------------
# Deploy
# ---------------------------------------------------------------------------

deploy version="3.2.0":
  npm dist-tag add trellis@{{version}} latest