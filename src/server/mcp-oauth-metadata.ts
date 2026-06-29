/**
 * OAuth metadata for MCP clients (ChatGPT Connectors, Claude web, etc.).
 *
 * Room servers issue JWTs via /auth/oauth/* and accept Bearer JWT on /mcp.
 *
 * @module trellis/server
 */

import type { AuthConfig } from './auth.js';

export function oauthProtectedResourceMetadata(origin: string, resourcePath = '/mcp') {
  const resource = `${origin.replace(/\/$/, '')}${resourcePath}`;
  return {
    resource,
    authorization_servers: [origin.replace(/\/$/, '')],
    bearer_methods_supported: ['header'],
    scopes_supported: ['openid', 'email', 'profile'],
  };
}

export function oauthAuthorizationServerMetadata(
  origin: string,
  providers: string[] = ['google', 'github'],
) {
  const base = origin.replace(/\/$/, '');
  return {
    issuer: base,
    authorization_endpoint: `${base}/auth/oauth/google`,
    token_endpoint: `${base}/auth/login`,
    registration_endpoint: `${base}/auth/register`,
    scopes_supported: ['openid', 'email', 'profile'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'password'],
    code_challenge_methods_supported: ['S256'],
    mcp_resource: `${base}/mcp`,
    oauth_providers: providers.map((p) => ({
      name: p,
      authorization_endpoint: `${base}/auth/oauth/${p}`,
    })),
  };
}

export function mcpServiceDocument(
  origin: string,
  authConfig: AuthConfig,
): Record<string, unknown> {
  const base = origin.replace(/\/$/, '');
  return {
    name: 'trellis-room',
    version: '0.3.0',
    mcp: `${base}/mcp`,
    mcpGateway: `${base}/gateway/mcp`,
    health: `${base}/health`,
    oauth: {
      protectedResource: `${base}/.well-known/oauth-protected-resource`,
      authorizationServer: `${base}/.well-known/oauth-authorization-server`,
      apiKeySupported: Boolean(authConfig.apiKey),
      jwtSupported: Boolean(authConfig.jwtSecret),
    },
    bridge: {
      command: 'npx trellis mcp bridge --room <url>',
    },
  };
}
