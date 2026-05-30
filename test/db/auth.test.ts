import { describe, it, expect } from 'vitest';
import {
  signJwt,
  verifyJwt,
  resolveAuth,
  ANONYMOUS,
} from '../../src/server/auth.js';

const SECRET = 'test-secret-12345';

describe('JWT', () => {
  it('signs and verifies a JWT', async () => {
    const token = await signJwt({ sub: 'user:abc', roles: ['user'] }, SECRET);
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);

    const claims = await verifyJwt(token, SECRET);
    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe('user:abc');
    expect(claims!.roles).toEqual(['user']);
  });

  it('returns null for tampered token', async () => {
    const token = await signJwt({ sub: 'user:abc' }, SECRET);
    const parts = token.split('.');
    const tampered = `${parts[0]}.${parts[1]}.invalidsig`;
    const result = await verifyJwt(tampered, SECRET);
    expect(result).toBeNull();
  });

  it('returns null for wrong secret', async () => {
    const token = await signJwt({ sub: 'user:abc' }, SECRET);
    const result = await verifyJwt(token, 'wrong-secret');
    expect(result).toBeNull();
  });

  it('returns null for expired token', async () => {
    const token = await signJwt({ sub: 'user:abc' }, SECRET, -1);
    const result = await verifyJwt(token, SECRET);
    expect(result).toBeNull();
  });
});

describe('resolveAuth', () => {
  it('returns ANONYMOUS when no header', async () => {
    const auth = await resolveAuth(null, {});
    expect(auth.authenticated).toBe(false);
    expect(auth.userId).toBeNull();
  });

  it('resolves API key', async () => {
    const auth = await resolveAuth('Bearer my-api-key', { apiKey: 'my-api-key' });
    expect(auth.authenticated).toBe(true);
    expect(auth.userId).toBe('service');
    expect(auth.roles).toContain('admin');
  });

  it('resolves JWT Bearer token', async () => {
    const token = await signJwt(
      { sub: 'user:xyz', roles: ['user'], tenantId: 'tenant-1' },
      SECRET,
    );
    const auth = await resolveAuth(`Bearer ${token}`, { jwtSecret: SECRET });
    expect(auth.authenticated).toBe(true);
    expect(auth.userId).toBe('user:xyz');
    expect(auth.tenantId).toBe('tenant-1');
    expect(auth.roles).toContain('user');
  });

  it('returns ANONYMOUS for invalid JWT', async () => {
    const auth = await resolveAuth('Bearer not.a.jwt', { jwtSecret: SECRET });
    expect(auth.authenticated).toBe(false);
  });
});
