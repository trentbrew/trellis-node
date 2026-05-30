/**
 * Kernel middleware types.
 * Slim version inlined from trellis-core — only includes the types
 * used by the VCS layer (op middleware). Query middleware types are
 * omitted to avoid pulling in the full query engine dependency chain.
 *
 * @module trellis/core
 */

import type { KernelOp } from '../persist/backend.js';

export type MiddlewareContext = {
  agentId?: string;
  [key: string]: unknown;
};

export type OpMiddlewareNext = (
  op: KernelOp,
  ctx: MiddlewareContext,
) => void | Promise<void>;

export interface KernelMiddleware {
  name: string;

  /**
   * Hook into kernel operations (mutations).
   * Can throw to block the operation (e.g. for security).
   */
  handleOp?: (
    op: KernelOp,
    ctx: MiddlewareContext,
    next: OpMiddlewareNext,
  ) => void | Promise<void>;

  /**
   * Hook into kernel queries.
   * Typed loosely here to avoid importing the full query engine.
   */
  handleQuery?: (
    query: unknown,
    ctx: MiddlewareContext,
    next: (...args: any[]) => any,
  ) => any;
}
