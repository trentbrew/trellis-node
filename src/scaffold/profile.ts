/**
 * Global User Profile
 *
 * Manages a persistent user profile stored at ~/.trellis/profile.json.
 * This profile is captured once on first-ever Trellis use and injected
 * into every repo's agent scaffold to provide personal context to AI tools.
 *
 * The profile is a *soft metadata* layer distinct from the cryptographic
 * identity in `src/identity/`. If an identity already exists for the repo,
 * the profile prompt pre-fills the name from `identity.displayName`.
 *
 * @module trellis/scaffold/profile
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createInterface } from 'readline';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserProfile {
  name: string;
  bio: string;
  skills: string[];
  style: string;
  preferences: {
    verbosity: 'concise' | 'detailed' | 'balanced';
    tone: 'peer' | 'mentor' | 'formal';
  };
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getProfileDir(): string {
  return join(homedir(), '.trellis');
}

function getProfilePath(): string {
  return join(getProfileDir(), 'profile.json');
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Load the global user profile, or null if not yet created.
 */
export function loadProfile(): UserProfile | null {
  const profilePath = getProfilePath();
  if (!existsSync(profilePath)) return null;
  try {
    const raw = readFileSync(profilePath, 'utf-8');
    return JSON.parse(raw) as UserProfile;
  } catch {
    return null;
  }
}

/**
 * Save (or overwrite) the global user profile.
 */
export function saveProfile(profile: UserProfile): void {
  const dir = getProfileDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(getProfilePath(), JSON.stringify(profile, null, 2));
}

/**
 * Returns true if a global profile exists.
 */
export function hasProfile(): boolean {
  return existsSync(getProfilePath());
}

// ---------------------------------------------------------------------------
// Terminal prompts
// ---------------------------------------------------------------------------

function ask(
  rl: ReturnType<typeof createInterface>,
  question: string,
): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

/**
 * Interactive terminal prompt to collect user profile.
 * Called only from the CLI layer, never from programmatic API consumers.
 *
 * @param hints Optional pre-fill hints (e.g. from an existing identity)
 */
export async function promptForProfile(hints?: {
  name?: string;
}): Promise<UserProfile> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log();
  console.log('  This takes about 60 seconds and only happens once.');
  console.log('  Press Enter to skip any question.\n');

  const defaultName = hints?.name ?? '';
  const namePrompt = defaultName
    ? `  Your name [${defaultName}]: `
    : '  Your name: ';
  const nameRaw = await ask(rl, namePrompt);
  const name = nameRaw || defaultName;

  const bio = await ask(
    rl,
    '  In one sentence, what kind of work do you do? ',
  );
  const skillsRaw = await ask(
    rl,
    '  Top 3–5 tools or skills (comma-separated): ',
  );
  const style = await ask(
    rl,
    '  How would you describe your working style? ',
  );
  const verbosityRaw = await ask(
    rl,
    '  Preferred response verbosity — concise / balanced / detailed [balanced]: ',
  );
  const toneRaw = await ask(
    rl,
    '  Preferred AI tone — peer / mentor / formal [peer]: ',
  );

  rl.close();

  const skills = skillsRaw
    ? skillsRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const verbosity = (
    ['concise', 'balanced', 'detailed'].includes(verbosityRaw)
      ? verbosityRaw
      : 'balanced'
  ) as UserProfile['preferences']['verbosity'];

  const tone = (
    ['peer', 'mentor', 'formal'].includes(toneRaw) ? toneRaw : 'peer'
  ) as UserProfile['preferences']['tone'];

  const now = new Date().toISOString();

  return {
    name: name || 'Unknown',
    bio: bio || '',
    skills,
    style: style || '',
    preferences: { verbosity, tone },
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Update specific fields of the existing profile without full re-prompting.
 */
export function updateProfile(
  updates: Partial<Omit<UserProfile, 'createdAt'>>,
): UserProfile {
  const existing = loadProfile();
  const base: UserProfile = existing ?? {
    name: 'Unknown',
    bio: '',
    skills: [],
    style: '',
    preferences: { verbosity: 'balanced', tone: 'peer' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const updated: UserProfile = {
    ...base,
    ...updates,
    preferences: { ...base.preferences, ...(updates.preferences ?? {}) },
    updatedAt: new Date().toISOString(),
  };

  saveProfile(updated);
  return updated;
}
