/**
 * Trellis React — Public API Surface
 *
 * Reactive hooks for building UIs on top of the Trellis Agentic State Engine.
 * Import from `trellis/react`:
 *
 *   import { TrellisProvider, useEntity, useQuery, useMutation } from 'trellis/react';
 *
 * @module trellis/react
 */

export { TrellisProvider, useTrellis } from './provider.js';
export type { TrellisProviderProps } from './provider.js';

export {
  useEntity,
  useEntities,
  useQuery,
  useMutation,
} from './hooks.js';
export type {
  AsyncState,
  UseEntityOptions,
  UseEntityResult,
  UseEntitiesOptions,
  UseEntitiesResult,
  UseQueryOptions,
  UseQueryResult,
  UseMutationResult,
} from './hooks.js';
