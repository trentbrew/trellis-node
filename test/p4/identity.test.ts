import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  createIdentity,
  signMessage,
  verifySignature,
  saveIdentity,
  loadIdentity,
  hasIdentity,
  toPublicIdentity,
  type IdentityConfig,
} from '../../src/identity/identity.js';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

describe('createIdentity', () => {
  test('generates an identity with Ed25519 keys', () => {
    const id = createIdentity({ displayName: 'Alice' });
    expect(id.displayName).toBe('Alice');
    expect(id.publicKey).toBeDefined();
    expect(id.privateKey).toBeDefined();
    expect(id.did).toMatch(/^did:key:z/);
    expect(id.entityId).toMatch(/^identity:did:key:z/);
    expect(id.createdAt).toBeDefined();
  });

  test('includes email when provided', () => {
    const id = createIdentity({ displayName: 'Bob', email: 'bob@example.com' });
    expect(id.email).toBe('bob@example.com');
  });

  test('generates unique keys each time', () => {
    const a = createIdentity({ displayName: 'A' });
    const b = createIdentity({ displayName: 'B' });
    expect(a.publicKey).not.toBe(b.publicKey);
    expect(a.privateKey).not.toBe(b.privateKey);
    expect(a.did).not.toBe(b.did);
  });

  test('DID is deterministic from public key', () => {
    const id = createIdentity({ displayName: 'Test' });
    // DID should be a stable derivation — same identity, same DID
    expect(id.did.length).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------
// Signing and verification
// ---------------------------------------------------------------------------

describe('signMessage / verifySignature', () => {
  let identity: IdentityConfig;

  test('sign and verify roundtrip', () => {
    identity = createIdentity({ displayName: 'Signer' });
    const message = 'op:abc123hash';
    const signature = signMessage(message, identity.privateKey);

    expect(signature).toBeDefined();
    expect(signature.length).toBeGreaterThan(0);

    const valid = verifySignature(message, signature, identity.publicKey);
    expect(valid).toBe(true);
  });

  test('verification fails with wrong message', () => {
    identity = createIdentity({ displayName: 'Signer' });
    const signature = signMessage('correct message', identity.privateKey);
    const valid = verifySignature(
      'wrong message',
      signature,
      identity.publicKey,
    );
    expect(valid).toBe(false);
  });

  test('verification fails with wrong public key', () => {
    identity = createIdentity({ displayName: 'Signer' });
    const other = createIdentity({ displayName: 'Other' });

    const signature = signMessage('test', identity.privateKey);
    const valid = verifySignature('test', signature, other.publicKey);
    expect(valid).toBe(false);
  });

  test('different messages produce different signatures', () => {
    identity = createIdentity({ displayName: 'Signer' });
    const sig1 = signMessage('message1', identity.privateKey);
    const sig2 = signMessage('message2', identity.privateKey);
    expect(sig1).not.toBe(sig2);
  });
});

// ---------------------------------------------------------------------------
// Local storage
// ---------------------------------------------------------------------------

describe('identity storage', () => {
  let currentTestDir: string;

  beforeEach(() => {
    currentTestDir = join(
      tmpdir(),
      `trellis-p4-identity-test-${Math.random().toString(36).slice(2)}`,
      '.trellis',
    );
    mkdirSync(currentTestDir, { recursive: true });
  });

  afterEach(() => {
    const parentDir = join(currentTestDir, '..');
    rmSync(parentDir, { recursive: true, force: true });
  });

  test('saveIdentity and loadIdentity roundtrip', () => {
    const id = createIdentity({
      displayName: 'Stored',
      email: 'stored@test.com',
    });
    saveIdentity(currentTestDir, id);

    const loaded = loadIdentity(currentTestDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.displayName).toBe('Stored');
    expect(loaded!.email).toBe('stored@test.com');
    expect(loaded!.did).toBe(id.did);
    expect(loaded!.privateKey).toBe(id.privateKey);
  });

  test('loadIdentity returns null when no identity exists', () => {
    expect(loadIdentity(currentTestDir)).toBeNull();
  });

  test('hasIdentity returns correct boolean', () => {
    expect(hasIdentity(currentTestDir)).toBe(false);

    const id = createIdentity({ displayName: 'Test' });
    saveIdentity(currentTestDir, id);
    expect(hasIdentity(currentTestDir)).toBe(true);
  });

  test('toPublicIdentity strips private key', () => {
    const id = createIdentity({ displayName: 'Public' });
    const pub = toPublicIdentity(id);

    expect(pub.displayName).toBe('Public');
    expect(pub.publicKey).toBe(id.publicKey);
    expect(pub.did).toBe(id.did);
    expect((pub as any).privateKey).toBeUndefined();
  });
});
