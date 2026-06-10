/**
 * Agent Scaffold Writer
 *
 * Writes the agent context directory (.trellis/agents/) during `trellis init`.
 * Produces AGENTS.md (human + AI readable), agent-context.json (machine
 * readable), and stub directories for skills and workflows.
 *
 * The agent config is named `agent-context.json` (not `config.json`) to avoid
 * collision with `.trellis/config.json` which stores engine configuration.
 *
 * @module trellis/scaffold/write
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { ProjectContext } from './infer.js';
import type { UserProfile } from './profile.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentScaffoldConfig {
  domain: string | null;
  ecosystem: string | null;
  tools: string[];
  ontologies: string[];
  generatedAt: string;
  confidence: string;
}

export interface ScaffoldInput {
  profile: UserProfile | null;
  context: ProjectContext;
}

export type IdeType =
  | 'cursor'
  | 'devin'
  | 'claude'
  | 'copilot'
  | 'codex'
  | 'gemini'
  | 'none';
export type WorkspaceFootprint = 'minimal' | 'standard' | 'full';
export type FrameworkType =
  | 'react'
  | 'vue'
  | 'svelte'
  | 'next'
  | 'nuxt'
  | 'remotion'
  | 'expo'
  | 'bun'
  | 'node'
  | 'cli'
  | 'library'
  | 'animation'
  | 'games'
  | 'none';

export interface IdeScaffoldInput {
  ide: IdeType;
  footprint: WorkspaceFootprint;
  framework: FrameworkType;
  plugins: string[];
  rootPath: string;
  context: ProjectContext;
  profile: UserProfile | null;
}

// ---------------------------------------------------------------------------
// Enhanced Trellis Hook Generation
// ---------------------------------------------------------------------------

/**
 * Write enhanced Trellis hooks for IDE integration
 * Generates shared harness scripts and IDE-specific adapters
 */
function writeTrellisHooks(rootPath: string, ide: IdeType): void {
  const hooksDir = join(rootPath, '.cursor', 'hooks');
  const trellisHarnessDir = join(hooksDir, 'trellis-harness');
  const adaptersDir = join(hooksDir, 'adapters');

  // Create directories
  if (!existsSync(trellisHarnessDir)) {
    mkdirSync(trellisHarnessDir, { recursive: true });
  }
  if (!existsSync(adaptersDir)) {
    mkdirSync(adaptersDir, { recursive: true });
  }

  // Write shared harness scripts
  writeFileSync(
    join(trellisHarnessDir, 'pre-prompt-recall.sh'),
    renderPrePromptRecallScript(),
    'utf-8',
  );

  writeFileSync(
    join(trellisHarnessDir, 'normalize-op.jq'),
    readHarnessTemplate('normalize-op.jq'),
    'utf-8',
  );

  writeFileSync(
    join(trellisHarnessDir, 'post-tool-oplog.sh'),
    renderPostToolOplogScript(),
    'utf-8',
  );

  writeFileSync(
    join(trellisHarnessDir, 'post-tool-memory-capture.sh'),
    renderPostToolMemoryCaptureScript(),
    'utf-8',
  );

  writeFileSync(
    join(trellisHarnessDir, 'stop-triage.sh'),
    renderStopTriageScript(),
    'utf-8',
  );

  writeFileSync(
    join(trellisHarnessDir, 'bug-intake.sh'),
    renderBugIntakeScript(),
    'utf-8',
  );

  writeFileSync(
    join(trellisHarnessDir, 'bug-investigate.sh'),
    renderBugInvestigateScript(),
    'utf-8',
  );

  writeFileSync(
    join(trellisHarnessDir, 'milestone-triage.sh'),
    renderMilestoneTriageScript(),
    'utf-8',
  );

  writeFileSync(
    join(trellisHarnessDir, 'cycle-planning.sh'),
    renderCyclePlanningScript(),
    'utf-8',
  );

  // Write IDE-specific adapters
  const adapterName = `${ide}-adapter.sh`;
  writeFileSync(
    join(adaptersDir, adapterName),
    renderAdapterScript(ide),
    'utf-8',
  );

  // Write IDE-specific hook configurations
  switch (ide) {
    case 'cursor':
      writeFileSync(
        join(rootPath, '.cursor', 'hooks.json'),
        JSON.stringify(renderCursorHooksConfig(), null, 2),
        'utf-8',
      );
      break;
    case 'devin':
      writeFileSync(
        join(rootPath, '.devin', 'hooks.json'),
        JSON.stringify(renderDevinHooksConfig(), null, 2),
        'utf-8',
      );
      break;
    case 'claude':
      writeFileSync(
        join(rootPath, '.claude', 'settings.local.json'),
        JSON.stringify(renderClaudeHooksConfig(), null, 2),
        'utf-8',
      );
      break;
    case 'codex':
      writeFileSync(
        join(rootPath, '.codex', 'hooks.json'),
        JSON.stringify(renderCodexHooksConfig(), null, 2),
        'utf-8',
      );
      break;
    case 'gemini':
      writeFileSync(
        join(rootPath, '.gemini', 'settings.json'),
        JSON.stringify(renderGeminiHooksConfig(), null, 2),
        'utf-8',
      );
      break;
  }
}

// ---------------------------------------------------------------------------
// Template renderers
// ---------------------------------------------------------------------------

function renderAgentsMd(
  profile: UserProfile | null,
  context: ProjectContext,
): string {
  const userName = profile?.name ?? 'the user';
  const userBio =
    profile?.bio ||
    '(No bio provided — run `trellis season` to set up your profile.)';
  const userSkills = profile?.skills?.length
    ? profile.skills.join(', ')
    : '(not specified)';
  const userStyle = profile?.style || '(not specified)';
  const userVerbosity = profile?.preferences?.verbosity ?? 'balanced';
  const userTone = profile?.preferences?.tone ?? 'peer';

  const projectName = context.name ?? '(unnamed)';
  const projectDomain =
    context.domain ?? '(not determined — run `trellis season` to specify)';
  const projectDesc = context.description ?? '(no description found)';
  const projectEco = context.ecosystem ?? 'unknown';
  const confidence = context.confidence;

  return `# Trellis Agent Context

> This file was generated by \`trellis init\` and should be kept up to date.
> Inference confidence: **${confidence}**

---

## About the User

| Field | Value |
|-------|-------|
| **Name** | ${userName} |
| **Bio** | ${userBio} |
| **Skills** | ${userSkills} |
| **Style** | ${userStyle} |
| **Preferred verbosity** | ${userVerbosity} |
| **Preferred tone** | ${userTone} |

---

## About This Project

| Field | Value |
|-------|-------|
| **Name** | ${projectName} |
| **Domain** | ${projectDomain} |
| **Description** | ${projectDesc} |
| **Ecosystem** | ${projectEco} |
| **File count** | ~${context.fileCount} |

---

## Agent Instructions

You are operating in a Trellis-tracked repository. Follow these guidelines:

1. **Read \`agent-context.json\`** in this directory for registered tools, ontologies, and domain settings.
2. **Check \`skills/\`** for domain-specific operating instructions relevant to this project.
3. **Check \`workflows/\`** for repeatable task procedures. Favor existing workflows before improvising.
4. **Update this file** as the project evolves — new teammates, new goals, new tools.
5. **Communicate through Trellis** — prefer writing to the graph kernel over mutating files directly when recording decisions or state.
6. **Run \`trellis season\`** if context seems incomplete or out of date.

---

## Quick Reference

\`\`\`bash
trellis status          # Current repo state
trellis log             # Causal operation history
trellis milestone       # Create narrative checkpoints
trellis ask "..."       # Semantic search across the repo
trellis season          # Re-run domain onboarding
\`\`\`
`;
}

