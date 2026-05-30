/**
 * Idea Garden API
 *
 * Provides functions to query the Trellis kernel for abandoned threads,
 * rejected plans, and unexplored alternatives, surfacing them as RecoverableIdeas.
 */

import type { TrellisKernel } from '../../core/kernel/trellis-kernel.js';
import type { RecoverableIdea } from './types.js';

export class IdeaGarden {
  constructor(private kernel: TrellisKernel) {}

  /**
   * Harvests all recoverable ideas from the graph.
   * Scans for:
   * 1. Rejected/Cancelled PendingPlans
   * 2. Archived Conversations
   * 3. DecisionTraces with unexplored alternatives
   */
  harvestIdeas(): RecoverableIdea[] {
    const ideas: RecoverableIdea[] = [];

    // 1. Rejected Plans
    const plans = this.kernel.listEntities('PendingPlan');
    for (const plan of plans) {
      const status = plan.facts.find((f) => f.a === 'status')?.v;
      if (status === 'rejected' || status === 'cancelled') {
        const title = plan.facts.find((f) => f.a === 'title')?.v as string | undefined;
        let opsPayload: unknown[] = [];
        try {
          const rawOps = plan.facts.find((f) => f.a === 'operations')?.v as string;
          if (rawOps) opsPayload = JSON.parse(rawOps);
        } catch (e) {
          // Ignore parse errors
        }
        
        ideas.push({
          id: `idea:rejected_plan:${plan.id}`,
          sourceType: 'rejected_plan',
          sourceEntityId: plan.id,
          title: title || 'Untitled Plan',
          description: `A plan that was ${status} during approval.`,
          createdAt: plan.facts.find((f) => f.a === 'createdAt')?.v as string || new Date().toISOString(),
          payload: { operations: opsPayload }
        });
      }
    }

    // 2. Archived Conversations
    const convos = this.kernel.listEntities('Conversation');
    for (const convo of convos) {
      const status = convo.facts.find((f) => f.a === 'status')?.v;
      if (status === 'archived') {
        const title = convo.facts.find((f) => f.a === 'title')?.v as string | undefined;
        ideas.push({
          id: `idea:archived_conversation:${convo.id}`,
          sourceType: 'archived_conversation',
          sourceEntityId: convo.id,
          title: title || 'Untitled Conversation',
          description: 'An archived thread that might contain unexplored ideas.',
          createdAt: convo.facts.find((f) => f.a === 'createdAt')?.v as string || new Date().toISOString(),
        });
      }
    }

    // 3. Unexplored Alternatives from DecisionTraces
    const traces = this.kernel.listEntities('DecisionTrace');
    for (const trace of traces) {
      const altsRaw = trace.facts.find((f) => f.a === 'alternatives')?.v as string;
      if (!altsRaw) continue;
      
      let alts: string[] = [];
      try {
        alts = JSON.parse(altsRaw);
      } catch (e) {
        continue;
      }
      
      if (alts.length > 0) {
        const toolName = trace.facts.find((f) => f.a === 'toolName')?.v as string || 'Unknown Tool';
        const rationale = trace.facts.find((f) => f.a === 'rationale')?.v as string || 'No rationale provided';

        // Add an idea for each alternative or just group them
        ideas.push({
          id: `idea:unexplored_alternative:${trace.id}`,
          sourceType: 'unexplored_alternative',
          sourceEntityId: trace.id,
          title: `Alternatives for ${toolName}`,
          description: `The agent chose one path because: "${rationale}". There were ${alts.length} alternative(s) not pursued.`,
          createdAt: trace.facts.find((f) => f.a === 'timestamp')?.v as string || new Date().toISOString(),
          payload: { alternatives: alts }
        });
      }
    }

    // Sort by newest first
    return ideas.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Resurrects a rejected plan by creating a new active 'pending' replica of it.
   * Returns the new PendingPlan ID.
   */
  async resurrectPlan(ideaId: string): Promise<string> {
    const idea = this.harvestIdeas().find(i => i.id === ideaId);
    if (!idea || idea.sourceType !== 'rejected_plan') {
      throw new Error(`Cannot resurrect plan: Invalid Idea ID ${ideaId}`);
    }
    
    const oldPlan = this.kernel.listEntities('PendingPlan').find(p => p.id === idea.sourceEntityId);
    if (!oldPlan) throw new Error('Original plan not found');
    
    // Create new plan
    const newId = `plan:${Date.now()}`;
    const title = (oldPlan.facts.find(f => f.a === 'title')?.v as string) || 'Resurrected Plan';
    const ops = oldPlan.facts.find(f => f.a === 'operations')?.v as string;
    
    await this.kernel.createEntity(newId, 'PendingPlan', {
      title: `${title} (Resurrected)`,
      status: 'pending',
      operations: ops || '[]',
      createdAt: new Date().toISOString(),
    });
    
    return newId;
  }
}
