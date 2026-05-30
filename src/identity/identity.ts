/**
 * Identity Module
 *
 * Ed25519 key pair generation, DID derivation, and local identity storage.
 * DESIGN.md §6.1 — Every actor is an Identity entity with a cryptographic key pair.
 *
 * Private keys are stored locally in `.trellis/identity.json` (never synced).
 * Public keys and DIDs are graph entities that get replicated to peers.
 */

import {
  generateKeyPairSync,
  sign,
  verify,
  createPublicKey,
  type KeyObject,
} from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IdentityConfig {
  displayName: string;
  email?: string;
  /** Ed25519 public key, base64-encoded. */
  publicKey: string;
  /** Ed25519 private key, base64-encoded (local only, never synced). */
  privateKey: string;
  /** did:key identifier derived from public key. */
  did: string;
  /** Entity ID for use in the EAV store. */
  entityId: string;
  /** ISO timestamp of creation. */
  createdAt: string;
}

export interface PublicIdentity {
  displayName: string;
  email?: string;
  publicKey: string;
  did: string;
  entityId: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

/**
 * Generate a new Ed25519 identity.
 */
export function createIdentity(opts: {
  displayName: string;
  email?: string;
}): IdentityConfig {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');

  const pubDer = publicKey.export({ type: 'spki', format: 'der' });
  const privDer = privateKey.export({ type: 'pkcs8', format: 'der' });

  // Extract raw 32-byte public key from SPKI DER (last 32 bytes)
  const rawPub = pubDer.subarray(pubDer.length - 32);

  const did = deriveDid(rawPub);
  const entityId = `identity:${did}`;

  return {
    displayName: opts.displayName,
    email: opts.email,
    publicKey: pubDer.toString('base64'),
    privateKey: privDer.toString('base64'),
    did,
    entityId,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Derive a did:key identifier from a raw Ed25519 public key.
 * Format: did:key:z6Mk... (multicodec 0xed01 prefix + base58btc)
 */
function deriveDid(rawPublicKey: Buffer | Uint8Array): string {
  // Multicodec prefix for Ed25519 public key: 0xed 0x01
  const multicodec = Buffer.concat([
    Buffer.from([0xed, 0x01]),
    Buffer.from(rawPublicKey),
  ]);
  // Base58btc encoding
  const encoded = base58btcEncode(multicodec);
  return `did:key:z${encoded}`;
}

// ---------------------------------------------------------------------------
// Op signing / verification
// ---------------------------------------------------------------------------

/**
 * Sign a message (typically an op hash) with a private key.
 */
export function signMessage(
  message: string,
  privateKeyBase64: string,
): string {
  const privDer = Buffer.from(privateKeyBase64, 'base64');
  const privateKey = createPrivateKeyFromDer(privDer);
  const sig = sign(null, Buffer.from(message, 'utf-8'), privateKey);
  return sig.toString('base64');
}

/**
 * Verify a signature against a message and public key.
 */
export function verifySignature(
  message: string,
  signatureBase64: string,
  publicKeyBase64: string,
): boolean {
  const pubDer = Buffer.from(publicKeyBase64, 'base64');
  const publicKey = createPublicKey({
    key: pubDer,
    format: 'der',
    type: 'spki',
  });
  const sig = Buffer.from(signatureBase64, 'base64');
  return verify(null, Buffer.from(message, 'utf-8'), publicKey, sig);
}

// ---------------------------------------------------------------------------
// Local identity storage
// ---------------------------------------------------------------------------

const IDENTITY_FILE = 'identity.json';

/**
 * Save an identity to the local .trellis directory.
 */
export function saveIdentity(trellisDir: string, identity: IdentityConfig): void {
  const filePath = join(trellisDir, IDENTITY_FILE);
  if (!existsSync(dirname(filePath))) {
    mkdirSync(dirname(filePath), { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(identity, null, 2), 'utf-8');
}

/**
 * Load the local identity from .trellis/identity.json.
 */
export function loadIdentity(trellisDir: string): IdentityConfig | null {
  const filePath = join(trellisDir, IDENTITY_FILE);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as IdentityConfig;
  } catch {
    return null;
  }
}

/**
 * Check if a local identity exists.
 */
export function hasIdentity(trellisDir: string): boolean {
  return existsSync(join(trellisDir, IDENTITY_FILE));
}

/**
 * Extract the public (safe-to-share) portion of an identity.
 */
export function toPublicIdentity(identity: IdentityConfig): PublicIdentity {
  return {
    displayName: identity.displayName,
    email: identity.email,
    publicKey: identity.publicKey,
    did: identity.did,
    entityId: identity.entityId,
    createdAt: identity.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createPrivateKeyFromDer(der: Buffer): KeyObject {
  const { createPrivateKey } = require('crypto');
  return createPrivateKey({
    key: der,
    format: 'der',
    type: 'pkcs8',
  });
}

/**
 * Base58btc encoding (Bitcoin alphabet).
 */
function base58btcEncode(buf: Buffer | Uint8Array): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  let num = BigInt(0);
  for (const byte of buf) {
    num = num * 256n + BigInt(byte);
  }

  let encoded = '';
  while (num > 0n) {
    const rem = Number(num % 58n);
    num = num / 58n;
    encoded = ALPHABET[rem] + encoded;
  }

  // Preserve leading zeros
  for (const byte of buf) {
    if (byte === 0) {
      encoded = '1' + encoded;
    } else {
      break;
    }
  }

  return encoded || '1';
}
