/**
 * Sprite Tools Plugin — Agent tools for checkpoint, deploy, rollback,
 * and deploy status.
 *
 * Thin wrappers around existing kernel primitives:
 *   - checkpoint → kernel.checkpoint()
 *   - deploy    → deploy() from src/server/deploy.ts
 *   - rollback  → kernel.timeTravel(opHash)
 *   - status    → readConfig() from src/client/config.ts
 *
 * @module trellis/plugins/sprite-tools
 */

import type { PluginDef } from '../../core/plugins/types.js';
import type { ToolHandler } from '../../core/agents/types.js';
import type { TrellisKernel } from '../../core/kernel/trellis-kernel.js';

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export function createSpriteToolsPlugin(): PluginDef {
  return {
    id: 'trellis:sprite-tools',
    name: 'Sprite Tools',
    version: '1.0.0',
    description: 'Agent tools for checkpoint, deploy, rollback, and deploy status',

    onLoad: async (ctx) => {
      ctx.log('Sprite tools loaded');
    },

    onUnload: async (ctx) => {
      ctx.log('Sprite tools unloaded');
    },
  };
}

// ---------------------------------------------------------------------------
// Tool context
// ---------------------------------------------------------------------------

export interface SpriteToolContext {
  kernel: TrellisKernel;
  /** Directory containing .trellis-db.json (defaults to cwd). */
  configDir?: string;
}

// ---------------------------------------------------------------------------
// Tool: createCheckpoint
// ---------------------------------------------------------------------------

