/**
 * Trellis Server — Permission Middleware
 *
 * Entity-level access control declared in ontology schemas.
 *
 * Permission rules are defined per entity type in `EntityDef.permissions`.
 * Rules are evaluated at the middleware layer before any mutation or query
 * reaches the kernel.
 *
 * @module trellis/server
 */

import type { AuthContext } from './auth.js';
import type { EntityRecord } from '../core/kernel/trellis-kernel.js';

// ---------------------------------------------------------------------------
// Permission rule types
// ---------------------------------------------------------------------------

/** A permission rule for a CRUD operation on an entity type. */
export type PermissionRule =
  | 'public'                                         // anyone, including unauthenticated
  | 'authenticated'                                  // any logged-in user
  | 'own'                                            // entity.ownerId === auth.userId
  | { role: string }                                 // user has this role
  | { roles: string[] }                              // user has ANY of these roles
  | { fn: (auth: AuthContext, entity: EntityRecord | null) => boolean }; // custom predicate

/** Per-operation permission rules for an entity type. */
export interface PermissionsDef {
  read?: PermissionRule;
  create?: PermissionRule;
  update?: PermissionRule;
  delete?: PermissionRule;
}

/** Extended EntityDef that includes optional permissions. */
export interface EntityDefWithPermissions {
  name: string;
  permissions?: PermissionsDef;
}

/** Operation types checked against permissions. */
export type CrudOp = 'read' | 'create' | 'update' | 'delete';

// ---------------------------------------------------------------------------
// Permission registry
// ---------------------------------------------------------------------------

/**
 * Registry mapping entity type names to their permission definitions.
 * Populated at server startup from ontology schemas.
 */
export class PermissionRegistry {
  private rules: Map<string, PermissionsDef> = new Map();
  private defaultRule: PermissionRule = 'authenticated';

  /**
   * Register permissions for an entity type.
   */
  register(entityType: string, permissions: PermissionsDef): void {
    this.rules.set(entityType, permissions);
  }

  /**
   * Set the fallback rule used when an entity type has no declared permissions.
   */
  setDefault(rule: PermissionRule): void {
    this.defaultRule = rule;
  }

  /**
   * Get the permission rule for a specific operation on an entity type.
   * Falls back to the default rule if not declared.
   */
  getRule(entityType: string, op: CrudOp): PermissionRule {
    const def = this.rules.get(entityType);
    return def?.[op] ?? this.defaultRule;
  }

  /**
   * Check whether an auth context is allowed to perform an operation.
   */
  check(
    auth: AuthContext,
    entityType: string,
    op: CrudOp,
    entity: EntityRecord | null = null,
  ): boolean {
    const rule = this.getRule(entityType, op);
    return evaluateRule(rule, auth, entity);
  }

  /**
   * Assert access — throws a PermissionError if denied.
   */
  assert(
    auth: AuthContext,
    entityType: string,
    op: CrudOp,
    entity: EntityRecord | null = null,
  ): void {
    if (!this.check(auth, entityType, op, entity)) {
      throw new PermissionError(auth, entityType, op);
    }
  }
}

// ---------------------------------------------------------------------------
// Rule evaluator
// ---------------------------------------------------------------------------

function evaluateRule(
  rule: PermissionRule,
  auth: AuthContext,
  entity: EntityRecord | null,
): boolean {
  if (rule === 'public') {
    return true;
  }

  if (rule === 'authenticated') {
    return auth.authenticated;
  }

  if (rule === 'own') {
    if (!auth.authenticated || !auth.userId) return false;
    const ownerFact = entity?.facts.find(
      (f) => f.a === 'ownerId' || f.a === 'createdBy',
    );
    return ownerFact?.v === auth.userId;
  }

  if (typeof rule === 'object') {
    if ('role' in rule) {
      return auth.roles.includes(rule.role);
    }
    if ('roles' in rule) {
      return rule.roles.some((r) => auth.roles.includes(r));
    }
    if ('fn' in rule) {
      try {
        return rule.fn(auth, entity);
      } catch {
        return false;
      }
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Permission error
// ---------------------------------------------------------------------------

export class PermissionError extends Error {
  constructor(
    public auth: AuthContext,
    public entityType: string,
    public op: CrudOp,
  ) {
    const who = auth.authenticated ? `user:${auth.userId}` : 'anonymous';
    super(`Permission denied: ${who} cannot ${op} ${entityType}`);
    this.name = 'PermissionError';
  }

  toResponse() {
    return {
      error: 'Forbidden',
      message: this.message,
      code: 403,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers for building permission configs
// ---------------------------------------------------------------------------

/** Common preset: read-public, write-authenticated */
export const PUBLIC_READ: PermissionsDef = {
  read: 'public',
  create: 'authenticated',
  update: 'authenticated',
  delete: 'authenticated',
};

/** Common preset: full public access */
export const FULLY_PUBLIC: PermissionsDef = {
  read: 'public',
  create: 'public',
  update: 'public',
  delete: 'public',
};

/** Common preset: owner-only CRUD */
export const OWNER_ONLY: PermissionsDef = {
  read: 'own',
  create: 'authenticated',
  update: 'own',
  delete: 'own',
};

/** Common preset: admin-only */
export const ADMIN_ONLY: PermissionsDef = {
  read: { role: 'admin' },
  create: { role: 'admin' },
  update: { role: 'admin' },
  delete: { role: 'admin' },
};
