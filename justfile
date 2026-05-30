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
ui path="sandbox/workspace" port="3333":
  #!/usr/bin/env bash
  set -euo pipefail
  # Ensure target is an initialized repo
  if [ ! -f "{{path}}/.trellis/config.json" ]; then
    echo "⚠ No trellis repo at {{path}} — initializing sandbox first…"
    just sandbox-init
  fi
  echo "⚡ Starting Trellis System Visualizer on http://localhost:{{port}}"
  # Auto-open browser after a short delay
  (sleep 1 && open "http://localhost:{{port}}") &
  bun run src/cli/index.ts ui --path "{{path}}" --port "{{port}}"

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