export function createCheckpointTool(ctx: SpriteToolContext): {
  def: { name: string; description: string; schema: string };
  handler: ToolHandler;
} {
  return {
    def: {
      name: 'createCheckpoint',
      description:
        'Create a snapshot checkpoint of the current graph state. Use before risky operations or after completing a significant batch of changes.',
      schema: JSON.stringify({
        type: 'object',
        properties: {
          comment: {
            type: 'string',
            description: 'Optional comment describing what this checkpoint captures',
          },
        },
      }),
    },
    handler: async (input) => {
      const { comment } = input as { comment?: string };
      const lastOpBefore = ctx.kernel.getLastOp();

      ctx.kernel.checkpoint();

      const opHash = lastOpBefore?.hash ?? 'none';
      return {
        success: true,
        output: {
          message: 'Checkpoint created',
          opHash,
          comment: comment ?? undefined,
          timestamp: new Date().toISOString(),
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: rollback
// ---------------------------------------------------------------------------

export function createRollbackTool(ctx: SpriteToolContext): {
  def: { name: string; description: string; schema: string };
  handler: ToolHandler;
} {
  return {
    def: {
      name: 'rollback',
      description:
        'Time-travel the graph to a previous state by replaying ops up to a specific operation hash. Returns a read-only snapshot — use the store methods to inspect the historical state.',
      schema: JSON.stringify({
        type: 'object',
        properties: {
          opHash: {
            type: 'string',
            description: 'The operation hash to roll back to (from a previous checkpoint)',
          },
        },
        required: ['opHash'],
      }),
    },
    handler: async (input) => {
      const { opHash } = input as { opHash: string };

      try {
        const snapshot = ctx.kernel.timeTravel(opHash);
        const factCount = snapshot.getAllFacts().length;
        const linkCount = snapshot.getAllLinks().length;

        return {
          success: true,
          output: {
            message: `Rolled back to op ${opHash}`,
            factCount,
            linkCount,
            opHash,
          },
        };
      } catch (err: any) {
        return {
          success: false,
          output: null,
          error: `Rollback failed: ${err.message}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: getDeployStatus
// ---------------------------------------------------------------------------

export function createGetDeployStatusTool(ctx: SpriteToolContext): {
  def: { name: string; description: string; schema: string };
  handler: ToolHandler;
} {
  return {
    def: {
      name: 'getDeployStatus',
      description:
        'Get the current deployment configuration, including mode (local/remote), Sprite name, URL, and last deploy timestamp.',
      schema: JSON.stringify({
        type: 'object',
        properties: {},
      }),
    },
    handler: async () => {
      try {
        // Dynamic import to avoid bundling fs-dependent code at module level
        const { readConfig } = await import('../../client/config.js');
        const config = readConfig(ctx.configDir ?? '.');

        if (!config) {
          return {
            success: true,
            output: {
              deployed: false,
              mode: 'unknown',
              message: 'No .trellis-db.json found. Project has not been configured.',
            },
          };
        }

        return {
          success: true,
          output: {
            deployed: config.mode === 'remote',
            mode: config.mode,
            url: config.url ?? null,
            spriteName: config.spriteName ?? null,
            deployedAt: config.deployedAt ?? null,
            port: config.port ?? null,
          },
        };
      } catch (err: any) {
        return {
          success: false,
          output: null,
          error: `Failed to read deploy config: ${err.message}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: deployToSprite
// ---------------------------------------------------------------------------

export function createDeployToSpriteTool(ctx: SpriteToolContext): {
  def: { name: string; description: string; schema: string };
  handler: ToolHandler;
} {
  return {
    def: {
      name: 'deployToSprite',
      description:
        'Deploy the Trellis DB server to a Sprites cloud environment. Bundles the server, uploads to the sprite, and starts a detached session. Requires the `sprite` CLI to be installed and authenticated.',
      schema: JSON.stringify({
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Sprite name (becomes the subdomain: <name>.sprites.app)',
          },
          dbPath: {
            type: 'string',
            description: 'Local .trellis-db directory to deploy (optional)',
          },
          port: {
            type: 'number',
            description: 'Port to run on inside the Sprite (default: 3000)',
          },
        },
        required: ['name'],
      }),
    },
    handler: async (input) => {
      const { name, dbPath, port } = input as {
        name: string;
        dbPath?: string;
        port?: number;
      };

      try {
        // Auto-checkpoint before deploy
        ctx.kernel.checkpoint();

        // Dynamic import to avoid bundling the deploy pipeline at module level
        const { deploy } = await import('../../server/deploy.js');
        const progressLog: string[] = [];

        const result = await deploy({
          name,
          dbPath,
          port,
          configDir: ctx.configDir ?? '.',
          onProgress: (msg) => progressLog.push(msg),
        });

        return {
          success: true,
          output: {
            url: result.url,
            spriteName: result.name,
            apiKey: result.apiKey,
            steps: progressLog,
          },
        };
      } catch (err: any) {
        return {
          success: false,
          output: null,
          error: `Deploy failed: ${err.message}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: listOps
// ---------------------------------------------------------------------------

export function createListOpsTool(ctx: SpriteToolContext): {
  def: { name: string; description: string; schema: string };
  handler: ToolHandler;
} {
  return {
    def: {
      name: 'listOps',
      description:
        'List recent operations in the causal stream. Useful for finding an operation hash to rollback to.',
      schema: JSON.stringify({
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of ops to return (default: 20)',
          },
        },
      }),
    },
    handler: async (input) => {
      const { limit = 20 } = input as { limit?: number };

      const allOps = ctx.kernel.readAllOps();
      const recent = allOps.slice(-limit);

      return {
        success: true,
        output: {
          total: allOps.length,
          showing: recent.length,
          ops: recent.map((op) => ({
            hash: op.hash,
            kind: op.kind,
            timestamp: op.timestamp,
            agentId: op.agentId,
            factsCount: (op.facts?.length ?? 0) + (op.deleteFacts?.length ?? 0),
            linksCount: (op.links?.length ?? 0) + (op.deleteLinks?.length ?? 0),
          })),
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Register all tools
// ---------------------------------------------------------------------------

export function registerSpriteTools(
  harness: {
    registerTool: (
      def: { name: string; description: string; schema?: string },
      handler: ToolHandler,
    ) => Promise<string>;
  },
  ctx: SpriteToolContext,
): Promise<string[]> {
  const tools = [
    createCheckpointTool(ctx),
    createRollbackTool(ctx),
    createGetDeployStatusTool(ctx),
    createDeployToSpriteTool(ctx),
    createListOpsTool(ctx),
  ];

  return Promise.all(tools.map((t) => harness.registerTool(t.def, t.handler)));
}
