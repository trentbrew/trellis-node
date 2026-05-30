import { describe, expect, test } from 'vitest';
import {
  entryFromFacts,
  expandReferences,
  fingerprint,
  groupFactsByEntity,
  groupLinksBySource,
  isSystemType,
  typeKey,
  type RawFact,
  type RawLink,
} from '../../src/cms/internal.js';
import type { Entry } from '../../src/cms/types.js';

describe('typeKey + isSystemType', () => {
  test('typeKey lowercases and trims', () => {
    expect(typeKey('  BlogPost  ')).toBe('blogpost');
    expect(typeKey('blog_post')).toBe('blog_post');
    expect(typeKey('AUTHOR')).toBe('author');
  });

  test('isSystemType matches case-insensitively', () => {
    expect(isSystemType('issue')).toBe(true);
    expect(isSystemType('Issue')).toBe(true);
    expect(isSystemType('TypeSchema')).toBe(true);
    expect(isSystemType('field')).toBe(true);
    expect(isSystemType('BlogPost')).toBe(false);
    expect(isSystemType('Author')).toBe(false);
  });
});

describe('entryFromFacts — status detection', () => {
  test('cms_status=published wins', () => {
    const e = entryFromFacts(
      { id: 'p1', type: 'BlogPost' },
      [
        { e: 'p1', a: 'cms_status', v: 'published' },
        { e: 'p1', a: 'title', v: 'Hello' },
      ],
    );
    expect(e.status).toBe('published');
    expect(e.fields.title).toBe('Hello');
  });

  test('cms_status=draft (or missing) defaults to draft', () => {
    const e1 = entryFromFacts({ id: 'p1', type: 'BlogPost' }, [
      { e: 'p1', a: 'cms_status', v: 'draft' },
    ]);
    expect(e1.status).toBe('draft');

    const e2 = entryFromFacts({ id: 'p1', type: 'BlogPost' }, []);
    expect(e2.status).toBe('draft');
  });

  test('falls back to `status` fact when cms_status is absent', () => {
    const published = entryFromFacts({ id: 'p1', type: 'BlogPost' }, [
      { e: 'p1', a: 'status', v: 'published' },
      { e: 'p1', a: 'title', v: 'Hello' },
    ]);
    expect(published.status).toBe('published');
    expect(published.fields.status).toBe('published');

    const draft = entryFromFacts({ id: 'p1', type: 'BlogPost' }, [
      { e: 'p1', a: 'status', v: 'draft' },
    ]);
    expect(draft.status).toBe('draft');
  });

  test('cms_status takes precedence over status fact', () => {
    const e = entryFromFacts({ id: 'p1', type: 'BlogPost' }, [
      { e: 'p1', a: 'status', v: 'published' },
      { e: 'p1', a: 'cms_status', v: 'draft' },
    ]);
    expect(e.status).toBe('draft');
  });
});

describe('entryFromFacts — link merging', () => {
  test('graph links populate fields where no fact exists for the same key', () => {
    const links: RawLink[] = [{ e1: 'post:1', a: 'author', e2: 'author:1' }];
    const e = entryFromFacts(
      { id: 'post:1', type: 'BlogPost' },
      [{ e: 'post:1', a: 'title', v: 'Hello' }],
      links,
    );
    expect(e.fields.author).toBe('author:1');
    expect(e.fields.title).toBe('Hello');
  });

  test('fact value wins over link target for the same attribute', () => {
    const links: RawLink[] = [{ e1: 'post:1', a: 'author', e2: 'author:link' }];
    const e = entryFromFacts(
      { id: 'post:1', type: 'BlogPost' },
      [{ e: 'post:1', a: 'author', v: 'author:fact' }],
      links,
    );
    expect(e.fields.author).toBe('author:fact');
  });

  test('links from other entities are ignored', () => {
    const links: RawLink[] = [
      { e1: 'post:2', a: 'author', e2: 'author:other' },
      { e1: 'post:1', a: 'author', e2: 'author:1' },
    ];
    const e = entryFromFacts({ id: 'post:1', type: 'BlogPost' }, [], links);
    expect(e.fields.author).toBe('author:1');
  });
});

describe('groupFactsByEntity / groupLinksBySource', () => {
  test('groupFactsByEntity buckets by entity id', () => {
    const facts: RawFact[] = [
      { e: 'a', a: 'x', v: 1 },
      { e: 'b', a: 'y', v: 2 },
      { e: 'a', a: 'z', v: 3 },
    ];
    const m = groupFactsByEntity(facts);
    expect(m.get('a')?.length).toBe(2);
    expect(m.get('b')?.length).toBe(1);
  });

  test('groupLinksBySource buckets by source entity', () => {
    const links: RawLink[] = [
      { e1: 'a', a: 'r', e2: 'x' },
      { e1: 'b', a: 'r', e2: 'y' },
      { e1: 'a', a: 's', e2: 'z' },
    ];
    const m = groupLinksBySource(links);
    expect(m.get('a')?.length).toBe(2);
    expect(m.get('b')?.length).toBe(1);
  });
});

describe('expandReferences', () => {
  test('replaces string ids with resolved entries', async () => {
    const entries: Entry[] = [
      {
        id: 'post:1',
        type: 'BlogPost',
        status: 'published',
        fields: { title: 'Hello', author: 'author:1' },
      },
    ];
    const fetchEntity = async (id: string): Promise<Entry | null> =>
      id === 'author:1'
        ? { id, type: 'Author', status: 'published', fields: { name: 'Jane' } }
        : null;

    const expanded = await expandReferences(entries, ['author'], fetchEntity);
    const author = expanded[0]!.fields.author as Entry;
    expect(author.id).toBe('author:1');
    expect(author.fields.name).toBe('Jane');
  });

  test('leaves non-string field values untouched', async () => {
    const entries: Entry[] = [
      {
        id: 'post:1',
        type: 'BlogPost',
        status: 'published',
        fields: { title: 'Hello', count: 5 },
      },
    ];
    const expanded = await expandReferences(entries, ['count'], async () => null);
    expect(expanded[0]!.fields.count).toBe(5);
  });

  test('handles missing referenced entities gracefully', async () => {
    const entries: Entry[] = [
      { id: 'p', type: 'BlogPost', status: 'published', fields: { author: 'gone' } },
    ];
    const expanded = await expandReferences(entries, ['author'], async () => null);
    expect(expanded[0]!.fields.author).toBe(null);
  });
});

describe('fingerprint', () => {
  test('produces stable strings for equal data', () => {
    expect(fingerprint([1, 2, 3])).toBe(fingerprint([1, 2, 3]));
    expect(fingerprint({ a: 1 })).toBe(fingerprint({ a: 1 }));
  });

  test('differs when data differs', () => {
    expect(fingerprint([1, 2])).not.toBe(fingerprint([1, 2, 3]));
  });
});
