/**
 * Shared `trellis deploy` / `trellis db deploy` handler.
 */

import chalk from 'chalk';
import { configPath } from '../client/config.js';
import { deploy } from '../server/deploy.js';
import { DeployNameError } from '../server/deploy-meta.js';

export interface DeployCliOptions {
  name: string;
  key?: string;
  jwtSecret?: string;
  port?: string | number;
  configDir?: string;
  stub?: boolean;
}

export function printDeploySuccess(
  result: { url: string; name: string; apiKey: string },
  configDir: string,
  stub: boolean,
): void {
  console.log('');
  console.log(
    chalk.green(
      stub ? '✓ Stub deploy — config written (no Sprite provisioned)' : '✓ TurtleDB room deployed',
    ),
  );
  console.log(chalk.dim(`  Name:     ${result.name}`));
  console.log(chalk.dim(`  URL:      ${result.url}`));
  console.log(chalk.dim(`  API key:  ${result.apiKey}`));
  console.log(chalk.dim(`  Config:   ${configPath(configDir)}`));
  console.log('');
  console.log(chalk.dim(`  Health:   curl ${result.url}/health`));
  console.log('');
  console.log(chalk.bold('SDK:'));
  console.log(chalk.cyan(`  import { TrellisDb } from 'trellis/client';`));
  console.log(
    chalk.cyan(
      `  const db = new TrellisDb({ url: '${result.url}', apiKey: '${result.apiKey}' });`,
    ),
  );
}

export async function runDeployCli(opts: DeployCliOptions): Promise<void> {
  const configDir = opts.configDir ?? '.';
  const port =
    typeof opts.port === 'string' ? parseInt(opts.port, 10) : (opts.port ?? 3000);

  const { readConfig } = await import('../client/config.js');
  const config = readConfig(configDir);

  const label = opts.stub ? 'Stub deploy' : 'Deploying to Sprites';
  console.log(chalk.bold(`${label}: ${opts.name}...`));

  try {
    const result = await deploy({
      name: opts.name,
      dbPath: config?.dbPath,
      apiKey: opts.key,
      jwtSecret: opts.jwtSecret,
      port,
      configDir,
      stub: !!opts.stub,
      onProgress: (msg) => console.log(chalk.dim(`  ${msg}`)),
    });

    printDeploySuccess(result, configDir, !!opts.stub);
  } catch (err: unknown) {
    if (err instanceof DeployNameError) {
      console.error(chalk.red(`Invalid name: ${err.message}`));
      process.exit(1);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Deploy failed: ${message}`));
    process.exit(1);
  }
}
