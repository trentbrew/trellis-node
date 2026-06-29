/**
 * Discovery MCP gateway — room list / connect tools.
 *
 * @module trellis/server
 */

import {
  createDiscoveryMcpServer,
  type DiscoveryMcpContext,
} from '../mcp/discovery.js';
import { StreamableMcpGateway } from './streamable-mcp-gateway.js';

export class DiscoveryMcpGateway {
  private gateway = new StreamableMcpGateway();

  async handle(req: Request, ctx: DiscoveryMcpContext): Promise<Response> {
    return this.gateway.handle(req, () => createDiscoveryMcpServer(ctx));
  }

  async close(): Promise<void> {
    await this.gateway.close();
  }
}

export const discoveryMcpGateway = new DiscoveryMcpGateway();