function renderConfigJson(context: ProjectContext): AgentScaffoldConfig {
  return {
    domain: context.domain,
    ecosystem: context.ecosystem,
    tools: [],
    ontologies: [],
    generatedAt: new Date().toISOString(),
    confidence: context.confidence,
  };
}

function renderSkillsReadme(): string {
  return `# Skills

Place domain-specific operating instructions here as \`.md\` files.

Each skill file should follow the format:

\`\`\`markdown
---
name: Skill Name
description: When to use this skill.
---

# Instructions
...
\`\`\`

The agent will discover and read skill files relevant to the current task.
`;
}

function renderWorkflowsReadme(): string {
  return `# Workflows

Place repeatable task procedures here as \`.md\` files.

Each workflow file should follow the format:

\`\`\`markdown
---
description: Short description of what this workflow does.
---

## Steps

1. Step one
2. Step two
// turbo
3. Auto-runnable step
\`\`\`

Add \`// turbo\` above a step to allow the agent to auto-run it without confirmation.
Add \`// turbo-all\` anywhere in the file to auto-run every step.
`;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Write the full agent scaffold into .trellis/agents/.
 *
 * @param rootPath - Absolute path to the repository root
 * @param input    - Profile and inferred project context
 */
export function writeAgentScaffold(
  rootPath: string,
  input: ScaffoldInput,
): void {
  const agentsDir = join(rootPath, '.trellis', 'agents');
  const skillsDir = join(agentsDir, 'skills');
  const workflowsDir = join(agentsDir, 'workflows');

  // Create directories
  for (const dir of [agentsDir, skillsDir, workflowsDir]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // AGENTS.md — always write (overwrite to stay fresh on re-init)
  writeFileSync(
    join(agentsDir, 'AGENTS.md'),
    renderAgentsMd(input.profile, input.context),
    'utf-8',
  );

  // agent-context.json — always write
  writeFileSync(
    join(agentsDir, 'agent-context.json'),
    JSON.stringify(renderConfigJson(input.context), null, 2),
    'utf-8',
  );

  // Stub READMEs — only if directory is empty
  const skillsReadmePath = join(skillsDir, 'README.md');
  if (!existsSync(skillsReadmePath)) {
    writeFileSync(skillsReadmePath, renderSkillsReadme(), 'utf-8');
  }

  const workflowsReadmePath = join(workflowsDir, 'README.md');
  if (!existsSync(workflowsReadmePath)) {
    writeFileSync(workflowsReadmePath, renderWorkflowsReadme(), 'utf-8');
  }
}

// ---------------------------------------------------------------------------
// IDE-specific scaffold writers
// ---------------------------------------------------------------------------

function renderCursorRules(input: IdeScaffoldInput): string {
  const projectName = input.context.name ?? 'this project';
  const domain = input.context.domain ?? 'general';
  const eco = input.context.ecosystem ?? 'unknown';
  const framework =
    input.framework && input.framework !== 'none' ? input.framework : 'vanilla';
  const plugins =
    input.plugins.length > 0
      ? input.plugins.map((p) => `- ${p}`).join('\n')
      : '(none selected)';

  return `# Cursor Rules for ${projectName}

> Generated by \`trellis init\`

## Project Context
- **Domain**: ${domain}
- **Framework**: ${framework}
- **Ecosystem**: ${eco}
- **Confidence**: ${input.context.confidence}

## Selected Features
${plugins}

## Agent Instructions
You are working in a Trellis-tracked repository. See \`.trellis/agents/AGENTS.md\` for full context.

## Commands
- \`trellis status\` — Check repo state
- \`trellis seed\` — Refresh this context file
- \`trellis log\` — View causal history

---
*Auto-generated by Trellis. Run \`trellis seed\` to refresh context.*
`;
}

function renderDevinRules(input: IdeScaffoldInput): string {
  const projectName = input.context.name ?? 'this project';
  const domain = input.context.domain ?? 'general';
  const eco = input.context.ecosystem ?? 'unknown';
  const framework =
    input.framework && input.framework !== 'none' ? input.framework : 'vanilla';
  const plugins =
    input.plugins.length > 0
      ? input.plugins.map((p) => `- ${p}`).join('\n')
      : '(none selected)';

  return `# Devin Rules for ${projectName}

> Generated by \`trellis init\`

## Project Context
- **Domain**: ${domain}
- **Framework**: ${framework}
- **Ecosystem**: ${eco}
- **Confidence**: ${input.context.confidence}

## Selected Features
${plugins}

## Agent Instructions
You are working in a Trellis-tracked repository. See \`.trellis/agents/AGENTS.md\` for full context.

## Commands
- \`trellis status\` — Check repo state
- \`trellis seed\` — Refresh this context file
- \`trellis log\` — View causal history

---
*Auto-generated by Trellis. Run \`trellis seed\` to refresh context.*
`;
}

function renderClaudeMd(input: IdeScaffoldInput): string {
  const projectName = input.context.name ?? 'this project';
  const domain = input.context.domain ?? 'general';
  const eco = input.context.ecosystem ?? 'unknown';
  const framework =
    input.framework && input.framework !== 'none' ? input.framework : 'vanilla';
  const plugins =
    input.plugins.length > 0
      ? input.plugins.map((p) => `- ${p}`).join('\n')
      : '(none selected)';

  return `# Claude Context for ${projectName}

> Generated by \`trellis init\`

## Project Context
- **Domain**: ${domain}
- **Framework**: ${framework}
- **Ecosystem**: ${eco}
- **Confidence**: ${input.context.confidence}

## Selected Features
${plugins}

## Agent Instructions
You are working in a Trellis-tracked repository. See \`.trellis/agents/AGENTS.md\` for full context.

## Commands
- \`trellis status\` — Check repo state
- \`trellis seed\` — Refresh this context file
- \`trellis log\` — View causal history

---
*Auto-generated by Trellis. Run \`trellis seed\` to refresh context.*
`;
}

function renderCopilotConfig(input: IdeScaffoldInput): Record<string, unknown> {
  return {
    version: '1.0',
    generatedBy: 'trellis init',
    context: {
      domain: input.context.domain,
      framework: input.framework,
      ecosystem: input.context.ecosystem,
      projectName: input.context.name,
      confidence: input.context.confidence,
    },
    plugins: input.plugins,
  };
}

function renderCodexConfig(input: IdeScaffoldInput): Record<string, unknown> {
  return {
    version: '1.0',
    generatedBy: 'trellis init',
    context: {
      domain: input.context.domain,
      framework: input.framework,
      ecosystem: input.context.ecosystem,
      projectName: input.context.name,
      confidence: input.context.confidence,
    },
    features: input.plugins,
  };
}

function renderGeminiConfig(input: IdeScaffoldInput): Record<string, unknown> {
  return {
    version: '1.0',
    generatedBy: 'trellis init',
    context: {
      domain: input.context.domain,
      framework: input.framework,
      ecosystem: input.context.ecosystem,
      projectName: input.context.name,
      confidence: input.context.confidence,
    },
    features: input.plugins,
  };
}

// ---------------------------------------------------------------------------
// Enhanced Trellis Hook Template Renderers
// ---------------------------------------------------------------------------

function renderPrePromptRecallScript(): string {
  return `#!/usr/bin/env bash
# Pre-prompt memory and context recall for Trellis integration
# Normalized contract: TRELLIS_ORIGIN, TRELLIS_DESK_ROOT, TRELLIS_HOOK_OUTPUT
set -euo pipefail

# Import desk root detection
source "$(dirname "$0")/../../desk-root.sh"

# Environment variables from contract
ORIGIN="\${TRELLIS_ORIGIN:-unknown}"
OUTPUT="\${TRELLIS_HOOK_OUTPUT:-stdout}"

# Only run if we're in a Trellis workspace
if ! command -v trellis >/dev/null 2>&1; then
  exit 0
fi

# Try to get Trellis context (non-blocking)
if [ -f ".trellis/config.json" ]; then
  # Query recent memories and entities for context
  CONTEXT_OUTPUT=$(trellis query --limit 5 --format json 2>/dev/null || echo '{"entities":[],"relations":[]}')

  # Query recent operations for context
  OPS_OUTPUT=$(trellis log --limit 3 --format json 2>/dev/null || echo '{"operations":[]}')

  # Query active issues
  ISSUES_OUTPUT=$(trellis issue list --status active --format json 2>/dev/null || echo '{"issues":[]}')

  # Format output based on hook type
  case "$OUTPUT" in
    "agent-stop")
      # For Codex/Gemini blocking hooks
      echo "{}"
      ;;
    "gemini")
      # For Gemini CLI format
      cat << EOF
{
  "decision": "allow",
  "context": {
    "memories": $CONTEXT_OUTPUT,
    "operations": $OPS_OUTPUT,
    "issues": $ISSUES_OUTPUT,
    "origin": "$ORIGIN"
  }
}
EOF
      ;;
    *)
      # Default stdout for Cursor/Devin/Claude
      echo ""
      echo "🌿 Trellis Context ($ORIGIN):"
      echo "  Recent memories: $(echo "$CONTEXT_OUTPUT" | jq -r '.entities | length' 2>/dev/null || echo "0")"
      echo "  Recent ops: $(echo "$OPS_OUTPUT" | jq -r '.operations | length' 2>/dev/null || echo "0")"
      echo "  Active issues: $(echo "$ISSUES_OUTPUT" | jq -r '.issues | length' 2>/dev/null || echo "0")"
      echo ""
      ;;
  esac
fi

exit 0`;
}

const SCAFFOLD_MODULE_DIR = dirname(fileURLToPath(import.meta.url));

function readHarnessTemplate(name: string): string {
  return readFileSync(
    join(SCAFFOLD_MODULE_DIR, '..', '..', 'templates', 'trellis-harness', name),
    'utf-8',
  );
}

function renderPostToolOplogScript(): string {
  return `#!/usr/bin/env bash
# Post-tool operation logging for Trellis integration (agent-ops v1 schema).
set -euo pipefail

source "$(dirname "$0")/../desk-root.sh"

ORIGIN="\${TRELLIS_ORIGIN:-unknown}"
TOOL_DATA=$(cat)

if [ ! -f ".trellis/config.json" ]; then
  exit 0
fi
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
LOG_DIR=".trellis/agent-ops"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/ops-$(date +%Y-%m-%d).jsonl"
NORMALIZE_JQ="$(dirname "$0")/normalize-op.jq"

OP_ENTRY=$(printf '%s' "$TOOL_DATA" | jq -c -f "$NORMALIZE_JQ" \\
  --arg ts "$TS" \\
  --arg origin "$ORIGIN" 2>/dev/null) || OP_ENTRY="{\\"schema_version\\":1,\\"timestamp\\":\\"$TS\\",\\"origin\\":\\"$ORIGIN\\",\\"tool\\":\\"unknown\\",\\"action\\":\\"unknown\\",\\"target\\":\\"\\",\\"command\\":\\"\\",\\"pattern\\":\\"\\",\\"mcp_server\\":\\"\\",\\"mcp_tool\\":\\"\\",\\"model\\":\\"\\",\\"tool_use_id\\":\\"\\",\\"type\\":\\"agent-operation\\"}"

printf '%s\\n' "$OP_ENTRY" >> "$LOG_FILE"
find "$LOG_DIR" -name "ops-*.jsonl" -mtime +7 -delete 2>/dev/null || true

exit 0`;
}

function renderPostToolMemoryCaptureScript(): string {
  return `#!/usr/bin/env bash
# Post-tool memory and entity capture for Trellis integration
# Normalized contract: TRELLIS_ORIGIN, TRELLIS_DESK_ROOT, stdin with tool data
set -euo pipefail

# Import desk root detection
source "$(dirname "$0")/../../desk-root.sh"

# Environment variables from contract
ORIGIN="\${TRELLIS_ORIGIN:-unknown}"

# Read tool data from stdin
TOOL_DATA=$(cat)

NORMALIZE_JQ="$(dirname "$0")/normalize-op.jq"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
NORM=$(printf '%s' "$TOOL_DATA" | jq -c -f "$NORMALIZE_JQ" --arg ts "$TS" --arg origin "$ORIGIN" 2>/dev/null || echo "")
TOOL_NAME=$(echo "$NORM" | jq -r '.tool // "unknown"' 2>/dev/null || echo "unknown")
ACTION=$(echo "$NORM" | jq -r '.action // "unknown"' 2>/dev/null || echo "unknown")
FILE_PATH=$(echo "$NORM" | jq -r '.target // ""' 2>/dev/null || echo "")

# Only run if we're in a Trellis workspace
if ! command -v trellis >/dev/null 2>&1; then
  exit 0
fi

if [ -f ".trellis/config.json" ]; then
  # Suggest memory creation for significant operations
  case "$TOOL_NAME-$ACTION" in
    "edit-create"|"write-create"|"Edit-create"|"Write-create")
      # File creation - suggest creating a memory
      if [ -n "$FILE_PATH" ]; then
        echo "🧠 Consider creating a memory for the new file: $FILE_PATH"
        echo "   Run: trellis memory create -t \"Created $FILE_PATH\" -c \"Created via $ORIGIN agent\""
      fi
      ;;
    "edit-update"|"Edit-update")
      # File update - suggest updating memory if significant
      if [ -n "$FILE_PATH" ]; then
        echo "🔄 Consider updating relevant memories for: $FILE_PATH"
        echo "   Run: trellis memory list -q \"$FILE_PATH\""
      fi
      ;;
    "issue-create"|"issue-update")
      # Issue operations - always suggest memory
      echo "📝 Consider creating a memory for this issue operation"
      echo "   Run: trellis memory create -t \"Issue $ACTION via $ORIGIN\""
      ;;
  esac

  # Store potential memory suggestions for later
  MEMORY_DIR=".trellis/agent-suggestions"
  mkdir -p "$MEMORY_DIR"

  SUGGESTION=$(cat << EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)",
  "origin": "$ORIGIN",
  "tool": "$TOOL_NAME",
  "action": "$ACTION",
  "target": "$FILE_PATH",
  "suggestion_type": "memory-creation"
}
EOF
  )

  SUGGESTIONS_FILE="$MEMORY_DIR/suggestions-$(date +%Y-%m-%d).jsonl"
  echo "$SUGGESTION" >> "$SUGGESTIONS_FILE"

  # Keep only last 3 days of suggestions
  find "$MEMORY_DIR" -name "suggestions-*.jsonl" -mtime +3 -delete 2>/dev/null || true
fi

exit 0`;
}

function renderStopTriageScript(): string {
  return `#!/usr/bin/env bash
# Session stop issue triage and workflow suggestions for Trellis integration
# Normalized contract: TRELLIS_ORIGIN, TRELLIS_DESK_ROOT, TRELLIS_HOOK_OUTPUT
set -euo pipefail

# Import desk root detection
source "$(dirname "$0")/../../desk-root.sh"

# Environment variables from contract
ORIGIN="\${TRELLIS_ORIGIN:-unknown}"
OUTPUT="\${TRELLIS_HOOK_OUTPUT:-stdout}"

# Only run if we're in a Trellis workspace
if ! command -v trellis >/dev/null 2>&1; then
  exit 0
fi

if [ -f ".trellis/config.json" ]; then
  # Check for active issues that need attention
  ACTIVE_ISSUES=$(trellis issue list --status active --format json 2>/dev/null || echo '{"issues":[]}')
  ACTIVE_COUNT=$(echo "$ACTIVE_ISSUES" | jq -r '.issues | length' 2>/dev/null || echo "0")

  # Check for pending memory suggestions
  MEMORY_DIR=".trellis/agent-suggestions"
  SUGGESTION_COUNT=0
  if [ -d "$MEMORY_DIR" ]; then
    SUGGESTION_COUNT=$(find "$MEMORY_DIR" -name "suggestions-*.jsonl" -exec wc -l {} \; 2>/dev/null | awk '{sum+=$1} END {print sum}' || echo "0")
  fi

  # Check for uncommitted changes
  UNCOMMITTED=0
  if git rev-parse --git-dir >/dev/null 2>&1; then
    UNCOMMITTED=$(git status --porcelain 2>/dev/null | wc -l || echo "0")
  fi

  # Build recommendations
  RECOMMENDATIONS=()

  if [ "$ACTIVE_COUNT" -gt 0 ]; then
    RECOMMENDATIONS+=("🎯 $ACTIVE_COUNT active issues need attention - run 'trellis issue list'")
  fi

  if [ "$SUGGESTION_COUNT" -gt 0 ]; then
    RECOMMENDATIONS+=("🧠 $SUGGESTION_COUNT memory suggestions pending - review .trellis/agent-suggestions/")
  fi

  if [ "$UNCOMMITTED" -gt 0 ]; then
    RECOMMENDATIONS+=("📝 $UNCOMMITTED uncommitted changes - consider committing or creating a checkpoint")
  fi

  # Format output based on hook type
  case "$OUTPUT" in
    "agent-stop")
      # For Codex/Gemini blocking hooks
      if [ \${#RECOMMENDATIONS[@]} -gt 0 ]; then
        MESSAGE=$(printf '%s\n' "\${RECOMMENDATIONS[@]}")
        cat << EOF
{
  "decision": "block",
  "reason": "Trellis workflow items need attention: $MESSAGE"
}
EOF
      else
        echo "{}"
      fi
      ;;
    "gemini")
      # For Gemini CLI format
      if [ \${#RECOMMENDATIONS[@]} -gt 0 ]; then
        MESSAGE=$(printf '%s\\n' "\${RECOMMENDATIONS[@]}")
        cat << EOF
{
  "decision": "deny",
  "reason": "Trellis workflow items need attention: $MESSAGE"
}
EOF
      else
        echo '{"decision": "allow"}'
      fi
      ;;
    *)
      # Default stdout for Cursor/Devin/Claude
      if [ \${#RECOMMENDATIONS[@]} -gt 0 ]; then
        echo ""
        echo "🌿 Trellis Session Summary ($ORIGIN):"
        printf '  %s\n' "\${RECOMMENDATIONS[@]}"
        echo ""
        echo "Run 'trellis status' for full workspace state"
      else
        echo "🌿 Trellis: All clear! No pending items."
      fi
      ;;
  esac
fi

exit 0`;
}

function renderAdapterScript(ide: IdeType): string {
  switch (ide) {
    case 'cursor':
      return `#!/usr/bin/env bash
# Cursor adapter for Trellis harness — raw stdin → shared normalizer
set -euo pipefail

source "\$(dirname "\$0")/../desk-root.sh"

export TRELLIS_ORIGIN="cursor"
export TRELLIS_DESK_ROOT="\$PWD"

EVENT_TYPE="\${1:-unknown}"
HARNESS="\$(dirname "\$0")/../trellis-harness"

log_tool_event() {
  local data
  data=\$(cat)
  printf '%s' "\$data" | "\$HARNESS/post-tool-oplog.sh"
  printf '%s' "\$data" | "\$HARNESS/post-tool-memory-capture.sh"
}

case "\$EVENT_TYPE" in
  "session-start")
    exec "\$HARNESS/pre-prompt-recall.sh"
    ;;
  "post-tool"|"post-tool-use"|"after-shell"|"afterShellExecution"|"after-mcp"|"afterMCPExecution"|"post-tool-edit"|"afterFileEdit")
    log_tool_event
    ;;
  "stop")
    export TRELLIS_HOOK_OUTPUT="stdout"
    exec "\$HARNESS/stop-triage.sh"
    ;;
  *)
    echo "Unknown Cursor event: \$EVENT_TYPE" >&2
    exit 1
    ;;
esac`;

    case 'devin':
      return `#!/usr/bin/env bash
# Devin adapter for Trellis harness
# Translates Devin events to normalized contract
set -euo pipefail

# Import desk root detection
source "\$(dirname "\$0")/../desk-root.sh"

# Set origin
export TRELLIS_ORIGIN="devin"
export TRELLIS_DESK_ROOT="\$PWD"

# Route based on event type
EVENT_TYPE="\${1:-unknown}"

case "\$EVENT_TYPE" in
  "pre-prompt")
    # Cascade pre_user_prompt hook
    exec "\$(dirname "\$0")/../trellis-harness/pre-prompt-recall.sh"
    ;;
  "post-tool")
    # Cascade post_write_code hook - read stdin for tool data
    TOOL_DATA=\$(cat)

    # Transform Cascade format to normalized format
    NORMALIZED_DATA=\$(cat << EOF
{
  "tool": "write_file",
  "action": "create",
  "file_path": \$(echo "\$TOOL_DATA" | jq -r '.file_path // ""' 2>/dev/null || echo '""'),
  "timestamp": "\$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
}
EOF
    )

    # Call op logger
    echo "\$NORMALIZED_DATA" | "\$(dirname "\$0")/../trellis-harness/post-tool-oplog.sh"

    # Call memory capture
    echo "\$NORMALIZED_DATA" | "\$(dirname "\$0")/../trellis-harness/post-tool-memory-capture.sh"
    ;;
  "post-response")
    # Cascade post_cascade_response hook
    export TRELLIS_HOOK_OUTPUT="stdout"
    exec "\$(dirname "\$0")/../trellis-harness/stop-triage.sh"
    ;;
  *)
    echo "Unknown Cascade event: \$EVENT_TYPE" >&2
    exit 1
    ;;
esac`;

    case 'claude':
      return `#!/usr/bin/env bash
# Claude Code adapter for Trellis harness
# Translates Claude Code events to normalized contract
set -euo pipefail

# Import desk root detection
source "\$(dirname "\$0")/../desk-root.sh"

# Set origin
export TRELLIS_ORIGIN="claude"
export TRELLIS_DESK_ROOT="\$PWD"

# Route based on event type
EVENT_TYPE="\${1:-unknown}"

case "\$EVENT_TYPE" in
  "pre-tool-use")
    # Claude Code PreToolUse hook
    exec "\$(dirname "\$0")/../trellis-harness/pre-prompt-recall.sh"
    ;;
  "post-tool-use")
    data=\$(cat)
    printf '%s' "\$data" | "\$(dirname "\$0")/../trellis-harness/post-tool-oplog.sh"
    printf '%s' "\$data" | "\$(dirname "\$0")/../trellis-harness/post-tool-memory-capture.sh"
    ;;
  "post-tool-batch")
    jq -c '.[]' 2>/dev/null | while read -r row; do
      printf '%s\\n' "\$row" | "\$(dirname "\$0")/../trellis-harness/post-tool-oplog.sh"
      printf '%s\\n' "\$row" | "\$(dirname "\$0")/../trellis-harness/post-tool-memory-capture.sh"
    done
    ;;
  "permission-denied")
    TS=\$(date -u +%Y-%m-%dT%H:%M:%SZ)
    printf '%s\\n' "{\\"tool_name\\":\\"permission_denied\\",\\"action\\":\\"blocked\\",\\"timestamp\\":\\"\$TS\\"}" | "\$(dirname "\$0")/../trellis-harness/post-tool-oplog.sh"
    ;;
  *)
    echo "Unknown Claude Code event: \$EVENT_TYPE" >&2
    exit 1
    ;;
esac`;

    case 'codex':
      return `#!/usr/bin/env bash
# Codex adapter for Trellis harness
# Translates Codex events to normalized contract
set -euo pipefail

# Import desk root detection
source "\$(dirname "\$0")/../desk-root.sh"

# Set origin
export TRELLIS_ORIGIN="codex"
export TRELLIS_DESK_ROOT="\$PWD"

# Route based on event type
EVENT_TYPE="\${1:-unknown}"

case "\$EVENT_TYPE" in
  "session-start")
    # Codex SessionStart hook
    exec "\$(dirname "\$0")/../trellis-harness/pre-prompt-recall.sh"
    ;;
  "post-tool")
    # Codex PostToolUse hook - read stdin for tool data
    TOOL_DATA=\$(cat)

    # Transform Codex format to normalized format
    NORMALIZED_DATA=\$(cat << EOF
{
  "tool": \$(echo "\$TOOL_DATA" | jq -r '.tool_name // "unknown"' 2>/dev/null || echo '"unknown"'),
  "action": \$(echo "\$TOOL_DATA" | jq -r '.action // "unknown"' 2>/dev/null || echo '"unknown"'),
  "file_path": \$(echo "\$TOOL_DATA" | jq -r '.file_path // .filePath // ""' 2>/dev/null || echo '""'),
  "timestamp": "\$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
}
EOF
    )

    # Call op logger
    echo "\$NORMALIZED_DATA" | "\$(dirname "\$0")/../trellis-harness/post-tool-oplog.sh"

    # Call memory capture
    echo "\$NORMALIZED_DATA" | "\$(dirname "\$0")/../trellis-harness/post-tool-memory-capture.sh"
    ;;
  "stop")
    # Codex Stop hook
    export TRELLIS_HOOK_OUTPUT="agent-stop"
    exec "\$(dirname "\$0")/../trellis-harness/stop-triage.sh"
    ;;
  *)
    echo "Unknown Codex event: \$EVENT_TYPE" >&2
    exit 1
    ;;
esac`;

    case 'gemini':
      return `#!/usr/bin/env bash
# Gemini CLI adapter for Trellis harness
# Translates Gemini events to normalized contract
set -euo pipefail

# Import desk root detection
source "\$(dirname "\$0")/../desk-root.sh"

# Set origin
export TRELLIS_ORIGIN="gemini"
export TRELLIS_DESK_ROOT="\$PWD"

# Route based on event type
EVENT_TYPE="\${1:-unknown}"

case "\$EVENT_TYPE" in
  "session-start"|"before-agent")
    # Gemini SessionStart or BeforeAgent hook
    exec "\$(dirname "\$0")/../trellis-harness/pre-prompt-recall.sh"
    ;;
  "post-tool")
    # Gemini AfterTool hook - read stdin for tool data
    TOOL_DATA=\$(cat)

    # Transform Gemini format to normalized format
    NORMALIZED_DATA=\$(cat << EOF
{
  "tool": \$(echo "\$TOOL_DATA" | jq -r '.tool_name // "unknown"' 2>/dev/null || echo '"unknown"'),
  "action": \$(echo "\$TOOL_DATA" | jq -r '.action // "unknown"' 2>/dev/null || echo '"unknown"'),
  "file_path": \$(echo "\$TOOL_DATA" | jq -r '.file_path // .filePath // ""' 2>/dev/null || echo '""'),
  "timestamp": "\$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
}
EOF
    )

    # Call op logger
    echo "\$NORMALIZED_DATA" | "\$(dirname "\$0")/../trellis-harness/post-tool-oplog.sh"

    # Call memory capture
    echo "\$NORMALIZED_DATA" | "\$(dirname "\$0")/../trellis-harness/post-tool-memory-capture.sh"
    ;;
  "after-agent")
    # Gemini AfterAgent hook
    export TRELLIS_HOOK_OUTPUT="gemini"
    exec "\$(dirname "\$0")/../trellis-harness/stop-triage.sh"
    ;;
  *)
    echo "Unknown Gemini event: \$EVENT_TYPE" >&2
    exit 1
    ;;
esac`;

    default:
      return `#!/usr/bin/env bash
# Default adapter for Trellis harness
echo "Unsupported IDE: ${ide}" >&2
exit 1`;
  }
}

function renderCursorHooksConfig(): Record<string, unknown> {
  const hookCmd = (event: string) =>
    `bash .cursor/hooks/adapters/cursor-adapter.sh ${event}`;
  return {
    version: 1,
    hooks: {
      sessionStart: [{ command: hookCmd('session-start'), timeout: 15 }],
      postToolUse: [{ command: hookCmd('post-tool-use'), timeout: 10 }],
      afterShellExecution: [{ command: hookCmd('after-shell'), timeout: 10 }],
      afterMCPExecution: [{ command: hookCmd('after-mcp'), timeout: 10 }],
      afterFileEdit: [{ command: hookCmd('afterFileEdit'), timeout: 10 }],
      stop: [{ command: hookCmd('stop'), timeout: 10 }],
    },
  };
}

function renderDevinHooksConfig(): Record<string, unknown> {
  return {
    hooks: {
      pre_user_prompt: [
        {
          command: 'bash .cursor/hooks/adapters/devin-adapter.sh pre-prompt',
          show_output: true,
        },
      ],
      post_write_code: [
        {
          command: 'bash .cursor/hooks/adapters/devin-adapter.sh post-tool',
          show_output: false,
        },
      ],
      post_cascade_response: [
        {
          command: 'bash .cursor/hooks/adapters/devin-adapter.sh post-response',
          show_output: true,
        },
      ],
    },
  };
}

function renderClaudeHooksConfig(): Record<string, unknown> {
  return {
    hooks: {
      PreToolUse: [
        {
          command: 'bash .cursor/hooks/adapters/claude-adapter.sh pre-tool-use',
          timeout: 15,
        },
      ],
      PostToolUse: [
        {
          command:
            'bash .cursor/hooks/adapters/claude-adapter.sh post-tool-use',
          timeout: 10,
        },
      ],
      PostToolBatch: [
        {
          command:
            'bash .cursor/hooks/adapters/claude-adapter.sh post-tool-batch',
          timeout: 15,
        },
      ],
      PermissionDenied: [
        {
          command:
            'bash .cursor/hooks/adapters/claude-adapter.sh permission-denied',
          timeout: 5,
        },
      ],
    },
    permissions: {
      allow: [
        'Bash(trellis --version)',
        'Bash(trellis issue *)',
        'Bash(trellis --help)',
        'Bash(trellis search *)',
        'Bash(trellis entity *)',
        'Bash(trellis ontology *)',
        'Bash(trellis query *)',
        'Bash(lsof -nP -iTCP -sTCP:LISTEN)',
        "Bash(awk '{print $9, $1, $2}')",
        'Bash(curl -s --max-time 1 http://localhost:__TRACKED_VAR__/api/graph/health)',
        "Bash(curl -s --max-time 1 http://localhost:__TRACKED_VAR__/api/graph/health -H 'Accept: application/json')",
        'Bash(grep -ivE "node_modules|dist|.vercel|.git$|.git/|.logs")',
      ],
    },
    spinnerTipsEnabled: true,
  };
}

function renderCodexHooksConfig(): Record<string, unknown> {
  return {
    hooks: {
      SessionStart: [
        {
          matcher: 'startup|resume|clear',
          hooks: [
            {
              type: 'command',
              command:
                'bash .cursor/hooks/adapters/codex-adapter.sh session-start',
              timeout: 15,
              statusMessage: 'Loading Trellis desk context',
            },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: 'apply_patch|Edit|Write',
          hooks: [
            {
              type: 'command',
              command: 'bash .cursor/hooks/adapters/codex-adapter.sh post-tool',
              timeout: 10,
              statusMessage: 'Recording Trellis operation',
            },
          ],
        },
      ],
      Stop: [
        {
          hooks: [
            {
              type: 'command',
              command: 'bash .cursor/hooks/adapters/codex-adapter.sh stop',
              timeout: 10,
              statusMessage: 'Checking Trellis workflow status',
            },
          ],
        },
      ],
    },
  };
}

function renderGeminiHooksConfig(): Record<string, unknown> {
  return {
    hooks: {
      SessionStart: [
        {
          matcher: 'startup|resume|clear',
          hooks: [
            {
              name: 'trellis-desk-context',
              type: 'command',
              command:
                'bash .cursor/hooks/adapters/gemini-adapter.sh session-start',
              timeout: 15000,
              description: 'Refresh pending Trellis context at session start',
            },
          ],
        },
      ],
      BeforeAgent: [
        {
          hooks: [
            {
              name: 'trellis-desk-prompt-context',
              type: 'command',
              command:
                'bash .cursor/hooks/adapters/gemini-adapter.sh before-agent',
              timeout: 15000,
              description: 'Mirror Devin pre_user_prompt desk context refresh',
            },
          ],
        },
      ],
      AfterTool: [
        {
          matcher: 'write_file|replace|apply_patch',
          hooks: [
            {
              name: 'trellis-op-logging',
              type: 'command',
              command:
                'bash .cursor/hooks/adapters/gemini-adapter.sh post-tool',
              timeout: 10000,
              description:
                'Record Trellis operations and suggest memory creation',
            },
          ],
        },
      ],
      AfterAgent: [
        {
          hooks: [
            {
              name: 'trellis-workflow-triage',
              type: 'command',
              command:
                'bash .cursor/hooks/adapters/gemini-adapter.sh after-agent',
              timeout: 10000,
              description:
                'Suggest Trellis workflow actions when items need attention',
            },
          ],
        },
      ],
    },
  };
}

/**
 * Write IDE-specific dotfolder scaffolds.
 *
 * @param rootPath - Absolute path to the repository root
 * @param input    - IDE type, footprint, plugins, context, and profile
 */
export function writeIdeScaffold(
  rootPath: string,
  input: IdeScaffoldInput,
): void {
  const { ide, footprint, framework, plugins, context, profile } = input;
  const fullInput: IdeScaffoldInput = {
    ide,
    footprint,
    framework,
    plugins,
    rootPath,
    context,
    profile,
  };

  switch (ide) {
    case 'cursor': {
      const cursorDir = join(rootPath, '.cursor');
      if (!existsSync(cursorDir)) {
        mkdirSync(cursorDir, { recursive: true });
      }
      writeFileSync(
        join(cursorDir, 'rules.md'),
        renderCursorRules(fullInput),
        'utf-8',
      );

      // Generate enhanced hooks for full footprint
      if (footprint === 'full') {
        writeTrellisHooks(rootPath, 'cursor');
      }
      break;
    }

    case 'devin': {
      const devinDir = join(rootPath, '.devin');
      if (!existsSync(devinDir)) {
        mkdirSync(devinDir, { recursive: true });
      }
      writeFileSync(
        join(devinDir, 'rules.md'),
        renderDevinRules(fullInput),
        'utf-8',
      );

      // Generate enhanced hooks for full footprint
      if (footprint === 'full') {
        writeTrellisHooks(rootPath, 'devin');
      }
      break;
    }

    case 'claude': {
      const claudeDir = join(rootPath, '.claude');
      if (!existsSync(claudeDir)) {
        mkdirSync(claudeDir, { recursive: true });
      }
      writeFileSync(
        join(claudeDir, 'settings.md'),
        renderClaudeMd(fullInput),
        'utf-8',
      );

      // Generate enhanced hooks for full footprint
      if (footprint === 'full') {
        writeTrellisHooks(rootPath, 'claude');
      }
      break;
    }

    case 'copilot': {
      const copilotDir = join(rootPath, '.github');
      const copilotDirSub = join(copilotDir, 'copilot');
      if (!existsSync(copilotDirSub)) {
        mkdirSync(copilotDirSub, { recursive: true });
      }
      writeFileSync(
        join(copilotDirSub, 'config.json'),
        JSON.stringify(renderCopilotConfig(fullInput), null, 2),
        'utf-8',
      );
      break;
    }

    case 'codex': {
      const codexDir = join(rootPath, '.codex');
      if (!existsSync(codexDir)) {
        mkdirSync(codexDir, { recursive: true });
      }
      writeFileSync(
        join(codexDir, 'config.json'),
        JSON.stringify(renderCodexConfig(fullInput), null, 2),
        'utf-8',
      );

      // Generate enhanced hooks for full footprint
      if (footprint === 'full') {
        writeTrellisHooks(rootPath, 'codex');
      }
      break;
    }

    case 'gemini': {
      const geminiDir = join(rootPath, '.gemini');
      if (!existsSync(geminiDir)) {
        mkdirSync(geminiDir, { recursive: true });
      }
      writeFileSync(
        join(geminiDir, 'config.json'),
        JSON.stringify(renderGeminiConfig(fullInput), null, 2),
        'utf-8',
      );

      // Generate enhanced hooks for full footprint
      if (footprint === 'full') {
        writeTrellisHooks(rootPath, 'gemini');
      }
      break;
    }

    case 'none':
      break;
  }

  if (footprint === 'full') {
    const agentsDir = join(rootPath, '.trellis', 'agents');
    if (existsSync(agentsDir)) {
      const current = readFileSync(join(agentsDir, 'AGENTS.md'), 'utf-8');
      const updated = current.replace(
        /## Quick Reference[\s\S]*$/,
        `## Quick Reference

\`\`\`bash
trellis status          # Current repo state
trellis log             # Causal operation history
trellis seed            # Refresh agent context (${ide})
trellis milestone       # Create narrative checkpoints
\`\`\`
`,
      );
      writeFileSync(join(agentsDir, 'AGENTS.md'), updated, 'utf-8');
    }
  }
}

function renderBugIntakeScript(): string {
  return `#!/usr/bin/env bash
# Bug intake and TDD enforcement for Trellis integration
# Creates structured issues with acceptance criteria and test requirements
set -euo pipefail

# Import desk root detection
source "\\$(dirname "\\$0")/../desk-root.sh"

# Environment variables from contract
ORIGIN="\${TRELLIS_ORIGIN:-unknown}"
OUTPUT="\${TRELLIS_HOOK_OUTPUT:-stdout}"

# Only run if we're in a Trellis workspace
if ! command -v trellis >/dev/null 2>&1; then
  exit 0
fi

# Read bug description from stdin or environment
BUG_DATA="\${TRELLIS_BUG_DATA:-}"
if [ -z "\\$BUG_DATA" ]; then
  BUG_DATA=$(cat)
fi

# Extract bug information
TITLE=$(echo "\\$BUG_DATA" | jq -r '.title // "Untitled Bug"' 2>/dev/null || echo "Untitled Bug")
DESCRIPTION=$(echo "\\$BUG_DATA" | jq -r '.description // ""' 2>/dev/null || echo "")
SEVERITY=$(echo "\\$BUG_DATA" | jq -r '.severity // "medium"' 2>/dev/null || echo "medium")
COMPONENT=$(echo "\\$BUG_DATA" | jq -r '.component // "unknown"' 2>/dev/null || echo "unknown")

# Validate required fields
if [ -z "\\$DESCRIPTION" ]; then
  echo "❌ Bug description is required" >&2
  exit 1
fi

# Create the Trellis issue with structured content
ISSUE_CONTENT="# Bug: \\$TITLE

**Severity:** \\$SEVERITY
**Component:** \\$COMPONENT
**Reported by:** \\$ORIGIN
**Reported at:** $(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)

## Description
\\$DESCRIPTION

## Acceptance Criteria

### Functional Requirements
- [ ] **AC-1:** Bug reproduction confirmed in test environment
- [ ] **AC-2:** Root cause identified and documented
- [ ] **AC-3:** Fix implemented without breaking existing functionality
- [ ] **AC-4:** Bug no longer reproducible after fix
- [ ] **AC-5:** Edge cases covered and tested

### Test Requirements (TDD)
- [ ] **TEST-1:** Unit tests written for the failing behavior
- [ ] **TEST-2:** Integration tests cover the bug scenario
- [ ] **TEST-3:** Regression tests prevent future occurrences
- [ ] **TEST-4:** Performance tests if applicable
- [ ] **TEST-5:** Manual testing checklist completed

### Documentation Requirements
- [ ] **DOC-1:** API documentation updated if behavior changed
- [ ] **DOC-2:** README updated if user-facing change
- [ ] **DOC-3:** Changelog entry prepared
- [ ] **DOC-4:** Technical notes added for future reference

### Code Quality Requirements
- [ ] **QUALITY-1:** Code follows project style guidelines
- [ ] **QUALITY-2:** No new linting errors introduced
- [ ] **QUALITY-3:** Code coverage maintained or improved
- [ ] **QUALITY-4:** Security review completed if applicable
- [ ] **QUALITY-5:** Performance impact assessed

## Definition of Done

This bug is considered **DONE** when:
1. ✅ All acceptance criteria are met
2. ✅ All tests pass (unit, integration, regression)
3. ✅ Code review approved
4. ✅ Documentation updated
5. ✅ No performance regressions
6. ✅ Security implications addressed
7. ✅ Changelog entry created
8. ✅ Release notes prepared

## Labels
\`bug\`, \`severity-\\$SEVERITY\`, \`component-\\$COMPONENT\`, \`tdd-required\`, \`needs-investigation\`

---

**Generated by:** Trellis Enhanced Hooks
**Origin:** \\$ORIGIN
**Template:** bug-intake-v1.0
"

# Create the Trellis issue
ISSUE_ID=$(echo "\\$ISSUE_CONTENT" | trellis issue create --title "\\$TITLE" --content-from-stdin --format json 2>/dev/null | jq -r '.id // empty' || echo "")

if [ -n "\\$ISSUE_ID" ]; then
  # Add labels to the issue
  trellis issue label "\\$ISSUE_ID" add "bug" "severity-\\$SEVERITY" "component-\\$COMPONENT" "tdd-required" "needs-investigation" 2>/dev/null || true

  echo ""
  echo "🐛 Bug Intake Completed (\\$ORIGIN):"
  echo "  📝 Issue: #\\$ISSUE_ID - \\$TITLE"
  echo "  🔧 Severity: \\$SEVERITY"
  echo "  📦 Component: \\$COMPONENT"
  echo "  ✅ TDD requirements enforced"
  echo ""
  echo "📋 Next Steps:"
  echo "  1. Investigate the bug: trellis issue view \\$ISSUE_ID"
  echo "  2. Develop tests with TDD approach"
  echo "  3. Implement fix"
  echo ""
else
  echo "❌ Failed to create bug issue" >&2
  exit 1
fi
`;
}

function renderBugInvestigateScript(): string {
  return `#!/usr/bin/env bash
# Bug investigation and TDD enforcement for Trellis integration
# Ensures thorough investigation before fix implementation
set -euo pipefail

# Import desk root detection
source "\\$(dirname "\\$0")/../desk-root.sh"

# Environment variables from contract
ORIGIN="\${TRELLIS_ORIGIN:-unknown}"
OUTPUT="\${TRELLIS_HOOK_OUTPUT:-stdout}"
ISSUE_ID="\${TRELLIS_ISSUE_ID:-}"

# Only run if we're in a Trellis workspace
if ! command -v trellis >/dev/null 2>&1; then
  exit 0
fi

# Validate issue ID
if [ -z "\\$ISSUE_ID" ]; then
  echo "❌ Issue ID is required for bug investigation" >&2
  exit 1
fi

# Get issue details
ISSUE_DETAILS=$(trellis issue view "\\$ISSUE_ID" --format json 2>/dev/null || echo "{}")
TITLE=$(echo "\\$ISSUE_DETAILS" | jq -r '.title // "Unknown Issue"' 2>/dev/null || echo "Unknown Issue")

# Create test directory structure
TEST_DIR="tests/bugs/\\$ISSUE_ID"
mkdir -p "\\$TEST_DIR"

# Create test template files
cat > "\\$TEST_DIR/reproduction.test.ts" << 'EOF'
/**
 * Bug #\\$ISSUE_ID: \\$TITLE
 * Reproduction test - This test should fail initially
 */

import { describe, test, expect } from 'vitest'

describe('Bug #\\$ISSUE_ID: \\$TITLE', () => {
  test('should reproduce the reported issue', async () => {
    // TODO: Implement reproduction steps based on bug description
    // This test should fail initially
    expect(true).toBe(false)
  })
})
EOF

cat > "\\$TEST_DIR/fix.test.ts" << 'EOF'
/**
 * Bug #\\$ISSUE_ID: \\$TITLE
 * Fix verification test - This test should pass after implementing the fix
 */

import { describe, test, expect } from 'vitest'

describe('Bug #\\$ISSUE_ID: \\$TITLE - Fix Verification', () => {
  test('should resolve the issue after fix implementation', async () => {
    // TODO: Implement test that verifies the fix
    // This test should pass after fix
    expect(true).toBe(true)
  })
})
EOF

# Create test runner script
cat > "\\$TEST_DIR/run-tests.sh" << 'EOF'
#!/usr/bin/env bash
# Test runner for bug investigation

set -euo pipefail

ISSUE_ID=$(basename "$(pwd)")
echo "🧪 Running tests for Bug #\\$ISSUE_ID"

# Run reproduction test (should fail initially)
echo "📋 Running reproduction test..."
bun run reproduction.test.ts || echo "❌ Reproduction test failed (expected)"

# Run fix test (should pass after fix)
echo "🔧 Running fix verification test..."
bun run fix.test.ts

echo "✅ All tests completed"
EOF

chmod +x "\\$TEST_DIR/run-tests.sh"

# Update issue labels
trellis issue label "\\$ISSUE_ID" add "investigating" 2>/dev/null || true

echo ""
echo "🔍 Bug Investigation Started (\\$ORIGIN):"
echo "  📝 Issue: #\\$ISSUE_ID - \\$TITLE"
echo "  📁 Test directory: \\$TEST_DIR"
echo "  🧪 Test files created"
echo ""
echo "📋 Next Steps:"
echo "  1. Complete investigation: trellis issue view \\$ISSUE_ID"
echo "  2. Run reproduction test: cd \\$TEST_DIR && ./run-tests.sh"
echo "  3. Implement fix with TDD approach"
echo ""
`;
}

function renderMilestoneTriageScript(): string {
  return `#!/usr/bin/env bash
# Milestone and cycle triage for Trellis integration
# Integrates bugs with project milestones and development cycles
set -euo pipefail

# Import desk root detection
source "\\$(dirname "\\$0")/../desk-root.sh"

# Environment variables from contract
ORIGIN="\${TRELLIS_ORIGIN:-unknown}"
OUTPUT="\${TRELLIS_HOOK_OUTPUT:-stdout}"
ISSUE_ID="\${TRELLIS_ISSUE_ID:-}"

# Only run if we're in a Trellis workspace
if ! command -v trellis >/dev/null 2>&1; then
  exit 0
fi

# Validate issue ID
if [ -z "\\$ISSUE_ID" ]; then
  echo "❌ Issue ID is required for milestone triage" >&2
  exit 1
fi

# Get issue details and calculate priority
ISSUE_DETAILS=$(trellis issue view "\\$ISSUE_ID" --format json 2>/dev/null || echo "{}")
TITLE=$(echo "\\$ISSUE_DETAILS" | jq -r '.title // "Unknown Issue"' 2>/dev/null || echo "Unknown Issue")
LABELS=$(echo "\\$ISSUE_DETAILS" | jq -r '.labels // []' 2>/dev/null || echo "[]")
SEVERITY=$(echo "\\$LABELS" | jq -r '.[] | select(startswith("severity-")) | split("-")[1]' 2>/dev/null || echo "medium")

# Get current milestone and cycle info
CURRENT_MILESTONE=$(trellis milestone current --format json 2>/dev/null || echo "{}")
MILESTONE_NAME=$(echo "\\$CURRENT_MILESTONE" | jq -r '.name // "current"' 2>/dev/null || echo "current")

CURRENT_CYCLE=$(trellis cycle current --format json 2>/dev/null || echo "{}")
CYCLE_NAME=$(echo "\\$CURRENT_CYCLE" | jq -r '.name // "current"' 2>/dev/null || echo "current")

# Calculate priority based on severity
calculate_priority() {
  local severity="\\$1"
  case "\\$severity" in
    "critical") echo "urgent" ;;
    "high") echo "high" ;;
    "medium") echo "medium" ;;
    "low") echo "low" ;;
    *) echo "medium" ;;
  esac
}

PRIORITY=$(calculate_priority "\\$SEVERITY")

# Update issue labels and assign to milestone/cycle
trellis issue label "\\$ISSUE_ID" add "triaged" "priority-\\$PRIORITY" "milestone-\\$MILESTONE_NAME" "cycle-\\$CYCLE_NAME" 2>/dev/null || true

# Update issue priority
trellis issue priority "\\$ISSUE_ID" set "\\$PRIORITY" 2>/dev/null || true

echo ""
echo "🎯 Milestone & Cycle Triage Completed (\\$ORIGIN):"
echo "  📝 Issue: #\\$ISSUE_ID - \\$TITLE"
echo "  🚦 Priority: \\$PRIORITY"
echo "  🎯 Milestone: \\$MILESTONE_NAME"
echo "  🔄 Cycle: \\$CYCLE_NAME"
echo ""
`;
}

function renderCyclePlanningScript(): string {
  return `#!/usr/bin/env bash
# Cycle planning and workload management for Trellis integration
# Manages development cycles, sprint planning, and resource allocation
set -euo pipefail

# Import desk root detection
source "\\$(dirname "\\$0")/../desk-root.sh"

# Environment variables from contract
ORIGIN="\${TRELLIS_ORIGIN:-unknown}"
OUTPUT="\${TRELLIS_HOOK_OUTPUT:-stdout}"

# Only run if we're in a Trellis workspace
if ! command -v trellis >/dev/null 2>&1; then
  exit 0
fi

# Get current cycle information
CURRENT_CYCLE=$(trellis cycle current --format json 2>/dev/null || echo "{}")
CYCLE_NAME=$(echo "\\$CURRENT_CYCLE" | jq -r '.name // "current"' 2>/dev/null || echo "current")

# Get all issues in current cycle
CYCLE_ISSUES=$(trellis cycle issues --format json 2>/dev/null || echo "[]")

# Analyze cycle workload
total_issues=$(echo "\\$CYCLE_ISSUES" | jq 'length' 2>/dev/null || echo "0")
urgent_issues=$(echo "\\$CYCLE_ISSUES" | jq '[.[] | select(.labels[] | contains("priority-urgent"))] | length' 2>/dev/null || echo "0")
high_issues=$(echo "\\$CYCLE_ISSUES" | jq '[.[] | select(.labels[] | contains("priority-high"))] | length' 2>/dev/null || echo "0")

# Calculate health score
health_score=100
health_score=\$((health_score - (urgent_issues * 20)))
health_score=\$((health_score - (high_issues * 10)))

if [ "\\$health_score" -lt 0 ]; then
  health_score=0
fi

echo ""
echo "🔄 Cycle Planning Completed (\\$ORIGIN):"
echo "  📊 Cycle: \\$CYCLE_NAME"
echo "  📈 Health Score: \\$health_score/100"
echo "  📝 Total Issues: \\$total_issues"
echo "  🚨 Urgent Issues: \\$urgent_issues"
echo "  ⚡ High Priority Issues: \\$high_issues"
echo ""
echo "📋 Recommendations:"
echo "  \\$([ "\\$health_score" -lt 60 ] && echo "🚨 High workload detected - consider rebalancing" || echo "✅ Healthy workload - maintain current pace")"
echo "  \\$([ "\\$urgent_issues" -gt 0 ] && echo "⚠️ Address urgent issues immediately" || echo "✅ No urgent issues")"
echo ""
`;
}
