import chalk from 'chalk';

/**
 * Print a CLI failure and exit. Used by parseAsync and action wrappers so
 * async rejections are never silent.
 */
export function handleCliError(err: unknown): never {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = String((err as { code?: string }).code);
    if (
      code === 'commander.helpDisplayed' ||
      code === 'commander.version' ||
      code === 'commander.help' ||
      code === 'commander.versionDisplayed'
    ) {
      process.exit(0);
    }
  }

  const message = err instanceof Error ? err.message : String(err);
  console.error(chalk.red(`✗ ${message}`));

  if (process.env.TRELLIS_DEBUG && err instanceof Error && err.stack) {
    console.error(chalk.dim(err.stack));
  }

  process.exit(1);
}
