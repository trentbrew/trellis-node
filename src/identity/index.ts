/**
 * Identity Module — Public Surface
 */

export {
  createIdentity,
  signMessage,
  verifySignature,
  saveIdentity,
  loadIdentity,
  hasIdentity,
  toPublicIdentity,
} from './identity.js';

export type { IdentityConfig, PublicIdentity } from './identity.js';

export { signOp, verifyOp, verifyOpBatch } from './signing-middleware.js';

export type {
  IdentityResolver,
  SignatureVerificationResult,
} from './signing-middleware.js';

export { evaluatePolicy, createPolicy } from './governance.js';

export type {
  PolicyRule,
  PolicyViolation,
  GovernanceResult,
} from './governance.js';
