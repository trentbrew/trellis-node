/**
 * Built-in Ontology Definitions
 *
 * Pre-defined ontologies for common domain models:
 *   - Project: software project management entities
 *   - Team: team/developer organizational entities
 *   - Agent: AI agent entities for the agent harness
 *
 * @module trellis/core/ontology
 */

import type { OntologySchema } from './types.js';

// ---------------------------------------------------------------------------
// Project Ontology
// ---------------------------------------------------------------------------

export const projectOntology: OntologySchema = {
  id: 'trellis:project',
  name: 'Project Ontology',
  version: '1.0.0',
  description: 'Entity types for software project management.',
  entities: [
    {
      name: 'Project',
      description: 'A software project or repository.',
      attributes: [
        { name: 'name', type: 'string', required: true, description: 'Project name' },
        { name: 'description', type: 'string', description: 'Project description' },
        { name: 'status', type: 'string', enum: ['active', 'archived', 'draft', 'deprecated'], default: 'active' },
        { name: 'url', type: 'string', description: 'Project URL or repository link' },
        { name: 'language', type: 'string', description: 'Primary programming language' },
        { name: 'createdAt', type: 'date', description: 'Creation timestamp' },
        { name: 'updatedAt', type: 'date', description: 'Last update timestamp' },
      ],
    },
    {
      name: 'Module',
      description: 'A logical module or package within a project.',
      attributes: [
        { name: 'name', type: 'string', required: true },
        { name: 'path', type: 'string', description: 'Filesystem path relative to project root' },
        { name: 'description', type: 'string' },
      ],
    },
    {
      name: 'Feature',
      description: 'A product feature or capability.',
      attributes: [
        { name: 'name', type: 'string', required: true },
        { name: 'description', type: 'string' },
        { name: 'status', type: 'string', enum: ['planned', 'in-progress', 'shipped', 'cut'], default: 'planned' },
        { name: 'priority', type: 'string', enum: ['critical', 'high', 'medium', 'low'], default: 'medium' },
      ],
    },
    {
      name: 'Dependency',
      description: 'An external dependency or library.',
      attributes: [
        { name: 'name', type: 'string', required: true },
        { name: 'version', type: 'string' },
        { name: 'registry', type: 'string', description: 'Package registry (npm, pypi, etc.)' },
        { name: 'scope', type: 'string', enum: ['runtime', 'dev', 'optional'], default: 'runtime' },
      ],
    },
    {
      name: 'Config',
      description: 'A configuration entry or setting.',
      attributes: [
        { name: 'key', type: 'string', required: true },
        { name: 'value', type: 'any', required: true },
        { name: 'description', type: 'string' },
        { name: 'scope', type: 'string', enum: ['project', 'user', 'system'], default: 'project' },
      ],
    },
    {
      name: 'Artifact',
      description: 'A build artifact, release asset, or output file.',
      attributes: [
        { name: 'name', type: 'string', required: true },
        { name: 'path', type: 'string' },
        { name: 'size', type: 'number' },
        { name: 'hash', type: 'string' },
        { name: 'format', type: 'string' },
      ],
    },
    {
      name: 'Release',
      description: 'A versioned release of a project.',
      attributes: [
        { name: 'version', type: 'string', required: true },
        { name: 'tag', type: 'string' },
        { name: 'date', type: 'date' },
        { name: 'notes', type: 'string' },
        { name: 'status', type: 'string', enum: ['draft', 'published', 'yanked'], default: 'draft' },
      ],
    },
  ],
  relations: [
    { name: 'contains', sourceTypes: ['Project'], targetTypes: ['Module', 'Feature', 'Config'], cardinality: 'many', description: 'Project contains modules/features/configs' },
    { name: 'dependsOn', sourceTypes: ['Project', 'Module'], targetTypes: ['Dependency', 'Module', 'Project'], cardinality: 'many', description: 'Depends on another entity' },
    { name: 'implementedBy', sourceTypes: ['Feature'], targetTypes: ['Module'], cardinality: 'many', description: 'Feature is implemented by modules' },
    { name: 'produces', sourceTypes: ['Project', 'Release'], targetTypes: ['Artifact'], cardinality: 'many', description: 'Produces artifacts' },
    { name: 'releases', sourceTypes: ['Project'], targetTypes: ['Release'], cardinality: 'many', description: 'Project has releases' },
  ],
};

// ---------------------------------------------------------------------------
// Team / Developer Ontology
// ---------------------------------------------------------------------------

