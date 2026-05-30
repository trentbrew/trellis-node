/**
 * VCS Middleware
 *
 * Intercepts VcsOps in the kernel middleware chain and decomposes
 * them into primitive EAV store operations before passing to the
 * next middleware (or the store).
 */

import type {
  KernelMiddleware,
  MiddlewareContext,
  OpMiddlewareNext,
} from '../core/kernel/middleware.js';
import type { KernelOp } from '../core/persist/backend.js';
import { decompose } from './decompose.js';
import { isVcsOp } from './ops.js';
import type { VcsOp } from './types.js';

export class VcsMiddleware implements KernelMiddleware {
  name = 'vcs';

  async handleOp(
    op: KernelOp,
    ctx: MiddlewareContext,
    next: OpMiddlewareNext,
  ): Promise<void> {
    if (!isVcsOp(op as any)) {
      return next(op, ctx);
    }

    const vcsOp = op as unknown as VcsOp;
    const decomposed = decompose(vcsOp);

    // Apply the decomposed primitive operations to the store.
    // We create synthetic KernelOps for each batch and pass them through.
    if (decomposed.deleteFacts.length > 0) {
      await next(
        {
          ...op,
          kind: 'deleteFacts' as any,
          facts: decomposed.deleteFacts,
          links: undefined,
        } as KernelOp,
        ctx,
      );
    }
    if (decomposed.deleteLinks.length > 0) {
      await next(
        {
          ...op,
          kind: 'deleteLinks' as any,
          facts: undefined,
          links: decomposed.deleteLinks,
        } as KernelOp,
        ctx,
      );
    }
    if (decomposed.addFacts.length > 0) {
      await next(
        {
          ...op,
          kind: 'addFacts' as any,
          facts: decomposed.addFacts,
          links: undefined,
        } as KernelOp,
        ctx,
      );
    }
    if (decomposed.addLinks.length > 0) {
      await next(
        {
          ...op,
          kind: 'addLinks' as any,
          facts: undefined,
          links: decomposed.addLinks,
        } as KernelOp,
        ctx,
      );
    }
  }
}
