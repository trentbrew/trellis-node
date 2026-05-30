/**
 * Trellis CMS Client
 *
 * Thin HTTP client for reading content collections from a Trellis-compatible store
 * (currently opencode's /store/* routes). Reads only; writes happen through the
 * IDE's CMS panel or the agent's `cms` tool.
 *
 * @example
 *   import { createCmsClient } from "trellis/cms";
 *
 *   const cms = createCmsClient({ url: "http://localhost:4096" });
 *
 *   // List published blog posts with author resolved
 *   const posts = await cms.collection("blog_post").list({
 *     status: "published",
 *     expand: ["author"],
 *   });
 *
 *   // Subscribe to live updates (polling for now, SSE later)
 *   const off = cms.collection("blog_post").subscribe((entries) => {
 *     console.log(entries);
 *   });
 *
 * @module trellis/cms
 */

import type {
  CmsClientOptions,
  Collection,
  Entry,
  EntrySubscribeOptions,
  EntrySubscriber,
  GetOptions,
  ListOptions,
  ListSubscribeOptions,
  ListSubscriber,
  Unsubscribe,
  FieldDefinition,
} from './types.js';
import {
  entryFromFacts,
  expandReferences,
  fingerprint,
  groupFactsByEntity,
  groupLinksBySource,
  typeKey,
  type RawEntity,
  type RawFact,
  type RawLink,
} from './internal.js';
import { applyFormulas, schemaFields } from './formula.js';

const DEFAULT_BASE_PATH = '/trellis/store';
const DEFAULT_POLL_MS = 2000;
const MIN_POLL_MS = 500;
const MAX_FACTS_PER_FETCH = 5000;
const MAX_ENTITIES_PER_FETCH = 1000;

const defaultEquals = (prev: unknown, next: unknown) =>
  fingerprint(prev) === fingerprint(next);

type Subscriber<T> = {
  callback: (value: T) => void;
  equals: (prev: unknown, next: unknown) => boolean;
  onError?: (err: unknown) => void;
  last?: T;
  hasLast: boolean;
};

type SharedSubscription<T> = {
  subscribers: Set<Subscriber<T>>;
  interval: ReturnType<typeof setInterval>;
  last?: T;
  hasLast: boolean;
  fetcher: () => Promise<T>;
};

export class CmsClient {
  private readonly url: string;
  private readonly basePath: string;
  private readonly directory?: string;
  readonly pollIntervalMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly apiKey?: string;
  private readonly subscriptions = new Map<
    string,
    SharedSubscription<unknown>
  >();

  constructor(opts: CmsClientOptions) {
    this.url = opts.url.replace(/\/+$/, '');
    this.basePath = (opts.basePath ?? DEFAULT_BASE_PATH).replace(/\/+$/, '');
    this.directory = opts.directory;
    this.pollIntervalMs = Math.max(
      MIN_POLL_MS,
      opts.pollIntervalMs ?? DEFAULT_POLL_MS,
    );
    this.fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.apiKey = opts.apiKey;
  }

  collection<T extends Record<string, unknown> = Record<string, unknown>>(
    key: string,
  ): CollectionRef<T> {
    return new CollectionRef<T>(this, key);
  }

  entry<T extends Record<string, unknown> = Record<string, unknown>>(
    id: string,
  ): EntryRef<T> {
    return new EntryRef<T>(this, id);
  }

