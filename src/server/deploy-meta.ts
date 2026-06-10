/**
 * TurtleDB deploy — name validation and URL helpers.
 *
 * @module trellis/server
 */

/** Sprites subdomain: lowercase DNS label, 3–32 chars. */
const DEPLOY_NAME_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const MIN_LEN = 3;
const MAX_LEN = 32;

export class DeployNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeployNameError';
  }
}

/**
 * Normalize user input (trim, lowercase).
 */
export function normalizeDeployName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Validate a Sprite / room-node slug. Returns normalized name or throws.
 */
export function validateDeployName(name: string): string {
  const normalized = normalizeDeployName(name);

  if (!normalized) {
    throw new DeployNameError('Deploy name is required.');
  }
  if (normalized.length < MIN_LEN || normalized.length > MAX_LEN) {
    throw new DeployNameError(
      `Deploy name must be ${MIN_LEN}–${MAX_LEN} characters (got ${normalized.length}).`,
    );
  }
  if (normalized.includes('--')) {
    throw new DeployNameError(
      'Deploy name cannot contain consecutive hyphens.',
    );
  }
  if (!DEPLOY_NAME_RE.test(normalized)) {
    throw new DeployNameError(
      'Deploy name must start with a letter and use only lowercase letters, numbers, and single hyphens (e.g. my-app).',
    );
  }

  return normalized;
}

/** Public HTTPS URL for a deployed room node on Sprites. */
export function buildDeployUrl(name: string): string {
  const slug = validateDeployName(name);
  return `https://${slug}.sprites.app`;
}
