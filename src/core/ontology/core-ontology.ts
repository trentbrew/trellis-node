/**
 * Core Ontology — Built-in structural type hierarchy
 *
 * These types are immutable and ship with the Trellis kernel.
 * They define the foundational type system that all system
 * and user ontologies extend.
 *
 * tier: 'core' — kernel rejects mutations to these schemas.
 */

import type { SchemaDefinition, PropertyValueSpecification } from './types.js';

const VERSION = '1.0.0';
type PVS = PropertyValueSpecification;

function f(
  name: string,
  valueType: PVS['valueType'],
  opts?: Partial<Omit<PVS, 'name' | 'valueType'>>,
): PVS {
  return { name, valueType, ...opts } as PVS;
}

/**
 * core:Thing — Root type. All entities inherit from Thing.
 */
const thing: SchemaDefinition = {
  '@id': 'core:Thing',
  '@type': 'trellis:Schema',
  version: VERSION,
  tier: 'core',
  label: 'Thing',
  icon: 'lucide:box',
  fields: [
    f('id', 'title', { required: true }),
    f('createdAt', 'date'),
    f('updatedAt', 'date'),
    f('createdBy', 'relation', {
      relation: { targetSchema: 'core:Member', cardinality: 'one' },
    }),
    f('tags', 'multi_select'),
  ],
};

/**
 * core:Record — Base type for data records with title/description/status.
 */
const record: SchemaDefinition = {
  '@id': 'core:Record',
  '@type': 'trellis:Schema',
  version: VERSION,
  tier: 'core',
  subClassOf: 'core:Thing',
  label: 'Record',
  icon: 'lucide:file',
  fields: [
    f('title', 'title', { required: true }),
    f('description', 'rich_text'),
    f('status', 'select'),
    f('tags', 'multi_select'),
  ],
};

/**
 * core:Document — Rich content entities (notes, files, pages).
 */
const document: SchemaDefinition = {
  '@id': 'core:Document',
  '@type': 'trellis:Schema',
  version: VERSION,
  tier: 'core',
  subClassOf: 'core:Record',
  label: 'Document',
  icon: 'lucide:file-text',
  fields: [
    f('content', 'rich_text'),
    f('mimeType', 'rich_text'),
    f('fileUrl', 'url'),
  ],
};

/**
 * core:Event — Time-bound entities (tasks, appointments, etc.).
 */
const event: SchemaDefinition = {
  '@id': 'core:Event',
  '@type': 'trellis:Schema',
  version: VERSION,
  tier: 'core',
  subClassOf: 'core:Record',
  label: 'Event',
  icon: 'lucide:calendar',
  fields: [
    f('startDate', 'date'),
    f('endDate', 'date'),
    f('location', 'rich_text'),
    f('allDay', 'checkbox'),
  ],
};

/**
 * core:Collection — Groups/organizes other entities.
 */
const collection: SchemaDefinition = {
  '@id': 'core:Collection',
  '@type': 'trellis:Schema',
  version: VERSION,
  tier: 'core',
  subClassOf: 'core:Thing',
  label: 'Collection',
  icon: 'lucide:database',
  fields: [
    f('title', 'title', { required: true }),
    f('description', 'rich_text'),
    f('icon', 'rich_text'),
    f('schema', 'rich_text'),
    f('recordType', 'relation', {
      relation: { targetSchema: 'core:Record', cardinality: 'one' },
    }),
  ],
};

/**
 * core:Tag — Classification/labeling entities.
 */
const tag: SchemaDefinition = {
  '@id': 'core:Tag',
  '@type': 'trellis:Schema',
  version: VERSION,
  tier: 'core',
  subClassOf: 'core:Thing',
  label: 'Tag',
  icon: 'lucide:tag',
  fields: [
    f('name', 'title', { required: true }),
    f('slug', 'rich_text'),
    f('color', 'rich_text'),
    f('icon', 'rich_text'),
    f('parentTag', 'relation', {
      relation: { targetSchema: 'core:Tag', cardinality: 'one' },
    }),
  ],
};

/**
 * core:Workspace — Top-level organizational unit.
 */
const workspace: SchemaDefinition = {
  '@id': 'core:Workspace',
  '@type': 'trellis:Schema',
  version: VERSION,
  tier: 'core',
  subClassOf: 'core:Thing',
  label: 'Workspace',
  icon: 'lucide:building-2',
  fields: [
    f('name', 'title', { required: true }),
    f('slug', 'rich_text'),
    f('avatar', 'files'),
    f('plan', 'select'),
  ],
};

/**
 * core:App — Application within a workspace.
 */
const app: SchemaDefinition = {
  '@id': 'core:App',
  '@type': 'trellis:Schema',
  version: VERSION,
  tier: 'core',
  subClassOf: 'core:Thing',
  label: 'App',
  icon: 'lucide:layout-grid',
  fields: [
    f('name', 'title', { required: true }),
    f('slug', 'rich_text'),
    f('icon', 'rich_text'),
    f('color', 'rich_text'),
    f('description', 'rich_text'),
    f('ontologies', 'multi_select'),
  ],
};

