/**
 * CORS for browser clients hitting a remote room node (TurtleDB Cloud C0 / deploy).
 *
 * Enabled when `TRELLIS_CORS_ORIGINS` is set, or when the server uses an API key
 * (typical deployed Sprite). Set `TRELLIS_CORS_ORIGINS=*` to allow any origin.
 *
 * @module trellis/server
 */

const DEFAULT_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';
const DEFAULT_HEADERS =
  'Content-Type, Authorization, mcp-session-id, mcp-protocol-version, Last-Event-ID, Accept, X-Trellis-Lane, X-Trellis-Tenant';

export function corsEnabledForConfig(apiKey?: string): boolean {
  return Boolean(process.env.TRELLIS_CORS_ORIGINS) || Boolean(apiKey);
}

function allowedOrigins(): string[] | '*' {
  const raw = process.env.TRELLIS_CORS_ORIGINS?.trim();
  if (!raw || raw === '*') return '*';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export function corsHeaders(req: Request): Record<string, string> {
  const origins = allowedOrigins();
  const requestOrigin = req.headers.get('Origin');
  let allowOrigin = '*';

  if (origins !== '*') {
    if (requestOrigin && origins.includes(requestOrigin)) {
      allowOrigin = requestOrigin;
    } else if (origins.length === 1) {
      allowOrigin = origins[0]!;
    } else {
      allowOrigin = origins[0] ?? '*';
    }
  }

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': DEFAULT_METHODS,
    'Access-Control-Allow-Headers': DEFAULT_HEADERS,
    Vary: 'Origin',
  };
}

export function withCors(req: Request, res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [key, value] of Object.entries(corsHeaders(req))) {
    headers.set(key, value);
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

export function corsPreflightResponse(req: Request): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req),
  });
}
