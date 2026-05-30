/**
 * Idea Garden Plugin
 *
 * Registers the Idea Garden feature and exposes agent tools to traverse
 * and resurrect ideas from the garden.
 *
 * @module trellis/plugins/idea-garden
 */

import type { PluginDef } from '../../core/plugins/types.js';
import type { TrellisKernel } from '../../core/kernel/trellis-kernel.js';
import type { AgentHarness } from '../../core/agents/harness.js';
import { IdeaGarden } from './api.js';

export function createIdeaGardenPlugin(
  kernel: TrellisKernel,
  harness: AgentHarness,
): PluginDef & { api: IdeaGarden } {
  const api = new IdeaGarden(kernel);

  return {
    id: 'trellis:idea-garden',
    name: 'Idea Garden',
    version: '1.0.0',
    description: 'Surfaces abandoned threads, cancelled plans, and unexplored alternatives as recoverable ideas.',
    
    api,

    onLoad: async (ctx) => {
      ctx.log('Idea Garden loaded');

      // Register Agent Tools
      await harness.registerTool(
        {
          id: 'harvestIdeas',
          name: 'harvestIdeas',
          description: 'Search for recoverable ideas like rejected plans, archived threads, or alternate agent paths.',
          schema: JSON.stringify({
            type: 'object',
            properties: {},
          }),
        },
        async () => {
          const ideas = api.harvestIdeas();
          return { success: true, output: ideas };
        }
      );

      await harness.registerTool(
        {
          id: 'resurrectPlan',
          name: 'resurrectPlan',
          description: 'Recover a rejected plan by creating a new active exact copy.',
          schema: JSON.stringify({
            type: 'object',
            properties: {
              ideaId: { type: 'string', description: 'The unique ID of the idea from harvestIdeas (e.g. idea:rejected_plan:plan:1)' }
            },
            required: ['ideaId']
          }),
        },
        async (input) => {
          const { ideaId } = input as { ideaId: string };
          try {
            const newPlanId = await api.resurrectPlan(ideaId);
            return {
              success: true,
              output: `Successfully resurrected plan. New PendingPlan ID: ${newPlanId}`,
            };
          } catch (err: any) {
            return { success: false, error: err.message, output: null };
          }
        }
      );
    },

    onUnload: async (ctx) => {
      ctx.log('Idea Garden unloaded');
      // In advanced implementations we would unregister the tools here.
    },
  };
}
