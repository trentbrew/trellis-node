/**
 * Idea Garden Types
 *
 * Defines the structure for recovering abandoned threads, rejected plans,
 * and unexplored alternatives as "Recoverable Ideas".
 *
 * @module trellis/plugins/idea-garden
 */

export type IdeaSource = 'rejected_plan' | 'archived_conversation' | 'unexplored_alternative';

export interface RecoverableIdea {
  /** Unique ID for this idea view (e.g. `idea:rejected_plan:plan_123`) */
  id: string;
  sourceType: IdeaSource;
  /** The ID of the actual entity in the graph (PendingPlan, Conversation, or DecisionTrace) */
  sourceEntityId: string;
  
  title: string;
  description: string;
  createdAt: string;
  
  /** Source-specific payload data (e.g. operations for a plan, alternate text for a decision) */
  payload?: Record<string, unknown>;
}