export const teamOntology: OntologySchema = {
  id: 'trellis:team',
  name: 'Team Ontology',
  version: '1.0.0',
  description: 'Entity types for team and developer organization.',
  entities: [
    {
      name: 'Team',
      description: 'A team or organizational group.',
      attributes: [
        { name: 'name', type: 'string', required: true },
        { name: 'description', type: 'string' },
        { name: 'slug', type: 'string', description: 'URL-safe identifier' },
      ],
    },
    {
      name: 'Developer',
      description: 'A developer or contributor.',
      attributes: [
        { name: 'name', type: 'string', required: true },
        { name: 'email', type: 'string' },
        { name: 'handle', type: 'string', description: 'Username or handle' },
        { name: 'role', type: 'string', enum: ['admin', 'maintainer', 'contributor', 'reviewer'] },
      ],
    },
    {
      name: 'Role',
      description: 'A named role with specific permissions.',
      attributes: [
        { name: 'name', type: 'string', required: true },
        { name: 'description', type: 'string' },
        { name: 'permissions', type: 'string', unique: false, description: 'Permission strings (multi-valued)' },
      ],
    },
    {
      name: 'Capability',
      description: 'A skill or capability.',
      attributes: [
        { name: 'name', type: 'string', required: true },
        { name: 'category', type: 'string' },
        { name: 'level', type: 'string', enum: ['beginner', 'intermediate', 'advanced', 'expert'] },
      ],
    },
  ],
  relations: [
    { name: 'hasMember', sourceTypes: ['Team'], targetTypes: ['Developer'], cardinality: 'many', inverse: 'memberOf', description: 'Team has member' },
    { name: 'memberOf', sourceTypes: ['Developer'], targetTypes: ['Team'], cardinality: 'many', inverse: 'hasMember', description: 'Developer is member of team' },
    { name: 'owns', sourceTypes: ['Developer'], targetTypes: ['Project', 'Module'], cardinality: 'many', description: 'Developer owns/maintains' },
    { name: 'reviewsFor', sourceTypes: ['Developer'], targetTypes: ['Project', 'Module'], cardinality: 'many', description: 'Developer reviews for' },
    { name: 'hasCapability', sourceTypes: ['Developer'], targetTypes: ['Capability'], cardinality: 'many', description: 'Developer has capability' },
    { name: 'hasRole', sourceTypes: ['Developer'], targetTypes: ['Role'], cardinality: 'many', description: 'Developer has role' },
    { name: 'assignedTo', sourceTypes: ['Developer'], targetTypes: ['Feature'], cardinality: 'many', description: 'Developer is assigned to feature' },
  ],
};

// ---------------------------------------------------------------------------
// Agent Ontology
// ---------------------------------------------------------------------------

export const agentOntology: OntologySchema = {
  id: 'trellis:agent',
  name: 'Agent Ontology',
  version: '1.0.0',
  description: 'Entity types for AI agents, runs, plans, and tools.',
  entities: [
    {
      name: 'Agent',
      description: 'An AI agent definition.',
      attributes: [
        { name: 'name', type: 'string', required: true },
        { name: 'description', type: 'string' },
        { name: 'model', type: 'string', description: 'LLM model identifier' },
        { name: 'provider', type: 'string', description: 'LLM provider (openai, anthropic, local, etc.)' },
        { name: 'systemPrompt', type: 'string' },
        { name: 'status', type: 'string', enum: ['active', 'inactive', 'deprecated'], default: 'active' },
      ],
    },
    {
      name: 'AgentCapability',
      description: 'A capability or skill an agent possesses.',
      attributes: [
        { name: 'name', type: 'string', required: true },
        { name: 'description', type: 'string' },
        { name: 'category', type: 'string' },
      ],
    },
    {
      name: 'AgentRun',
      description: 'A single execution run of an agent.',
      attributes: [
        { name: 'startedAt', type: 'date', required: true },
        { name: 'completedAt', type: 'date' },
        { name: 'status', type: 'string', enum: ['running', 'completed', 'failed', 'cancelled'], default: 'running' },
        { name: 'input', type: 'string' },
        { name: 'output', type: 'string' },
        { name: 'totalTokens', type: 'number' },
        { name: 'promptTokens', type: 'number' },
        { name: 'completionTokens', type: 'number' },
      ],
    },
    {
      name: 'AgentPlan',
      description: 'A plan or strategy created by an agent.',
      attributes: [
        { name: 'title', type: 'string', required: true },
        { name: 'description', type: 'string' },
        { name: 'status', type: 'string', enum: ['draft', 'active', 'completed', 'abandoned'], default: 'draft' },
      ],
    },
    {
      name: 'Tool',
      description: 'A tool available to agents.',
      attributes: [
        { name: 'name', type: 'string', required: true },
        { name: 'description', type: 'string' },
        { name: 'schema', type: 'string', description: 'JSON schema for tool parameters' },
        { name: 'endpoint', type: 'string' },
      ],
    },
  ],
  relations: [
    { name: 'hasCapability', sourceTypes: ['Agent'], targetTypes: ['AgentCapability'], cardinality: 'many' },
    { name: 'hasTool', sourceTypes: ['Agent'], targetTypes: ['Tool'], cardinality: 'many' },
    { name: 'executedBy', sourceTypes: ['AgentRun'], targetTypes: ['Agent'], cardinality: 'one' },
    { name: 'hasPlan', sourceTypes: ['AgentRun'], targetTypes: ['AgentPlan'], cardinality: 'many' },
    { name: 'usedTool', sourceTypes: ['AgentRun'], targetTypes: ['Tool'], cardinality: 'many' },
    { name: 'createdBy', sourceTypes: ['AgentPlan'], targetTypes: ['Agent'], cardinality: 'one' },
  ],
};

// ---------------------------------------------------------------------------
// All built-in ontologies
// ---------------------------------------------------------------------------

export const builtinOntologies: OntologySchema[] = [
  projectOntology,
  teamOntology,
  agentOntology,
];
