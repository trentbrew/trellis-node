import { describe, expect, test } from 'vitest';
import { scaffoldConsumer, scaffoldFilename } from '../../src/cms/scaffold.js';

describe('scaffoldConsumer', () => {
  test('vanilla output imports from trellis/cms and uses createCmsClient', () => {
    const code = scaffoldConsumer({ collection: 'blog_post' });
    expect(code).toContain('import { createCmsClient } from "trellis/cms"');
    expect(code).toContain('createCmsClient');
    expect(code).toContain('cms.collection("blog_post")');
  });

  test('react output emits a typed hook named for the collection', () => {
    const code = scaffoldConsumer({ collection: 'blog_post', framework: 'react' });
    expect(code).toContain('export function useBlogPost()');
    expect(code).toContain('useState<Entry[]>');
    expect(code).toContain('useEffect');
  });

  test('solid output emits createX with onCleanup', () => {
    const code = scaffoldConsumer({ collection: 'author', framework: 'solid' });
    expect(code).toContain('export function createAuthor()');
    expect(code).toContain('onCleanup');
  });

  test('vue output uses ref + onUnmounted', () => {
    const code = scaffoldConsumer({ collection: 'product', framework: 'vue' });
    expect(code).toContain('export function useProduct()');
    expect(code).toContain('ref<Entry[]>');
    expect(code).toContain('onUnmounted');
  });

  test('directory option bakes into the client literal', () => {
    const code = scaffoldConsumer({
      collection: 'blog_post',
      framework: 'react',
      directory: '/projects/my-app',
    });
    expect(code).toContain('directory: "/projects/my-app"');
  });

  test('expand option emits expand clause in subscribe call', () => {
    const code = scaffoldConsumer({
      collection: 'blog_post',
      framework: 'vanilla',
      expand: ['author'],
    });
    expect(code).toContain('expand: ["author"]');
  });
});

describe('scaffoldFilename', () => {
  test('vanilla → .js, frameworks → .ts', () => {
    expect(scaffoldFilename({ collection: 'blog_post' })).toBe('cms-blog-post.js');
    expect(scaffoldFilename({ collection: 'blog_post', framework: 'react' })).toBe('cms-blog-post.ts');
    expect(scaffoldFilename({ collection: 'blog_post', framework: 'solid' })).toBe('cms-blog-post.ts');
    expect(scaffoldFilename({ collection: 'blog_post', framework: 'vue' })).toBe('cms-blog-post.ts');
  });

  test('normalizes special chars in collection name', () => {
    expect(scaffoldFilename({ collection: 'BlogPost' })).toBe('cms-blogpost.js');
    expect(scaffoldFilename({ collection: 'blog post' })).toBe('cms-blog-post.js');
  });
});
