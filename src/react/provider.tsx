/**
 * Trellis React — Provider
 *
 * Wraps a TrellisClient instance in React context so hooks can access it.
 *
 *   import { TrellisProvider } from 'trellis/react';
 *
 *   <TrellisProvider url="http://localhost:3000" apiKey="...">
 *     <App />
 *   </TrellisProvider>
 *
 * @module trellis/react
 */

import {
  createContext,
  useContext,
  useMemo,
  useEffect,
  type ReactNode,
} from 'react';
import { TrellisDb } from '../client/sdk.js';
import type { TrellisDbRemoteOptions } from '../client/sdk.js';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const TrellisContext = createContext<TrellisDb | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface TrellisProviderProps {
  /** Base URL of the Trellis server. */
  url: string;
  /** API key or JWT token. */
  apiKey?: string;
  /** Tenant ID (optional, for multi-tenant deployments). */
  tenantId?: string;
  children: ReactNode;
}

export function TrellisProvider({
  url,
  apiKey,
  tenantId,
  children,
}: TrellisProviderProps) {
  const client = useMemo(() => {
    const opts: TrellisDbRemoteOptions = { url };
    if (apiKey) opts.apiKey = apiKey;
    if (tenantId) opts.tenantId = tenantId;
    return new TrellisDb(opts);
  }, [url, apiKey, tenantId]);

  useEffect(() => {
    return () => {
      client.disconnect();
    };
  }, [client]);

  return (
    <TrellisContext.Provider value={client}>{children}</TrellisContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook to access raw client
// ---------------------------------------------------------------------------

/**
 * Access the TrellisClient instance from context.
 * Must be used within a `<TrellisProvider>`.
 */
export function useTrellis(): TrellisDb {
  const client = useContext(TrellisContext);
  if (!client) {
    throw new Error(
      'useTrellis() must be used within a <TrellisProvider>. ' +
        'Wrap your app with <TrellisProvider url="...">.',
    );
  }
  return client;
}
