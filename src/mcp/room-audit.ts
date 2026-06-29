/**
 * Room MCP audit — Decision entities for agent write attribution.
 *
 * @module trellis/mcp
 */

import type { MiddlewareContext } from '../core/kernel/middleware.js';
import type { TrellisKernel } from '../core/kernel/trellis-kernel.js';

function sanitizeInput(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value.length > 2000) {
      out[key] = value.slice(0, 2000) + '…';
    } else {
      out[key] = value;
    }
  }
  return out;
}

function summarizeText(text: string, max = 500): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

/**
 * Persist a Decision entity for an MCP write (fire-and-forget safe).
 */
export async function recordRoomMcpAudit(
  kernel: TrellisKernel,
  agentId: string,
  toolName: string,
  params: Record<string, unknown>,
  resultText: string,
  wctx: Partial<MiddlewareContext>,
  relatedEntities: string[] = [],
): Promise<string | null> {
  try {
    const id = `decision:mcp-${crypto.randomUUID().slice(0, 8)}`;
    const links = relatedEntities.map((targetEntityId) => ({
      attribute: 'relatedTo',
      targetEntityId,
    }));

    await kernel.createEntity(
      id,
      'Decision',
      {
        title: `MCP ${toolName}`,
        toolName,
        input: JSON.stringify(sanitizeInput(params)),
        outputSummary: summarizeText(resultText),
        createdBy: agentId,
        source: 'room-mcp',
      },
      links.length > 0 ? links : undefined,
      wctx,
    );
    return id;
  } catch {
    return null;
  }
}

/** Schedule audit without blocking the tool response. */
export function scheduleRoomMcpAudit(
  kernelPromise: Promise<TrellisKernel>,
  agentId: string,
  toolName: string,
  params: Record<string, unknown>,
  resultText: string,
  wctx: Partial<MiddlewareContext>,
  relatedEntities?: string[],
): void {
  void kernelPromise.then((kernel) =>
    recordRoomMcpAudit(
      kernel,
      agentId,
      toolName,
      params,
      resultText,
      wctx,
      relatedEntities,
    ),
  );
}
