/**
 * Security Middleware
 *
 * Capability-based access control. Validates that the agent has permission
 * to perform the requested operation on the target entity.
 */

import type { KernelOp } from '../persist/backend.js';
import type {
  KernelMiddleware,
  MiddlewareContext,
  OpMiddlewareNext,
} from './middleware.js';

export type Permission =
  | 'read'
  | 'create'
  | 'update'
  | 'delete'
  | 'link'
  | 'unlink'
  | 'admin';

export interface Capability {
  /** What the capability applies to (entity ID, type, or '*' for all) */
  resource: string;
  /** Permissions granted */
  permissions: Permission[];
}

export interface SecurityMiddlewareConfig {
  /** Agent ID to capabilities map */
  capabilities: Map<string, Capability[]>;
  /** Default capabilities for agents not in the map */
  defaultCapabilities?: Capability[];
  /** If true, blocks operations without explicit grants. If false, allows by default. */
  strict?: boolean;
}

export function createSecurityMiddleware(
  config: SecurityMiddlewareConfig,
): KernelMiddleware {
  const strict = config.strict ?? false;
  const defaultCaps = config.defaultCapabilities ?? [];

  return {
    name: 'security',

    async handleOp(
      op: KernelOp,
      ctx: MiddlewareContext,
      next: OpMiddlewareNext,
    ): Promise<void> {
      const agentId = ctx.agentId;
      if (!agentId) {
        if (strict) {
          throw new Error('No agent ID in context — operation denied');
        }
        return next(op, ctx);
      }

      // Get capabilities for this agent
      const capabilities = config.capabilities.get(agentId) ?? defaultCaps;

      // Determine what permission is needed based on op kind
      const requiredPermission = getRequiredPermission(op);
      if (!requiredPermission) {
        // Not a mutation that requires permission
        return next(op, ctx);
      }

      // Check entity IDs involved in this operation
      const entityIds = getEntityIdsFromOp(op);

      for (const entityId of entityIds) {
        const hasPermission = capabilities.some((cap) => {
          // Wildcard matches everything
          if (cap.resource === '*') {
            return cap.permissions.includes(requiredPermission);
          }
          // Exact match
          if (cap.resource === entityId) {
            return cap.permissions.includes(requiredPermission);
          }
          // Type match (e.g., "type:Project")
          if (cap.resource.startsWith('type:')) {
            const type = cap.resource.slice(5);
            // Check if entity has this type
            const typeFact = op.facts?.find(
              (f) => f.e === entityId && f.a === 'type',
            );
            return (
              typeFact?.v === type &&
              cap.permissions.includes(requiredPermission)
            );
          }
          return false;
        });

        if (!hasPermission) {
          throw new Error(
            `Permission denied: agent ${agentId} lacks ${requiredPermission} on ${entityId}`,
          );
        }
      }

      return next(op, ctx);
    },
  };
}

function getRequiredPermission(op: KernelOp): Permission | null {
  const kind = op.kind.toLowerCase();

  if (kind.includes('delete')) return 'delete';
  if (kind.includes('addlink') || kind.includes('link')) return 'link';
  if (kind.includes('dellink') || kind.includes('unlink')) return 'unlink';
  if (kind.includes('addfacts') || kind.includes('create')) {
    // Check if this is a create or update
    const hasType = op.facts?.some((f) => f.a === 'type');
    if (hasType) {
      // Could be create or update — check if entity exists
      // For simplicity, assume addfacts with type is create
      return 'create';
    }
    return 'update';
  }

  return null;
}

function getEntityIdsFromOp(op: KernelOp): string[] {
  const ids = new Set<string>();

  if (op.facts) {
    for (const fact of op.facts) {
      ids.add(fact.e);
    }
  }

  if (op.deleteFacts) {
    for (const fact of op.deleteFacts) {
      ids.add(fact.e);
    }
  }

  if (op.links) {
    for (const link of op.links) {
      ids.add(link.e1);
      ids.add(link.e2);
    }
  }

  if (op.deleteLinks) {
    for (const link of op.deleteLinks) {
      ids.add(link.e1);
      ids.add(link.e2);
    }
  }

  return Array.from(ids);
}
