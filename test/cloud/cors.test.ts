import { describe, expect, it } from 'vitest';
import { corsHeaders, corsEnabledForConfig, withCors } from '../../src/server/cors.js';

describe('cors', () => {
  it('enables when apiKey is configured', () => {
    expect(corsEnabledForConfig('spk_test')).toBe(true);
    expect(corsEnabledForConfig(undefined)).toBe(false);
  });

  it('reflects request origin when allowlisted', () => {
    process.env.TRELLIS_CORS_ORIGINS = 'https://brew.build,https://fractals.brew.build';
    const req = new Request('https://x/health', {
      headers: { Origin: 'https://brew.build' },
    });
    expect(corsHeaders(req)['Access-Control-Allow-Origin']).toBe('https://brew.build');
    delete process.env.TRELLIS_CORS_ORIGINS;
  });

  it('wraps responses with cors headers', () => {
    const req = new Request('https://x/health');
    const res = withCors(req, new Response('ok'));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