/**
 * core:Member — User within a workspace.
 */
const member: SchemaDefinition = {
  '@id': 'core:Member',
  '@type': 'trellis:Schema',
  version: VERSION,
  tier: 'core',
  subClassOf: 'core:Thing',
  label: 'Member',
  icon: 'lucide:user',
  fields: [
    f('name', 'title', { required: true }),
    f('email', 'email'),
    f('avatar', 'files'),
    f('role', 'select', {
      required: true,
      selectOptions: ['owner', 'admin', 'member', 'guest'],
      defaultValue: 'member',
    }),
    f('status', 'select', {
      required: true,
      selectOptions: ['pending', 'active', 'suspended'],
      defaultValue: 'pending',
    }),
    f('orgId', 'relation', {
      required: true,
      relation: { targetSchema: 'core:Workspace', cardinality: 'one' },
    }),
    f('userId', 'relation', {
      relation: { targetSchema: 'core:Person', cardinality: 'one' },
    }),
    f('invitedAt', 'date'),
    f('joinedAt', 'date'),
  ],
};

/**
 * core:Notification — In-app notification record.
 */
const notification: SchemaDefinition = {
  '@id': 'core:Notification',
  '@type': 'trellis:Schema',
  version: VERSION,
  tier: 'core',
  subClassOf: 'core:Thing',
  label: 'Notification',
  icon: 'lucide:bell',
  fields: [
    f('recipientId', 'relation', {
      required: true,
      relation: { targetSchema: 'core:Person', cardinality: 'one' },
    }),
    f('orgId', 'relation', {
      relation: { targetSchema: 'core:Workspace', cardinality: 'one' },
    }),
    f('orgName', 'rich_text'),
    f('type', 'select', {
      required: true,
      selectOptions: [
        'invite_accepted',
        'invite_sent',
        'member_joined',
        'member_removed',
        'role_changed',
        'mention',
        'comment',
        'entity_updated',
        'system',
      ],
    }),
    f('title', 'title', { required: true }),
    f('message', 'rich_text', { required: true }),
    f('actionUrl', 'url'),
    f('icon', 'rich_text'),
    f('variant', 'select', {
      selectOptions: ['default', 'success', 'warning', 'destructive', 'info'],
    }),
    f('isRead', 'checkbox', { defaultValue: false }),
    f('actorId', 'relation', {
      relation: { targetSchema: 'core:Person', cardinality: 'one' },
    }),
    f('actorName', 'rich_text'),
    f('metadata', 'rich_text'),
    f('createdAt', 'date', { required: true }),
  ],
};

/**
 * core:Share — Entity-level access grant (for guest sharing).
 */
const share: SchemaDefinition = {
  '@id': 'core:Share',
  '@type': 'trellis:Schema',
  version: VERSION,
  tier: 'core',
  subClassOf: 'core:Thing',
  label: 'Share',
  icon: 'lucide:share-2',
  fields: [
    f('entityId', 'relation', { required: true }),
    f('entityType', 'select', { selectOptions: ['entity', 'collection'] }),
    f('userId', 'relation', {
      required: true,
      relation: { targetSchema: 'core:Person', cardinality: 'one' },
    }),
    f('orgId', 'relation', {
      relation: { targetSchema: 'core:Workspace', cardinality: 'one' },
    }),
    f('permission', 'select', {
      required: true,
      selectOptions: ['view', 'comment', 'edit'],
      defaultValue: 'view',
    }),
    f('sharedBy', 'relation', {
      relation: { targetSchema: 'core:Person', cardinality: 'one' },
    }),
    f('createdAt', 'date', { required: true }),
  ],
};

/**
 * core:Person — Actor entity.
 */
const person: SchemaDefinition = {
  '@id': 'core:Person',
  '@type': 'trellis:Schema',
  version: VERSION,
  tier: 'core',
  subClassOf: 'core:Thing',
  label: 'Person',
  icon: 'lucide:user',
  fields: [f('name', 'title', { required: true })],
};

/**
 * core:Workflow — Automation/process definition.
 */
const workflow: SchemaDefinition = {
  '@id': 'core:Workflow',
  '@type': 'trellis:Schema',
  version: VERSION,
  tier: 'core',
  subClassOf: 'core:Thing',
  label: 'Workflow',
  icon: 'lucide:git-branch',
  fields: [
    f('name', 'title', { required: true }),
    f('trigger', 'rich_text'),
    f('steps', 'multi_select'),
    f('active', 'checkbox'),
  ],
};

/**
 * All core structural type schemas.
 * Auto-loaded into the kernel at construction time.
 */
export const CORE_ONTOLOGY: SchemaDefinition[] = [
  thing,
  record,
  document,
  event,
  collection,
  tag,
  workspace,
  app,
  member,
  notification,
  share,
  person,
  workflow,
];

/**
 * Core ontology version.
 */
export const CORE_VERSION = VERSION;
