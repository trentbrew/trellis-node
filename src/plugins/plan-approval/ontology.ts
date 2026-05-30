/**
 * Plan Approval Ontology — Schema definitions for PendingPlan and PlannedOperation entities.
 *
 * Plans are first-class graph entities so they can be queried, linked to runs,
 * and preserved for the Idea Garden when rejected.
 *
 * @module trellis/plugins/plan-approval
 */

import type { OntologySchema } from '../../core/ontology/types.js';

export const planApprovalOntology: OntologySchema = {
  id: 'trellis:plan-approval',
  name: 'Plan Approval',
  version: '1.0.0',
  description: 'Multi-turn planning with buffered mutations and user approval',
  entities: [
    {
      name: 'PendingPlan',
      description: 'A buffered set of graph mutations awaiting user approval',
      attributes: [
        { name: 'title', type: 'string', required: true },
        { name: 'description', type: 'string' },
        {
          name: 'status',
          type: 'string',
          required: true,
          enum: ['drafting', 'submitted', 'approved', 'rejected'],
          default: 'drafting',
        },
        { name: 'submittedAt', type: 'string', description: 'ISO 8601 timestamp' },
        { name: 'resolvedAt', type: 'string', description: 'ISO 8601 timestamp' },
        { name: 'resolvedBy', type: 'string', description: 'Agent or user who approved/rejected' },
        { name: 'rejectionReason', type: 'string' },
        { name: 'operationCount', type: 'number', description: 'Number of planned operations' },
      ],
    },
    {
      name: 'PlannedOperation',
      description: 'A single buffered graph mutation within a plan',
      attributes: [
        {
          name: 'kind',
          type: 'string',
          required: true,
          enum: ['createEntity', 'updateEntity', 'deleteEntity', 'addLink', 'removeLink'],
        },
        { name: 'entityId', type: 'string', description: 'Target entity ID' },
        { name: 'entityType', type: 'string', description: 'Entity type (for createEntity)' },
        { name: 'attributes', type: 'any', description: 'JSON-serialized attributes' },
        { name: 'sourceId', type: 'string', description: 'Source entity (for link operations)' },
        { name: 'targetId', type: 'string', description: 'Target entity (for link operations)' },
        { name: 'linkAttribute', type: 'string', description: 'Link attribute name' },
        { name: 'description', type: 'string', description: 'Human-readable description of this operation' },
        { name: 'sequence', type: 'number', description: 'Execution order within the plan' },
      ],
    },
  ],
  relations: [
    {
      name: 'hasOperation',
      sourceTypes: ['PendingPlan'],
      targetTypes: ['PlannedOperation'],
      cardinality: 'many',
    },
    {
      name: 'planForRun',
      sourceTypes: ['PendingPlan'],
      targetTypes: ['AgentRun'],
      cardinality: 'one',
      description: 'Links a plan to the agent run that produced it',
    },
  ],
};
