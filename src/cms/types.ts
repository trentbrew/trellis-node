/**
 * Trellis CMS Client — public types
 *
 * @module trellis/cms
 */

export type EntryStatus = 'draft' | 'published';

export type FieldKind =
  | 'text'
  | 'rich_text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'email'
  | 'url'
  | 'color'
  | 'select'
  | 'multiselect'
  | 'file'
  | 'formula'
  | 'reference'
  | 'image'
  | 'video'
  | 'audio';

export type DateRepeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export type FieldDefinition = {
  key: string;
  label?: string;
  type: FieldKind;
  required?: boolean;
  default?: string;
  options?: string[];
  formula?: string;
  target?: string;
  min?: number;
  max?: number;
  step?: number;
  repeat?: DateRepeat;
};

export type Entry<T extends Record<string, unknown> = Record<string, unknown>> =
  {
    /** Stable entity id (e.g. "blog_post:abc123" or "BlogPost:abc"). */
    id: string;
    /** Original type string as stored on the entity (e.g. "BlogPost"). */
    type: string;
    /** "draft" or "published". Missing cms_status fact is treated as "draft". */
    status: EntryStatus;
    /** All other facts as a flat field bag. Reference fields hold entity ids until expanded. */
    fields: T;
  };

export type ListOptions = {
  /** Filter by status. Default: "published". Use "all" to include drafts. */
  status?: 'all' | EntryStatus;
  /** Field keys to resolve as references — string ids become nested Entry objects. */
  expand?: string[];
  /** Max results. Default: 100. */
  limit?: number;
};

export type GetOptions = {
  expand?: string[];
};

export type SubscribeExtras = {
  /** Called when a poll fails. If absent, errors are silently swallowed. */
  onError?: (err: unknown) => void;
  /**
   * Custom equality check between consecutive results. Default: deep JSON
   * comparison. Override with a faster check (e.g. id/version-based) for
   * very large payloads.
   */
  equals?: (prev: unknown, next: unknown) => boolean;
};

export type ListSubscribeOptions = ListOptions & SubscribeExtras;
export type EntrySubscribeOptions = GetOptions & SubscribeExtras;

export type Unsubscribe = () => void;
export type ListSubscriber<
  T extends Record<string, unknown> = Record<string, unknown>,
> = (entries: Entry<T>[]) => void;
export type EntrySubscriber<
  T extends Record<string, unknown> = Record<string, unknown>,
> = (entry: Entry<T> | null) => void;

export type Collection = {
  /** Normalized lowercase key (e.g. "blog_post"). */
  key: string;
  /** Human-readable label. */
  label: string;
  /** Always false — kept for SDK compatibility. Collections require TypeSchema + cms=true. */
  inferred: boolean;
  /** Total entry count (all statuses). */
  count: number;
};

export type CmsClientOptions = {
  /** Base URL of the Trellis-compatible HTTP server (e.g. opencode at "http://localhost:4096"). */
  url: string;
  /**
   * Path prefix for store routes. Default: "/trellis/store" (matches opencode).
   * Override only if pointing at a different server layout.
   */
  basePath?: string;
  /**
   * Project directory for multi-instance backends (opencode requires this).
   * If omitted, the request goes to the default instance.
   */
  directory?: string;
  /** Polling interval in ms for subscribe(). Minimum 500ms. Default: 2000. */
  pollIntervalMs?: number;
  /** Custom fetch implementation (for SSR / Node environments without global fetch). */
  fetch?: typeof fetch;
  /** Optional bearer token for authenticated routes. */
  apiKey?: string;
};

export type Framework = 'vanilla' | 'react' | 'solid' | 'vue';
