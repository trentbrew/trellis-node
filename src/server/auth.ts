/**
 * Trellis Server — Auth
 *
 * Produces an `AuthContext` from a request using one of:
 *   - Bearer JWT (signed with jwtSecret)
 *   - API key (compared against configured key)
 *   - Unauthenticated (public access)
 *
 * OAuth provider flows (Google, GitHub) are handled separately and ultimately
 * issue a JWT, so this module just needs to verify tokens.
 *
 * @module trellis/server
 */

// ---------------------------------------------------------------------------
// Auth context — the resolved identity for a request
// ---------------------------------------------------------------------------

export interface AuthContext {
  /** User entity ID (null = unauthenticated). */
  userId: string | null;
  /** Tenant ID (null = default tenant). */
  tenantId: string | null;
  /** Roles assigned to this user. */
  roles: string[];
  /** Raw JWT claims (if authenticated via JWT). */
  claims: Record<string, unknown>;
  /** Whether this request passed authentication. */
  authenticated: boolean;
}

export const ANONYMOUS: AuthContext = {
  userId: null,
  tenantId: null,
  roles: [],
  claims: {},
  authenticated: false,
};

// ---------------------------------------------------------------------------
// JWT helpers (no external dep — manual HS256 using Web Crypto)
// ---------------------------------------------------------------------------

function base64UrlEncode(input: Uint8Array): string {
  return btoa(String.fromCharCode(...input))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const base64 = padded + '='.repeat(padLen);
  const binary = atob(base64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/**
 * Sign a JWT payload with HS256.
 */
export async function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  expiresInSeconds = 86400,
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claims = { iat: now, exp: now + expiresInSeconds, ...payload };

  const enc = new TextEncoder();
  const headerB64 = base64UrlEncode(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(enc.encode(JSON.stringify(claims)));
  const signing = `${headerB64}.${payloadB64}`;

  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(signing));
  const sigB64 = base64UrlEncode(new Uint8Array(sig));

  return `${signing}.${sigB64}`;
}

/**
 * Verify and decode a JWT. Returns null if invalid or expired.
 */
export async function verifyJwt(
  token: string,
  secret: string,
): Promise<Record<string, unknown> | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
  const enc = new TextEncoder();
  const signing = `${headerB64}.${payloadB64}`;

  try {
    const key = await hmacKey(secret);
    const sigRaw = base64UrlDecode(sigB64);
    const sigBuf = sigRaw.buffer.slice(
      sigRaw.byteOffset,
      sigRaw.byteOffset + sigRaw.byteLength,
    ) as ArrayBuffer;
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBuf,
      enc.encode(signing),
    );
    if (!valid) return null;

    const claims = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(payloadB64)),
    ) as Record<string, unknown>;

    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp === 'number' && claims.exp < now) return null;

    return claims;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Request auth resolution
// ---------------------------------------------------------------------------

export interface AuthConfig {
  /** Secret for JWT verification. Required for JWT auth. */
  jwtSecret?: string;
  /** Static API key. If set, `Authorization: Bearer <key>` is also accepted. */
  apiKey?: string;
  /** Allow unauthenticated (public) access. Default: true. */
  allowPublic?: boolean;
}

/**
 * Resolve an `AuthContext` from an HTTP request's Authorization header.
 */
export async function resolveAuth(
  authHeader: string | null | undefined,
  config: AuthConfig,
): Promise<AuthContext> {
  if (!authHeader) {
    return config.allowPublic === false
      ? { ...ANONYMOUS, authenticated: false }
      : ANONYMOUS;
  }

  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;

  // API key check (fast path)
  if (config.apiKey && token === config.apiKey) {
    return {
      userId: 'service',
      tenantId: null,
      roles: ['admin'],
      claims: { sub: 'service' },
      authenticated: true,
    };
  }

  // JWT verification
  if (config.jwtSecret) {
    const claims = await verifyJwt(token, config.jwtSecret);
    if (claims) {
      return {
        userId: (claims.sub as string) ?? null,
        tenantId: (claims.tenantId as string) ?? null,
        roles: Array.isArray(claims.roles)
          ? (claims.roles as string[])
          : typeof claims.role === 'string'
            ? [claims.role]
            : [],
        claims,
        authenticated: true,
      };
    }
  }

  return ANONYMOUS;
}

// ---------------------------------------------------------------------------
// OAuth provider helpers
// ---------------------------------------------------------------------------

export interface OAuthProvider {
  name: string;
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string[];
}

export const GOOGLE_PROVIDER: Omit<OAuthProvider, 'clientId' | 'clientSecret'> =
  {
    name: 'google',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    scopes: ['openid', 'email', 'profile'],
  };

export const GITHUB_PROVIDER: Omit<OAuthProvider, 'clientId' | 'clientSecret'> =
  {
    name: 'github',
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: ['read:user', 'user:email'],
  };

/**
 * Build an OAuth authorization redirect URL.
 */
export function buildOAuthUrl(
  provider: OAuthProvider,
  redirectUri: string,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: provider.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: provider.scopes.join(' '),
    state,
  });
  return `${provider.authUrl}?${params}`;
}

/**
 * Exchange an OAuth code for an access token + user info.
 * Returns normalized user profile.
 */
export async function exchangeOAuthCode(
  provider: OAuthProvider,
  code: string,
  redirectUri: string,
): Promise<{ id: string; email: string; name: string; avatarUrl?: string }> {
  const tokenRes = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    throw new Error(`OAuth token exchange failed: ${tokenRes.status}`);
  }

  const tokenData = (await tokenRes.json()) as Record<string, unknown>;
  const accessToken = tokenData.access_token as string;

  const userRes = await fetch(provider.userInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!userRes.ok) {
    throw new Error(`OAuth user info fetch failed: ${userRes.status}`);
  }

  const user = (await userRes.json()) as Record<string, unknown>;

  return {
    id: String(user.id ?? user.sub ?? ''),
    email: String(user.email ?? ''),
    name: String(user.name ?? user.login ?? ''),
    avatarUrl:
      (user.picture as string) ?? (user.avatar_url as string) ?? undefined,
  };
}
