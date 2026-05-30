/**
 * Project Context Inference
 *
 * Analyzes a repository root to infer domain, ecosystem, and description
 * without requiring user input. Used during `trellis init` to seed the
 * agent scaffold with meaningful context.
 *
 * @module trellis/scaffold/infer
 */

import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InferenceConfidence = 'high' | 'medium' | 'low';
export type FrameworkType = 'react' | 'vue' | 'svelte' | 'next' | 'nuxt' | 'remotion' | 'expo' | 'bun' | 'node' | 'cli' | 'library' | 'animation' | 'games' | 'none';

export interface ProjectContext {
  /** Inferred domain (e.g. 'animation-studio', 'web-app', 'library', etc.) */
  domain: string | null;
  /** Short human-readable description (from README or package.json) */
  description: string | null;
  /** Primary ecosystem (e.g. 'bun', 'node', 'python', 'rust') */
  ecosystem: string | null;
  /** Project name (from package.json or directory name) */
  name: string | null;
  /** Inferred framework (e.g. 'react', 'next', 'cli', etc.) */
  framework: FrameworkType | null;
  /** Approximate file count */
  fileCount: number;
  /** How confident the inference is — determines whether prompts fire */
  confidence: InferenceConfidence;
  /** Key indicator files that were detected */
  indicators: string[];
}

// ---------------------------------------------------------------------------
// Ecosystem detection
// ---------------------------------------------------------------------------

interface EcosystemResult {
  ecosystem: string;
  name: string | null;
  description: string | null;
  domain: string | null;
  framework: FrameworkType | null;
  indicators: string[];
}

function detectEcosystem(rootPath: string): EcosystemResult {
  const indicators: string[] = [];
  let ecosystem: string | null = null;
  let name: string | null = null;
  let description: string | null = null;
  let domain: string | null = null;

  // --- Bun / Node ---
  const pkgPath = join(rootPath, 'package.json');
  if (existsSync(pkgPath)) {
    indicators.push('package.json');
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      name = pkg.name ?? null;
      description = pkg.description ?? null;
      ecosystem = 'node';

      const deps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };
      const depNames = Object.keys(deps);

      // Bun-specific
      if (pkg.engines?.bun || depNames.includes('@types/bun')) {
        ecosystem = 'bun';
      }

      // Domain inference from deps
      if (depNames.some((d: string) => d.includes('motion-canvas'))) {
        domain = 'animation-studio';
      } else if (
        depNames.some((d: string) =>
          ['react', 'vue', 'svelte', 'next', 'nuxt'].includes(d),
        )
      ) {
        domain = 'web-app';
      } else if (
        depNames.some((d: string) =>
          ['express', 'fastify', 'hono', 'elysia'].includes(d),
        )
      ) {
        domain = 'api-server';
      } else if (
        depNames.some(
          (d: string) =>
            d.includes('@tensorflow') ||
            d.includes('langchain') ||
            d.includes('openai'),
        )
      ) {
        domain = 'ai-ml';
      }
    } catch {
      // Malformed package.json — ignore
    }
  }

  // --- Python ---
  if (existsSync(join(rootPath, 'pyproject.toml'))) {
    indicators.push('pyproject.toml');
    ecosystem = ecosystem ?? 'python';
  } else if (existsSync(join(rootPath, 'requirements.txt'))) {
    indicators.push('requirements.txt');
    ecosystem = ecosystem ?? 'python';
  }

  // --- Rust ---
  const cargoPath = join(rootPath, 'Cargo.toml');
  if (existsSync(cargoPath)) {
    indicators.push('Cargo.toml');
    ecosystem = ecosystem ?? 'rust';
    try {
      const cargo = readFileSync(cargoPath, 'utf-8');
      const nameMatch = cargo.match(/^name\s*=\s*"(.+?)"/m);
      if (nameMatch) name = name ?? nameMatch[1] ?? null;
    } catch {}
  }

  // --- Go ---
  if (existsSync(join(rootPath, 'go.mod'))) {
    indicators.push('go.mod');
    ecosystem = ecosystem ?? 'go';
  }

  // --- Docker / infra ---
  if (
    existsSync(join(rootPath, 'Dockerfile')) ||
    existsSync(join(rootPath, 'docker-compose.yml'))
  ) {
    indicators.push('Dockerfile');
    domain = domain ?? 'infrastructure';
  }

  // --- Framework detection ---
  let framework: FrameworkType | null = null;
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const deps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };
      const depNames = Object.keys(deps);

      if (depNames.includes('next')) {
        framework = 'next';
      } else if (depNames.includes('nuxt')) {
        framework = 'nuxt';
      } else if (depNames.includes('svelte')) {
        framework = 'svelte';
      } else if (depNames.includes('vue')) {
        framework = 'vue';
      } else if (depNames.includes('remotion') || depNames.includes('@remotion/server')) {
        framework = 'remotion';
      } else if (depNames.includes('expo') || depNames.includes('react-native')) {
        framework = 'expo';
      } else if (depNames.some(d => ['commander', 'cac', 'oclif', 'yargs'].includes(d))) {
        framework = 'cli';
      } else if (depNames.includes('react')) {
        framework = 'react';
      }
    } catch {}
  }

  return {
    ecosystem: ecosystem ?? 'unknown',
    name,
    description,
    domain,
    framework,
    indicators,
  };
}

