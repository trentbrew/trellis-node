/**
 * Shared runtime-agnostic types for the Trellis HTTP server.
 *
 * @module trellis/server
 */

/**
 * Minimal interface satisfied by both Bun's server (returned from `Bun.serve`)
 * and the Node http adapter. Use this when you only need the cross-runtime
 * surface — most consumers only call `.stop()`.
 */
export interface TrellisHttpServer {
  port: number;
  hostname?: string;
  /**
   * Shut down the server. On Bun the returned value may be void; on Node the
   * returned promise resolves once both the HTTP server and the WebSocket
   * server have closed.
   */
  stop(closeActiveConnections?: boolean): void | Promise<void>;
}