  /** List CMS collections (TypeSchema entities marked cms=true). */
  async collections(): Promise<Collection[]> {
    const [entities, facts] = await Promise.all([
      this._entities(),
      this._facts(),
    ]);

    const factsByEntity = groupFactsByEntity(facts ?? []);
    const counts = new Map<string, number>();
    for (const e of entities ?? []) {
      const k = typeKey(e.type);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }

    const out = new Map<string, Collection>();

    // Explicit CMS collections (TypeSchema entities marked cms=true)
    for (const e of entities ?? []) {
      if (e.type !== 'TypeSchema') continue;
      const efacts = factsByEntity.get(e.id) ?? [];
      const isCms = efacts.some((f) => f.a === 'cms' && f.v === true);
      if (!isCms) continue;
      const name = e.id.replace(/^schema:/, '');
      const k = typeKey(name);
      const labelFact = efacts.find((f) => f.a === 'label');
      const label = typeof labelFact?.v === 'string' ? labelFact.v : name;
      out.set(k, {
        key: k,
        label,
        inferred: false,
        count: counts.get(k) ?? 0,
      });
    }

    return [...out.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  close(): void {
    for (const sub of this.subscriptions.values()) {
      clearInterval(sub.interval);
      sub.subscribers.clear();
    }
    this.subscriptions.clear();
  }

  /**
   * Shared polling subscription. Multiple subscribers to the same key share a
   * single timer and one HTTP request per poll cycle. New subscribers receive
   * the most recently fetched value immediately if one is cached.
   *
   * @internal
   */
  _share<T>(
    key: string,
    fetcher: () => Promise<T>,
    callback: (value: T) => void,
    extras: {
      equals?: (prev: unknown, next: unknown) => boolean;
      onError?: (err: unknown) => void;
    } = {},
  ): Unsubscribe {
    let sub = this.subscriptions.get(key) as SharedSubscription<T> | undefined;
    if (!sub) {
      const fresh: SharedSubscription<T> = {
        subscribers: new Set(),
        interval: undefined as unknown as ReturnType<typeof setInterval>,
        hasLast: false,
        fetcher,
      };
      const tick = async () => {
        try {
          const next = await fresh.fetcher();
          fresh.last = next;
          fresh.hasLast = true;
          for (const item of fresh.subscribers) {
            if (!item.hasLast || !item.equals(item.last, next)) {
              item.last = next;
              item.hasLast = true;
              item.callback(next);
            }
          }
        } catch (err) {
          for (const item of fresh.subscribers) item.onError?.(err);
        }
      };
      fresh.interval = setInterval(tick, this.pollIntervalMs);
      this.subscriptions.set(key, fresh as SharedSubscription<unknown>);
      sub = fresh;
      void tick();
    }
    const item: Subscriber<T> = {
      callback,
      equals: extras.equals ?? defaultEquals,
      onError: extras.onError,
      hasLast: false,
    };
    sub.subscribers.add(item);
    if (sub.hasLast) {
      item.last = sub.last;
      item.hasLast = true;
      callback(sub.last as T);
    }
    return () => {
      sub!.subscribers.delete(item);
      if (sub!.subscribers.size === 0) {
        clearInterval(sub!.interval);
        this.subscriptions.delete(key);
      }
    };
  }

  /** @internal */
  async _get<T>(path: string): Promise<T | undefined> {
    const u = new URL(`${this.basePath}${path}`, this.url);
    if (this.directory && !u.searchParams.has('directory')) {
      u.searchParams.set('directory', this.directory);
    }
    const res = await this.fetchFn(u.toString(), {
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
    });
    if (res.status === 404) return undefined;
    if (!res.ok)
      throw new Error(
        `Trellis CMS request failed (${res.status}) ${u.pathname}`,
      );
    const kind = res.headers.get('content-type') ?? '';
    const text = await res.text();
    if (!kind.toLowerCase().includes('application/json')) {
      throw new Error(
        `Trellis CMS expected JSON (${res.status}) ${u.pathname}: ${text.slice(0, 120)}`,
      );
    }
    try {
      return JSON.parse(text) as T;
    } catch (err) {
      throw new Error(
        `Trellis CMS invalid JSON (${res.status}) ${u.pathname}: ${text.slice(0, 120)}`,
        { cause: err },
      );
    }
  }

  /** @internal */
  async _entities(): Promise<RawEntity[]> {
    const out: RawEntity[] = [];
    let offset = 0;
    while (true) {
      const page =
        (await this._get<RawEntity[]>(
          `/entities?limit=${MAX_ENTITIES_PER_FETCH}&offset=${offset}`,
        )) ?? [];
      out.push(...page);
      if (page.length < MAX_ENTITIES_PER_FETCH) return out;
      offset += MAX_ENTITIES_PER_FETCH;
    }
  }

  async _facts(): Promise<RawFact[]> {
    const out: RawFact[] = [];
    let offset = 0;
    while (true) {
      const page =
        (await this._get<RawFact[]>(
          `/facts?limit=${MAX_FACTS_PER_FETCH}&offset=${offset}`,
        )) ?? [];
      out.push(...page);
      if (page.length < MAX_FACTS_PER_FETCH) return out;
      offset += MAX_FACTS_PER_FETCH;
    }
  }

  /** @internal */
  async _entryById(id: string, schemaFacts?: RawFact[]): Promise<Entry | null> {
    const detail = await this._get<{
      id: string;
      facts: RawFact[];
      links?: RawLink[];
    }>(`/entity/${encodeURIComponent(id)}`);
    if (!detail) return null;
    const typeFact = detail.facts.find((f) => f.a === 'type');
    const type = typeof typeFact?.v === 'string' ? typeFact.v : 'unknown';
    const facts = schemaFacts ?? (await this._facts()) ?? [];
    return applyFormulas(
      entryFromFacts({ id: detail.id, type }, detail.facts, detail.links),
      schemaFields(facts, [type]),
    );
  }
}

export class CollectionRef<
  T extends Record<string, unknown> = Record<string, unknown>,
> {
  constructor(
    private readonly client: CmsClient,
    readonly key: string,
  ) {}

  async list(opts: ListOptions = {}): Promise<Entry<T>[]> {
    const status = opts.status ?? 'published';
    const limit = opts.limit ?? 100;
    const wantsExpand = opts.expand && opts.expand.length > 0;

    // Fetch all entities (no server-side type filter) and match by normalized
    // key client-side. Avoids case-sensitivity mismatch between normalized
    // collection keys (lowercase) and stored entity types (canonical case).
    const [allEntities, facts, links] = await Promise.all([
      this.client._entities(),
      this.client._facts(),
      this.client._get<RawLink[]>(`/links`),
    ]);

    if (!allEntities) return [];
    const wantedKey = typeKey(this.key);
    const matching = allEntities.filter((e) => typeKey(e.type) === wantedKey);
    if (matching.length === 0) return [];

    const factsByEntity = groupFactsByEntity(facts ?? []);
    const linksBySource = groupLinksBySource(links ?? []);
    const defs = schemaFields(facts ?? [], [
      this.key,
      ...matching.map((e) => e.type),
    ]);

    let entries = matching.map((e) =>
      applyFormulas(
        entryFromFacts(
          e,
          factsByEntity.get(e.id) ?? [],
          linksBySource.get(e.id) ?? [],
        ),
        defs,
      ),
    ) as Entry<T>[];

    if (status !== 'all') {
      entries = entries.filter((e) => e.status === status);
    }

    entries = entries.slice(0, limit);

    if (wantsExpand) {
      entries = (await expandReferences(entries, opts.expand!, (id) =>
        this.client._entryById(id, facts ?? []),
      )) as Entry<T>[];
    }

    return entries;
  }

  async get(id: string, opts: GetOptions = {}): Promise<Entry<T> | null> {
    const entry = (await this.client._entryById(id)) as Entry<T> | null;
    if (!entry) return null;
    if (opts.expand && opts.expand.length > 0) {
      const [expanded] = await expandReferences([entry], opts.expand, (eid) =>
        this.client._entryById(eid),
      );
      return expanded as Entry<T>;
    }
    return entry;
  }

  /**
   * Subscribe to changes. Currently implemented as polling; a future SSE-backed
   * upgrade will replace the transport without changing this API.
   *
   * Multiple subscribers to the same collection + opts share one polling timer
   * and one HTTP request per cycle.
   */
  subscribe(
    callback: ListSubscriber<T>,
    opts: ListSubscribeOptions = {},
  ): Unsubscribe {
    const { onError, equals, ...listOpts } = opts;
    const key = `coll:${typeKey(this.key)}:${JSON.stringify(listOpts)}`;
    return this.client._share<Entry<T>[]>(
      key,
      () => this.list(listOpts),
      callback,
      { onError, equals },
    );
  }

  async schema(): Promise<FieldDefinition[]> {
    const facts = await this.client._facts();
    return schemaFields(facts ?? [], [this.key]);
  }
}

export class EntryRef<
  T extends Record<string, unknown> = Record<string, unknown>,
> {
  constructor(
    private readonly client: CmsClient,
    readonly id: string,
  ) {}

  async get(opts: GetOptions = {}): Promise<Entry<T> | null> {
    const entry = (await this.client._entryById(this.id)) as Entry<T> | null;
    if (!entry) return null;
    if (opts.expand && opts.expand.length > 0) {
      const [expanded] = await expandReferences([entry], opts.expand, (eid) =>
        this.client._entryById(eid),
      );
      return expanded as Entry<T>;
    }
    return entry;
  }

  subscribe(
    callback: EntrySubscriber<T>,
    opts: EntrySubscribeOptions = {},
  ): Unsubscribe {
    const { onError, equals, ...getOpts } = opts;
    const key = `entry:${this.id}:${JSON.stringify(getOpts)}`;
    return this.client._share<Entry<T> | null>(
      key,
      () => this.get(getOpts),
      callback,
      { onError, equals },
    );
  }
}

export function createCmsClient(opts: CmsClientOptions): CmsClient {
  return new CmsClient(opts);
}
