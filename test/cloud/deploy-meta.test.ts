import { describe, it, expect } from 'vitest';
import {
  validateDeployName,
  normalizeDeployName,
  buildDeployUrl,
  DeployNameError,
} from '../../src/server/deploy-meta.js';

describe('validateDeployName', () => {
  it('accepts valid slugs', () => {
    expect(validateDeployName('my-app')).toBe('my-app');
    expect(validateDeployName('Trellis-Demo')).toBe('trellis-demo');
    expect(validateDeployName('a12')).toBe('a12');
  });

  it('rejects empty names', () => {
    expect(() => validateDeployName('')).toThrow(DeployNameError);
    expect(() => validateDeployName('   ')).toThrow(DeployNameError);
  });

  it('rejects names that are too short or too long', () => {
    expect(() => validateDeployName('ab')).toThrow(/3–32/);
    expect(() => validateDeployName('a'.repeat(33))).toThrow(/3–32/);
  });

  it('rejects invalid characters and shapes', () => {
    expect(() => validateDeployName('1starts-with-digit')).toThrow(
      DeployNameError,
    );
    expect(() => validateDeployName('has_underscore')).toThrow(DeployNameError);
    expect(() => validateDeployName('double--hyphen')).toThrow(
      /consecutive hyphens/,
    );
    expect(() => validateDeployName('-leading')).toThrow(DeployNameError);
    expect(() => validateDeployName('trailing-')).toThrow(DeployNameError);
  });
});

describe('buildDeployUrl', () => {
  it('builds Sprites HTTPS URL from normalized slug', () => {
    expect(buildDeployUrl('My-Room')).toBe('https://my-room.sprites.app');
  });
});

describe('normalizeDeployName', () => {
  it('trims and lowercases', () => {
    expect(normalizeDeployName('  My-App  ')).toBe('my-app');
  });
});
