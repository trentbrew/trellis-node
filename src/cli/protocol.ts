/**
 * trellis protocol / whereami CLI
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { TrellisVcsEngine } from '../engine.js';
import {
  validateEnvelope,
  formatIssueDescription,
  type HandoffEnvelope,
  type HandoffRole,
  type HandoffStatus,
} from '../protocol/envelope.js';
import { formatWhereami, writeCheckpoint } from '../protocol/whereami.js';
import { resolveRepoRoot } from './repo-path.js';

async function openEngine(rootPath: string): Promise<TrellisVcsEngine> {
  const engine = new TrellisVcsEngine({ rootPath });
  engine.open();
  await engine.syncEnvLaneFromEnv();
  return engine;
}

function readBody(opts: {
  body?: string;
  file?: string;
}): string | undefined {
  if (opts.body) return opts.body;
  if (opts.file) return readFileSync(opts.file, 'utf-8');
  if (!process.stdin.isTTY) {
    return readFileSync(0, 'utf-8').trim() || undefined;
  }
  return undefined;
}

function registerWhereamiCommands(program: Command): void {
  const whereamiCmd = program
    .command('whereami')
    .description('Re-entry dump: waiting / active / moved since checkpoint')
    .option('-p, --path <path>', 'Repository path', '.');

  whereamiCmd.action(async (opts) => {
    const rootPath = resolveRepoRoot(opts.path);
    const engine = await openEngine(rootPath);
    console.log(formatWhereami({ engine, rootPath }));
  });

  whereamiCmd
    .command('checkpoint')
    .description('Save re-entry checkpoint manifest')
    .option('-p, --path <path>', 'Repository path', '.')
    .action(async (opts) => {
      const rootPath = resolveRepoRoot(opts.path);
      const engine = await openEngine(rootPath);
      const allIds = engine.listIssues().map((i) => i.id);
      const openMessageIds = engine
        .listIssues()
        .filter(
          (i) =>
            i.status !== 'closed' &&
            (i.labels.includes('message') || i.labels.includes('decision')),
        )
        .map((i) => i.id);

      const cp = writeCheckpoint(rootPath, allIds, openMessageIds);
      console.log(chalk.green(`✓ Checkpoint saved at ${cp.at}`));
      console.log(
        `  ${chalk.dim('Issues:')} ${cp.issueIds.length} · ${chalk.dim('open protocol:')} ${cp.openMessageIds.length}`,
      );
    });
}

export function registerProtocolCommands(program: Command): void {
  registerWhereamiCommands(program);

  const protocolCmd = program
    .command('protocol')
    .description('Agent handoff protocol (trellis-handoffs envelope)');

  protocolCmd
    .command('send')
    .description('Record a handoff envelope as a child issue')
    .requiredOption('--parent <id>', 'Parent issue id')
    .requiredOption('--from <role>', 'Sender role')
    .requiredOption('--to <role>', 'Receiver role')
    .requiredOption('--re <path>', 'Issue path (e.g. TRL-41)')
    .requiredOption(
      '--status <status>',
      'HANDOFF | CLARIFY | REJECT | BLOCKED | DECISION',
    )
    .option('--body <text>', 'Message body')
    .option('--file <path>', 'Read body from file')
    .option('-l, --label <label>', 'Override label (default: message or decision)')
    .option('--stage <stage>', 'Pipeline stage for turn banner')
    .option('-p, --path <path>', 'Repository path', '.')
    .action(async (opts) => {
      const rootPath = resolveRepoRoot(opts.path);
      const engine = await openEngine(rootPath);

      const envelope: HandoffEnvelope = {
        from: opts.from as HandoffRole,
        to: opts.to as HandoffRole,
        re: opts.re,
        status: opts.status as HandoffStatus,
        body: readBody(opts),
      };

      const validation = validateEnvelope(envelope);
      if (!validation.ok) {
        console.error(chalk.red(validation.errors.join('\n')));
        process.exit(1);
      }

      const label =
        opts.label ??
        (envelope.status === 'DECISION' ? 'decision' : 'message');
      const title = `msg: ${envelope.status} ${envelope.re}`;
      const description = formatIssueDescription(envelope, opts.stage);

      const op = await engine.createIssue(title, {
        parentId: opts.parent,
        labels: [label],
        description,
        status: 'queue',
      });

      const childId = op.vcs?.issueId;
      console.log(
        chalk.green(`✓ Protocol message recorded: ${chalk.bold(childId)}`),
      );
      console.log(`  ${chalk.dim('Parent:')}  ${opts.parent}`);
      console.log(`  ${chalk.dim('Label:')}   ${label}`);
    });

  protocolCmd
    .command('whereami')
    .description('Re-entry orientation (alias of trellis whereami)')
    .option('-p, --path <path>', 'Repository path', '.')
    .action(async (opts) => {
      const rootPath = resolveRepoRoot(opts.path);
      const engine = await openEngine(rootPath);
      console.log(formatWhereami({ engine, rootPath }));
    });
}
