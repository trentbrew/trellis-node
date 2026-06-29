/**
 * `trellis mcp gateway deploy` handler.
 */

import chalk from 'chalk';
import { gatewayConfigPath } from '../mcp/gateway-config.js';
import { deployMcpGateway } from '../server/deploy-gateway.js';
import { DeployNameError } from '../server/deploy-meta.js';

export interface GatewayDeployCliOptions {
  name: string;
  publicUrl?: string;
  port?: string | number;
  configDir?: string;
  roomsFile?: string;
  stub?: boolean;
}

export function printGatewayDeploySuccess(
  result: {
    url: string;
    publicUrl: string;
    name: string;
    roomCount: number;
  },
  configDir: string,
  stub: boolean,
): void {
  const spriteHost = new URL(result.url).hostname;

  console.log('');
  console.log(
    chalk.green(
      stub
        ? '✓ Stub gateway deploy — config written (no Sprite provisioned)'
        : '✓ Trellis MCP discovery gateway deployed',
    ),
  );
  console.log(chalk.dim(`  Sprite:   ${result.name}`));
  console.log(chalk.dim(`  Origin:   ${result.url}`));
  console.log(chalk.dim(`  Public:   ${result.publicUrl}`));
  console.log(chalk.dim(`  Rooms:    ${result.roomCount}`));
  console.log(chalk.dim(`  Config:   ${gatewayConfigPath(configDir)}`));
  console.log('');
  console.log(chalk.bold('MCP (use public URL in Cursor):'));
  console.log(chalk.cyan(`  ${result.publicUrl}/gateway/mcp`));
  console.log(
    chalk.dim(
      '  On Sprites, /gateway/mcp is canonical (platform reserves /mcp).',
    ),
  );
  console.log('');
  console.log(chalk.bold('DNS (mcp.trellis.computer):'));
  console.log(
    chalk.dim(
      '  Vercel proxy: deploy trellis-node/apps/mcp-gateway-proxy, add domain, CNAME mcp → Vercel',
    ),
  );
  console.log(
    chalk.dim(
      `  Or direct CNAME → ${spriteHost} (TLS on vanity host needs Sprites custom domains)`,
    ),
  );
  console.log('');
  console.log(chalk.bold('Until DNS propagates, use the Sprites origin:'));
  console.log(chalk.cyan(`  ${result.url}/mcp`));
  console.log('');
  console.log(chalk.bold('Cursor:'));
  console.log(
    chalk.cyan(
      `  { "url": "${result.publicUrl}/mcp" }  // or ${result.url}/mcp`,
    ),
  );
}

export async function runGatewayDeployCli(
  opts: GatewayDeployCliOptions,
): Promise<void> {
  const configDir = opts.configDir ?? '.';
  const port =
    opts.port === undefined
      ? undefined
      : typeof opts.port === 'string'
        ? parseInt(opts.port, 10)
        : opts.port;

  const label = opts.stub ? 'Stub gateway deploy' : 'Deploying MCP gateway';
  console.log(chalk.bold(`${label}: ${opts.name}...`));

  try {
    const result = await deployMcpGateway({
      name: opts.name,
      publicUrl: opts.publicUrl,
      port,
      configDir,
      roomsFile: opts.roomsFile,
      stub: !!opts.stub,
      onProgress: (msg) => console.log(chalk.dim(`  ${msg}`)),
    });

    printGatewayDeploySuccess(result, configDir, !!opts.stub);
  } catch (err: unknown) {
    if (err instanceof DeployNameError) {
      console.error(chalk.red(`Invalid name: ${err.message}`));
      process.exit(1);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Gateway deploy failed: ${message}`));
    process.exit(1);
  }
}