// ---------------------------------------------------------------------------
// README extraction
// ---------------------------------------------------------------------------

function extractReadmeDescription(rootPath: string): {
  description: string | null;
  indicators: string[];
} {
  const candidates = ['README.md', 'README.MD', 'readme.md', 'README.txt'];
  for (const candidate of candidates) {
    const readmePath = join(rootPath, candidate);
    if (!existsSync(readmePath)) continue;

    try {
      const content = readFileSync(readmePath, 'utf-8');
      const lines = content.split('\n').slice(0, 60);

      // Find first non-heading, non-empty paragraph
      for (const line of lines) {
        const trimmed = line.trim();
        if (
          trimmed &&
          !trimmed.startsWith('#') &&
          !trimmed.startsWith('!') &&
          trimmed.length > 20
        ) {
          // Strip markdown formatting
          const clean = trimmed
            .replace(/[*_`[\]]/g, '')
            .replace(/\(https?:\/\/[^\)]+\)/g, '')
            .trim();
          if (clean.length > 10) {
            return {
              description: clean.slice(0, 200),
              indicators: [candidate],
            };
          }
        }
      }
    } catch {}
  }
  return { description: null, indicators: [] };
}

// ---------------------------------------------------------------------------
// File count (shallow, fast)
// ---------------------------------------------------------------------------

function shallowFileCount(rootPath: string, maxDepth = 3): number {
  let count = 0;

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (
        entry.startsWith('.') ||
        entry === 'node_modules' ||
        entry === '.trellis'
      )
        continue;
      try {
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full, depth + 1);
        } else {
          count++;
        }
      } catch {}
    }
  }

  walk(rootPath, 0);
  return count;
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

function computeConfidence(
  fileCount: number,
  indicators: string[],
): InferenceConfidence {
  // Fresh project or strong indicator signals → high confidence
  if (fileCount <= 5) return 'high';
  if (indicators.length >= 2) return 'high';

  // Huge unknown codebase → low confidence, suggest `trellis season`
  if (fileCount >= 10_000) return 'low';

  // Mid-range: at least one indicator → high, otherwise medium
  if (indicators.length === 1) return fileCount <= 500 ? 'high' : 'medium';

  // 6+ files, no indicators → medium
  return 'medium';
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export interface InferOptions {
  /** Pre-computed file count from an existing scan (avoids double walk) */
  precomputedFileCount?: number;
}

/**
 * Infer project context from the filesystem without user input.
 *
 * @param rootPath - Absolute path to the project root
 * @param opts     - Optional pre-computed data to avoid duplicate work
 * @returns A ProjectContext object to seed the agent scaffold
 */
export async function inferProjectContext(
  rootPath: string,
  opts?: InferOptions,
): Promise<ProjectContext> {
  const fileCount = opts?.precomputedFileCount ?? shallowFileCount(rootPath);
  const ecosystem = detectEcosystem(rootPath);
  const readme = extractReadmeDescription(rootPath);

  const allIndicators = [...ecosystem.indicators, ...readme.indicators];
  const confidence = computeConfidence(fileCount, allIndicators);

  return {
    domain: ecosystem.domain,
    description: readme.description ?? ecosystem.description,
    ecosystem: ecosystem.ecosystem,
    name: ecosystem.name,
    framework: ecosystem.framework,
    fileCount,
    confidence,
    indicators: allIndicators,
  };
}
