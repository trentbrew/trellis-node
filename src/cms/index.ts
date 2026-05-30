/**
 * Trellis CMS — client-side SDK for reading content collections.
 *
 * @module trellis/cms
 */

export {
  CmsClient,
  CollectionRef,
  EntryRef,
  createCmsClient,
} from './client.js';

export type {
  CmsClientOptions,
  Collection,
  Entry,
  EntryStatus,
  EntrySubscribeOptions,
  EntrySubscriber,
  FieldDefinition,
  FieldKind,
  Framework,
  GetOptions,
  ListOptions,
  ListSubscribeOptions,
  ListSubscriber,
  SubscribeExtras,
  Unsubscribe,
} from './types.js';

export { applyFormulas, evaluateFormula, parseFields } from './formula.js';
export { scaffoldConsumer, scaffoldFilename } from './scaffold.js';
export type { ScaffoldOptions } from './scaffold.js';
