/**
 * Tests for scaffold/write.ts — agent scaffold file writer
 */

import { test, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  writeAgentScaffold,
  writeIdeScaffold,
} from '../../src/scaffold/write.js';
import type { ProjectContext } from '../../src/scaffold/infer.js';
import type { UserProfile } from '../../src/scaffold/profile.js';

let testDir: string;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `trellis-write-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(join(testDir, '.trellis'), { recursive: true });
});

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

const mockContext: ProjectContext = {
  domain: 'animation-studio',
  description: 'Agentic animation pipeline',
  ecosystem: 'bun',
  framework: 'next',
  name: 'agent-studio',
  fileCount: 42,
  confidence: 'high',
  indicators: ['package.json', 'README.md'],
};

const mockProfile: UserProfile = {
  name: 'Trent',
  bio: 'Creative technologist building agentic media tools',
  skills: ['TypeScript', 'Motion Canvas', 'AI pipelines'],
  style: 'minimal, expressive, systems-first',
  preferences: { verbosity: 'concise', tone: 'peer' },
  createdAt: '2026-04-02T00:00:00.000Z',
  updatedAt: '2026-04-02T00:00:00.000Z',
};

test('creates AGENTS.md with profile and context', () => {
  writeAgentScaffold(testDir, { profile: mockProfile, context: mockContext });

  const agentsMd = readFileSync(
    join(testDir, '.trellis', 'agents', 'AGENTS.md'),
    'utf-8',
  );
  expect(agentsMd).toContain('Trent');
  expect(agentsMd).toContain('Creative technologist');
  expect(agentsMd).toContain('animation-studio');
  expect(agentsMd).toContain('bun');
  expect(agentsMd).toContain('agent-studio');
  expect(agentsMd).toContain('TypeScript, Motion Canvas, AI pipelines');
  expect(agentsMd).toContain('concise');
  expect(agentsMd).toContain('peer');
  expect(agentsMd).toContain('high');
});

test('creates agent-context.json (not config.json)', () => {
  writeAgentScaffold(testDir, { profile: mockProfile, context: mockContext });

  const configPath = join(testDir, '.trellis', 'agents', 'agent-context.json');
  expect(existsSync(configPath)).toBe(true);

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  expect(config.domain).toBe('animation-studio');
  expect(config.ecosystem).toBe('bun');
  expect(config.confidence).toBe('high');
  expect(config.tools).toEqual([]);
  expect(config.ontologies).toEqual([]);

  // Should NOT create a config.json (that would collide with engine config)
  expect(existsSync(join(testDir, '.trellis', 'agents', 'config.json'))).toBe(
    false,
  );
});

test('creates skills/ and workflows/ stub directories', () => {
  writeAgentScaffold(testDir, { profile: mockProfile, context: mockContext });

  expect(
    existsSync(join(testDir, '.trellis', 'agents', 'skills', 'README.md')),
  ).toBe(true);
  expect(
    existsSync(join(testDir, '.trellis', 'agents', 'workflows', 'README.md')),
  ).toBe(true);

  const skillsReadme = readFileSync(
    join(testDir, '.trellis', 'agents', 'skills', 'README.md'),
    'utf-8',
  );
  expect(skillsReadme).toContain('domain-specific operating instructions');
});

test('handles null profile gracefully', () => {
  writeAgentScaffold(testDir, { profile: null, context: mockContext });

  const agentsMd = readFileSync(
    join(testDir, '.trellis', 'agents', 'AGENTS.md'),
    'utf-8',
  );
  expect(agentsMd).toContain('the user'); // fallback for null name
  expect(agentsMd).toContain('trellis season'); // suggestion to set up profile
});

test('handles null domain/description/ecosystem gracefully', () => {
  const emptyContext: ProjectContext = {
    domain: null,
    description: null,
    ecosystem: null,
    framework: null,
    name: null,
    fileCount: 0,
    confidence: 'high',
    indicators: [],
  };

  writeAgentScaffold(testDir, { profile: null, context: emptyContext });

  const agentsMd = readFileSync(
    join(testDir, '.trellis', 'agents', 'AGENTS.md'),
    'utf-8',
  );
  expect(agentsMd).toContain('(unnamed)');
  expect(agentsMd).toContain('(not determined');
  expect(agentsMd).toContain('(no description found)');
  expect(agentsMd).toContain('unknown');
});

test('does not overwrite existing skills/workflows READMEs', () => {
  // First write
  writeAgentScaffold(testDir, { profile: mockProfile, context: mockContext });

  // Manually modify the skills README
  const skillsReadmePath = join(
    testDir,
    '.trellis',
    'agents',
    'skills',
    'README.md',
  );
  const { writeFileSync } = require('fs');
  writeFileSync(skillsReadmePath, '# Custom content\nUser-modified README.');

  // Second write
  writeAgentScaffold(testDir, { profile: mockProfile, context: mockContext });

  // Skills README should NOT be overwritten
  const content = readFileSync(skillsReadmePath, 'utf-8');
  expect(content).toContain('Custom content');
  expect(content).not.toContain('domain-specific operating instructions');
});

test('AGENTS.md references agent-context.json, not config.json', () => {
  writeAgentScaffold(testDir, { profile: mockProfile, context: mockContext });

  const agentsMd = readFileSync(
    join(testDir, '.trellis', 'agents', 'AGENTS.md'),
    'utf-8',
  );
  expect(agentsMd).toContain('agent-context.json');
  expect(agentsMd).not.toContain('Read `config.json`');
});

// ---------------------------------------------------------------------------
// Enhanced Hook System Tests
// ---------------------------------------------------------------------------

test('generates enhanced hooks for Cursor with full footprint', () => {
  const ideInput = {
    ide: 'cursor' as const,
    footprint: 'full' as const,
    framework: 'next' as const,
    plugins: ['trellis-integration'],
    rootPath: testDir,
    context: mockContext,
    profile: mockProfile,
  };

  writeIdeScaffold(testDir, ideInput);

  // Check that enhanced hooks are generated
  expect(existsSync(join(testDir, '.cursor', 'hooks', 'trellis-harness'))).toBe(
    true,
  );
  expect(existsSync(join(testDir, '.cursor', 'hooks', 'adapters'))).toBe(true);

  // Check shared harness scripts
  const harnessDir = join(testDir, '.cursor', 'hooks', 'trellis-harness');
  expect(existsSync(join(harnessDir, 'pre-prompt-recall.sh'))).toBe(true);
  expect(existsSync(join(harnessDir, 'normalize-op.jq'))).toBe(true);
  expect(existsSync(join(harnessDir, 'post-tool-oplog.sh'))).toBe(true);
  expect(existsSync(join(harnessDir, 'post-tool-memory-capture.sh'))).toBe(
    true,
  );
  expect(existsSync(join(harnessDir, 'stop-triage.sh'))).toBe(true);

  // Check adapter scripts
  const adaptersDir = join(testDir, '.cursor', 'hooks', 'adapters');
  expect(existsSync(join(adaptersDir, 'cursor-adapter.sh'))).toBe(true);

  // Check hook configuration
  const hooksConfig = JSON.parse(
    readFileSync(join(testDir, '.cursor', 'hooks.json'), 'utf-8'),
  );
  expect(hooksConfig.hooks.sessionStart).toBeDefined();
  expect(hooksConfig.hooks.postToolUse).toBeDefined();
  expect(hooksConfig.hooks.afterShellExecution).toBeDefined();
  expect(hooksConfig.hooks.afterMCPExecution).toBeDefined();
  expect(hooksConfig.hooks.afterFileEdit).toBeDefined();
  expect(hooksConfig.hooks.stop).toBeDefined();
  expect(hooksConfig.hooks.sessionStart[0].command).toContain(
    'cursor-adapter.sh',
  );
});

test('generates enhanced hooks for Windsurf with full footprint', () => {
  const ideInput = {
    ide: 'windsurf' as const,
    footprint: 'full' as const,
    framework: 'next' as const,
    plugins: ['trellis-integration'],
    rootPath: testDir,
    context: mockContext,
    profile: mockProfile,
  };

  writeIdeScaffold(testDir, ideInput);

  // Check that enhanced hooks are generated
  expect(existsSync(join(testDir, '.cursor', 'hooks', 'trellis-harness'))).toBe(
    true,
  );
  expect(existsSync(join(testDir, '.cursor', 'hooks', 'adapters'))).toBe(true);

  // Check adapter script for Windsurf
  expect(
    existsSync(
      join(testDir, '.cursor', 'hooks', 'adapters', 'cascade-adapter.sh'),
    ),
  ).toBe(true);

  // Check hook configuration
  const hooksConfig = JSON.parse(
    readFileSync(join(testDir, '.windsurf', 'hooks.json'), 'utf-8'),
  );
  expect(hooksConfig.hooks.pre_user_prompt).toBeDefined();
  expect(hooksConfig.hooks.post_write_code).toBeDefined();
  expect(hooksConfig.hooks.post_cascade_response).toBeDefined();
  expect(hooksConfig.hooks.pre_user_prompt[0].command).toContain(
    'cascade-adapter.sh',
  );
});

test('does not generate enhanced hooks for minimal footprint', () => {
  const ideInput = {
    ide: 'cursor' as const,
    footprint: 'minimal' as const,
    framework: 'next' as const,
    plugins: ['trellis-integration'],
    rootPath: testDir,
    context: mockContext,
    profile: mockProfile,
  };

  writeIdeScaffold(testDir, ideInput);

  // Should NOT generate enhanced hooks for minimal footprint
  expect(existsSync(join(testDir, '.cursor', 'hooks', 'trellis-harness'))).toBe(
    false,
  );
  expect(existsSync(join(testDir, '.cursor', 'hooks', 'adapters'))).toBe(false);

  // Should still generate basic rules file but not enhanced hooks
  expect(existsSync(join(testDir, '.cursor', 'rules.md'))).toBe(true);
  expect(existsSync(join(testDir, '.cursor', 'hooks.json'))).toBe(false); // No hooks for minimal
});

test('enhanced hook scripts have correct content', () => {
  const ideInput = {
    ide: 'cursor' as const,
    footprint: 'full' as const,
    framework: 'next' as const,
    plugins: ['trellis-integration'],
    rootPath: testDir,
    context: mockContext,
    profile: mockProfile,
  };

  writeIdeScaffold(testDir, ideInput);

  // Check pre-prompt-recall script content
  const prePromptScript = readFileSync(
    join(
      testDir,
      '.cursor',
      'hooks',
      'trellis-harness',
      'pre-prompt-recall.sh',
    ),
    'utf-8',
  );
  expect(prePromptScript).toContain('#!/usr/bin/env bash');
  expect(prePromptScript).toContain('Pre-prompt memory and context recall');
  expect(prePromptScript).toContain('TRELLIS_ORIGIN');
  expect(prePromptScript).toContain('trellis query');

  // Check adapter script content
  const adapterScript = readFileSync(
    join(testDir, '.cursor', 'hooks', 'adapters', 'cursor-adapter.sh'),
    'utf-8',
  );
  expect(adapterScript).toContain('#!/usr/bin/env bash');
  expect(adapterScript).toContain('Cursor adapter for Trellis harness');
  expect(adapterScript).toContain('export TRELLIS_ORIGIN="cursor"');
});
