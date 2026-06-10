/**
 * Context Seeding
 *
 * Rewrites agent context files based on current repository state.
 * Provides the `trellis seed` command to refresh context without re-running init.
 *
 * @module trellis/scaffold/seed
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ProjectContext } from './infer.js';
import type { UserProfile } from './profile.js';
import { loadProfile } from './profile.js';
import { inferProjectContext } from './infer.js';
import type { IdeType } from './write.js';

export interface SeedOptions {
  rootPath: string;
  ide?: IdeType;
  force?: boolean;
}

export interface SeedResult {
  success: boolean;
  filesUpdated: string[];
  timestamp: string;
}

/**
 * Refresh the agent context files by re-inferring project context.
 *
 * @param opts - Options including rootPath and IDE target
 * @returns SeedResult with success status and list of updated files
 */
export async function seedContext(opts: SeedOptions): Promise<SeedResult> {
  const { rootPath, ide = 'none', force = false } = opts;
  const filesUpdated: string[] = [];
  const timestamp = new Date().toISOString();

  const profile = loadProfile();
  const context = await inferProjectContext(rootPath);

  const agentsDir = join(rootPath, '.trellis', 'agents');
  if (existsSync(agentsDir)) {
    const agentsMdPath = join(agentsDir, 'AGENTS.md');
    if (existsSync(agentsMdPath) || force) {
      const content = renderSeedAgentsMd(profile, context, timestamp);
      writeFileSync(agentsMdPath, content, 'utf-8');
      filesUpdated.push('.trellis/agents/AGENTS.md');
    }

    const agentContextPath = join(agentsDir, 'agent-context.json');
    if (existsSync(agentContextPath) || force) {
      const config = {
        domain: context.domain,
        ecosystem: context.ecosystem,
        tools: [],
        ontologies: [],
        generatedAt: timestamp,
        confidence: context.confidence,
        lastSeed: timestamp,
      };
      writeFileSync(agentContextPath, JSON.stringify(config, null, 2), 'utf-8');
      filesUpdated.push('.trellis/agents/agent-context.json');
    }
  }

  switch (ide) {
    case 'cursor': {
      const cursorRulesPath = join(rootPath, '.cursor', 'rules.md');
      if (existsSync(cursorRulesPath) || force) {
        const content = renderSeedIdeRules(
          profile,
          context,
          'cursor',
          timestamp,
        );
        writeFileSync(cursorRulesPath, content, 'utf-8');
        filesUpdated.push('.cursor/rules.md');
      }
      break;
    }

    case 'devin': {
      const devinRulesPath = join(rootPath, '.devin', 'rules.md');
      if (existsSync(devinRulesPath) || force) {
        const content = renderSeedIdeRules(
          profile,
          context,
          'devin',
          timestamp,
        );
        writeFileSync(devinRulesPath, content, 'utf-8');
        filesUpdated.push('.devin/rules.md');
      }
      break;
    }

    case 'claude': {
      const claudeSettingsPath = join(rootPath, '.claude', 'settings.md');
      if (existsSync(claudeSettingsPath) || force) {
        const content = renderSeedIdeRules(
          profile,
          context,
          'claude',
          timestamp,
        );
        writeFileSync(claudeSettingsPath, content, 'utf-8');
        filesUpdated.push('.claude/settings.md');
      }
      break;
    }

    case 'none':
      break;
  }

  return {
    success: true,
    filesUpdated,
    timestamp,
  };
}

function renderSeedAgentsMd(
  profile: UserProfile | null,
  context: ProjectContext,
  timestamp: string,
): string {
  const userName = profile?.name ?? 'the user';
  const userBio = profile?.bio ?? '(not provided)';
  const userSkills = profile?.skills?.length
    ? profile.skills.join(', ')
    : '(not specified)';

  return `# Trellis Agent Context

> This file was seeded by \`trellis seed\` on ${timestamp}
> Inference confidence: **${context.confidence}**

---

## About the User

| Field | Value |
|-------|-------|
| **Name** | ${userName} |
| **Bio** | ${userBio} |
| **Skills** | ${userSkills} |

---

## About This Project

| Field | Value |
|-------|-------|
| **Name** | ${context.name ?? '(unnamed)'} |
| **Domain** | ${context.domain ?? '(not determined)'} |
| **Description** | ${context.description ?? '(no description found)'} |
| **Ecosystem** | ${context.ecosystem ?? 'unknown'} |
| **File count** | ~${context.fileCount} |

---

## Agent Instructions

You are operating in a Trellis-tracked repository. Follow these guidelines:

1. **Read \`agent-context.json\`** in this directory for registered tools, ontologies, and domain settings.
2. **Check \`skills/\`** for domain-specific operating instructions relevant to this project.
3. **Check \`workflows/\`** for repeatable task procedures.
4. **Run \`trellis seed\`** to refresh this context file when the project evolves.

---

## Quick Reference

\`\`\`bash
trellis status          # Current repo state
trellis log             # Causal operation history
trellis seed            # Refresh this context
trellis milestone       # Create narrative checkpoints
\`\`\`
`;
}

function renderSeedIdeRules(
  profile: UserProfile | null,
  context: ProjectContext,
  ide: IdeType,
  timestamp: string,
): string {
  const ideName = ide.charAt(0).toUpperCase() + ide.slice(1);
  const projectName = context.name ?? 'this project';

  return `# ${ideName} Rules for ${projectName}

> Generated by \`trellis seed\` on ${timestamp}

## Project Context
- **Domain**: ${context.domain ?? '(not determined)'}
- **Ecosystem**: ${context.ecosystem ?? 'unknown'}
- **File count**: ~${context.fileCount}
- **Confidence**: ${context.confidence}

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
