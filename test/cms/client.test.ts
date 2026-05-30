import { describe, expect, test } from 'vitest';
import { CmsClient, createCmsClient } from '../../src/cms/client.js';

type FetchInput = Parameters<typeof fetch>[0];

function mockFetch(
  handler: (path: string, search: URLSearchParams) => unknown,
) {
  const calls: string[] = [];
  const fn: typeof fetch = (async (input: FetchInput) => {
    const url = new URL(
      typeof input === 'string' ? input : (input as Request).url,
    );
    calls.push(url.pathname + url.search);
    const body = handler(url.pathname, url.searchParams);
    return new Response(JSON.stringify(body ?? []), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const FIXTURE_ENTITIES = [
  { id: 'post:1', type: 'BlogPost' },
  { id: 'post:2', type: 'BlogPost' },
  { id: 'author:1', type: 'Author' },
  { id: 'issue:1', type: 'Issue' }, // system type, should be filtered out
];

const FIXTURE_FACTS = [
  { e: 'post:1', a: 'type', v: 'BlogPost' },
  { e: 'post:1', a: 'title', v: 'First' },
  { e: 'post:1', a: 'cms_status', v: 'published' },
  { e: 'post:2', a: 'type', v: 'BlogPost' },
  { e: 'post:2', a: 'title', v: 'Second' },
  { e: 'post:2', a: 'status', v: 'draft' }, // legacy: no cms_status, status fallback
  { e: 'author:1', a: 'type', v: 'Author' },
  { e: 'author:1', a: 'name', v: 'Jane' },
];

const FIXTURE_LINKS = [{ e1: 'post:1', a: 'author', e2: 'author:1' }];

function makeClient(extra?: Partial<Parameters<typeof createCmsClient>[0]>) {
  const { fn, calls } = mockFetch((path) => {
    if (path.endsWith('/entities')) return FIXTURE_ENTITIES;
    if (path.endsWith('/facts')) return FIXTURE_FACTS;
    if (path.endsWith('/links')) return FIXTURE_LINKS;
    return [];
  });
  const client = createCmsClient({
    url: 'http://localhost:9999',
    fetch: fn,
    pollIntervalMs: 500,
    ...extra,
  });
  return { client, calls };
}

describe('CollectionRef.list — case-insensitive lookup', () => {
  test("lowercase 'blogpost' key matches stored type 'BlogPost'", async () => {
    const { client } = makeClient();
    const posts = await client.collection('blogpost').list({ status: 'all' });
    expect(posts.length).toBe(2);
    expect(posts.map((p) => p.id).sort()).toEqual(['post:1', 'post:2']);
  });

  test("canonical 'BlogPost' key also works (idempotent)", async () => {
    const { client } = makeClient();
    const posts = await client.collection('BlogPost').list({ status: 'all' });
    expect(posts.length).toBe(2);
  });

  test('default status filter is "published"', async () => {
    const { client } = makeClient();
    const posts = await client.collection('blogpost').list();
    // post:1 is cms_status=published; post:2 is status=draft (fallback)
    expect(posts.length).toBe(1);
    expect(posts[0]!.id).toBe('post:1');
  });

  test('status fallback: legacy `status` fact picks up draft', async () => {
    const { client } = makeClient();
    const drafts = await client
      .collection('blogpost')
      .list({ status: 'draft' });
    expect(drafts.length).toBe(1);
    expect(drafts[0]!.id).toBe('post:2');
  });
});

describe('CollectionRef.list — link-aware reference expansion', () => {
  test('graph link populates the `author` field', async () => {
    const { client } = makeClient();
    const [post] = await client
      .collection('blogpost')
      .list({ status: 'published' });
    expect(post!.fields.author).toBe('author:1');
  });
});

describe('CollectionRef.list — virtual formula fields', () => {
  const entities = [
    { id: 'post:1', type: 'BlogPost' },
    { id: 'schema:blog_post', type: 'TypeSchema' },
  ];
  const props = JSON.stringify([
    { key: 'margin', type: 'formula', formula: '{total} - {cost}' },
    { key: 'total', type: 'formula', formula: '{price} * {quantity}' },
    { key: 'bad', type: 'formula', formula: 'globalThis.process.exit()' },
  ]);
  const facts = [
    { e: 'post:1', a: 'type', v: 'BlogPost' },
    { e: 'post:1', a: 'cms_status', v: 'published' },
    { e: 'post:1', a: 'price', v: 10 },
    { e: 'post:1', a: 'quantity', v: '3' },
    { e: 'post:1', a: 'cost', v: 12 },
    { e: 'post:1', a: 'total', v: 999 },
    { e: 'schema:blog_post', a: 'type', v: 'TypeSchema' },
    { e: 'schema:blog_post', a: 'cms', v: true },
    { e: 'schema:blog_post', a: 'props', v: props },
  ];

  function makeFormulaClient() {
    const { fn, calls } = mockFetch((path) => {
      if (path.endsWith('/entities')) return entities;
      if (path.endsWith('/facts')) return facts;
      if (path.endsWith('/links')) return [];
      if (path.includes('/entity/')) {
        const id = decodeURIComponent(path.split('/').at(-1)!);
        return { id, facts: facts.filter((f) => f.e === id), links: [] };
      }
      return [];
    });
    const client = createCmsClient({
      url: 'http://localhost:9999',
      fetch: fn,
      pollIntervalMs: 500,
    });
    return { client, calls };
  }

  test('computes formula fields from schema props in collection reads', async () => {
    const { client } = makeFormulaClient();
    const [post] = await client.collection('BlogPost').list();
    expect(post!.fields.total).toBe(30);
    expect(post!.fields.margin).toBe(18);
    expect(post!.fields.bad).toBeUndefined();
  });

  test('computes formula fields for entry reads', async () => {
    const { client, calls } = makeFormulaClient();
    const post = await client.entry('post:1').get();
    expect(post!.fields.total).toBe(30);
    expect(calls.some((c) => c.includes('/facts?limit=5000'))).toBe(true);
  });
});

describe('CollectionRef.list — pagination and response validation', () => {
  test('reads facts across multiple pages', async () => {
    const facts = [
      ...Array.from({ length: 5000 }, (_, i) => ({
        e: `noise:${i}`,
        a: 'type',
        v: 'Noise',
      })),
      { e: 'post:late', a: 'type', v: 'BlogPost' },
      { e: 'post:late', a: 'cms_status', v: 'published' },
      { e: 'post:late', a: 'title', v: 'Late' },
    ];
    const { fn, calls } = mockFetch((path, search) => {
      if (path.endsWith('/entities')) return [{ id: 'post:late', type: 'BlogPost' }];
      if (path.endsWith('/links')) return [];
      if (path.endsWith('/facts')) {
        const offset = Number(search.get('offset') ?? 0);
        const limit = Number(search.get('limit') ?? 5000);
        return facts.slice(offset, offset + limit);
      }
      return [];
    });
    const client = createCmsClient({ url: 'http://localhost:9999', fetch: fn });
    const posts = await client.collection('blogpost').list();
    expect(posts.length).toBe(1);
    expect(posts[0]!.fields.title).toBe('Late');
    expect(calls).toContain('/trellis/store/facts?limit=5000&offset=0');
    expect(calls).toContain('/trellis/store/facts?limit=5000&offset=5000');
  });

  test('reports non-JSON responses clearly', async () => {
    const fn: typeof fetch = (async () =>
      new Response('<!doctype html><title>App</title>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })) as unknown as typeof fetch;
    const client = createCmsClient({ url: 'http://localhost:9999', fetch: fn });
    await expect(client.collection('blogpost').list()).rejects.toThrow(
      'Trellis CMS expected JSON',
    );
  });
});

describe('CmsClient.collections — explicit CMS schemas', () => {
  test('returns only TypeSchema collections marked cms=true', async () => {
    const entities = [
      ...FIXTURE_ENTITIES,
      { id: 'schema:blogpost', type: 'TypeSchema' },
      { id: 'schema:author', type: 'TypeSchema' },
      { id: 'schema:issue', type: 'TypeSchema' },
    ];
    const facts = [
      ...FIXTURE_FACTS,
      { e: 'schema:blogpost', a: 'type', v: 'TypeSchema' },
      { e: 'schema:blogpost', a: 'cms', v: true },
      { e: 'schema:blogpost', a: 'label', v: 'Blog Post' },
      { e: 'schema:author', a: 'type', v: 'TypeSchema' },
      { e: 'schema:author', a: 'cms', v: true },
      { e: 'schema:author', a: 'label', v: 'Author' },
      { e: 'schema:issue', a: 'type', v: 'TypeSchema' },
      { e: 'schema:issue', a: 'label', v: 'Issue' },
    ];
    const { fn } = mockFetch((path) => {
      if (path.endsWith('/entities')) return entities;
      if (path.endsWith('/facts')) return facts;
      if (path.endsWith('/links')) return FIXTURE_LINKS;
      return [];
    });
    const client = createCmsClient({
      url: 'http://localhost:9999',
      fetch: fn,
      pollIntervalMs: 500,
    });
    const collections = await client.collections();
    const keys = collections.map((c) => c.key).sort();
    expect(keys).toEqual(['author', 'blogpost']);
    expect(keys).not.toContain('issue');
    const blogpost = collections.find((c) => c.key === 'blogpost');
    expect(blogpost?.inferred).toBe(false);
    expect(blogpost?.label).toBe('Blog Post');
    client.close();
  });

  test('uses the server-compatible entity page size', async () => {
    const { client, calls } = makeClient();
    await client.collections();
    expect(calls.some((c) => c.includes('/entities?limit=1000&offset=0'))).toBe(
      true,
    );
  });
});

describe('subscribe — shared poll dedup', () => {
  test('multiple subscribers to the same collection share one timer', async () => {
    const { client, calls } = makeClient({ pollIntervalMs: 500 });
    const got: number[] = [];
    const off1 = client
      .collection('blogpost')
      .subscribe((entries) => got.push(entries.length));
    const off2 = client
      .collection('blogpost')
      .subscribe((entries) => got.push(entries.length));
    // wait for initial tick
    await new Promise((r) => setTimeout(r, 100));
    off1();
    off2();
    client.close();

    // Both subscribers should have received the initial fetch result.
    expect(got.length).toBeGreaterThanOrEqual(2);
    // Should have made one set of fetches (entities + facts + links), not two.
    // With dedup, subscriber #2 just gets the cached `last` immediately.
    const entityCalls = calls.filter((c) => c.includes('/entities')).length;
    expect(entityCalls).toBe(1);
  });

  test('different opts produce independent subscriptions', async () => {
    const { client, calls } = makeClient({ pollIntervalMs: 500 });
    const off1 = client
      .collection('blogpost')
      .subscribe(() => {}, { status: 'all' });
    const off2 = client
      .collection('blogpost')
      .subscribe(() => {}, { status: 'published' });
    await new Promise((r) => setTimeout(r, 100));
    off1();
    off2();
    client.close();

    // Two distinct opts → two separate fetch streams.
    const entityCalls = calls.filter((c) => c.includes('/entities')).length;
    expect(entityCalls).toBe(2);
  });

  test('onError is invoked when fetch throws', async () => {
    let errorCount = 0;
    const failingFetch: typeof fetch = (async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    const client = createCmsClient({
      url: 'http://localhost:9999',
      fetch: failingFetch,
      pollIntervalMs: 500,
    });
    const off = client
      .collection('blogpost')
      .subscribe(() => {}, { onError: () => errorCount++ });
    await new Promise((r) => setTimeout(r, 100));
    off();
    client.close();
    expect(errorCount).toBeGreaterThanOrEqual(1);
  });

  test('onError is tracked per subscriber on shared subscriptions', async () => {
    let first = 0;
    let second = 0;
    const failingFetch: typeof fetch = (async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    const client = createCmsClient({
      url: 'http://localhost:9999',
      fetch: failingFetch,
      pollIntervalMs: 500,
    });
    const off1 = client
      .collection('blogpost')
      .subscribe(() => {}, { onError: () => first++ });
    const off2 = client
      .collection('blogpost')
      .subscribe(() => {}, { onError: () => second++ });
    await new Promise((r) => setTimeout(r, 100));
    off1();
    off2();
    client.close();
    expect(first).toBeGreaterThanOrEqual(1);
    expect(second).toBeGreaterThanOrEqual(1);
  });

  test('equals is tracked per subscriber on shared subscriptions', async () => {
    let tick = 0;
    const { fn } = mockFetch((path) => {
      if (path.endsWith('/entities')) return FIXTURE_ENTITIES;
      if (path.endsWith('/links')) return FIXTURE_LINKS;
      if (path.endsWith('/facts')) {
        tick++;
        return FIXTURE_FACTS.map((f) =>
          f.e === 'post:1' && f.a === 'title'
            ? { ...f, v: `First ${tick}` }
            : f,
        );
      }
      return [];
    });
    const client = createCmsClient({
      url: 'http://localhost:9999',
      fetch: fn,
      pollIntervalMs: 500,
    });
    let normal = 0;
    let stable = 0;
    const off1 = client
      .collection('blogpost')
      .subscribe(() => normal++, { status: 'all' });
    const off2 = client
      .collection('blogpost')
      .subscribe(() => stable++, { status: 'all', equals: () => true });
    await new Promise((r) => setTimeout(r, 650));
    off1();
    off2();
    client.close();
    expect(normal).toBeGreaterThan(1);
    expect(stable).toBe(1);
  });
});

describe('CollectionRef.schema', () => {
  const facts = [
    { e: 'schema:post', a: 'type', v: 'TypeSchema' },
    { e: 'schema:post', a: 'cms', v: true },
    {
      e: 'schema:post',
      a: 'props',
      v: JSON.stringify([
        { key: 'title', type: 'text', required: true },
        { key: 'image', type: 'image' },
      ]),
    },
  ];

  test('returns the field definitions for a collection', async () => {
    const { fn } = mockFetch((path) => {
      if (path.includes('/facts')) return facts;
      return [];
    });
    const client = createCmsClient({ url: 'http://localhost:9999', fetch: fn });
    const schema = await client.collection('post').schema();
    expect(schema.length).toBe(2);
    expect(schema[0]!.key).toBe('title');
    expect(schema[0]!.type).toBe('text');
    expect(schema[1]!.key).toBe('image');
    expect(schema[1]!.type).toBe('image');
  });
});
