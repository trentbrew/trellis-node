#!/usr/bin/env bun

/**
 * TrellisVCS CLI
 *
 * Commands:
 *   init     Initialize a new TrellisVCS repository
 *   status   Show current repository status
 *   log      Show operation history
 *   watch    Start file watcher (foreground)
 *   lane     Agent lanes — isolated op journals
 *   files    List tracked files
 *   import   Import from a Git repository
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { resolve, join, dirname } from 'path';
import { select, checkbox, confirm } from '@inquirer/prompts';
import { TrellisVcsEngine } from '../engine.js';
import { TrellisKernel } from '../core/kernel/trellis-kernel.js';
import { SqliteKernelBackend } from '../core/persist/sqlite-backend.js';
import { QueryEngine, parseQuery, parseSimple } from '../core/query/index.js';
import {
  OntologyRegistry,
  validateStore,
  builtinOntologies,
} from '../core/ontology/index.js';
import { buildRAGContext } from '../embeddings/auto-embed.js';
import { VectorStore } from '../embeddings/store.js';
import { embed } from '../embeddings/model.js';
import { EmbeddingManager } from '../embeddings/search.js';
import { importFromGit } from '../git/git-importer.js';
import { exportToGit } from '../git/git-exporter.js';
import { buildRepoExamples } from './examples.js';
import {
  createIdentity,
  saveIdentity,
  loadIdentity,
  hasIdentity,
  toPublicIdentity,
} from '../identity/index.js';
import {
  loadProfile,
  saveProfile,
  hasProfile,
  promptForProfile,
  updateProfile,
  inferProjectContext,
  writeAgentScaffold,
  writeIdeScaffold,
  seedContext,
} from '../scaffold/index.js';
import { cliVersion, findRepoRoot, resolveRepoRoot } from './repo-path.js';
import { registerLaneCommands } from './lane.js';

export type IdeType =
  | 'cursor'
  | 'windsurf'
  | 'claude'
  | 'copilot'
  | 'codex'
  | 'gemini'
  | 'none';
export type WorkspaceFootprint = 'minimal' | 'standard' | 'full';
export type FrameworkType =
  | 'react'
  | 'vue'
  | 'svelte'
  | 'next'
  | 'nuxt'
  | 'remotion'
  | 'expo'
  | 'bun'
  | 'node'
  | 'cli'
  | 'library'
  | 'animation'
  | 'games'
  | 'none';

const program = new Command();

program
  .name('trellis')
  .description('TrellisVCS — graph-native, code-first version control')
  .version(cliVersion());

async function runInit(
  rootPath: string,
  opts: {
    interactive?: boolean;
    ides?: string[];
    framework?: string;
    footprint?: string;
    plugins?: string[];
  } = {},
): Promise<{ selectedIdes: string[]; footprint: string; framework: string }> {
  const isInteractive =
    opts.interactive !== false &&
    process.stdout.isTTY &&
    !process.argv.includes('--no-interactive');

  if (TrellisVcsEngine.isRepo(rootPath)) {
    return {
      selectedIdes: opts.ides || [],
      footprint: opts.footprint || 'standard',
      framework: opts.framework || 'none',
    };
  }

  if (!hasProfile()) {
    const identity = hasIdentity(rootPath)
      ? loadIdentity(join(rootPath, '.trellis'))
      : null;

    if (isInteractive) {
      console.log(chalk.cyan("\n  Welcome to Trellis! Let's get you set up."));
      const newProfile = await promptForProfile({
        name: identity?.displayName,
      });
      saveProfile(newProfile);
      console.log(
        chalk.green('  ✓ Profile saved to ~/.trellis/profile.json\n'),
      );
    } else {
      updateProfile({ name: identity?.displayName || 'Unknown' });
    }
  }

  const preInfer = await inferProjectContext(rootPath);
  const detectedFramework = preInfer.framework;

  let selectedIdes: string[] = opts.ides || [];
  let footprint: WorkspaceFootprint =
    (opts.footprint as WorkspaceFootprint) || 'standard';
  let framework: FrameworkType =
    (opts.framework as FrameworkType) || detectedFramework || 'none';
  let plugins: string[] = opts.plugins || [];

  if (!isInteractive && framework === 'none' && detectedFramework) {
    framework = detectedFramework;
  }

  if (!isInteractive && selectedIdes.length === 0) {
    selectedIdes = ['cursor'];
  }

  if (isInteractive) {
    console.log(chalk.cyan('\n  Configuring workspace...'));

    const setupType = await select({
      message: 'Choose your setup mode:',
      choices: [
        {
          name: '⚡ Minimal Setup (One-shot setup with detected defaults)',
          value: 'minimal',
        },
        {
          name: '🔧 Custom Guided Setup (Customize framework, IDEs, footprint, features)',
          value: 'custom',
        },
      ],
      default: 'minimal',
    });

    if (setupType === 'minimal') {
      footprint = 'minimal';
      framework = detectedFramework || 'none';

      // Auto-detect active/relevant IDEs
      const ides: string[] = [];
      const envKeys = Object.keys(process.env).join(',').toLowerCase();
      if (
        process.env.TERM_PROGRAM === 'Windsurf' ||
        envKeys.includes('windsurf')
      ) {
        ides.push('windsurf');
      } else if (
        process.env.TERM_PROGRAM === 'vscode' ||
        envKeys.includes('cursor')
      ) {
        ides.push('cursor');
      } else {
        // Default to both Cursor and Windsurf to cover bases
        ides.push('cursor', 'windsurf');
      }
      selectedIdes = ides;
      plugins = [];

      console.log(
        chalk.green(`  ✓ Detected project type: ${chalk.bold(framework)}`),
      );
      console.log(
        chalk.green(
          `  ✓ Scaffolding rules for: ${chalk.bold(selectedIdes.join(', '))}`,
        ),
      );
    } else {
      const frameworkChoices = [
        { name: 'React', value: 'react' },
        { name: 'Vue', value: 'vue' },
        { name: 'Svelte', value: 'svelte' },
        { name: 'Next.js', value: 'next' },
        { name: 'Nuxt', value: 'nuxt' },
        { name: 'Remotion', value: 'remotion' },
        { name: 'Expo / React Native', value: 'expo' },
        { name: 'Bun runtime', value: 'bun' },
        { name: 'Node.js server', value: 'node' },
        { name: 'CLI tool', value: 'cli' },
        { name: 'Library / Package', value: 'library' },
        { name: 'Animation studio', value: 'animation' },
        { name: 'Games', value: 'games' },
        { name: 'None / Vanilla', value: 'none' },
      ];

      framework = (await select({
        message: detectedFramework
          ? `What type of project are you building? (detected: ${detectedFramework})`
          : 'What type of project are you building?',
        choices: frameworkChoices,
        default: (opts.framework ||
          detectedFramework ||
          'none') as FrameworkType,
      })) as FrameworkType;

      const ideChoices = [
        {
          name: 'Cursor',
          value: 'cursor',
          checked: selectedIdes.includes('cursor') || selectedIdes.length === 0,
        },
        {
          name: 'Windsurf',
          value: 'windsurf',
          checked: selectedIdes.includes('windsurf'),
        },
        {
          name: 'Claude Desktop',
          value: 'claude',
          checked: selectedIdes.includes('claude'),
        },
        {
          name: 'VS Code Copilot',
          value: 'copilot',
          checked: selectedIdes.includes('copilot'),
        },
        {
          name: 'Google Gemini (Code Assist)',
          value: 'gemini',
          checked: selectedIdes.includes('gemini'),
        },
        {
          name: 'OpenAI Codex',
          value: 'codex',
          checked: selectedIdes.includes('codex'),
        },
      ];

      selectedIdes = await checkbox({
        message: 'Which IDEs/agents do you want to scaffold for?',
        choices: ideChoices,
      });

      footprint = await select({
        message: 'How minimal do you want your workspace?',
        choices: [
          { name: 'Minimal (just agent rules)', value: 'minimal' },
          { name: 'Standard (includes skills + workflows)', value: 'standard' },
          { name: 'Full (kitchen sink)', value: 'full' },
        ],
        default: footprint,
      });

      plugins = await checkbox({
        message: 'Select features:',
        choices: [
          {
            name: 'Sub-projects (monorepo, workspaces)',
            value: 'sub-projects',
            checked: plugins.includes('sub-projects'),
          },
          { name: 'P2P Sync', value: 'p2p', checked: plugins.includes('p2p') },
          {
            name: 'MCP Server',
            value: 'mcp',
            checked: plugins.includes('mcp'),
          },
          {
            name: 'UI Components',
            value: 'ui-components',
            checked: plugins.includes('ui-components'),
          },
          {
            name: 'Media Pipelines',
            value: 'media-pipelines',
            checked: plugins.includes('media-pipelines'),
          },
          {
            name: 'Brand System',
            value: 'brand-system',
            checked: plugins.includes('brand-system'),
          },
          {
            name: 'Agent Memory',
            value: 'agent-memory',
            checked: plugins.includes('agent-memory'),
          },
          {
            name: 'Workflows',
            value: 'workflows',
            checked: plugins.includes('workflows') || footprint !== 'minimal',
          },
        ],
      });

      if (plugins.includes('sub-projects') && !plugins.includes('workflows')) {
        plugins.push('workflows');
      }
    }
  }

  const engine = new TrellisVcsEngine({ rootPath });
  let renderedProgress = false;
  const result = await engine.initRepo({
    onProgress: (progress) => {
      renderedProgress = true;
      if (progress.phase === 'done') {
        process.stdout.write('\r\x1b[2K');
        return;
      }

      const label =
        progress.phase === 'discovering'
          ? 'Discovering…'
          : progress.phase === 'hashing'
            ? 'Hashing…'
            : progress.phase === 'scaffolding'
              ? 'Scaffolding…'
              : 'Scanning…';

      process.stdout.write(
        `\r\x1b[2K  ${chalk.dim(label)} ${progress.message}`,
      );
    },
  });

  if (renderedProgress) {
    process.stdout.write('\n');
  }

  if (selectedIdes && selectedIdes.length > 0) {
    for (const selectedIde of selectedIdes) {
      writeIdeScaffold(rootPath, {
        ide: selectedIde as IdeType,
        footprint,
        framework,
        plugins,
        rootPath,
        context: result.context,
        profile: loadProfile(),
      });
    }
  }

  return { selectedIdes, footprint, framework };
}

// ---------------------------------------------------------------------------
// trellis init
// ---------------------------------------------------------------------------

program
  .command('init')
  .description(
    'Initialize a new TrellisVCS repository in the current directory',
  )
  .option('-p, --path <path>', 'Path to initialize', '.')
  .option(
    '--ides <ides...>',
    'IDEs to scaffold for (cursor, windsurf, claude, copilot, codex, gemini)',
  )
  .option(
    '--framework <framework>',
    'Project framework (react, vue, svelte, next, nuxt, remotion, expo, bun, node, cli, library, animation, games, none)',
    'none',
  )
  .option(
    '--footprint <footprint>',
    'Workspace footprint (minimal, standard, full)',
    'standard',
  )
  .option('--no-interactive', 'Skip interactive prompts')
  .action(async (opts) => {
    const rootPath = resolve(opts.path);

    if (TrellisVcsEngine.isRepo(rootPath)) {
      console.log(chalk.yellow('Already a Trellis workspace.'));
      return;
    }

    const configResult = await runInit(rootPath, {
      interactive:
        process.stdout.isTTY && !process.argv.includes('--no-interactive'),
      ides: opts.ides,
      framework: opts.framework,
      footprint: opts.footprint,
    });

    console.log(chalk.green('✓ Initialized Trellis repository'));
    const engine = new TrellisVcsEngine({ rootPath });
    const opsCount = (await engine.log()).length;
    console.log(`  ${chalk.dim('Path:')}           ${rootPath}`);
    console.log(
      `  ${chalk.dim('Ops:')}            ${opsCount} initial operations scanned`,
    );
    console.log(`  ${chalk.dim('Config:')}         .trellis/config.json`);
    console.log(`  ${chalk.dim('Op log:')}         .trellis/ops.json`);
    console.log(`  ${chalk.dim('Agent context:')}  .trellis/agents/AGENTS.md`);
    const preInfer = await inferProjectContext(rootPath);
    if (preInfer.domain) {
      console.log(
        `  ${chalk.dim('Domain:')}         ${chalk.cyan(preInfer.domain)} ${chalk.dim('(inferred)')}`,
      );
    }
    if (preInfer.ecosystem && preInfer.ecosystem !== 'unknown') {
      console.log(`  ${chalk.dim('Ecosystem:')}      ${preInfer.ecosystem}`);
    }
    console.log();
    console.log(chalk.bold('Next steps (VCS):'));
    console.log();
    console.log(
      `  ${chalk.cyan('trellis status')}     Check repository status`,
    );
    console.log(`  ${chalk.cyan('trellis log')}        View recent history`);
    console.log(
      `  ${chalk.cyan('trellis branch')}     List or create branches`,
    );
    console.log(
      `  ${chalk.cyan('trellis milestone')}  Create narrative checkpoints`,
    );
    console.log(
      `  ${chalk.cyan('trellis garden')}     Discover abandoned work`,
    );
    console.log(
      `  ${chalk.cyan('trellis issue')}      Create and track issues`,
    );
    if (preInfer.confidence !== 'high') {
      console.log(
        `  ${chalk.cyan('trellis season')}     Enrich project context for agents`,
      );
    }
    console.log();
    console.log(chalk.bold('Semantic Substrate (Live local services):'));
    console.log();
    console.log(
      `  ${chalk.cyan('trellis web')}        Launch local web client / graph visualizer`,
    );
    console.log(
      `  ${chalk.cyan('trellis query')}      Run EQL-S semantic queries against your code graph`,
    );
    if (configResult.selectedIdes.length > 0) {
      console.log(
        `  ${chalk.cyan('Agent Rules')}       Active for ${chalk.bold(configResult.selectedIdes.join(', '))}. Agents will auto-detect the graph.`,
      );
    }
    console.log();
    console.log(
      chalk.dim(
        'The causal stream is now active. Every file change will be tracked.',
      ),
    );
  });

// ---------------------------------------------------------------------------
// trellis seed
// ---------------------------------------------------------------------------

program
  .command('seed')
  .description('Refresh agent context files with current project state')
  .option('-p, --path <path>', 'Repository path', '.')
  .option(
    '--ide <ide>',
    'IDE to update (cursor, windsurf, claude, copilot)',
    'none',
  )
  .option('-f, --force', 'Force rewrite even if files do not exist', false)
  .action(async (opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const ide = (opts.ide as IdeType) || 'none';
    const force = opts.force || false;

    console.log(chalk.dim('Seeding agent context...'));
    const result = await seedContext({ rootPath, ide, force });

    if (result.success) {
      console.log(chalk.green('✓ Context seeded'));
      console.log(
        `  ${chalk.dim('Files updated:')} ${result.filesUpdated.length}`,
      );
      for (const f of result.filesUpdated) {
        console.log(`    ${chalk.dim('-')} ${f}`);
      }
      console.log(`  ${chalk.dim('Timestamp:')} ${result.timestamp}`);
    } else {
      console.log(chalk.red('✗ Failed to seed context'));
    }
  });

// ---------------------------------------------------------------------------
// trellis repair
// ---------------------------------------------------------------------------

program
  .command('repair')
  .description('Attempt to repair a corrupted .trellis/ops.json file')
  .option('-p, --path <path>', 'Repository path', '.')
  .action((opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    console.log(chalk.yellow('Attempting to repair ops.json...'));
    const result = TrellisVcsEngine.repair(rootPath);

    if (result.lost === -1) {
      console.log(
        chalk.red(
          'Could not recover any ops. A corrupted backup was saved as ops.json.corrupted',
        ),
      );
    } else if (result.recovered > 0) {
      console.log(chalk.green(`✓ Recovered ${result.recovered} ops.`));
    } else {
      console.log(chalk.green('ops.json is already valid. No repair needed.'));
    }
  });

// ---------------------------------------------------------------------------
// trellis status
// ---------------------------------------------------------------------------

program
  .command('status')
  .description('Show current repository status')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();
    const st = engine.status();

    console.log(chalk.bold('TrellisVCS Status'));
    console.log();
    console.log(`  ${chalk.dim('Branch:')}        ${chalk.cyan(st.branch)}`);
    console.log(`  ${chalk.dim('Total ops:')}     ${st.totalOps}`);
    console.log(`  ${chalk.dim('Tracked files:')} ${st.trackedFiles}`);

    if (st.lastOp) {
      console.log();
      console.log(
        `  ${chalk.dim('Last op:')}      ${chalk.yellow(st.lastOp.kind)}`,
      );
      console.log(`  ${chalk.dim('  at:')}          ${st.lastOp.timestamp}`);
      if (st.lastOp.vcs?.filePath) {
        console.log(
          `  ${chalk.dim('  file:')}        ${st.lastOp.vcs.filePath}`,
        );
      }
    }

    if (st.recentOps.length > 0) {
      console.log();
      console.log(chalk.dim('  Recent activity:'));
      // Show last 5 ops (excluding branch create for readability)
      const display = st.recentOps
        .filter((op) => op.kind !== 'vcs:branchCreate')
        .slice(-5);
      for (const op of display) {
        const kind = formatOpKind(op.kind);
        const file = op.vcs?.filePath ?? '';
        const time = formatRelativeTime(op.timestamp);
        console.log(`    ${kind} ${chalk.white(file)} ${chalk.dim(time)}`);
      }
    }
  });

// ---------------------------------------------------------------------------
// trellis log
// ---------------------------------------------------------------------------

program
  .command('log')
  .description('Show operation history')
  .option('-p, --path <path>', 'Repository path', '.')
  .option('-n, --limit <n>', 'Number of ops to show', '20')
  .option('-f, --file <file>', 'Filter by file path')
  .option('--remote <remote>', 'Filter by remote workspace')
  .option('--all', 'Include operations from all remotes')
  .action(async (opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();
    let ops = engine.log({
      limit: parseInt(opts.limit, 10),
      filePath: opts.file,
    });

    // Handle remote filtering
    if (opts.remote || opts.all) {
      const { RemoteManager } = await import('../federation/remote-manager.js');
      const remoteManager = new RemoteManager(join(rootPath, '.trellis'));

      if (opts.all) {
        // Get all remotes and filter ops from them
        const remotes = remoteManager.listRemotes();
        const remoteOps = ops.filter((op) =>
          op.facts?.some(
            (fact) =>
              fact.e === 'op' &&
              fact.a === 'remote' &&
              remotes.some((remote) => fact.v === remote.name),
          ),
        );

        if (opts.remote) {
          // Filter by specific remote when --all is also used
          ops = remoteOps.filter((op) =>
            op.facts?.some(
              (fact) =>
                fact.e === 'op' &&
                fact.a === 'remote' &&
                fact.v === opts.remote,
            ),
          );
        } else {
          ops = remoteOps;
        }
      } else if (opts.remote) {
        // Filter by specific remote only
        ops = ops.filter((op) =>
          op.facts?.some(
            (fact) =>
              fact.e === 'op' && fact.a === 'remote' && fact.v === opts.remote,
          ),
        );
      }
    }

    if (ops.length === 0) {
      console.log(chalk.dim('No operations found.'));
      return;
    }

    // Group by remote for display
    const groupedOps =
      opts.all || opts.remote
        ? ops.reduce(
            (groups, op) => {
              const remoteFact = op.facts?.find(
                (fact) => fact.e === 'op' && fact.a === 'remote',
              );
              const remote = remoteFact ? (remoteFact.v as string) : 'local';
              if (!groups[remote]) groups[remote] = [];
              groups[remote].push(op);
              return groups;
            },
            {} as Record<string, typeof ops>,
          )
        : { local: ops };

    console.log(chalk.bold(`Causal Stream — ${ops.length} ops`));
    console.log();

    for (const [remote, remoteOps] of Object.entries(groupedOps)) {
      if (opts.all || opts.remote) {
        console.log(chalk.cyan(`${remote === 'local' ? 'Local' : remote}:`));
      }

      for (const op of remoteOps.reverse()) {
        const kind = formatOpKind(op.kind);
        const hash = chalk.dim(op.hash.slice(0, 28) + '…');
        const time = formatRelativeTime(op.timestamp);
        const file = op.vcs?.filePath ? chalk.white(op.vcs.filePath) : '';
        const rename = op.vcs?.oldFilePath
          ? chalk.dim(` (from ${op.vcs.oldFilePath})`)
          : '';

        console.log(`  ${hash} ${kind} ${file}${rename} ${chalk.dim(time)}`);
      }

      if (opts.all || opts.remote) {
        console.log();
      }
    }
  });

// ---------------------------------------------------------------------------
// trellis files
// ---------------------------------------------------------------------------

program
  .command('files')
  .description('List all tracked files')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();
    const files = engine.trackedFiles();

    if (files.length === 0) {
      console.log(chalk.dim('No tracked files.'));
      return;
    }

    console.log(chalk.bold(`Tracked Files — ${files.length}`));
    console.log();

    for (const f of files.sort((a, b) => a.path.localeCompare(b.path))) {
      const hash = f.contentHash
        ? chalk.dim(f.contentHash.slice(0, 12))
        : chalk.dim('(no hash)');
      console.log(`  ${hash} ${f.path}`);
    }
  });

// ---------------------------------------------------------------------------
// trellis watch
// ---------------------------------------------------------------------------

program
  .command('watch')
  .description('Start file watcher (foreground, Ctrl+C to stop)')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();
    await engine.syncEnvLaneFromEnv();

    const laneId = engine.getActiveLaneId();
    console.log(
      chalk.green('✓ Watching for changes…') + chalk.dim(' (Ctrl+C to stop)'),
    );
    if (laneId) {
      console.log(chalk.dim(`  Lane: ${laneId} (writes → lane journal)`));
    }
    console.log();

    // Override engine's watch to add logging
    const originalWatch = engine.watch.bind(engine);
    engine.watch();

    // Keep process alive
    process.on('SIGINT', () => {
      engine.stop();
      console.log();
      console.log(chalk.dim('Watcher stopped.'));
      process.exit(0);
    });
  });

// ---------------------------------------------------------------------------
// trellis import
// ---------------------------------------------------------------------------

program
  .command('import')
  .description('Import from an existing Git repository')
  .requiredOption('--from <path>', 'Path to the Git repository to import from')
  .option('-p, --path <path>', 'Target TrellisVCS repository path', '.')
  .action(async (opts) => {
    const from = resolve(opts.from);
    const to = resolve(opts.path);

    console.log(chalk.dim(`Importing from Git: ${from}`));
    console.log(chalk.dim(`Target: ${to}`));
    console.log();

    try {
      const result = await importFromGit({
        from,
        to,
        onProgress: (p) => {
          if (p.phase === 'reading') {
            process.stdout.write(`\r  ${chalk.dim('Reading…')} ${p.message}`);
          } else if (p.phase === 'importing') {
            process.stdout.write(
              `\r  ${chalk.dim('Importing…')} ${p.current}/${p.total} commits`,
            );
          } else {
            process.stdout.write('\n');
          }
        },
      });

      console.log();
      console.log(chalk.green('✓ Git import complete'));
      console.log(`  ${chalk.dim('Commits:')}    ${result.commitsImported}`);
      console.log(`  ${chalk.dim('Ops:')}        ${result.opsCreated}`);
      console.log(`  ${chalk.dim('Files:')}      ${result.filesTracked}`);
      console.log(
        `  ${chalk.dim('Branches:')}   ${result.branches.join(', ')}`,
      );
      console.log(
        `  ${chalk.dim('Duration:')}   ${(result.duration / 1000).toFixed(1)}s`,
      );
      console.log();
      console.log(
        chalk.dim(
          'Run `trellis status` or `trellis log` to explore the imported history.',
        ),
      );
    } catch (err: any) {
      console.error(chalk.red(`\nImport failed: ${err.message}`));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// trellis export
// ---------------------------------------------------------------------------

program
  .command('export')
  .description('Export milestones to a Git repository')
  .requiredOption('--to <path>', 'Path to the target Git repository')
  .option('-p, --path <path>', 'Source TrellisVCS repository path', '.')
  .option('--author-name <name>', 'Author name for Git commits')
  .option('--author-email <email>', 'Author email for Git commits')
  .action(async (opts) => {
    const from = resolveRepoRoot(opts.path);
    const to = resolve(opts.to);

    console.log(chalk.dim(`Exporting from: ${from}`));
    console.log(chalk.dim(`Target Git repo: ${to}`));
    console.log();

    try {
      const result = await exportToGit({
        from,
        to,
        authorName: opts.authorName,
        authorEmail: opts.authorEmail,
        onProgress: (p) => {
          if (p.phase === 'preparing') {
            console.log(`  ${chalk.dim(p.message)}`);
          } else if (p.phase === 'exporting') {
            process.stdout.write(
              `\r  ${chalk.dim('Exporting…')} ${p.current}/${p.total} milestones`,
            );
          } else {
            process.stdout.write('\n');
          }
        },
      });

      console.log();
      console.log(chalk.green('✓ Git export complete'));
      console.log(`  ${chalk.dim('Milestones:')} ${result.milestonesExported}`);
      console.log(`  ${chalk.dim('Commits:')}    ${result.commitsCreated}`);
      console.log(
        `  ${chalk.dim('Duration:')}   ${(result.duration / 1000).toFixed(1)}s`,
      );
    } catch (err: any) {
      console.error(chalk.red(`\nExport failed: ${err.message}`));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// trellis branch
// ---------------------------------------------------------------------------

program
  .command('branch')
  .description('Manage branches')
  .argument('[name]', 'Branch name to create or switch to')
  .option('-d, --delete <name>', 'Delete a branch')
  .option('-l, --list', 'List all branches')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (name, opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    // Delete
    if (opts.delete) {
      try {
        await engine.deleteBranch(opts.delete);
        console.log(chalk.green(`✓ Deleted branch '${opts.delete}'`));
      } catch (err: any) {
        console.error(chalk.red(err.message));
        process.exit(1);
      }
      return;
    }

    // Create or switch
    if (name) {
      const branches = engine.listBranches();
      const exists = branches.find((b) => b.name === name);

      if (exists) {
        // Switch to existing branch
        try {
          engine.switchBranch(name);
          console.log(chalk.green(`✓ Switched to branch '${name}'`));
        } catch (err: any) {
          console.error(chalk.red(err.message));
          process.exit(1);
        }
      } else {
        // Create new branch
        try {
          await engine.createBranch(name);
          engine.switchBranch(name);
          console.log(
            chalk.green(`✓ Created and switched to branch '${name}'`),
          );
        } catch (err: any) {
          console.error(chalk.red(err.message));
          process.exit(1);
        }
      }
      return;
    }

    // List (default)
    const branches = engine.listBranches();
    if (branches.length === 0) {
      console.log(chalk.dim('No branches'));
      return;
    }

    console.log(chalk.bold('Branches\n'));
    for (const b of branches) {
      const marker = b.isCurrent ? chalk.green('* ') : '  ';
      const name = b.isCurrent ? chalk.green(b.name) : b.name;
      const age = b.createdAt ? chalk.dim(formatRelativeTime(b.createdAt)) : '';
      console.log(`${marker}${name} ${age}`);
    }
  });

// ---------------------------------------------------------------------------
// trellis milestone
// ---------------------------------------------------------------------------

program
  .command('milestone')
  .description('Create or list milestones')
  .argument('[action]', '"create" or "list" (default: list)')
  .option('-m, --message <message>', 'Milestone message')
  .option('--from <hash>', 'Start op hash for the milestone range')
  .option('--to <hash>', 'End op hash for the milestone range')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (action, opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    if (action === 'create') {
      if (!opts.message) {
        console.error(
          chalk.red('Milestone message is required: --message "..."'),
        );
        process.exit(1);
      }

      try {
        const op = await engine.createMilestone(opts.message, {
          fromOpHash: opts.from,
          toOpHash: opts.to,
        });
        console.log(chalk.green(`✓ Milestone created`));
        console.log(`  ${chalk.dim('ID:')}      ${op.vcs?.milestoneId}`);
        console.log(`  ${chalk.dim('Message:')} ${opts.message}`);
        console.log(`  ${chalk.dim('Hash:')}    ${op.hash.slice(0, 32)}…`);
      } catch (err: any) {
        console.error(chalk.red(`Failed: ${err.message}`));
        process.exit(1);
      }
      return;
    }

    // List (default)
    const milestones = engine.listMilestones();
    if (milestones.length === 0) {
      console.log(chalk.dim('No milestones'));
      return;
    }

    console.log(chalk.bold(`Milestones (${milestones.length})\n`));
    for (const m of milestones) {
      const age = m.createdAt ? formatRelativeTime(m.createdAt) : '';
      console.log(
        `  ${chalk.cyan('★')} ${chalk.bold(m.message ?? '(no message)')}`,
      );
      console.log(`    ${chalk.dim('ID:')} ${m.id}  ${chalk.dim(age)}`);
      if (m.affectedFiles.length > 0) {
        console.log(
          `    ${chalk.dim('Files:')} ${m.affectedFiles.slice(0, 5).join(', ')}${m.affectedFiles.length > 5 ? ` +${m.affectedFiles.length - 5} more` : ''}`,
        );
      }
      console.log();
    }
  });

// ---------------------------------------------------------------------------
// trellis checkpoint
// ---------------------------------------------------------------------------

program
  .command('checkpoint')
  .description('Create or list checkpoints')
  .argument('[action]', '"create" or "list" (default: list)')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (action, opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    if (action === 'create') {
      try {
        const op = await engine.createCheckpoint('manual');
        console.log(chalk.green(`✓ Checkpoint created`));
        console.log(`  ${chalk.dim('Hash:')}    ${op.hash.slice(0, 32)}…`);
        console.log(`  ${chalk.dim('Trigger:')} manual`);
      } catch (err: any) {
        console.error(chalk.red(`Failed: ${err.message}`));
        process.exit(1);
      }
      return;
    }

    // List (default)
    const checkpoints = engine.listCheckpoints();
    if (checkpoints.length === 0) {
      console.log(chalk.dim('No checkpoints'));
      return;
    }

    console.log(chalk.bold(`Checkpoints (${checkpoints.length})\n`));
    for (const cp of checkpoints) {
      const age = cp.createdAt ? formatRelativeTime(cp.createdAt) : '';
      console.log(
        `  ${chalk.dim('●')} ${cp.id.slice(0, 32)}  ${chalk.dim(cp.trigger ?? '')}  ${chalk.dim(age)}`,
      );
    }
  });

// ---------------------------------------------------------------------------
// trellis diff
// ---------------------------------------------------------------------------

program
  .command('diff')
  .description('Show file-level diff between two points in history')
  .argument('[from]', 'Starting op hash or milestone ID')
  .argument('[to]', 'Ending op hash (default: current head)')
  .option('-p, --path <path>', 'Repository path', '.')
  .option('--stat', 'Show only summary stats')
  .action((from, to, opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    let result;
    if (from && to) {
      result = engine.diffOps(from, to);
    } else if (from) {
      result = engine.diffFromOp(from);
    } else {
      // Diff from the first op to HEAD
      const ops = engine.getOps();
      if (ops.length < 2) {
        console.log(chalk.dim('Not enough history to diff.'));
        return;
      }
      result = engine.diffOps(ops[0].hash, ops[ops.length - 1].hash);
    }

    if (result.diffs.length === 0) {
      console.log(chalk.dim('No differences.'));
      return;
    }

    // Stats
    const s = result.stats;
    console.log(
      `${chalk.green(`+${s.added} added`)}  ${chalk.yellow(`~${s.modified} modified`)}  ${chalk.red(`-${s.removed} removed`)}${s.renamed ? `  ${chalk.blue(`→${s.renamed} renamed`)}` : ''}`,
    );
    console.log();

    if (opts.stat) return;

    // Detailed output
    for (const diff of result.diffs) {
      switch (diff.kind) {
        case 'fileAdded':
          console.log(`${chalk.green('+ ' + diff.path)}`);
          break;
        case 'fileDeleted':
          console.log(`${chalk.red('- ' + diff.path)}`);
          break;
        case 'fileRenamed':
          console.log(`${chalk.blue(`→ ${diff.oldPath} → ${diff.path}`)}`);
          break;
        case 'fileModified':
          console.log(`${chalk.yellow('~ ' + diff.path)}`);
          if (diff.unifiedDiff) {
            for (const line of diff.unifiedDiff.split('\n')) {
              if (line.startsWith('+')) {
                console.log(chalk.green(line));
              } else if (line.startsWith('-')) {
                console.log(chalk.red(line));
              } else if (line.startsWith('@@')) {
                console.log(chalk.cyan(line));
              } else {
                console.log(chalk.dim(line));
              }
            }
          }
          break;
      }
      console.log();
    }
  });

// ---------------------------------------------------------------------------
// trellis merge
// ---------------------------------------------------------------------------

program
  .command('merge')
  .description('Merge a branch into the current branch')
  .argument('<branch>', 'Source branch to merge')
  .option('-p, --path <path>', 'Repository path', '.')
  .option('--dry-run', 'Preview merge without applying changes')
  .action((branch, opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    const result = engine.mergeBranch(branch);

    if (result.clean) {
      console.log(chalk.green('✓ Merge completed cleanly'));
    } else {
      console.log(
        chalk.yellow(`⚠ Merge has ${result.conflicts.length} conflict(s)`),
      );
    }

    const s = result.stats;
    console.log(`  ${chalk.dim('Modified:')}   ${s.modified}`);
    console.log(`  ${chalk.dim('Deleted:')}    ${s.deleted}`);
    console.log(`  ${chalk.dim('Conflicted:')} ${s.conflicted}`);

    if (result.conflicts.length > 0) {
      console.log();
      console.log(chalk.bold('Conflicts:'));
      for (const c of result.conflicts) {
        console.log(`  ${chalk.red('✗')} ${c.path} (${c.kind})`);
      }
    }

    if (opts.dryRun) {
      console.log();
      console.log(chalk.dim('(dry run — no changes applied)'));
    }
  });

// ---------------------------------------------------------------------------
// trellis parse
// ---------------------------------------------------------------------------

program
  .command('parse')
  .description('Parse a file into AST-level semantic entities')
  .argument('<file>', 'File to parse')
  .option('-p, --path <path>', 'Repository path', '.')
  .action((file, opts) => {
    const rootPath = resolveRepoRoot(opts.path);
    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    const { readFileSync } = require('fs');
    const filePath = resolve(file);
    const content = readFileSync(filePath, 'utf-8');
    const result = engine.parseFile(content, file);

    if (!result) {
      console.log(chalk.dim(`No parser available for: ${file}`));
      return;
    }

    console.log(chalk.bold(`Parse: ${file}\n`));
    console.log(`  ${chalk.dim('Language:')}     ${result.language}`);
    console.log(
      `  ${chalk.dim('Declarations:')} ${result.declarations.length}`,
    );
    console.log(`  ${chalk.dim('Imports:')}      ${result.imports.length}`);
    console.log(`  ${chalk.dim('Exports:')}      ${result.exports.length}`);

    if (result.declarations.length > 0) {
      console.log();
      console.log(chalk.bold('Declarations:'));
      for (const d of result.declarations) {
        console.log(
          `  ${chalk.cyan(d.kind.padEnd(14))} ${chalk.bold(d.name)}${d.children.length ? ` (${d.children.length} members)` : ''}`,
        );
        for (const child of d.children) {
          console.log(`    ${chalk.dim(child.kind.padEnd(14))} ${child.name}`);
        }
      }
    }

    if (result.imports.length > 0) {
      console.log();
      console.log(chalk.bold('Imports:'));
      for (const imp of result.imports) {
        const specs =
          imp.specifiers.length > 0 ? ` { ${imp.specifiers.join(', ')} }` : '';
        console.log(
          `  ${chalk.dim('from')} ${chalk.yellow(imp.source)}${specs}`,
        );
      }
    }
  });

// ---------------------------------------------------------------------------
// trellis sdiff (semantic diff)
// ---------------------------------------------------------------------------

program
  .command('sdiff')
  .description('Show semantic diff between two versions of a file')
  .argument('<fileA>', 'Old version of the file')
  .argument('<fileB>', 'New version of the file')
  .option('-p, --path <path>', 'Repository path', '.')
  .action((fileA, fileB, opts) => {
    const rootPath = resolveRepoRoot(opts.path);
    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    const { readFileSync } = require('fs');
    const oldContent = readFileSync(resolve(fileA), 'utf-8');
    const newContent = readFileSync(resolve(fileB), 'utf-8');
    const patches = engine.semanticDiff(oldContent, newContent, fileA);

    if (patches.length === 0) {
      console.log(chalk.dim('No semantic differences.'));
      return;
    }

    console.log(chalk.bold(`Semantic diff: ${fileA} → ${fileB}\n`));
    console.log(`  ${chalk.dim('Patches:')} ${patches.length}\n`);

    for (const patch of patches) {
      switch (patch.kind) {
        case 'symbolAdd':
          console.log(
            `  ${chalk.green('+')} ${chalk.green(`${patch.entity.kind}: ${patch.entity.name}`)}`,
          );
          break;
        case 'symbolRemove':
          console.log(
            `  ${chalk.red('-')} ${chalk.red(`${patch.entityName}`)} (removed)`,
          );
          break;
        case 'symbolModify':
          console.log(
            `  ${chalk.yellow('~')} ${chalk.yellow(patch.entityName)} (modified)`,
          );
          break;
        case 'symbolRename':
          console.log(
            `  ${chalk.blue('\u2192')} ${chalk.blue(`${patch.oldName} \u2192 ${patch.newName}`)} (renamed)`,
          );
          break;
        case 'importAdd':
          console.log(
            `  ${chalk.green('+')} import from ${chalk.yellow(patch.source)}`,
          );
          break;
        case 'importRemove':
          console.log(
            `  ${chalk.red('-')} import from ${chalk.yellow(patch.source)}`,
          );
          break;
        case 'importModify':
          console.log(
            `  ${chalk.yellow('~')} import from ${chalk.yellow(patch.source)} (specifiers changed)`,
          );
          break;
        case 'exportAdd':
          console.log(`  ${chalk.green('+')} export ${chalk.bold(patch.name)}`);
          break;
        case 'exportRemove':
          console.log(`  ${chalk.red('-')} export ${chalk.bold(patch.name)}`);
          break;
        case 'symbolMove':
          console.log(
            `  ${chalk.blue('\u2192')} ${chalk.blue(patch.entityName)} moved ${patch.oldFile} \u2192 ${patch.newFile}`,
          );
          break;
      }
    }
  });

// ---------------------------------------------------------------------------
// trellis sync
// ---------------------------------------------------------------------------

program
  .command('sync')
  .description('Sync operations with another TrellisVCS repository')
  .argument(
    '[action]',
    '"push", "pull", "status", or "reconcile" (default: status)',
  )
  .option('-p, --path <path>', 'Local repository path', '.')
  .option('--remote <remote>', 'Remote repository path')
  .action((action, opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();
    const ops = engine.getOps();

    if (action === 'status' || !action) {
      console.log(chalk.bold('Sync Status\n'));
      console.log(`  ${chalk.dim('Local ops:')}  ${ops.length}`);
      console.log(
        `  ${chalk.dim('Head:')}       ${ops.length > 0 ? ops[ops.length - 1].hash.slice(0, 16) + '\u2026' : '(none)'}`,
      );
      console.log(`  ${chalk.dim('Branch:')}     ${engine.getCurrentBranch()}`);
      return;
    }

    if (action === 'reconcile' && opts.remote) {
      const remotePath = resolve(opts.remote);
      if (!TrellisVcsEngine.isRepo(remotePath)) {
        console.error(chalk.red(`Not a TrellisVCS repository: ${remotePath}`));
        process.exit(1);
      }

      const remoteEngine = new TrellisVcsEngine({ rootPath: remotePath });
      remoteEngine.open();
      const remoteOps = remoteEngine.getOps();

      const { reconcile } = require('../sync/reconciler.js');
      const result = reconcile(ops, remoteOps);

      console.log(chalk.bold('Reconcile Result\n'));
      console.log(`  ${chalk.dim('Merged ops:')}    ${result.merged.length}`);
      console.log(`  ${chalk.dim('Unique local:')} ${result.uniqueToA.length}`);
      console.log(
        `  ${chalk.dim('Unique remote:')} ${result.uniqueToB.length}`,
      );
      console.log(
        `  ${chalk.dim('Fork point:')}   ${result.forkPoint?.slice(0, 16) ?? '(none)'}`,
      );
      console.log(
        `  ${chalk.dim('Clean:')}        ${result.clean ? chalk.green('yes') : chalk.red('no')}`,
      );

      if (result.conflicts.length > 0) {
        console.log();
        console.log(chalk.bold('Conflicts:'));
        for (const c of result.conflicts) {
          console.log(`  ${chalk.red('\u2717')} ${c.filePath}: ${c.reason}`);
        }
      }
      return;
    }

    console.log(
      chalk.dim('Use --remote <path> with reconcile to compare repositories.'),
    );
    console.log(
      chalk.dim('Full peer sync requires a transport layer (coming soon).'),
    );
  });

// ---------------------------------------------------------------------------
// trellis garden
// ---------------------------------------------------------------------------

program
  .command('garden')
  .description('Explore the Idea Garden — abandoned work clusters')
  .argument(
    '[action]',
    '"list", "show <id>", "search", "revive <id>", or "stats" (default: list)',
  )
  .argument('[id]', 'Cluster ID (for show/revive)')
  .option('-p, --path <path>', 'Repository path', '.')
  .option('-f, --file <file>', 'Filter by file path')
  .option('-k, --keyword <keyword>', 'Filter by keyword')
  .option('-s, --status <status>', 'Filter by status (abandoned|draft|revived)')
  .option('-n, --limit <n>', 'Max results', parseInt as any)
  .action((action, id, opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();
    const garden = engine.garden();

    if (action === 'stats') {
      const s = garden.stats();
      console.log(chalk.bold('Idea Garden Stats\n'));
      console.log(`  ${chalk.dim('Total clusters:')} ${s.total}`);
      console.log(`  ${chalk.dim('Abandoned:')}      ${s.abandoned}`);
      console.log(`  ${chalk.dim('Draft:')}          ${s.draft}`);
      console.log(`  ${chalk.dim('Revived:')}        ${s.revived}`);
      console.log(`  ${chalk.dim('Total ops:')}      ${s.totalOps}`);
      console.log(`  ${chalk.dim('Total files:')}    ${s.totalFiles}`);
      return;
    }

    if (action === 'show') {
      if (!id) {
        console.error(chalk.red('Usage: trellis garden show <cluster-id>'));
        process.exit(1);
      }
      const cluster = garden.getCluster(id);
      if (!cluster) {
        console.error(chalk.red(`Cluster not found: ${id}`));
        process.exit(1);
      }

      console.log(chalk.bold(`Cluster: ${cluster.id}\n`));
      console.log(
        `  ${chalk.dim('Status:')}     ${formatClusterStatus(cluster.status)}`,
      );
      console.log(`  ${chalk.dim('Detected by:')} ${cluster.detectedBy}`);
      console.log(`  ${chalk.dim('Created:')}    ${cluster.createdAt}`);
      console.log(`  ${chalk.dim('Abandoned:')}  ${cluster.abandonedAt}`);
      console.log(`  ${chalk.dim('Ops:')}        ${cluster.ops.length}`);
      console.log(
        `  ${chalk.dim('Files:')}      ${cluster.affectedFiles.join(', ')}`,
      );
      if (cluster.estimatedIntent) {
        console.log(`  ${chalk.dim('Intent:')}     ${cluster.estimatedIntent}`);
      }
      console.log();
      console.log(chalk.bold('Operations:'));
      for (const op of cluster.ops.slice(0, 20)) {
        console.log(
          `  ${formatOpKind(op.kind)} ${chalk.dim(op.hash.slice(0, 12))} ${op.vcs?.filePath ?? ''}`,
        );
      }
      if (cluster.ops.length > 20) {
        console.log(chalk.dim(`  ... +${cluster.ops.length - 20} more`));
      }
      return;
    }

    if (action === 'revive') {
      if (!id) {
        console.error(chalk.red('Usage: trellis garden revive <cluster-id>'));
        process.exit(1);
      }
      const ops = garden.revive(id);
      if (!ops) {
        console.error(chalk.red(`Cluster not found: ${id}`));
        process.exit(1);
      }
      console.log(chalk.green(`\u2713 Cluster revived: ${id}`));
      console.log(`  ${chalk.dim('Ops to replay:')} ${ops.length}`);
      console.log(
        `  ${chalk.dim('Files:')} ${[...new Set(ops.filter((o) => o.vcs?.filePath).map((o) => o.vcs!.filePath!))].join(', ')}`,
      );
      return;
    }

    if (action === 'search') {
      const results = garden.search({
        file: opts.file,
        keyword: opts.keyword,
        status: opts.status as any,
        limit: opts.limit,
      });

      if (results.length === 0) {
        console.log(chalk.dim('No matching clusters found.'));
        return;
      }

      console.log(chalk.bold(`Search results (${results.length})\n`));
      for (const c of results) {
        printClusterSummary(c);
      }
      return;
    }

    // List (default)
    const clusters = garden.search({
      file: opts.file,
      keyword: opts.keyword,
      status: opts.status as any,
      limit: opts.limit,
    });

    if (clusters.length === 0) {
      console.log(chalk.dim('No idea clusters found. The garden is empty.'));
      return;
    }

    console.log(chalk.bold(`Idea Garden (${clusters.length} clusters)\n`));
    for (const c of clusters) {
      printClusterSummary(c);
    }
  });

function formatClusterStatus(status: string): string {
  switch (status) {
    case 'abandoned':
      return chalk.yellow('abandoned');
    case 'draft':
      return chalk.blue('draft');
    case 'revived':
      return chalk.green('revived');
    default:
      return chalk.dim(status);
  }
}

function printClusterSummary(c: {
  id: string;
  status: string;
  detectedBy: string;
  ops: any[];
  affectedFiles: string[];
  createdAt: string;
  abandonedAt: string;
}): void {
  console.log(
    `  ${chalk.cyan('\u2740')} ${chalk.bold(c.id)}  ${formatClusterStatus(c.status)}  ${chalk.dim(c.detectedBy)}`,
  );
  console.log(
    `    ${chalk.dim('Ops:')} ${c.ops.length}  ${chalk.dim('Files:')} ${c.affectedFiles.slice(0, 3).join(', ')}${c.affectedFiles.length > 3 ? ` +${c.affectedFiles.length - 3}` : ''}`,
  );
  console.log(
    `    ${chalk.dim('Created:')} ${formatRelativeTime(c.createdAt)}  ${chalk.dim('Abandoned:')} ${formatRelativeTime(c.abandonedAt)}`,
  );
  console.log();
}

// ---------------------------------------------------------------------------
// trellis issue
// ---------------------------------------------------------------------------

function formatIssueStatus(status: string | undefined): string {
  switch (status) {
    case 'backlog':
      return chalk.gray('backlog');
    case 'queue':
      return chalk.blue('queue');
    case 'in_progress':
      return chalk.yellow('in_progress');
    case 'paused':
      return chalk.magenta('paused');
    case 'closed':
      return chalk.green('closed');
    default:
      return chalk.dim(status ?? 'unknown');
  }
}

function formatPriority(p: string | undefined): string {
  switch (p) {
    case 'critical':
      return chalk.red('critical');
    case 'high':
      return chalk.yellow('high');
    case 'medium':
      return chalk.cyan('medium');
    case 'low':
      return chalk.dim('low');
    default:
      return chalk.dim(p ?? '');
  }
}

function formatCriterionStatus(status: string | undefined): string {
  switch (status) {
    case 'passed':
      return chalk.green('✓ passed');
    case 'failed':
      return chalk.red('✗ failed');
    case 'pending':
      return chalk.dim('○ pending');
    default:
      return chalk.dim(status ?? 'pending');
  }
}

const issueCmd = program
  .command('issue')
  .description('Manage issues (task tracking)');

issueCmd
  .command('create')
  .description('Create a new issue')
  .requiredOption('-t, --title <title>', 'Issue title')
  .option(
    '-P, --priority <priority>',
    'Priority: critical, high, medium, low',
    'medium',
  )
  .option('-l, --labels <labels>', 'Comma-separated labels')
  .option('--assignee <agentId>', 'Agent to assign')
  .option('--parent <id>', 'Parent issue ID (for sub-tasks)')
  .option('-d, --desc <description>', 'Short description')
  .option('--description <description>', 'Alias for --desc')
  .option(
    '-S, --status <status>',
    'Initial status: backlog (default) or queue',
    'backlog',
  )
  .option(
    '--ac <criteria...>',
    'Acceptance criteria. Prefix with "test:" for test commands',
  )
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    const labels = opts.labels
      ? opts.labels.split(',').map((l: string) => l.trim())
      : undefined;

    const criteria = opts.ac
      ? opts.ac.map((ac: string) => {
          if (ac.startsWith('test:')) {
            return { description: ac.slice(5), command: ac.slice(5) };
          }
          return { description: ac };
        })
      : undefined;

    const op = await engine.createIssue(opts.title, {
      priority: opts.priority,
      labels,
      assignee: opts.assignee,
      parentId: opts.parent,
      description: opts.desc ?? opts.description,
      status: opts.status,
      criteria,
    });

    const issueId = op.vcs?.issueId;
    console.log(chalk.green(`✓ Issue created: ${chalk.bold(issueId)}`));
    console.log(`  ${chalk.dim('Title:')}    ${opts.title}`);
    console.log(`  ${chalk.dim('Priority:')} ${formatPriority(opts.priority)}`);
    if (labels) {
      console.log(`  ${chalk.dim('Labels:')}   ${labels.join(', ')}`);
    }
    if (opts.parent) {
      console.log(`  ${chalk.dim('Parent:')}   ${opts.parent}`);
    }
    if (criteria) {
      console.log(
        `  ${chalk.dim('Criteria:')} ${criteria.length} acceptance criteria`,
      );
    }
  });

issueCmd
  .command('list')
  .description('List issues')
  .option(
    '--status <status>',
    'Filter by status: backlog, queue, in_progress, paused, closed',
  )
  .option('--label <label>', 'Filter by label')
  .option('--assignee <agentId>', 'Filter by assignee')
  .option('--parent <id>', 'Filter by parent issue')
  .option('--remote <remote>', 'Filter by remote workspace')
  .option('--all', 'Include issues from all remotes')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    let issues = engine.listIssues({
      status: opts.status,
      label: opts.label,
      assignee: opts.assignee,
      parentId: opts.parent,
    });

    // Handle remote filtering
    if (opts.remote || opts.all) {
      const { RemoteManager } = await import('../federation/remote-manager.js');
      const remoteManager = new RemoteManager(join(rootPath, '.trellis'));

      if (opts.all) {
        // Get all remotes and filter issues from them
        const remotes = remoteManager.listRemotes();
        const remoteIssues = issues.filter((issue) =>
          remotes.some((remote) => issue.id.startsWith(`${remote.name}:`)),
        );

        if (opts.remote) {
          // Filter by specific remote when --all is also used
          issues = remoteIssues.filter((issue) =>
            issue.id.startsWith(`${opts.remote}:`),
          );
        } else {
          issues = remoteIssues;
        }
      } else if (opts.remote) {
        // Filter by specific remote only
        issues = issues.filter((issue) =>
          issue.id.startsWith(`${opts.remote}:`),
        );
      }
    }

    if (issues.length === 0) {
      console.log(chalk.dim('No issues found.'));
      return;
    }

    // Group by remote for display
    const groupedIssues =
      opts.all || opts.remote
        ? issues.reduce(
            (groups, issue) => {
              const colonIndex = issue.id.indexOf(':');
              const remote =
                colonIndex > 0 ? issue.id.substring(0, colonIndex) : 'local';
              if (!groups[remote]) groups[remote] = [];
              groups[remote].push(issue);
              return groups;
            },
            {} as Record<string, typeof issues>,
          )
        : { local: issues };

    console.log(chalk.bold(`Issues (${issues.length})\n`));

    for (const [remote, remoteIssues] of Object.entries(groupedIssues)) {
      if (opts.all || opts.remote) {
        console.log(chalk.cyan(`\n${remote === 'local' ? 'Local' : remote}:`));
      }

      for (const issue of remoteIssues) {
        const labels =
          issue.labels.length > 0
            ? chalk.dim(` [${issue.labels.join(',')}]`)
            : '';
        const assignee = issue.assignee
          ? chalk.dim(` → ${issue.assignee}`)
          : '';
        const parent = issue.parentId ? chalk.dim(` ← ${issue.parentId}`) : '';
        const blocked = issue.isBlocked ? chalk.yellow(' 🔒 blocked') : '';
        const criteria =
          issue.criteria.length > 0
            ? chalk.dim(
                ` (${issue.criteria.filter((c) => c.status === 'passed').length}/${issue.criteria.length} AC)`,
              )
            : '';
        const displayId = opts.all || opts.remote ? issue.id : issue.id;
        console.log(
          `  ${formatPriority(issue.priority)} ${chalk.bold(displayId)} ${formatIssueStatus(issue.status)} ${issue.title ?? ''}${labels}${assignee}${parent}${blocked}${criteria}`,
        );
      }
    }
  });

issueCmd
  .command('show')
  .description('Show issue details')
  .argument('<id>', 'Issue ID (e.g. TRL-1)')
  .option('-p, --path <path>', 'Repository path', '.')
  .action((id, opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    const issue = engine.getIssue(id);
    if (!issue) {
      console.error(chalk.red(`Issue not found: ${id}`));
      process.exit(1);
    }

    console.log(chalk.bold(`${issue.id}: ${issue.title ?? '(untitled)'}\n`));
    if (issue.description) {
      console.log(`  ${chalk.dim(issue.description)}\n`);
    }
    console.log(
      `  ${chalk.dim('Status:')}    ${formatIssueStatus(issue.status)}`,
    );
    console.log(
      `  ${chalk.dim('Priority:')}  ${formatPriority(issue.priority)}`,
    );
    if (issue.labels.length > 0) {
      console.log(`  ${chalk.dim('Labels:')}    ${issue.labels.join(', ')}`);
    }
    if (issue.assignee) {
      console.log(`  ${chalk.dim('Assignee:')}  ${issue.assignee}`);
    }
    if (issue.parentId) {
      console.log(`  ${chalk.dim('Parent:')}    ${issue.parentId}`);
    }
    if (issue.branchName) {
      console.log(`  ${chalk.dim('Branch:')}    ${issue.branchName}`);
    }
    if (issue.blockedBy.length > 0) {
      console.log(
        `  ${chalk.dim('Blocked by:')} ${issue.blockedBy.map((b) => chalk.yellow(b)).join(', ')}`,
      );
    }
    if (issue.blocking.length > 0) {
      console.log(
        `  ${chalk.dim('Blocking:')}  ${issue.blocking.map((b) => chalk.cyan(b)).join(', ')}`,
      );
    }
    if (issue.createdAt) {
      console.log(
        `  ${chalk.dim('Created:')}   ${formatRelativeTime(issue.createdAt)}`,
      );
    }
    if (issue.startedAt) {
      console.log(
        `  ${chalk.dim('Started:')}   ${formatRelativeTime(issue.startedAt)}`,
      );
    }
    if (issue.closedAt) {
      console.log(
        `  ${chalk.dim('Closed:')}    ${formatRelativeTime(issue.closedAt)}`,
      );
    }

    if (issue.criteria.length > 0) {
      console.log(`\n  ${chalk.bold('Acceptance Criteria:')}`);
      for (const c of issue.criteria) {
        const desc = c.description ?? c.id;
        const cmd = c.command ? chalk.dim(` (${c.command})`) : '';
        console.log(`    ${formatCriterionStatus(c.status)} ${desc}${cmd}`);
      }
    }
  });

issueCmd
  .command('start')
  .description('Start working on an issue (creates branch, lane, auto-assigns)')
  .argument('<id>', 'Issue ID')
  .option('--no-lane', 'Skip auto-create/enter agent lane')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (id, opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    await engine.startIssue(id, { lane: !opts.noLane });
    const issue = engine.getIssue(id);
    console.log(chalk.green(`✓ Started issue ${chalk.bold(id)}`));
    if (issue?.branchName) {
      console.log(`  ${chalk.dim('Branch:')}   ${issue.branchName}`);
    }
    if (issue?.assignee) {
      console.log(`  ${chalk.dim('Assignee:')} ${issue.assignee}`);
    }
    const laneId = engine.getActiveLaneId();
    if (laneId) {
      console.log(`  ${chalk.dim('Lane:')}     ${laneId}`);
      console.log(chalk.dim(`  export TRELLIS_LANE_ID=${laneId}`));
    }
  });

issueCmd
  .command('pause')
  .description('Pause an in-progress issue (switches to default branch)')
  .argument('<id>', 'Issue ID')
  .requiredOption(
    '-n, --note <note>',
    'Why paused and what must happen before resuming',
  )
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (id, opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    await engine.pauseIssue(id, opts.note);
    console.log(chalk.yellow(`⏸ Paused issue ${chalk.bold(id)}`));
    console.log(`  ${chalk.dim('Note:')} ${opts.note}`);
    console.log(`  ${chalk.dim('Switched to:')} ${engine.getCurrentBranch()}`);
  });

issueCmd
  .command('resume')
  .description('Resume a paused issue (switches to issue branch and lane)')
  .argument('<id>', 'Issue ID')
  .option('--no-lane', 'Do not re-enter linked agent lane')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (id, opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    await engine.resumeIssue(id, { lane: !opts.noLane });
    const issue = engine.getIssue(id);
    console.log(chalk.green(`▶ Resumed issue ${chalk.bold(id)}`));
    if (issue?.branchName) {
      console.log(`  ${chalk.dim('Branch:')} ${issue.branchName}`);
    }
    const laneId = engine.getActiveLaneId();
    if (laneId) {
      console.log(`  ${chalk.dim('Lane:')}   ${laneId}`);
    }
  });

issueCmd
  .command('triage')
  .description('Move a backlog issue to queue (ready to start)')
  .argument('<id>', 'Issue ID')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (id, opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    await engine.triageIssue(id);
    console.log(chalk.green(`✓ Triaged ${chalk.bold(id)} → queue`));
  });

issueCmd
  .command('update')
  .description('Update issue metadata')
  .argument('<id>', 'Issue ID')
  .option('--title <title>', 'New title')
  .option('-d, --desc <description>', 'Short description')
  .option('--description <description>', 'Alias for --desc')
  .option(
    '--status <status>',
    'New status: backlog, queue, in_progress, paused, closed',
  )
  .option('-P, --priority <priority>', 'Priority: critical, high, medium, low')
  .option('-l, --labels <labels>', 'Comma-separated labels')
  .option('--assignee <agentId>', 'Agent to assign')
  .option('--parent <id>', 'Parent issue ID (re-parent sub-task)')
  .option('--clear-parent', 'Remove parent link')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (id, opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    const updates: Record<string, any> = {};
    if (opts.title !== undefined) updates.title = opts.title;
    const desc = opts.desc ?? opts.description;
    if (desc !== undefined) updates.description = desc;
    if (opts.status !== undefined) updates.status = opts.status;
    if (opts.priority !== undefined) updates.priority = opts.priority;
    if (opts.labels !== undefined) {
      updates.labels = opts.labels.split(',').map((l: string) => l.trim());
    }
    if (opts.assignee !== undefined) updates.assignee = opts.assignee;
    if (opts.clearParent) {
      updates.parentId = null;
    } else if (opts.parent !== undefined) {
      updates.parentId = opts.parent;
    }

    await engine.updateIssue(id, updates);
    console.log(chalk.green(`✓ Updated ${chalk.bold(id)}`));
  });

issueCmd
  .command('describe')
  .description('Set an issue description')
  .argument('<id>', 'Issue ID')
  .argument('<description>', 'Short description text')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (id, description, opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    await engine.updateIssue(id, { description });
    console.log(chalk.green(`✓ Description set for ${chalk.bold(id)}`));
  });

issueCmd
  .command('assign')
  .description('Assign an issue to an agent')
  .argument('<id>', 'Issue ID')
  .requiredOption('--to <agentId>', 'Agent ID to assign')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (id, opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    await engine.assignIssue(id, opts.to);
    console.log(chalk.green(`✓ Assigned ${chalk.bold(id)} → ${opts.to}`));
  });

issueCmd
  .command('ac')
  .description('Add acceptance criterion to an issue')
  .argument('<id>', 'Issue ID')
  .argument('<description>', 'Criterion description')
  .option('--test <command>', 'Shell command to validate (exit 0 = pass)')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (id, description, opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    await engine.addCriterion(id, description, opts.test);
    const cmdNote = opts.test ? chalk.dim(` (test: ${opts.test})`) : '';
    console.log(
      chalk.green(
        `✓ Added criterion to ${chalk.bold(id)}: ${description}${cmdNote}`,
      ),
    );
  });

issueCmd
  .command('ac-pass')
  .description('Manually mark an acceptance criterion as passed')
  .argument('<id>', 'Issue ID')
  .argument('<index>', 'Criterion number (1-based)')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (id, index, opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    await engine.setCriterionStatus(id, parseInt(index, 10), 'passed');
    console.log(
      chalk.green(
        `✓ Criterion #${index} on ${chalk.bold(id)} marked as passed`,
      ),
    );
  });

issueCmd
  .command('ac-fail')
  .description('Manually mark an acceptance criterion as failed')
  .argument('<id>', 'Issue ID')
  .argument('<index>', 'Criterion number (1-based)')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (id, index, opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    await engine.setCriterionStatus(id, parseInt(index, 10), 'failed');
    console.log(
      chalk.red(`✗ Criterion #${index} on ${chalk.bold(id)} marked as failed`),
    );
  });

issueCmd
  .command('check')
  .description('Run acceptance criteria for an issue')
  .argument('<id>', 'Issue ID')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (id, opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    console.log(chalk.bold(`Running criteria for ${id}...\n`));
    const results = await engine.runCriteria(id);

    if (results.length === 0) {
      console.log(chalk.dim('No acceptance criteria defined.'));
      return;
    }

    for (const r of results) {
      const desc = r.description ?? r.id;
      const statusStr =
        r.status === 'passed'
          ? chalk.green('✓ PASSED')
          : r.status === 'failed'
            ? chalk.red('✗ FAILED')
            : chalk.dim('○ SKIPPED');
      console.log(`  ${statusStr}  ${desc}`);
      if (r.command) {
        console.log(`    ${chalk.dim('$')} ${r.command}`);
      }
      if (r.output && r.status === 'failed') {
        const lines = r.output.split('\n').slice(0, 5);
        for (const line of lines) {
          console.log(`    ${chalk.dim(line)}`);
        }
      }
    }

    const passed = results.filter((r) => r.status === 'passed').length;
    const total = results.length;
    console.log();
    if (passed === total) {
      console.log(
        chalk.green(
          `All ${total} criteria passed. Close with: trellis issue close ${id} --confirm`,
        ),
      );
    } else {
      console.log(chalk.yellow(`${passed}/${total} criteria passing.`));
    }
  });

issueCmd
  .command('close')
  .description('Close an issue (requires all criteria pass + --confirm)')
  .argument('<id>', 'Issue ID')
  .option('--confirm', 'Confirm closure after criteria pass')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (id, opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    const lane = engine.findLaneForIssue(id);
    if (
      lane &&
      lane.status === 'active' &&
      engine.getLaneOpCount(lane.id) > 0
    ) {
      console.log(
        chalk.yellow(
          `⚠ Lane ${lane.id} has unpromoted ops — promote before close when W3 lands (trellis lane promote)`,
        ),
      );
    }

    try {
      const result = await engine.closeIssue(id, { confirm: opts.confirm });

      if (!result.op) {
        // Criteria passed but no --confirm
        console.log(chalk.bold(`Criteria status for ${id}:\n`));
        for (const r of result.criteriaResults) {
          console.log(
            `  ${formatCriterionStatus(r.status)}  ${r.description ?? r.id}`,
          );
        }
        console.log();
        console.log(
          chalk.yellow(
            `All criteria pass. Re-run with --confirm to close: trellis issue close ${id} --confirm`,
          ),
        );
        return;
      }

      console.log(chalk.green(`✓ Issue ${chalk.bold(id)} closed`));
    } catch (err: any) {
      console.error(chalk.red(err.message));
      process.exit(1);
    }
  });

issueCmd
  .command('reopen')
  .description('Reopen a closed issue')
  .argument('<id>', 'Issue ID')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (id, opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    await engine.reopenIssue(id);
    console.log(chalk.green(`✓ Issue ${chalk.bold(id)} reopened`));
  });

issueCmd
  .command('block')
  .description('Mark an issue as blocked by another issue')
  .argument('<id>', 'Issue ID to block')
  .argument('<blockedBy>', 'Issue ID that blocks it')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (id, blockedBy, opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    await engine.blockIssue(id, blockedBy);
    console.log(
      chalk.yellow(
        `🔒 ${chalk.bold(id)} is now blocked by ${chalk.bold(blockedBy)}`,
      ),
    );
  });

issueCmd
  .command('unblock')
  .description('Remove a blocking relationship')
  .argument('<id>', 'Blocked issue ID')
  .argument('<blockedBy>', 'Blocking issue ID to remove')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (id, blockedBy, opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    await engine.unblockIssue(id, blockedBy);
    console.log(
      chalk.green(
        `🔓 ${chalk.bold(id)} is no longer blocked by ${chalk.bold(blockedBy)}`,
      ),
    );
  });

issueCmd
  .command('active')
  .description('Show all active (in-progress) issues')
  .option('-p, --path <path>', 'Repository path', '.')
  .action((opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    const active = engine.getActiveIssues();
    if (active.length === 0) {
      console.log(chalk.dim('No active issues.'));
      return;
    }

    console.log(chalk.bold(`Active Issues (${active.length})\n`));
    for (const issue of active) {
      const branch = issue.branchName
        ? chalk.dim(` on ${issue.branchName}`)
        : '';
      const assignee = issue.assignee ? chalk.dim(` → ${issue.assignee}`) : '';
      console.log(
        `  ${formatPriority(issue.priority)} ${chalk.bold(issue.id)} ${issue.title ?? ''}${branch}${assignee}`,
      );
    }
  });

issueCmd
  .command('readiness')
  .description(
    'Check if all issues are complete (no queue, paused, or in-progress)',
  )
  .option('-p, --path <path>', 'Repository path', '.')
  .action((opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    const result = engine.checkCompletionReadiness();
    console.log(result.summary);

    if (!result.ready) {
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// trellis decision
// ---------------------------------------------------------------------------

const decisionCmd = program
  .command('decision')
  .description('Manage decision traces');

decisionCmd
  .command('list')
  .description('List decision traces')
  .option('-p, --path <path>', 'Repository path', '.')
  .option(
    '-t, --tool <pattern>',
    'Filter by tool name pattern (e.g. "trellis_issue_*")',
  )
  .option('-e, --entity <id>', 'Filter by related entity ID')
  .option('-n, --limit <n>', 'Max results', '20')
  .action((opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    const decisions = engine.queryDecisions({
      toolPattern: opts.tool,
      entityId: opts.entity,
      limit: parseInt(opts.limit, 10),
    });

    if (decisions.length === 0) {
      console.log(chalk.dim('No decision traces found.'));
      return;
    }

    for (const d of decisions) {
      const ts = d.createdAt ? chalk.dim(d.createdAt) : '';
      console.log(`${chalk.cyan(d.id)}  ${chalk.white(d.toolName)}  ${ts}`);
      if (d.rationale) {
        console.log(`  ${chalk.dim('→')} ${d.rationale}`);
      }
    }
  });

decisionCmd
  .command('show')
  .description('Show full details of a decision trace')
  .argument('<id>', 'Decision ID (e.g. DEC-1)')
  .option('-p, --path <path>', 'Repository path', '.')
  .action((id, opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    const d = engine.getDecision(id);
    if (!d) {
      console.error(chalk.red(`Decision ${id} not found.`));
      process.exit(1);
    }

    console.log(`${chalk.bold('ID:')}         ${d.id}`);
    console.log(`${chalk.bold('Tool:')}       ${d.toolName}`);
    console.log(`${chalk.bold('Created:')}    ${d.createdAt ?? 'unknown'}`);
    console.log(`${chalk.bold('Agent:')}      ${d.createdBy ?? 'unknown'}`);
    if (d.context) console.log(`${chalk.bold('Context:')}    ${d.context}`);
    if (d.rationale) console.log(`${chalk.bold('Rationale:')}  ${d.rationale}`);
    if (d.alternatives && d.alternatives.length > 0) {
      console.log(
        `${chalk.bold('Alternatives:')} ${d.alternatives.join(', ')}`,
      );
    }
    if (d.outputSummary) {
      console.log(`${chalk.bold('Output:')}    ${d.outputSummary}`);
    }
    if (d.relatedEntities.length > 0) {
      console.log(
        `${chalk.bold('Related:')}   ${d.relatedEntities.join(', ')}`,
      );
    }
  });

decisionCmd
  .command('chain')
  .description('Trace all decisions that affected a given entity')
  .argument(
    '<entityId>',
    'Entity ID (e.g. "issue:TRL-5", "file:src/engine.ts")',
  )
  .option('-p, --path <path>', 'Repository path', '.')
  .action((entityId, opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    const chain = engine.getDecisionChain(entityId);
    if (chain.length === 0) {
      console.log(chalk.dim(`No decision traces found for ${entityId}.`));
      return;
    }

    console.log(
      chalk.bold(`Decision chain for ${entityId} (${chain.length} decisions):`),
    );
    for (const d of chain) {
      const ts = d.createdAt ? chalk.dim(d.createdAt) : '';
      console.log(`  ${chalk.cyan(d.id)}  ${chalk.white(d.toolName)}  ${ts}`);
      if (d.rationale) {
        console.log(`    ${chalk.dim('→')} ${d.rationale}`);
      }
    }
  });

// ---------------------------------------------------------------------------
// trellis identity
// ---------------------------------------------------------------------------

program
  .command('identity')
  .description('Manage local identity (Ed25519 key pair)')
  .argument('[action]', '"init" or "show" (default: show)')
  .option('-p, --path <path>', 'Repository path', '.')
  .option('--name <name>', 'Display name for new identity')
  .option('--email <email>', 'Email for new identity')
  .action((action, opts) => {
    const rootPath = resolve(opts.path);
    const trellisDir = join(rootPath, '.trellis');

    if (action === 'init') {
      if (hasIdentity(trellisDir)) {
        console.error(
          chalk.yellow(
            'Identity already exists. Use `trellis identity` to view it.',
          ),
        );
        process.exit(1);
      }

      const name = opts.name ?? 'Anonymous';
      const email = opts.email;

      const identity = createIdentity({ displayName: name, email });
      saveIdentity(trellisDir, identity);

      console.log(chalk.green('✓ Identity created'));
      console.log(`  ${chalk.dim('Name:')}  ${identity.displayName}`);
      if (identity.email) {
        console.log(`  ${chalk.dim('Email:')} ${identity.email}`);
      }
      console.log(`  ${chalk.dim('DID:')}   ${identity.did}`);
      console.log(`  ${chalk.dim('ID:')}    ${identity.entityId}`);
      return;
    }

    // Show (default)
    const identity = loadIdentity(trellisDir);
    if (!identity) {
      console.log(
        chalk.dim(
          'No identity configured. Run `trellis identity init --name "Your Name"`.',
        ),
      );
      return;
    }

    const pub = toPublicIdentity(identity);
    console.log(chalk.bold('Identity\n'));
    console.log(`  ${chalk.dim('Name:')}       ${pub.displayName}`);
    if (pub.email) {
      console.log(`  ${chalk.dim('Email:')}      ${pub.email}`);
    }
    console.log(`  ${chalk.dim('DID:')}        ${pub.did}`);
    console.log(`  ${chalk.dim('Entity ID:')}  ${pub.entityId}`);
    console.log(`  ${chalk.dim('Public Key:')} ${pub.publicKey.slice(0, 32)}…`);
    console.log(`  ${chalk.dim('Created:')}    ${pub.createdAt}`);
  });

// ---------------------------------------------------------------------------
// trellis refs
// ---------------------------------------------------------------------------

program
  .command('refs')
  .description('List wiki-link references in files or find backlinks')
  .argument('[file]', 'File to list outgoing refs for')
  .option('-p, --path <path>', 'Repository path', '.')
  .option(
    '--backlinks <entity>',
    'Show all files referencing an entity (e.g. TRL-5)',
  )
  .option('--broken', 'List all broken and stale references')
  .option('--stats', 'Show reference index statistics')
  .action((file, opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    const { readFileSync } = require('fs');
    const {
      parseFileRefs,
      buildRefIndex,
      getOutgoingRefs,
      getBacklinks,
      getIndexStats,
    } = require('../links/index.js');
    const {
      resolveRef,
      resolveRefs,
      createResolverContext,
    } = require('../links/index.js');
    const { StaleRefRegistry, getDiagnostics } = require('../links/index.js');

    // Build resolver context from engine
    const resolverCtx = createResolverContext(engine);

    // Scan all tracked .md files and source files to build the index
    const trackedFiles = engine.trackedFiles();
    const fileContents: Array<{ path: string; content: string }> = [];
    for (const f of trackedFiles) {
      try {
        const absPath = join(rootPath, f.path);
        const content = readFileSync(absPath, 'utf-8');
        fileContents.push({ path: f.path, content });
      } catch {
        // File may not exist on disk
      }
    }

    const index = buildRefIndex(fileContents, resolverCtx);

    // --stats: show index statistics
    if (opts.stats) {
      const stats = getIndexStats(index);
      console.log(chalk.bold('Reference Index Stats\n'));
      console.log(`  ${chalk.dim('Files with refs:')} ${stats.totalFiles}`);
      console.log(`  ${chalk.dim('Total refs:')}      ${stats.totalRefs}`);
      console.log(`  ${chalk.dim('Unique entities:')} ${stats.totalEntities}`);
      return;
    }

    // --backlinks <entity>: show all sources referencing an entity
    if (opts.backlinks) {
      const entity = opts.backlinks;
      // Try common entity ID formats
      const candidates = [
        `issue:${entity}`,
        `file:${entity}`,
        `symbol:${entity}`,
        `identity:${entity}`,
        `milestone:${entity}`,
        `decision:${entity}`,
        entity, // raw entity ID
      ];

      let found = false;
      for (const eid of candidates) {
        const sources = getBacklinks(index, eid);
        if (sources.length > 0) {
          console.log(
            chalk.bold(
              `Backlinks for ${chalk.cyan(eid)} (${sources.length})\n`,
            ),
          );
          for (const s of sources) {
            console.log(
              `  ${chalk.dim(s.filePath)}:${s.line}  ${chalk.dim(`(${s.context})`)}`,
            );
          }
          found = true;
          break;
        }
      }

      if (!found) {
        console.log(chalk.dim(`No references found for: ${entity}`));
      }
      return;
    }

    // --broken: list all broken and stale refs
    if (opts.broken) {
      const registry = new StaleRefRegistry();
      const resolvedIds = new Set<string>();

      // Resolve all refs to build the resolved set
      for (const [, refs] of index.outgoing) {
        for (const ref of refs) {
          const resolved = resolveRef(ref, resolverCtx);
          if (resolved.state === 'resolved' && resolved.entityId) {
            resolvedIds.add(resolved.entityId);
          }
        }
      }

      const diags = getDiagnostics(index, registry, resolvedIds);

      if (diags.length === 0) {
        console.log(chalk.green('✓ No broken or stale references found.'));
        return;
      }

      const stale = diags.filter((d: any) => d.state === 'stale');
      const broken = diags.filter((d: any) => d.state === 'broken');

      if (broken.length > 0) {
        console.log(
          chalk.bold(chalk.red(`Broken references (${broken.length})\n`)),
        );
        for (const d of broken) {
          console.log(
            `  ${chalk.red('✗')} ${d.source.filePath}:${d.source.line}  ${d.message}`,
          );
        }
        console.log();
      }

      if (stale.length > 0) {
        console.log(
          chalk.bold(chalk.yellow(`Stale references (${stale.length})\n`)),
        );
        for (const d of stale) {
          console.log(
            `  ${chalk.yellow('⚠')} ${d.source.filePath}:${d.source.line}  ${d.message}`,
          );
        }
      }
      return;
    }

    // Default: list outgoing refs for a specific file (or all files)
    if (file) {
      const refs = getOutgoingRefs(index, file);
      if (refs.length === 0) {
        console.log(chalk.dim(`No [[...]] references found in: ${file}`));
        return;
      }

      console.log(
        chalk.bold(`References in ${chalk.cyan(file)} (${refs.length})\n`),
      );
      for (const ref of refs) {
        const resolved = resolveRef(ref, resolverCtx);
        const stateIcon =
          resolved.state === 'resolved'
            ? chalk.green('✓')
            : resolved.state === 'stale'
              ? chalk.yellow('⚠')
              : chalk.red('✗');
        const display = ref.alias ?? ref.raw;
        const entityId = resolved.entityId ?? chalk.dim('unresolved');
        console.log(
          `  ${stateIcon} [[${display}]]  → ${entityId}  ${chalk.dim(`L${ref.source.line}`)}`,
        );
      }
    } else {
      // List all files with refs
      const stats = getIndexStats(index);
      if (stats.totalRefs === 0) {
        console.log(
          chalk.dim('No [[...]] references found in any tracked files.'),
        );
        return;
      }

      console.log(
        chalk.bold(
          `References (${stats.totalRefs} across ${stats.totalFiles} files)\n`,
        ),
      );
      for (const [filePath, refs] of index.outgoing) {
        console.log(`  ${chalk.cyan(filePath)} (${refs.length} refs)`);
        for (const ref of refs) {
          const resolved = resolveRef(ref, resolverCtx);
          const stateIcon =
            resolved.state === 'resolved'
              ? chalk.green('✓')
              : resolved.state === 'stale'
                ? chalk.yellow('⚠')
                : chalk.red('✗');
          console.log(
            `    ${stateIcon} [[${ref.raw}]]  ${chalk.dim(`L${ref.source.line}`)}`,
          );
        }
      }
    }
  });

// ---------------------------------------------------------------------------
// trellis search
// ---------------------------------------------------------------------------

program
  .command('search')
  .description('Semantic search across all embedded content')
  .argument('<query>', 'Natural language search query')
  .option('-p, --path <path>', 'Repository path', '.')
  .option('-l, --limit <n>', 'Max results', '10')
  .option(
    '-t, --type <types>',
    'Filter by chunk type(s), comma-separated (issue_title,issue_desc,milestone_msg,markdown,code_entity,doc_comment,summary_md)',
  )
  .action(async (query, opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    const { EmbeddingManager } = require('../embeddings/index.js');

    const dbPath = join(rootPath, '.trellis', 'embeddings.db');
    const manager = await EmbeddingManager.create(dbPath);

    try {
      const searchOpts: any = {
        limit: parseInt(opts.limit, 10) || 10,
      };
      if (opts.type) {
        searchOpts.types = opts.type.split(',').map((t: string) => t.trim());
      }

      const results = await manager.search(query, searchOpts);

      if (results.length === 0) {
        console.log(
          chalk.dim(
            'No results found. Try `trellis reindex` to build the index.',
          ),
        );
        return;
      }

      console.log(
        chalk.bold(
          `Search results for ${chalk.cyan(`"${query}"`)} (${results.length})\n`,
        ),
      );

      for (const r of results) {
        const score = (r.score * 100).toFixed(1);
        const typeTag = chalk.dim(`[${r.chunk.chunkType}]`);
        const filePart = r.chunk.filePath
          ? chalk.dim(` ${r.chunk.filePath}`)
          : '';
        const preview = r.chunk.content.slice(0, 120).replace(/\n/g, ' ');

        console.log(`  ${chalk.green(`${score}%`)} ${typeTag}${filePart}`);
        console.log(`    ${chalk.dim(preview)}`);
        console.log();
      }
    } finally {
      manager.close();
    }
  });

// ---------------------------------------------------------------------------
// trellis reindex
// ---------------------------------------------------------------------------

program
  .command('reindex')
  .description('Rebuild the semantic embedding index')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    const { EmbeddingManager } = require('../embeddings/index.js');

    const dbPath = join(rootPath, '.trellis', 'embeddings.db');
    const manager = await EmbeddingManager.create(dbPath);

    try {
      console.log(chalk.dim('Loading embedding model…'));
      const result = await manager.reindex(engine);
      console.log(chalk.green(`✓ Indexed ${result.chunks} chunks`));

      const stats = manager.stats();
      console.log(chalk.dim(`  Types: ${JSON.stringify(stats.byType)}`));
    } finally {
      manager.close();
    }
  });

// ---------------------------------------------------------------------------
// trellis ui
// ---------------------------------------------------------------------------

program
  .command('ui')
  .description(
    'Launch the live graph explorer (SvelteKit realtime-app at demo/realtime-app)',
  )
  .option('-p, --path <path>', 'Repository path (init .trellis if missing)', '.')
  .option('--port <port>', 'SvelteKit app port', '4000')
  .option('--trellis-port <port>', 'Trellis graph sidecar port', '3920')
  .option(
    '--legacy',
    'Use legacy client.html System Visualizer instead of the Svelte explorer',
  )
  .option('--no-open', 'Do not auto-open browser')
  .action(async (opts) => {
    const rootPath = resolveRepoRoot(opts.path);
    const appPort = parseInt(opts.port, 10) || 4000;
    const trellisPort = parseInt(opts.trellisPort, 10) || 3920;

    const openBrowser = (url: string) => {
      if (opts.open === false) return;
      const { exec } = require('child_process');
      const cmd =
        process.platform === 'darwin'
          ? 'open'
          : process.platform === 'win32'
            ? 'start'
            : 'xdg-open';
      exec(`${cmd} ${url}`);
    };

    if (opts.legacy) {
      const { startUIServer } = require('../ui/server.js');
      try {
        const server = await startUIServer({ rootPath, port: appPort });
        const url = `http://localhost:${server.port}`;
        console.log(
          chalk.yellow('Legacy System Visualizer (client.html)'),
        );
        console.log(
          chalk.green(`✓ Running at ${chalk.bold(url)}`),
        );
        openBrowser(url);
        process.on('SIGINT', () => {
          server.stop();
          process.exit(0);
        });
      } catch (err: any) {
        console.error(chalk.red(`Failed to start server: ${err.message}`));
        process.exit(1);
      }
      return;
    }

    try {
      const { launchRealtimeExplorer } = await import(
        '../ui/launch-explorer.js'
      );
      console.log(
        chalk.dim(`Workspace: ${rootPath}`),
      );
      console.log(
        chalk.dim('Starting Svelte realtime explorer (sidecar + Vite)…\n'),
      );
      const handle = await launchRealtimeExplorer({
        rootPath,
        appPort,
        trellisPort,
      });
      console.log(
        chalk.green(`✓ Live graph explorer → ${chalk.bold(handle.appUrl)}`),
      );
      console.log(
        chalk.dim(`  Trellis sidecar / inspector → ${handle.trellisUrl}`),
      );
      console.log(chalk.dim('  Press Ctrl+C to stop\n'));
      openBrowser(handle.appUrl);

      process.on('SIGINT', () => {
        handle.stop();
        console.log(chalk.dim('\nExplorer stopped.'));
        process.exit(0);
      });
    } catch (err: any) {
      console.error(chalk.red(`Failed to start explorer: ${err.message}`));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// Kernel helper — boots a TrellisKernel from a .trellis directory
// ---------------------------------------------------------------------------

async function bootKernel(rootPath: string): Promise<TrellisKernel> {
  const dbPath = join(rootPath, '.trellis', 'kernel.db');
  const { createKernelBackend } = await import('../core/persist/factory.js');
  const { attachStandardMiddleware } = await import(
    '../core/kernel/boot-middleware.js'
  );
  const backend = await createKernelBackend(dbPath);
  const kernel = new TrellisKernel({
    backend,
    agentId: `agent:${process.env.USER ?? 'unknown'}`,
  });
  kernel.boot();
  attachStandardMiddleware(kernel);
  return kernel;
}

// ---------------------------------------------------------------------------
// trellis entity
// ---------------------------------------------------------------------------

const entityCmd = program
  .command('entity')
  .description('Manage graph entities (generic CRUD)');

entityCmd
  .command('create')
  .description('Create a new entity in the graph')
  .requiredOption('-i, --id <id>', 'Entity ID (e.g. "project:my-app")')
  .requiredOption('-t, --type <type>', 'Entity type (e.g. "Project", "User")')
  .option('-a, --attr <attrs...>', 'Attributes as key=value pairs')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (opts: any) => {
    const rootPath = resolveRepoRoot(opts.path);

    const kernel = await bootKernel(rootPath);
    try {
      const attrs: Record<string, any> = {};
      if (opts.attr) {
        for (const pair of opts.attr) {
          const eq = pair.indexOf('=');
          if (eq === -1) continue;
          const key = pair.slice(0, eq);
          let val: any = pair.slice(eq + 1);
          // Auto-coerce numbers and booleans
          if (val === 'true') val = true;
          else if (val === 'false') val = false;
          else if (!isNaN(Number(val)) && val !== '') val = Number(val);
          attrs[key] = val;
        }
      }

      const result = await kernel.createEntity(opts.id, opts.type, attrs);
      console.log(chalk.green(`✓ Entity created: ${chalk.bold(opts.id)}`));
      console.log(`  ${chalk.dim('Type:')}  ${opts.type}`);
      console.log(`  ${chalk.dim('Facts:')} ${result.factsDelta.added}`);
      console.log(`  ${chalk.dim('Op:')}    ${result.op.hash.slice(0, 32)}…`);
    } finally {
      kernel.close();
    }
  });

entityCmd
  .command('get')
  .description('Get an entity by ID')
  .argument('<id>', 'Entity ID')
  .option('-p, --path <path>', 'Repository path', '.')
  .option('--json', 'Output as JSON')
  .action(async (id: any, opts: any) => {
    const rootPath = resolveRepoRoot(opts.path);

    const kernel = await bootKernel(rootPath);
    try {
      const entity = kernel.getEntity(id);
      if (!entity) {
        console.error(chalk.red(`Entity not found: ${id}`));
        process.exit(1);
      }

      if (opts.json) {
        const obj: Record<string, any> = { id: entity.id, type: entity.type };
        for (const f of entity.facts) {
          if (f.a !== 'type') obj[f.a] = f.v;
        }
        obj._links = entity.links.map((l) => ({
          attribute: l.a,
          target: l.e2,
          source: l.e1,
        }));
        console.log(JSON.stringify(obj, null, 2));
        return;
      }

      console.log(chalk.bold(`${entity.type}: ${entity.id}\n`));
      for (const f of entity.facts) {
        console.log(`  ${chalk.dim(f.a.padEnd(20))} ${f.v}`);
      }
      if (entity.links.length > 0) {
        console.log(`\n  ${chalk.bold('Links:')}`);
        for (const l of entity.links) {
          const dir = l.e1 === id ? '→' : '←';
          const other = l.e1 === id ? l.e2 : l.e1;
          console.log(`    ${dir} ${chalk.dim(l.a)} ${other}`);
        }
      }
    } finally {
      kernel.close();
    }
  });

entityCmd
  .command('update')
  .description('Update attributes on an existing entity')
  .argument('<id>', 'Entity ID')
  .requiredOption('-a, --attr <attrs...>', 'Attributes as key=value pairs')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (id: any, opts: any) => {
    const rootPath = resolveRepoRoot(opts.path);

    const kernel = await bootKernel(rootPath);
    try {
      const updates: Record<string, any> = {};
      for (const pair of opts.attr) {
        const eq = pair.indexOf('=');
        if (eq === -1) continue;
        const key = pair.slice(0, eq);
        let val: any = pair.slice(eq + 1);
        if (val === 'true') val = true;
        else if (val === 'false') val = false;
        else if (!isNaN(Number(val)) && val !== '') val = Number(val);
        updates[key] = val;
      }

      await kernel.updateEntity(id, updates);
      console.log(chalk.green(`✓ Updated ${chalk.bold(id)}`));
      for (const [k, v] of Object.entries(updates)) {
        console.log(`  ${chalk.dim(k)} = ${v}`);
      }
    } finally {
      kernel.close();
    }
  });

entityCmd
  .command('delete')
  .description('Delete an entity and all its facts/links')
  .argument('<id>', 'Entity ID')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (id: any, opts: any) => {
    const rootPath = resolveRepoRoot(opts.path);

    const kernel = await bootKernel(rootPath);
    try {
      const entity = kernel.getEntity(id);
      if (!entity) {
        console.error(chalk.red(`Entity not found: ${id}`));
        process.exit(1);
      }
      await kernel.deleteEntity(id);
      console.log(chalk.green(`✓ Deleted entity ${chalk.bold(id)}`));
    } finally {
      kernel.close();
    }
  });

entityCmd
  .command('list')
  .description('List entities, optionally filtered by type')
  .option('-t, --type <type>', 'Filter by entity type')
  .option('-f, --filter <filters...>', 'Attribute filters as key=value')
  .option('--json', 'Output as JSON')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (opts: any) => {
    const rootPath = resolveRepoRoot(opts.path);

    const kernel = await bootKernel(rootPath);
    try {
      let filters: Record<string, any> | undefined;
      if (opts.filter) {
        filters = {};
        for (const pair of opts.filter) {
          const eq = pair.indexOf('=');
          if (eq === -1) continue;
          const key = pair.slice(0, eq);
          let val: any = pair.slice(eq + 1);
          if (val === 'true') val = true;
          else if (val === 'false') val = false;
          else if (!isNaN(Number(val)) && val !== '') val = Number(val);
          filters[key] = val;
        }
      }

      const entities = kernel.listEntities(opts.type, filters);

      if (opts.json) {
        const out = entities.map((e) => {
          const obj: Record<string, any> = { id: e.id, type: e.type };
          for (const f of e.facts) {
            if (f.a !== 'type') obj[f.a] = f.v;
          }
          return obj;
        });
        console.log(JSON.stringify(out, null, 2));
        return;
      }

      if (entities.length === 0) {
        console.log(chalk.dim('No entities found.'));
        return;
      }

      const typeLabel = opts.type ? ` (type: ${opts.type})` : '';
      console.log(chalk.bold(`Entities (${entities.length})${typeLabel}\n`));
      for (const e of entities) {
        const nameFact = e.facts.find((f) => f.a === 'name');
        const name = nameFact ? ` ${chalk.white(String(nameFact.v))}` : '';
        console.log(
          `  ${chalk.cyan(e.type.padEnd(16))} ${chalk.bold(e.id)}${name}`,
        );
      }
    } finally {
      kernel.close();
    }
  });

// ---------------------------------------------------------------------------
// trellis fact
// ---------------------------------------------------------------------------

const factCmd = program
  .command('fact')
  .description('Add or remove individual facts on entities');

factCmd
  .command('add')
  .description('Add a fact to an entity')
  .argument('<entity>', 'Entity ID')
  .argument('<attribute>', 'Attribute name')
  .argument('<value>', 'Value')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (entity: any, attribute: any, value: any, opts: any) => {
    const rootPath = resolveRepoRoot(opts.path);

    const kernel = await bootKernel(rootPath);
    try {
      // Auto-coerce
      let val: any = value;
      if (val === 'true') val = true;
      else if (val === 'false') val = false;
      else if (!isNaN(Number(val)) && val !== '') val = Number(val);

      await kernel.addFact(entity, attribute, val);
      console.log(
        chalk.green(
          `✓ Added fact: ${chalk.bold(entity)}.${attribute} = ${val}`,
        ),
      );
    } finally {
      kernel.close();
    }
  });

factCmd
  .command('remove')
  .description('Remove a fact from an entity')
  .argument('<entity>', 'Entity ID')
  .argument('<attribute>', 'Attribute name')
  .argument('<value>', 'Value to remove')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (entity: any, attribute: any, value: any, opts: any) => {
    const rootPath = resolveRepoRoot(opts.path);

    const kernel = await bootKernel(rootPath);
    try {
      let val: any = value;
      if (val === 'true') val = true;
      else if (val === 'false') val = false;
      else if (!isNaN(Number(val)) && val !== '') val = Number(val);

      await kernel.removeFact(entity, attribute, val);
      console.log(
        chalk.green(
          `✓ Removed fact: ${chalk.bold(entity)}.${attribute} = ${val}`,
        ),
      );
    } finally {
      kernel.close();
    }
  });

factCmd
  .command('query')
  .description('Query facts by entity or attribute')
  .option('-e, --entity <id>', 'Filter by entity ID')
  .option('-a, --attribute <attr>', 'Filter by attribute')
  .option('--json', 'Output as JSON')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (opts: any) => {
    const rootPath = resolveRepoRoot(opts.path);

    const kernel = await bootKernel(rootPath);
    try {
      const store = kernel.getStore();
      let facts;

      if (opts.entity) {
        facts = store.getFactsByEntity(opts.entity);
      } else if (opts.attribute) {
        facts = store.getFactsByAttribute(opts.attribute);
      } else {
        facts = store.getAllFacts();
      }

      if (opts.json) {
        console.log(JSON.stringify(facts, null, 2));
        return;
      }

      if (facts.length === 0) {
        console.log(chalk.dim('No facts found.'));
        return;
      }

      console.log(chalk.bold(`Facts (${facts.length})\n`));
      for (const f of facts.slice(0, 100)) {
        console.log(
          `  ${chalk.cyan(f.e.padEnd(24))} ${chalk.dim(f.a.padEnd(20))} ${f.v}`,
        );
      }
      if (facts.length > 100) {
        console.log(chalk.dim(`  … +${facts.length - 100} more`));
      }
    } finally {
      kernel.close();
    }
  });

// ---------------------------------------------------------------------------
// trellis link
// ---------------------------------------------------------------------------

const linkCmd = program
  .command('link')
  .description('Add or remove links between entities');

linkCmd
  .command('add')
  .description('Add a link between two entities')
  .argument('<source>', 'Source entity ID')
  .argument('<attribute>', 'Relationship attribute')
  .argument('<target>', 'Target entity ID')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (source: any, attribute: any, target: any, opts: any) => {
    const rootPath = resolveRepoRoot(opts.path);

    const kernel = await bootKernel(rootPath);
    try {
      await kernel.addLink(source, attribute, target);
      console.log(
        chalk.green(
          `✓ Link: ${chalk.bold(source)} —[${attribute}]→ ${chalk.bold(target)}`,
        ),
      );
    } finally {
      kernel.close();
    }
  });

linkCmd
  .command('remove')
  .description('Remove a link between two entities')
  .argument('<source>', 'Source entity ID')
  .argument('<attribute>', 'Relationship attribute')
  .argument('<target>', 'Target entity ID')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (source: any, attribute: any, target: any, opts: any) => {
    const rootPath = resolveRepoRoot(opts.path);

    const kernel = await bootKernel(rootPath);
    try {
      await kernel.removeLink(source, attribute, target);
      console.log(
        chalk.green(
          `✓ Removed: ${chalk.bold(source)} —[${attribute}]→ ${chalk.bold(target)}`,
        ),
      );
    } finally {
      kernel.close();
    }
  });

linkCmd
  .command('query')
  .description('Query links for an entity')
  .option('-e, --entity <id>', 'Entity ID')
  .option('-a, --attribute <attr>', 'Relationship attribute')
  .option('--json', 'Output as JSON')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (opts: any) => {
    const rootPath = resolveRepoRoot(opts.path);

    const kernel = await bootKernel(rootPath);
    try {
      const store = kernel.getStore();
      let links;

      if (opts.entity && opts.attribute) {
        links = store.getLinksByEntityAndAttribute(opts.entity, opts.attribute);
      } else if (opts.entity) {
        links = store.getLinksByEntity(opts.entity);
      } else if (opts.attribute) {
        links = store.getLinksByAttribute(opts.attribute);
      } else {
        links = store.getAllLinks();
      }

      if (opts.json) {
        console.log(JSON.stringify(links, null, 2));
        return;
      }

      if (links.length === 0) {
        console.log(chalk.dim('No links found.'));
        return;
      }

      console.log(chalk.bold(`Links (${links.length})\n`));
      for (const l of links.slice(0, 100)) {
        console.log(
          `  ${chalk.cyan(l.e1)} —[${chalk.dim(l.a)}]→ ${chalk.cyan(l.e2)}`,
        );
      }
      if (links.length > 100) {
        console.log(chalk.dim(`  … +${links.length - 100} more`));
      }
    } finally {
      kernel.close();
    }
  });

// ---------------------------------------------------------------------------
// trellis examples
// ---------------------------------------------------------------------------

program
  .command('examples')
  .description('Print example CLI commands and EQL-S queries for this repo')
  .option('-p, --path <path>', 'Repository path', '.')
  .option('--json', 'Output as JSON')
  .action(async (opts: any) => {
    const rootPath = resolveRepoRoot(opts.path);

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    const examples = buildRepoExamples({
      issues: engine.listIssues(),
      milestones: engine.listMilestones(),
      branches: engine.listBranches(),
      files: engine.trackedFiles(),
    });

    if (opts.json) {
      console.log(JSON.stringify(examples, null, 2));
      return;
    }

    console.log(chalk.bold('Example commands for this repo\n'));
    for (const section of examples.sections) {
      console.log(chalk.cyan(section.title));
      for (const cmd of section.commands) {
        console.log(`  ${chalk.dim('$')} ${cmd}`);
      }
      console.log();
    }

    console.log(chalk.cyan('EQL-S queries'));
    console.log(
      chalk.dim('  (requires kernel materialization — run after init)\n'),
    );
    for (const cmd of examples.eql) {
      console.log(`  ${chalk.dim('$')} ${cmd}`);
    }
  });

// ---------------------------------------------------------------------------
// trellis query
// ---------------------------------------------------------------------------

program
  .command('query')
  .description('Execute an EQL-S query against the graph')
  .argument(
    '<query>',
    'EQL-S query string (or "find ?e where attr = value" shorthand)',
  )
  .option('-p, --path <path>', 'Repository path', '.')
  .option('--json', 'Output as JSON')
  .action(async (queryStr: string, opts: any) => {
    const rootPath = resolveRepoRoot(opts.path);

    const kernel = await bootKernel(rootPath);
    try {
      const store = kernel.getStore();
      const engine = new QueryEngine(store);

      let q;
      try {
        q = parseSimple(queryStr);
      } catch {
        try {
          q = parseQuery(queryStr);
        } catch (e: any) {
          console.error(chalk.red(`Parse error: ${e.message}`));
          process.exit(1);
          return;
        }
      }

      const result = engine.execute(q!);

      if (opts.json) {
        console.log(JSON.stringify(result.bindings, null, 2));
      } else {
        if (result.count === 0) {
          console.log(chalk.dim('No results.'));
        } else {
          // Determine columns
          const cols =
            result.bindings.length > 0 ? Object.keys(result.bindings[0]) : [];

          // Print header
          console.log(chalk.bold(cols.map((c) => `?${c}`).join('\t')));
          console.log(chalk.dim('─'.repeat(cols.length * 20)));

          // Print rows
          for (const row of result.bindings) {
            console.log(cols.map((c) => String(row[c] ?? '')).join('\t'));
          }

          console.log(
            chalk.dim(
              `\n${result.count} result(s) in ${result.executionTime.toFixed(1)}ms`,
            ),
          );
        }
      }
    } finally {
      kernel.close();
    }
  });

// ---------------------------------------------------------------------------
// trellis repl
// ---------------------------------------------------------------------------

program
  .command('repl')
  .description('Interactive EQL-S query shell')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (opts: any) => {
    const rootPath = resolveRepoRoot(opts.path);

    const kernel = await bootKernel(rootPath);
    const store = kernel.getStore();
    const engine = new QueryEngine(store);

    console.log(chalk.cyan.bold('Trellis EQL-S REPL'));
    console.log(
      chalk.dim(
        'Type EQL-S queries or "find ?e where attr = value" shorthand.',
      ),
    );
    console.log(chalk.dim('Type .exit to quit, .help for help.\n'));

    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.green('eql> '),
    });

    rl.prompt();

    rl.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) {
        rl.prompt();
        return;
      }

      if (trimmed === '.exit' || trimmed === '.quit') {
        kernel.close();
        rl.close();
        return;
      }

      if (trimmed === '.help') {
        console.log(`
${chalk.bold('EQL-S Query Syntax:')}
  ${chalk.cyan('SELECT')} ?var1 ?var2 ${chalk.cyan('WHERE')} { patterns } [${chalk.cyan('FILTER')} ...] [${chalk.cyan('ORDER BY')} ...] [${chalk.cyan('LIMIT')} n]

${chalk.bold('Pattern types:')}
  ${chalk.yellow('[?e "attr" "value"]')}     Fact pattern (entity, attribute, value)
  ${chalk.yellow('(?src "rel" ?tgt)')}       Link pattern (source, relationship, target)
  ${chalk.yellow('NOT [?e "attr" ?v]')}      Negation
  ${chalk.yellow('OR { ... } { ... }')}      Disjunction

${chalk.bold('Shorthand:')}
  ${chalk.yellow('find ?e where type = "Project"')}

${chalk.bold('Commands:')}
  .exit / .quit   Exit the REPL
  .stats          Show store statistics
  .help           Show this help
`);
        rl.prompt();
        return;
      }

      if (trimmed === '.stats') {
        const facts = store.getAllFacts();
        const links = store.getAllLinks();
        const types = new Set(
          facts.filter((f) => f.a === 'type').map((f) => f.v),
        );
        console.log(`  Facts: ${facts.length}`);
        console.log(`  Links: ${links.length}`);
        console.log(`  Entity types: ${[...types].join(', ') || '(none)'}`);
        rl.prompt();
        return;
      }

      try {
        let q;
        try {
          q = parseSimple(trimmed);
        } catch {
          q = parseQuery(trimmed);
        }

        const result = engine.execute(q);

        if (result.count === 0) {
          console.log(chalk.dim('No results.'));
        } else {
          const cols = Object.keys(result.bindings[0]);
          console.log(chalk.bold(cols.map((c) => `?${c}`).join('\t')));
          for (const row of result.bindings) {
            console.log(cols.map((c) => String(row[c] ?? '')).join('\t'));
          }
          console.log(
            chalk.dim(
              `${result.count} result(s) in ${result.executionTime.toFixed(1)}ms`,
            ),
          );
        }
      } catch (e: any) {
        console.error(chalk.red(`Error: ${e.message}`));
      }

      rl.prompt();
    });

    rl.on('close', () => {
      kernel.close();
      console.log(chalk.dim('Goodbye.'));
    });
  });

// ---------------------------------------------------------------------------
// trellis ontology
// ---------------------------------------------------------------------------

const ontologyCmd = program
  .command('ontology')
  .description('Manage and inspect ontology schemas');

ontologyCmd
  .command('list')
  .description('List all registered ontologies (built-in + custom)')
  .action(() => {
    const registry = new OntologyRegistry();
    for (const o of builtinOntologies) registry.register(o);

    const schemas = registry.list();
    if (schemas.length === 0) {
      console.log(chalk.dim('No ontologies registered.'));
      return;
    }

    console.log(chalk.bold(`Ontologies (${schemas.length})\n`));
    for (const s of schemas) {
      console.log(`  ${chalk.cyan(s.id)} ${chalk.dim(`v${s.version}`)}`);
      console.log(
        `    ${s.name}${s.description ? ` — ${chalk.dim(s.description)}` : ''}`,
      );
      console.log(`    Entities: ${s.entities.map((e) => e.name).join(', ')}`);
      console.log(
        `    Relations: ${s.relations.map((r) => r.name).join(', ')}`,
      );
      console.log();
    }
  });

ontologyCmd
  .command('inspect')
  .description('Inspect a specific ontology or entity type')
  .argument(
    '<name>',
    'Ontology ID (e.g. "trellis:project") or entity type name (e.g. "Project")',
  )
  .action((name: string) => {
    const registry = new OntologyRegistry();
    for (const o of builtinOntologies) registry.register(o);

    // Try as ontology ID first
    const schema = registry.get(name);
    if (schema) {
      console.log(
        chalk.bold(
          `${schema.name} ${chalk.dim(`(${schema.id} v${schema.version})`)}`,
        ),
      );
      if (schema.description) console.log(chalk.dim(schema.description));
      console.log();

      console.log(chalk.bold('Entity Types:'));
      for (const e of schema.entities) {
        console.log(
          `\n  ${chalk.cyan.bold(e.name)}${e.abstract ? chalk.dim(' (abstract)') : ''}${e.extends ? chalk.dim(` extends ${e.extends}`) : ''}`,
        );
        if (e.description) console.log(`  ${chalk.dim(e.description)}`);
        for (const a of e.attributes) {
          const flags = [
            a.required ? chalk.red('required') : null,
            a.enum ? `enum[${a.enum.join('|')}]` : null,
            a.default !== undefined ? `default=${a.default}` : null,
          ]
            .filter(Boolean)
            .join(', ');
          console.log(
            `    ${chalk.yellow(a.name)}: ${a.type}${flags ? ` (${flags})` : ''}`,
          );
        }
      }

      if (schema.relations.length > 0) {
        console.log(chalk.bold('\nRelations:'));
        for (const r of schema.relations) {
          console.log(
            `  ${chalk.yellow(r.name)}: ${r.sourceTypes.join('|')} → ${r.targetTypes.join('|')}${r.cardinality ? ` [${r.cardinality}]` : ''}`,
          );
        }
      }
      return;
    }

    // Try as entity type name
    const def = registry.getEntityDef(name);
    if (def) {
      const ontId = registry.getEntityOntology(name);
      console.log(chalk.bold(`${def.name}`) + chalk.dim(` (from ${ontId})`));
      if (def.description) console.log(chalk.dim(def.description));
      if (def.abstract)
        console.log(chalk.dim('(abstract — cannot be instantiated)'));
      if (def.extends) console.log(chalk.dim(`extends ${def.extends}`));

      console.log(chalk.bold('\nAttributes:'));
      for (const a of def.attributes) {
        const flags = [
          a.required ? chalk.red('required') : null,
          a.enum ? `enum[${a.enum.join('|')}]` : null,
          a.default !== undefined ? `default=${a.default}` : null,
        ]
          .filter(Boolean)
          .join(', ');
        console.log(
          `  ${chalk.yellow(a.name)}: ${a.type}${flags ? ` (${flags})` : ''}`,
        );
        if (a.description) console.log(`    ${chalk.dim(a.description)}`);
      }

      const rels = registry.getRelationsForType(name);
      if (rels.length > 0) {
        console.log(chalk.bold('\nRelations:'));
        for (const r of rels) {
          const dir = r.sourceTypes.includes(name) ? '→' : '←';
          console.log(
            `  ${chalk.yellow(r.name)} ${dir} ${r.sourceTypes.includes(name) ? r.targetTypes.join('|') : r.sourceTypes.join('|')}`,
          );
        }
      }
      return;
    }

    console.error(chalk.red(`Unknown ontology or entity type: "${name}"`));
    console.log(
      chalk.dim(
        'Available ontologies: ' +
          registry
            .list()
            .map((s) => s.id)
            .join(', '),
      ),
    );
    console.log(
      chalk.dim('Available types: ' + registry.listEntityTypes().join(', ')),
    );
  });

ontologyCmd
  .command('validate')
  .description(
    'Validate all entities in the graph against registered ontologies',
  )
  .option('-p, --path <path>', 'Repository path', '.')
  .option('--strict', 'Treat unknown types as errors')
  .action(async (opts: any) => {
    const rootPath = resolveRepoRoot(opts.path);

    const kernel = await bootKernel(rootPath);
    try {
      const registry = new OntologyRegistry();
      for (const o of builtinOntologies) registry.register(o);

      const store = kernel.getStore();
      const result = validateStore(store, registry);

      if (result.errors.length > 0) {
        console.log(chalk.red.bold(`✗ ${result.errors.length} error(s):\n`));
        for (const err of result.errors) {
          console.log(
            `  ${chalk.red('ERROR')} ${chalk.bold(err.entityId)} (${err.entityType}) → ${err.field}: ${err.message}`,
          );
        }
      }

      if (result.warnings.length > 0) {
        console.log(
          chalk.yellow.bold(`\n⚠ ${result.warnings.length} warning(s):\n`),
        );
        for (const w of result.warnings) {
          console.log(
            `  ${chalk.yellow('WARN')}  ${chalk.bold(w.entityId)} (${w.entityType}) → ${w.field}: ${w.message}`,
          );
        }
      }

      if (result.valid && result.warnings.length === 0) {
        console.log(chalk.green('✓ All entities pass ontology validation.'));
      } else if (result.valid) {
        console.log(chalk.green('\n✓ Valid (with warnings).'));
      } else {
        console.log(chalk.red('\n✗ Validation failed.'));
      }
    } finally {
      kernel.close();
    }
  });

// ---------------------------------------------------------------------------
// trellis ask
// ---------------------------------------------------------------------------

program
  .command('ask')
  .description('Natural language search over the graph (semantic search)')
  .argument('<question>', 'Natural language query')
  .option('-p, --path <path>', 'Repository path', '.')
  .option('-n, --limit <n>', 'Max results', '5')
  .option('--json', 'Output as JSON')
  .option('--rag', 'Output as RAG context (for LLM consumption)')
  .action(async (question: string, opts: any) => {
    const rootPath = resolveRepoRoot(opts.path);

    const dbPath = join(rootPath, '.trellis', 'embeddings.db');
    const vectorStore = await VectorStore.create(dbPath);

    try {
      const limit = parseInt(opts.limit, 10) || 5;

      if (opts.rag) {
        const ctx = await buildRAGContext(question, vectorStore, embed, {
          maxChunks: limit,
        });

        if (opts.json) {
          console.log(JSON.stringify(ctx, null, 2));
        } else {
          console.log(chalk.bold.cyan('RAG Context'));
          console.log(chalk.dim(`Query: ${ctx.query}`));
          console.log(
            chalk.dim(
              `Chunks: ${ctx.chunks.length} | ~${ctx.estimatedTokens} tokens\n`,
            ),
          );
          for (const c of ctx.chunks) {
            console.log(
              chalk.yellow(
                `[${c.score.toFixed(3)}] ${c.entityId} (${c.chunkType})`,
              ),
            );
            console.log(c.content);
            console.log();
          }
        }
      } else {
        const queryVector = await embed(question);
        const results = vectorStore.search(queryVector, { limit });

        if (opts.json) {
          console.log(
            JSON.stringify(
              results.map((r) => ({
                score: r.score,
                entityId: r.chunk.entityId,
                chunkType: r.chunk.chunkType,
                content: r.chunk.content,
              })),
              null,
              2,
            ),
          );
        } else {
          if (results.length === 0) {
            console.log(
              chalk.dim(
                'No results. Run `trellis reindex` first to build the embedding index.',
              ),
            );
          } else {
            console.log(chalk.bold(`Results for: "${question}"\n`));
            for (const r of results) {
              const score = chalk.dim(`[${r.score.toFixed(3)}]`);
              const entity = chalk.cyan(r.chunk.entityId);
              const type = chalk.dim(`(${r.chunk.chunkType})`);
              console.log(`${score} ${entity} ${type}`);
              const preview =
                r.chunk.content.length > 200
                  ? r.chunk.content.slice(0, 200) + '…'
                  : r.chunk.content;
              console.log(`  ${preview}\n`);
            }
          }
        }
      }
    } catch (err: any) {
      if (err.message?.includes('No transformers')) {
        console.error(chalk.red('Embedding model not available.'));
        console.error(chalk.dim('Install: bun add @huggingface/transformers'));
      } else {
        console.error(chalk.red(`Error: ${err.message}`));
      }
    } finally {
      vectorStore.close();
    }
  });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatOpKind(kind: string): string {
  const kindMap: Record<string, string> = {
    'vcs:fileAdd': chalk.green('+add'),
    'vcs:fileModify': chalk.yellow('~mod'),
    'vcs:fileDelete': chalk.red('-del'),
    'vcs:fileRename': chalk.blue('→ren'),
    'vcs:branchCreate': chalk.magenta('⊕branch'),
    'vcs:branchAdvance': chalk.magenta('→branch'),
    'vcs:milestoneCreate': chalk.cyan('★milestone'),
    'vcs:checkpointCreate': chalk.dim('●checkpoint'),
  };
  return kindMap[kind] ?? chalk.dim(kind);
}

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = now - then;

  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ---------------------------------------------------------------------------
// trellis db — Application database surface
// ---------------------------------------------------------------------------

const db = program
  .command('db')
  .description('Trellis DB — use Trellis as an application database');

// trellis db init
db.command('init')
  .description('Initialize a new Trellis DB in the current directory')
  .option('-p, --path <path>', 'Database directory', '.trellis-db')
  .option('--port <port>', 'Server port', '3000')
  .option('--key <key>', 'API key (auto-generated if omitted)')
  .option('--jwt-secret <secret>', 'JWT secret (auto-generated if omitted)')
  .option('--multi-tenant', 'Enable multi-tenancy (separate SQLite per tenant)')
  .action(async (opts) => {
    const { writeConfig, defaultLocalConfig, hasConfig, configPath } =
      await import('../client/config.js');
    const { resolve } = await import('path');

    if (hasConfig('.')) {
      console.log(
        chalk.yellow(
          `Already initialized (${configPath('.')}). Use \`trellis db serve\` to start.`,
        ),
      );
      return;
    }

    const dbPath = resolve(opts.path);
    const apiKey = opts.key ?? `spk_${crypto.randomUUID().replace(/-/g, '')}`;
    const jwtSecret =
      opts.jwtSecret ?? `jws_${crypto.randomUUID().replace(/-/g, '')}`;

    writeConfig(
      defaultLocalConfig(dbPath, {
        port: parseInt(opts.port),
        apiKey,
        jwtSecret,
        multiTenant: !!opts.multiTenant,
      }),
      '.',
    );

    console.log(chalk.green('✓ Trellis DB initialized'));
    console.log(chalk.dim(`  Config:     .trellis-db.json`));
    console.log(chalk.dim(`  DB path:    ${dbPath}`));
    console.log(chalk.dim(`  API key:    ${apiKey}`));
    console.log(chalk.dim(`  Port:       ${opts.port}`));
    console.log('');
    console.log(chalk.bold('Next steps:'));
    console.log(
      `  ${chalk.cyan('trellis db serve')}          Start the local HTTP server`,
    );
    console.log(
      `  ${chalk.cyan('trellis db deploy --name <n>')}  Deploy to Sprites`,
    );
  });
// trellis db serve
db.command('serve')
  .description('Start the Trellis DB HTTP + WebSocket server')
  .option('-p, --port <port>', 'Override port from config')
  .option('--config-dir <dir>', 'Directory containing .trellis-db.json', '.')
  .action(async (opts) => {
    const { readConfig } = await import('../client/config.js');
    const { TenantPool } = await import('../server/tenancy.js');
    const { startServer } = await import('../server/server.js');

    const config = readConfig(opts.configDir);
    if (!config) {
      console.error(
        chalk.red('No .trellis-db.json found. Run `trellis db init` first.'),
      );
      process.exit(1);
    }
    if (!config.dbPath) {
      console.error(
        chalk.red('Config is missing dbPath. Re-run `trellis db init`.'),
      );
      process.exit(1);
    }

    const port = opts.port ? parseInt(opts.port) : (config.port ?? 3000);
    const pool = new TenantPool(config.dbPath);
    const { startServerCrossRuntime } = await import('../server/server.js');
    const server = await startServerCrossRuntime({ port, config, pool });

    console.log(chalk.green(`✓ Trellis DB running`));
    console.log(chalk.dim(`  URL:  http://localhost:${port}`));
    console.log(chalk.dim(`  Docs: GET http://localhost:${port}/health`));
    if (config.apiKey) {
      console.log(chalk.dim(`  Key:  ${config.apiKey}`));
    }
  });

// trellis db create
db.command('create <type> [json]')
  .description('Create an entity (json can be a JSON string or @file.json)')
  .option('--config-dir <dir>', 'Config directory', '.')
  .option('--tenant <id>', 'Tenant ID')
  .action(async (type, jsonArg, opts) => {
    const { TrellisDb } = await import('../client/sdk.js');
    const db = TrellisDb.fromConfig(opts.configDir);

    let attributes: Record<string, unknown> = {};
    if (jsonArg) {
      const { readFileSync } = await import('fs');
      const raw = jsonArg.startsWith('@')
        ? readFileSync(jsonArg.slice(1), 'utf8')
        : jsonArg;
      attributes = JSON.parse(raw);
    }

    const id = await db.create(type, attributes);
    console.log(chalk.green(`✓ Created: ${chalk.bold(id)}`));
    db.close();
  });

// trellis db read
db.command('read <id>')
  .description('Read an entity by ID')
  .option('--config-dir <dir>', 'Config directory', '.')
  .action(async (id, opts) => {
    const { TrellisDb } = await import('../client/sdk.js');
    const db = TrellisDb.fromConfig(opts.configDir);
    const entity = await db.read(id);
    if (!entity) {
      console.error(chalk.red(`Not found: ${id}`));
      process.exit(1);
    }
    console.log(JSON.stringify(entity, null, 2));
    db.close();
  });

// trellis db update
db.command('update <id> <json>')
  .description('Update entity attributes (JSON string or @file.json)')
  .option('--config-dir <dir>', 'Config directory', '.')
  .action(async (id, jsonArg, opts) => {
    const { TrellisDb } = await import('../client/sdk.js');
    const db = TrellisDb.fromConfig(opts.configDir);
    const { readFileSync } = await import('fs');
    const raw = jsonArg.startsWith('@')
      ? readFileSync(jsonArg.slice(1), 'utf8')
      : jsonArg;
    await db.update(id, JSON.parse(raw));
    console.log(chalk.green(`✓ Updated: ${chalk.bold(id)}`));
    db.close();
  });

// trellis db delete
db.command('delete <id>')
  .description('Delete an entity by ID')
  .option('--config-dir <dir>', 'Config directory', '.')
  .action(async (id, opts) => {
    const { TrellisDb } = await import('../client/sdk.js');
    const db = TrellisDb.fromConfig(opts.configDir);
    await db.delete(id);
    console.log(chalk.green(`✓ Deleted: ${chalk.bold(id)}`));
    db.close();
  });

// trellis db list
db.command('list')
  .description('List entities')
  .option('--type <type>', 'Filter by entity type')
  .option('--limit <n>', 'Max results', '50')
  .option('--offset <n>', 'Offset', '0')
  .option('--config-dir <dir>', 'Config directory', '.')
  .action(async (opts) => {
    const { TrellisDb } = await import('../client/sdk.js');
    const db = TrellisDb.fromConfig(opts.configDir);
    const result = await db.list(opts.type, {
      limit: parseInt(opts.limit),
      offset: parseInt(opts.offset),
    });
    console.log(JSON.stringify(result, null, 2));
    db.close();
  });

// trellis db query
db.command('query <eql>')
  .description('Run an EQL-S query')
  .option('--config-dir <dir>', 'Config directory', '.')
  .action(async (eql, opts) => {
    const { TrellisDb } = await import('../client/sdk.js');
    const db = TrellisDb.fromConfig(opts.configDir);
    const result = await db.query(eql);
    console.log(JSON.stringify(result.bindings, null, 2));
    console.log(chalk.dim(`Execution time: ${result.executionTime}ms`));
    db.close();
  });

// trellis db upload
db.command('upload <file>')
  .description('Upload a file to the blob store')
  .option('--config-dir <dir>', 'Config directory', '.')
  .option('--type <mime>', 'MIME type (auto-detected if omitted)')
  .action(async (filePath, opts) => {
    const { readFileSync } = await import('fs');
    const { extname } = await import('path');
    const { TrellisDb } = await import('../client/sdk.js');

    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.pdf': 'application/pdf',
      '.json': 'application/json',
      '.txt': 'text/plain',
    };
    const contentType =
      opts.type ??
      mimeMap[extname(filePath).toLowerCase()] ??
      'application/octet-stream';

    const buffer = readFileSync(filePath);
    const db = TrellisDb.fromConfig(opts.configDir);
    const result = await db.upload(new Uint8Array(buffer), contentType);
    console.log(chalk.green(`✓ Uploaded`));
    console.log(chalk.dim(`  Hash: ${result.hash}`));
    console.log(chalk.dim(`  Size: ${result.size} bytes`));
    db.close();
  });

// trellis db import
db.command('import <file>')
  .description('Import data from CSV, JSON, NDJSON, or Parquet')
  .requiredOption('--type <type>', 'Entity type to assign to each record')
  .option('--id-field <field>', 'Field to use as entity ID')
  .option('--limit <n>', 'Max rows to import')
  .option('--config-dir <dir>', 'Config directory', '.')
  .option('--tenant <id>', 'Tenant ID')
  .action(async (filePath, opts) => {
    const { readConfig } = await import('../client/config.js');
    const { TenantPool } = await import('../server/tenancy.js');
    const { importFile } = await import('../server/import.js');

    const config = readConfig(opts.configDir);
    if (!config?.dbPath) {
      console.error(
        chalk.red('No .trellis-db.json found. Run `trellis db init` first.'),
      );
      process.exit(1);
    }

    const pool = new TenantPool(config.dbPath);
    const kernel = await pool.preload(opts.tenant ?? null);

    const result = await importFile(kernel, filePath, {
      type: opts.type,
      idField: opts.idField,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    console.log(chalk.green(`✓ Import complete`));
    console.log(chalk.dim(`  Imported: ${result.imported}`));
    console.log(chalk.dim(`  Skipped:  ${result.skipped}`));
    if (result.errors.length > 0) {
      console.log(chalk.yellow(`  Errors:   ${result.errors.length}`));
      result.errors.slice(0, 5).forEach((e) => {
        console.log(chalk.red(`    Row ${e.row}: ${e.message}`));
      });
    }
    pool.closeAll();
  });

// trellis db deploy
db.command('deploy')
  .description('Deploy Trellis DB to a Sprites cloud environment')
  .requiredOption('--name <name>', 'Sprite name (becomes <name>.sprites.app)')
  .option(
    '--key <key>',
    'API key for the deployed server (auto-generated if omitted)',
  )
  .option('--jwt-secret <secret>', 'JWT secret (auto-generated if omitted)')
  .option('--port <port>', 'Port to run on inside Sprite', '3000')
  .option('--config-dir <dir>', 'Config directory', '.')
  .action(async (opts) => {
    const { deploy } = await import('../server/deploy.js');
    const { readConfig } = await import('../client/config.js');

    const config = readConfig(opts.configDir);

    console.log(chalk.bold(`Deploying to Sprites: ${opts.name}...`));

    try {
      const result = await deploy({
        name: opts.name,
        dbPath: config?.dbPath,
        apiKey: opts.key,
        jwtSecret: opts.jwtSecret,
        port: opts.port ? parseInt(opts.port) : 3000,
        configDir: opts.configDir,
        onProgress: (msg) => console.log(chalk.dim(`  ${msg}`)),
      });

      console.log('');
      console.log(chalk.green(`✓ Deployed successfully`));
      console.log(chalk.dim(`  URL:    ${result.url}`));
      console.log(chalk.dim(`  Key:    ${result.apiKey}`));
      console.log('');
      console.log(chalk.bold('SDK usage:'));
      console.log(chalk.cyan(`  import { TrellisDb } from 'trellis/client';`));
      console.log(
        chalk.cyan(
          `  const db = new TrellisDb({ url: '${result.url}', apiKey: '${result.apiKey}' });`,
        ),
      );
    } catch (err: any) {
      console.error(chalk.red(`Deploy failed: ${err.message}`));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// trellis vm — Sprite VM management
// ---------------------------------------------------------------------------

const vmProgram = new Command('vm');
vmProgram
  .description('Manage Sprites VMs')
  .option('-s, --sprite <name>', 'Sprite name to operate on');

async function getSpriteName(spriteOption?: string): Promise<string> {
  if (spriteOption) return spriteOption;
  const { getActiveSprite } = await import('../server/vm-config.js');
  const active = getActiveSprite();
  if (active) return active;
  throw new Error(
    'No sprite specified. Use --sprite <name> or set an active sprite with `trellis vm use <name>`',
  );
}

// vm create <name>
vmProgram
  .command('create <name>')
  .description('Create a new Sprite and deploy Trellis DB')
  .option('-k, --api-key <key>', 'API key (auto-generated if omitted)')
  .option('-p, --port <port>', 'Port (default: 3000)', '3000')
  .action(async (name: string, cmdOpts: any) => {
    const { runSpriteCmd, assertSpriteCli } =
      await import('../server/sprites.js');
    const { trackSprite } = await import('../server/vm-config.js');
    const { deploy } = await import('../server/deploy.js');

    try {
      await assertSpriteCli();
      console.log(`Creating Sprite: ${name}...`);
      await runSpriteCmd(['exec', '--sprite', name, 'echo', 'Sprite created']);

      console.log(`Deploying Trellis DB to ${name}...`);
      const result = await deploy({
        name,
        apiKey: cmdOpts.apiKey,
        port: parseInt(cmdOpts.port),
        onProgress: (msg) => console.log(chalk.dim(`  ${msg}`)),
      });

      trackSprite(name, {
        url: result.url,
        hasTrellis: true,
        apiKey: result.apiKey,
      });

      console.log('');
      console.log(
        chalk.green(`✓ Sprite ${name} created and Trellis DB deployed`),
      );
      console.log(chalk.dim(`  URL:    ${result.url}`));
      console.log(chalk.dim(`  Key:    ${result.apiKey}`));
      console.log('');
    } catch (err: any) {
      console.error(chalk.red(`Failed: ${err.message}`));
      process.exit(1);
    }
  });

// vm list
vmProgram
  .command('list')
  .description('List all tracked Sprites')
  .action(async () => {
    const { loadVmConfig } = await import('../server/vm-config.js');

    const config = loadVmConfig();
    const sprites = config.sprites;

    if (Object.keys(sprites).length === 0) {
      console.log(
        'No Sprites tracked. Use `trellis vm create <name>` to create one.',
      );
      return;
    }

    console.log('Tracked Sprites:');
    for (const [name, sprite] of Object.entries(sprites)) {
      const activeMarker =
        config.activeSprite === name ? chalk.green('*') : ' ';
      const trellisStatus = sprite.hasTrellis
        ? chalk.green('✓ Trellis')
        : chalk.dim('○ No Trellis');
      console.log(`${activeMarker} ${name} ${trellisStatus}`);
      console.log(`    URL: ${sprite.url}`);
      if (sprite.lastCheckpoint) {
        console.log(`    Last Checkpoint: ${sprite.lastCheckpoint}`);
      }
      console.log();
    }
  });

// vm use <name>
vmProgram
  .command('use <name>')
  .description('Set the active Sprite')
  .action(async (name: string) => {
    const { runSpriteCmd, assertSpriteCli } =
      await import('../server/sprites.js');
    const { setActiveSprite } = await import('../server/vm-config.js');

    try {
      await assertSpriteCli();
      try {
        await runSpriteCmd(['list']);
      } catch {
        throw new Error(`Sprite ${name} does not exist`);
      }
      setActiveSprite(name);
      console.log(chalk.green(`✓ Active Sprite set to: ${name}`));
    } catch (err: any) {
      console.error(chalk.red(`Failed: ${err.message}`));
      process.exit(1);
    }
  });

// vm destroy <name>
vmProgram
  .command('destroy <name>')
  .description('Destroy a Sprite')
  .action(async (name: string) => {
    const { runSpriteCmd, assertSpriteCli } =
      await import('../server/sprites.js');
    const { untrackSprite } = await import('../server/vm-config.js');

    try {
      await assertSpriteCli();

      const { createInterface } = await import('readline');
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const answer = await new Promise<string>((resolve) => {
        rl.question(
          `Destroy Sprite "${name}"? Cannot be undone. (y/N) `,
          (a) => {
            rl.close();
            resolve(a.trim().toLowerCase());
          },
        );
      });

      if (answer !== 'y' && answer !== 'yes') {
        console.log('Cancelled.');
        return;
      }

      await runSpriteCmd(['destroy', '-s', name, '-y']);
      untrackSprite(name);
      console.log(chalk.green(`✓ Sprite ${name} destroyed`));
    } catch (err: any) {
      console.error(chalk.red(`Failed: ${err.message}`));
      process.exit(1);
    }
  });

// vm exec <cmd...>
vmProgram
  .command('exec <command...>')
  .description('Execute a command on the active Sprite')
  .action(async (command: string[]) => {
    const { runSpriteInteractive, assertSpriteCli } =
      await import('../server/sprites.js');

    try {
      const spriteName = await getSpriteName(vmProgram.opts().sprite);
      console.log(`Executing on ${spriteName}: ${command.join(' ')}`);
      await runSpriteInteractive(['exec', '--sprite', spriteName, ...command]);
    } catch (err: any) {
      console.error(chalk.red(`Failed: ${err.message}`));
      process.exit(1);
    }
  });

// vm console
vmProgram
  .command('console')
  .description('Open an interactive console on the active Sprite')
  .action(async () => {
    const { runSpriteInteractive, assertSpriteCli } =
      await import('../server/sprites.js');

    try {
      const spriteName = await getSpriteName(vmProgram.opts().sprite);
      console.log(`Opening console on ${spriteName}...`);
      await runSpriteInteractive(['console', '--sprite', spriteName]);
    } catch (err: any) {
      console.error(chalk.red(`Failed: ${err.message}`));
      process.exit(1);
    }
  });

// vm sessions
vmProgram
  .command('sessions')
  .description('Manage Sprite sessions')
  .argument('<action>', 'Action: list, attach, or kill')
  .argument('[sessionId]', 'Session ID (required for attach/kill)')
  .action(async (action: string, sessionId?: string) => {
    const { runSpriteCmd, runSpriteInteractive, assertSpriteCli } =
      await import('../server/sprites.js');

    try {
      const spriteName = await getSpriteName(vmProgram.opts().sprite);

      switch (action) {
        case 'list':
          await runSpriteCmd(['sessions', 'list', '--sprite', spriteName]);
          break;
        case 'attach':
          if (!sessionId) throw new Error('Session ID required for attach');
          await runSpriteInteractive([
            'sessions',
            'attach',
            '--sprite',
            spriteName,
            sessionId,
          ]);
          break;
        case 'kill':
          if (!sessionId) throw new Error('Session ID required for kill');
          await runSpriteCmd([
            'sessions',
            'kill',
            '--sprite',
            spriteName,
            sessionId,
          ]);
          console.log(chalk.green(`✓ Killed session ${sessionId}`));
          break;
        default:
          throw new Error(`Invalid action: ${action}`);
      }
    } catch (err: any) {
      console.error(chalk.red(`Failed: ${err.message}`));
      process.exit(1);
    }
  });

// vm url
vmProgram
  .command('url')
  .description('Get or update the URL for the active Sprite')
  .option('--public', 'Get public URL (default)')
  .option('--private', 'Get private URL')
  .option('--update-auth', 'Update authentication')
  .action(async (cmdOpts: any) => {
    const { runSpriteCmd, assertSpriteCli } =
      await import('../server/sprites.js');

    try {
      const spriteName = await getSpriteName(vmProgram.opts().sprite);

      if (cmdOpts.updateAuth) {
        await runSpriteCmd(['url', 'update', '--auth', '--sprite', spriteName]);
        console.log(chalk.green(`✓ Updated authentication for ${spriteName}`));
      } else {
        const urlType = cmdOpts.private ? 'private' : 'public';
        const url = await runSpriteCmd([
          'url',
          urlType,
          '--sprite',
          spriteName,
        ]);
        console.log(url.trim());
      }
    } catch (err: any) {
      console.error(chalk.red(`Failed: ${err.message}`));
      process.exit(1);
    }
  });

// vm proxy
vmProgram
  .command('proxy <ports...>')
  .description('Proxy local ports to the active Sprite')
  .action(async (ports: string[]) => {
    const { runSpriteInteractive, assertSpriteCli } =
      await import('../server/sprites.js');

    try {
      const spriteName = await getSpriteName(vmProgram.opts().sprite);
      console.log(`Proxying ports ${ports.join(', ')} to ${spriteName}...`);
      await runSpriteInteractive(['proxy', '--sprite', spriteName, ...ports]);
    } catch (err: any) {
      console.error(chalk.red(`Failed: ${err.message}`));
      process.exit(1);
    }
  });

// vm checkpoint
vmProgram
  .command('checkpoint')
  .description('Manage Sprite checkpoints')
  .argument('<action>', 'Action: create, list, or restore')
  .option('-m, --milestone <msg>', 'Message for linked milestone (create only)')
  .option('-c, --checkpoint <id>', 'Checkpoint ID (restore only)')
  .action(async (action: string, cmdOpts: any) => {
    const { runSpriteCmd, assertSpriteCli } =
      await import('../server/sprites.js');
    const { loadVmConfig, trackSprite } =
      await import('../server/vm-config.js');

    try {
      const spriteName = await getSpriteName(vmProgram.opts().sprite);

      switch (action) {
        case 'create':
          console.log(`Creating checkpoint for ${spriteName}...`);
          const output = await runSpriteCmd([
            'checkpoint',
            'create',
            '--sprite',
            spriteName,
          ]);
          const match = output.match(/checkpoint-(\S+)\s+created/);
          const checkpointId = match ? match[1] : null;

          let milestoneId: string | undefined;
          if (cmdOpts.milestone) {
            milestoneId = `milestone-${Date.now()}`;
            console.log(`Would create milestone: ${cmdOpts.milestone}`);
          }

          const config = loadVmConfig();
          const spriteConfig = config.sprites[spriteName];
          trackSprite(spriteName, {
            ...spriteConfig,
            lastCheckpoint: checkpointId ?? undefined,
            linkedMilestone: milestoneId,
          });

          console.log(
            chalk.green(`✓ Checkpoint: ${checkpointId || 'unknown'}`),
          );
          break;

        case 'list':
          await runSpriteCmd(['checkpoint', 'list', '--sprite', spriteName]);
          break;

        case 'restore':
          if (!cmdOpts.checkpoint)
            throw new Error('Checkpoint ID required: --checkpoint <id>');
          await runSpriteCmd([
            'checkpoint',
            'restore',
            '--sprite',
            spriteName,
            cmdOpts.checkpoint,
          ]);
          console.log(chalk.green(`✓ Restored: ${cmdOpts.checkpoint}`));
          break;

        default:
          throw new Error(`Invalid action: ${action}`);
      }
    } catch (err: any) {
      console.error(chalk.red(`Failed: ${err.message}`));
      process.exit(1);
    }
  });

// vm cp
vmProgram
  .command('cp <src> <dest>')
  .description('Copy files (use :prefix for remote paths)')
  .action(async (src: string, dest: string) => {
    const { runSpriteCmd, runSpriteCopy, assertSpriteCli } =
      await import('../server/sprites.js');

    try {
      const spriteName = await getSpriteName(vmProgram.opts().sprite);

      const isToSprite = !src.startsWith(':') && dest.startsWith(':');
      const isFromSprite = src.startsWith(':') && !dest.startsWith(':');

      if (isToSprite) {
        await runSpriteCopy(src, spriteName, dest.slice(1));
        console.log(
          chalk.green(`✓ Copied ${src} to ${spriteName}:${dest.slice(1)}`),
        );
      } else if (isFromSprite) {
        await runSpriteCopy(src.slice(1), spriteName, dest);
        console.log(
          chalk.green(`✓ Copied ${spriteName}:${src.slice(1)} to ${dest}`),
        );
      } else {
        await runSpriteCmd(['cp', src, dest]);
        console.log(chalk.green(`✓ Copied ${src} to ${dest}`));
      }
    } catch (err: any) {
      console.error(chalk.red(`Failed: ${err.message}`));
      process.exit(1);
    }
  });

// vm status
vmProgram
  .command('status')
  .description('Show detailed status of the active Sprite')
  .action(async () => {
    const { runSpriteCmd, assertSpriteCli } =
      await import('../server/sprites.js');
    const { loadVmConfig } = await import('../server/vm-config.js');

    try {
      const spriteName = await getSpriteName(vmProgram.opts().sprite);
      const config = loadVmConfig();
      const spriteConfig = config.sprites[spriteName];

      if (!spriteConfig) {
        console.log(chalk.red(`Sprite ${spriteName} not in config`));
        return;
      }

      console.log(`Status for: ${chalk.cyan(spriteName)}`);
      console.log(
        `  Active: ${config.activeSprite === spriteName ? chalk.green('yes') : chalk.dim('no')}`,
      );
      console.log(`  URL: ${spriteConfig.url}`);
      console.log(
        `  Trellis: ${spriteConfig.hasTrellis ? chalk.green('yes') : chalk.dim('no')}`,
      );
      if (spriteConfig.hasTrellis) {
        console.log(
          `  API Key: ${spriteConfig.apiKey ?? chalk.dim('not available')}`,
        );
      }
      if (spriteConfig.lastCheckpoint) {
        console.log(`  Checkpoint: ${spriteConfig.lastCheckpoint}`);
      }
    } catch (err: any) {
      console.error(chalk.red(`Failed: ${err.message}`));
      process.exit(1);
    }
  });

// vm code
vmProgram
  .command('code [name]')
  .description('Create Sprite, deploy Trellis, open in browser')
  .action(async (nameOpt?: string) => {
    const { runSpriteCmd, assertSpriteCli } =
      await import('../server/sprites.js');
    const { loadVmConfig, trackSprite, getActiveSprite } =
      await import('../server/vm-config.js');
    const { deploy } = await import('../server/deploy.js');
    const openUrl = (url: string) => {
      const cmd =
        process.platform === 'darwin'
          ? 'open'
          : process.platform === 'linux'
            ? 'xdg-open'
            : null;
      if (!cmd) {
        console.log(url);
        return;
      }
      const { spawn } = require('child_process');
      spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
    };

    try {
      await assertSpriteCli();

      const spriteName = nameOpt || getActiveSprite();
      if (!spriteName) {
        throw new Error(
          'No sprite name and no active sprite. Use `trellis vm use <name>` first.',
        );
      }

      try {
        await runSpriteCmd(['list']);
      } catch {
        console.log(`Creating ${spriteName}...`);
        await runSpriteCmd(['exec', '--sprite', spriteName, 'echo', 'created']);
      }

      const config = loadVmConfig();
      const spriteConfig = config.sprites[spriteName];

      if (!spriteConfig?.hasTrellis) {
        console.log(`Deploying Trellis to ${spriteName}...`);
        const result = await deploy({
          name: spriteName,
          onProgress: (msg) => console.log(chalk.dim(`  ${msg}`)),
        });
        trackSprite(spriteName, {
          url: result.url,
          hasTrellis: true,
          apiKey: result.apiKey,
        });
        console.log(chalk.green(`✓ Deployed`));
      }

      const url = spriteConfig?.url || `https://${spriteName}.sprites.app`;
      console.log(`Opening ${url}...`);
      openUrl(url);
    } catch (err: any) {
      console.error(chalk.red(`Failed: ${err.message}`));
      process.exit(1);
    }
  });

program.addCommand(vmProgram);

// ---------------------------------------------------------------------------
// trellis season — opt-in domain onboarding
// ---------------------------------------------------------------------------

program
  .command('season')
  .description('Enrich project context for agents — interactive Q&A')
  .option('-p, --path <path>', 'Repository path', '.')
  .option('--reset', 'Re-run even if previously configured')
  .action(async (opts) => {
    const rootPath = resolveRepoRoot(opts.path);

    const { createInterface } = await import('readline');
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const ask = (q: string): Promise<string> =>
      new Promise((r) => rl.question(q, (a) => r(a.trim())));

    // Load existing context
    const context = await inferProjectContext(rootPath);

    console.log(
      chalk.bold("\n  Trellis Season — let's enrich your project context\n"),
    );
    console.log(chalk.dim(`  Current domain: ${context.domain ?? '(none)'}`));
    console.log(
      chalk.dim(`  Current ecosystem: ${context.ecosystem ?? '(none)'}\n`),
    );

    const domain = await ask(
      `  What domain does this project serve? [${context.domain ?? ''}]: `,
    );
    const description = await ask(
      `  One-sentence description: [${context.description ?? ''}]: `,
    );
    const toolsRaw = await ask('  Key tools or frameworks (comma-separated): ');
    const ontologiesRaw = await ask(
      '  Domain ontologies to register (comma-separated, or skip): ',
    );

    rl.close();

    // Build updated context
    const updatedContext = {
      ...context,
      domain: domain || context.domain,
      description: description || context.description,
    };

    // Write updated scaffold
    const profile = loadProfile();
    writeAgentScaffold(rootPath, { profile, context: updatedContext });

    // Also update agent-context.json with tools/ontologies
    const agentContextPath = join(
      rootPath,
      '.trellis',
      'agents',
      'agent-context.json',
    );
    try {
      const { readFileSync, writeFileSync } = await import('fs');
      const existing = JSON.parse(readFileSync(agentContextPath, 'utf-8'));
      existing.domain = updatedContext.domain;
      if (toolsRaw) {
        existing.tools = toolsRaw
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean);
      }
      if (ontologiesRaw) {
        existing.ontologies = ontologiesRaw
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean);
      }
      existing.generatedAt = new Date().toISOString();
      existing.confidence = 'high';
      writeFileSync(agentContextPath, JSON.stringify(existing, null, 2));
    } catch {}

    console.log();
    console.log(chalk.green('✓ Project context updated'));
    console.log(
      `  ${chalk.dim('AGENTS.md:')}         .trellis/agents/AGENTS.md`,
    );
    console.log(
      `  ${chalk.dim('Agent config:')}      .trellis/agents/agent-context.json`,
    );
    if (updatedContext.domain) {
      console.log(
        `  ${chalk.dim('Domain:')}            ${chalk.cyan(updatedContext.domain)}`,
      );
    }
    console.log();
  });

// ---------------------------------------------------------------------------
// trellis code / trellis ide — Launch OpenCode in Harness mode
// ---------------------------------------------------------------------------

program
  .command('code')
  .alias('ide')
  .description(
    'Launch OpenCode in "Harness" mode, bridged to this Trellis repository',
  )
  .option('-p, --path <path>', 'Repository path', '.')
  .option('-m, --model <model>', 'OpenCode model to use')
  .option('-w, --web', 'Launch MCP server in HTTP mode for web client access')
  .option('--mcp-port <port>', 'MCP HTTP server port (default: 3333)', '3333')
  .option('--no-init', 'Skip initialization even if not a Trellis workspace')
  .action(async (opts) => {
    const { resolve, dirname, join } = await import('path');
    const { existsSync } = await import('fs');
    const { spawn } = await import('child_process');
    const { readFileSync } = await import('fs');
    const { createServer: createHttpServer } = await import('http');
    const rootPath = findRepoRoot(opts.path) ?? resolve(opts.path);

    // ── Step 1: Initialize Trellis workspace ──────────────────────────
    if (!opts.noInit) {
      if (!TrellisVcsEngine.isRepo(rootPath)) {
        console.log(chalk.dim('Not a Trellis workspace — initializing…'));
        await runInit(rootPath, {
          interactive: false,
        });
        console.log(chalk.green('✓ Initialized Trellis repository'));
      }
    }

    // ── Step 2: Locate binaries ───────────────────────────────────────
    function findOpencode(): string | null {
      const here = dirname(process.argv[1]);
      const candidates = [
        join(here, '..', 'node_modules', '.bin', 'opencode'),
        join(here, '..', '..', 'node_modules', '.bin', 'opencode'),
      ];
      let dir = here;
      for (let i = 0; i < 5; i++) {
        const p = join(dir, 'node_modules', '.bin', 'opencode');
        if (existsSync(p)) return p;
        dir = dirname(dir);
      }
      for (const p of candidates) {
        if (existsSync(p)) return p;
      }
      return null;
    }

    function findMcpServer(): string | null {
      const here = dirname(process.argv[1]);
      const candidates = [
        join(here, '..', '..', 'src', 'mcp', 'index.ts'),
        join(here, '..', 'src', 'mcp', 'index.ts'),
        join(here, '..', '..', '..', 'src', 'mcp', 'index.ts'),
        join(here, '..', 'mcp', 'index.js'),
        join(here, '..', 'mcp', 'index.ts'),
        join(here, 'mcp', 'index.ts'),
      ];
      for (const p of candidates) {
        if (existsSync(p)) return p;
      }
      return null;
    }

    const opencode = findOpencode();
    if (!opencode) {
      console.error(
        chalk.red(
          'OpenCode not found. Try running `bun install` or `npm install -g opencode-ai`.',
        ),
      );
      process.exit(1);
    }

    const mcp = findMcpServer();
    if (!mcp) {
      console.error(chalk.red('Trellis MCP server not found.'));
      process.exit(1);
    }

    // ── Step 3: Start MCP server and wait for readiness ──────────────
    const mcpPort = parseInt(opts.mcpPort, 10) || 3333;
    const mcpUrl = `http://localhost:${mcpPort}`;

    console.log(chalk.green(`⚡ Spinning up Trellis Agentic Harness...`));
    console.log(chalk.dim(`   Root:    ${rootPath}`));
    console.log(chalk.dim(`   MCP:     ${mcp}`));
    console.log(chalk.dim(`   Agent:   OpenCode`));
    if (opts.web) {
      console.log(chalk.dim(`   Web:     ${mcpUrl}`));
    }
    console.log('');

    let mcpProcess: ReturnType<typeof spawn> | null = null;

    if (opts.web) {
      console.log(chalk.dim(`   Starting MCP server on port ${mcpPort}…`));
      mcpProcess = spawn(
        'bun',
        [
          'run',
          mcp,
          '--quiet',
          '--path',
          rootPath,
          '--http',
          '--port',
          String(mcpPort),
        ],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: false,
        },
      );

      mcpProcess.stderr?.on('data', (data) => {
        const msg = data.toString();
        if (!msg.includes('TrellisVCS MCP Server')) {
          process.stderr.write(chalk.dim(`   [mcp] ${msg}`));
        }
      });

      mcpProcess.on('error', (err) => {
        console.error(
          chalk.red(`\n✗ MCP server failed to start: ${err.message}`),
        );
        process.exit(1);
      });

      // Wait for MCP server to be ready
      const ready = await waitForMcpReady(mcpUrl, 10_000);
      if (!ready) {
        console.error(chalk.red(`\n✗ MCP server did not become ready in time`));
        if (mcpProcess) {
          mcpProcess.kill();
        }
        process.exit(1);
      }
      console.log(chalk.green(`✓ MCP server ready at ${mcpUrl}`));
    }

    // ── Step 4: Launch OpenCode with MCP config ──────────────────────
    const args = [rootPath];
    if (opts.model) {
      args.push('--model', opts.model);
    }

    const mcpServers = {
      mcpServers: {
        'trellis-vcs': opts.web
          ? {
              url: `${mcpUrl}/sse`,
            }
          : {
              command: 'bun',
              args: ['run', mcp, '--quiet', '--path', rootPath],
            },
      },
    };

    const child = spawn(opencode, args, {
      stdio: 'inherit',
      env: {
        ...process.env,
        OPENCODE_MCP_CONFIG: JSON.stringify(mcpServers),
        OPENCODE_THEME: 'everforest',
        OPENCODE_ACCENT_COLOR: '#a7c080',
        OPENCODE_HEADER_TEXT: '🌿 trellis harness',
        OPENCODE_BRAND_LOGO: 'trellis',
      },
    });

    child.on('exit', (code) => {
      if (mcpProcess) {
        mcpProcess.kill();
      }
      if (code === 0) {
        console.log(chalk.green('\n✓ Agentic session complete.'));
      } else {
        console.log(chalk.yellow(`\n⚠ Agent session exited with code ${code}`));
      }
      process.exit(code ?? 0);
    });
  });

// ---------------------------------------------------------------------------
// trellis studio — Launch Trellis Studio (delegates to turtlecode CLI)
// ---------------------------------------------------------------------------

program
  .command('studio')
  .alias('web')
  .description('Launch Trellis Studio in your browser, bridged to this repo')
  .option('-p, --path <path>', 'Repository path', '.')
  .option('--port <port>', 'Studio HTTP port (defaults to turtlecode default)')
  .option(
    '--new',
    'Open the new-project prompt instead of the current directory',
  )
  .option('--no-open', 'Do not auto-open the browser')
  .option('--no-init', 'Skip initialization even if not a Trellis workspace')
  .option('--quiet-backend', 'Suppress backend stdout/stderr')
  .allowUnknownOption(true)
  .action(async (opts, command) => {
    const { resolve } = await import('path');
    const { existsSync, readFileSync } = await import('fs');
    const { spawn } = await import('child_process');
    const { createRequire } = await import('module');
    const path = await import('path');
    const rootPath = findRepoRoot(opts.path) ?? resolve(opts.path);

    if (!opts.noInit) {
      if (!TrellisVcsEngine.isRepo(rootPath)) {
        console.log(chalk.dim('Not a Trellis workspace — initializing…'));
        await runInit(rootPath, { interactive: false });
        console.log(chalk.green('✓ Initialized Trellis repository'));
      }
    }

    const requireFn = createRequire(import.meta.url);
    let turtlecodeBin: string | null = null;
    try {
      const pkgPath = requireFn.resolve('turtlecode/package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const binRel =
        typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.turtlecode;
      if (binRel) {
        const candidate = path.join(path.dirname(pkgPath), binRel);
        if (existsSync(candidate)) turtlecodeBin = candidate;
      }
    } catch {
      // turtlecode not installed alongside trellis
    }

    const passthrough: string[] = [];
    if (opts.port) passthrough.push('--port', String(opts.port));
    if (opts.new) passthrough.push('--new');
    if (!opts.open) passthrough.push('--no-open');
    if (opts.quietBackend) passthrough.push('--quiet-backend');
    // Forward any extra unrecognized args (e.g. --backend <url>)
    const extra = command.args ?? [];
    passthrough.push(...extra);

    const spawnArgs = turtlecodeBin
      ? [turtlecodeBin, ...passthrough]
      : ['turtlecode', ...passthrough];
    const spawnCmd = turtlecodeBin ? process.execPath : 'npx';

    console.log(chalk.green('⚡ Launching Trellis Studio...'));
    console.log(chalk.dim(`   Project: ${rootPath}`));
    console.log('');

    const child = spawn(spawnCmd, spawnArgs, {
      stdio: 'inherit',
      cwd: rootPath,
      env: process.env,
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT' && !turtlecodeBin) {
        console.error(
          chalk.red(
            '\nCould not find `turtlecode`. Reinstall trellis, or install turtlecode globally: `npm i -g turtlecode`\n',
          ),
        );
      } else {
        console.error(chalk.red(`\nFailed to launch Studio: ${err.message}`));
      }
      process.exit(1);
    });

    const shutdown = () => {
      if (!child.killed) child.kill();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    child.on('exit', (code) => {
      process.exit(code ?? 0);
    });
  });

async function waitForMcpReady(
  url: string,
  timeoutMs: number,
): Promise<boolean> {
  const { get } = await import('http');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    try {
      const res = await new Promise<any>((resolve, reject) => {
        const req = get(`${url}/health`, resolve);
        req.on('error', reject);
        req.setTimeout(2000);
      });
      if (res.statusCode === 200) {
        return true;
      }
    } catch {
      // Server not ready yet, retry
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// trellis cms — Manage CMS entities and component-library registrations
// ---------------------------------------------------------------------------

const cmsCmd = program
  .command('cms')
  .description('Manage CMS entities (collections, libraries, schemas)');

cmsCmd
  .command('register-library <pkg>')
  .description(
    'Register a Svelte 5 component library as DesignComponent entities. ' +
      'The package must ship dist/components.json (see @turtle.tech/ui for the format).',
  )
  .option('-p, --path <path>', 'Repository path', '.')
  .option('--url <url>', 'Trellis server URL', 'http://localhost:4096')
  .option(
    '--dry-run',
    'Print the facts that would be asserted without contacting the server',
  )
  .action(async (pkg: string, opts: any) => {
    const rootPath = resolveRepoRoot(opts.path);

    const { readFileSync, existsSync } = await import('fs');
    const manifestPath = join(
      rootPath,
      'node_modules',
      pkg,
      'dist',
      'components.json',
    );

    if (!existsSync(manifestPath)) {
      console.error(chalk.red(`✗ No manifest at ${manifestPath}`));
      console.error(
        chalk.dim(
          `  Install ${pkg} in this repo and ensure it ships dist/components.json.`,
        ),
      );
      process.exit(1);
    }

    let manifest: {
      package: string;
      version: string;
      components: Array<{
        component: string;
        slug: string;
        source?: string;
        editable?: unknown[];
      }>;
    };
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (err: any) {
      console.error(chalk.red(`✗ Manifest is not valid JSON: ${manifestPath}`));
      console.error(chalk.dim(`  ${err?.message ?? String(err)}`));
      process.exit(1);
    }

    const { package: pkgName, version, components } = manifest;
    if (!Array.isArray(components) || components.length === 0) {
      console.error(chalk.yellow(`⚠ Manifest is empty: ${manifestPath}`));
      process.exit(1);
    }

    const pkgSlug = pkgName.replace(/^@/, '').replace(/\//g, '__');
    const now = new Date().toISOString();
    const facts: Array<{ e: string; a: string; v: unknown }> = [];

    for (const comp of components) {
      const id = `design:component:${pkgSlug}:${comp.slug}`;
      facts.push(
        { e: id, a: 'type', v: 'DesignComponent' },
        { e: id, a: 'label', v: comp.component },
        { e: id, a: 'package', v: pkgName },
        { e: id, a: 'packageVersion', v: version },
        { e: id, a: 'slug', v: comp.slug },
        { e: id, a: 'source', v: comp.source ?? '' },
        { e: id, a: 'editable', v: JSON.stringify(comp.editable ?? []) },
        { e: id, a: 'createdAt', v: now },
      );
    }

    if (opts.dryRun) {
      console.log(chalk.dim('── Dry run: would assert these facts ──'));
      console.log(JSON.stringify(facts, null, 2));
      console.log(
        chalk.dim(
          `── ${facts.length} facts across ${components.length} components ──`,
        ),
      );
      return;
    }

    const url = new URL('/trellis/store/assert', opts.url);
    url.searchParams.set('directory', rootPath);

    const meta = {
      actor: 'cli:trellis',
      actorKind: 'user',
      source: 'trellis-cms-register-library',
      relatedEntities: [...new Set(facts.map((f) => f.e))],
    };

    try {
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facts, meta }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(chalk.red(`✗ Assert failed: HTTP ${res.status}`));
        if (body) console.error(chalk.dim(`  ${body.slice(0, 400)}`));
        process.exit(1);
      }

      const body = (await res.json().catch(() => ({ added: 0 }))) as {
        added?: number;
      };
      console.log(
        chalk.green(
          `✓ Registered ${chalk.bold(String(components.length))} components from ${chalk.bold(pkgName)}@${version}`,
        ),
      );
      console.log(`  ${chalk.dim('Facts added:')} ${body.added ?? '?'}`);
      console.log(`  ${chalk.dim('Workspace:')}   ${rootPath}`);
      for (const comp of components) {
        console.log(
          `  ${chalk.dim('•')} ${comp.component} ${chalk.dim(`(design:component:${pkgSlug}:${comp.slug})`)}`,
        );
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error(
        chalk.red(`✗ Could not reach Trellis server at ${opts.url}`),
      );
      console.error(chalk.dim(`  ${msg}`));
      console.error(
        chalk.dim(
          `  Hint: start the Trellis backend (e.g. open the turtlecode IDE) and retry.`,
        ),
      );
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// Federation Commands
// ---------------------------------------------------------------------------

program
  .command('remote')
  .description('Manage remote workspace subscriptions')
  .argument('[action]', '"add", "remove", or "list" (default: list)')
  .argument('[name]', 'Remote name (for add/remove)')
  .argument('[path]', 'Remote path (for add)')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (action, name, path, opts) => {
    const rootPath = resolveRepoRoot(opts.path);
    const { RemoteManager } = await import('../federation/remote-manager.js');
    const remoteManager = new RemoteManager(join(rootPath, '.trellis'));

    try {
      if (!action || action === 'list') {
        const remotes = remoteManager.listRemotes();
        if (remotes.length === 0) {
          console.log(chalk.dim('No remotes configured.'));
          return;
        }
        console.log(chalk.bold(`Remotes (${remotes.length})\n`));
        for (const remote of remotes) {
          const lastPulled = remote.pulledAt
            ? chalk.dim(
                ` (pulled ${new Date(remote.pulledAt).toLocaleDateString()})`,
              )
            : chalk.dim(' (never pulled)');
          console.log(
            `  ${chalk.cyan(remote.name)}: ${remote.path}${lastPulled}`,
          );
        }
        return;
      }

      if (action === 'add') {
        if (!name) {
          console.error(chalk.red('Error: Remote name required for add'));
          process.exit(1);
        }
        if (!path) {
          console.error(chalk.red('Error: Remote path required for add'));
          process.exit(1);
        }

        remoteManager.addRemote(name, path);
        console.log(chalk.green(`✓ Added remote '${name}' -> ${path}`));
        return;
      }

      if (action === 'remove') {
        if (!name) {
          console.error(chalk.red('Error: Remote name required for remove'));
          process.exit(1);
        }

        remoteManager.removeRemote(name);
        console.log(chalk.green(`✓ Removed remote '${name}'`));
        return;
      }

      console.error(chalk.red(`Unknown action: ${action}`));
      process.exit(1);
    } catch (error) {
      console.error(chalk.red(`Error: ${error}`));
      process.exit(1);
    }
  });

program
  .command('pull')
  .description('Pull operations from remote workspaces')
  .option('-p, --path <path>', 'Repository path', '.')
  .option('--remote <remote>', 'Pull from specific remote only')
  .action(async (opts) => {
    const rootPath = resolveRepoRoot(opts.path);
    const { RemoteManager } = await import('../federation/remote-manager.js');
    const remoteManager = new RemoteManager(join(rootPath, '.trellis'));

    const engine = new TrellisVcsEngine({ rootPath });
    engine.open();

    try {
      if (opts.remote) {
        // Pull from specific remote
        const result = await remoteManager.pullRemote(opts.remote, engine);
        console.log(chalk.bold(`Pull from ${opts.remote}\n`));
        console.log(`  ${chalk.dim('New ops:')} ${result.newOps}`);
        if (result.errors.length > 0) {
          console.log(`  ${chalk.dim('Errors:')} ${result.errors.join(', ')}`);
        }
        console.log(`  ${chalk.dim('Duration:')} ${result.durationMs}ms`);
      } else {
        // Pull from all remotes
        const result = await remoteManager.pullAll(engine);
        console.log(chalk.bold('Pull from all remotes\n'));
        console.log(`  ${chalk.dim('Total new ops:')} ${result.totalNewOps}`);
        console.log(`  ${chalk.dim('Duration:')} ${result.totalDurationMs}ms`);

        for (const remoteResult of result.results) {
          const status =
            remoteResult.errors.length > 0 ? chalk.red('✗') : chalk.green('✓');
          console.log(
            `  ${status} ${remoteResult.remote}: ${remoteResult.newOps} new ops`,
          );
          if (remoteResult.errors.length > 0) {
            for (const error of remoteResult.errors) {
              console.log(`    ${chalk.dim(error)}`);
            }
          }
        }
      }
    } catch (error) {
      console.error(chalk.red(`Pull failed: ${error}`));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------

program
  .command('skills')
  .description('Install Trellis agent skills using the skills CLI (npx skills)')
  .argument('[args...]', 'Additional arguments to pass to the skills CLI')
  .allowUnknownOption()
  .action(async () => {
    const skillsIndex = process.argv.indexOf('skills');
    const extraArgs =
      skillsIndex !== -1 ? process.argv.slice(skillsIndex + 1) : [];

    const { spawnSync } = await import('child_process');

    const skillsArgs = ['skills', 'add', 'trentbrew/trellis', ...extraArgs];
    console.log(chalk.cyan('  Installing Trellis agent skills...'));
    console.log(chalk.dim(`  Running: npx ${skillsArgs.join(' ')}\n`));

    if (process.env.TRELLIS_CLI_DRY_RUN === '1') {
      return;
    }

    const result = spawnSync('npx', skillsArgs, {
      stdio: 'inherit',
      shell: true,
    });

    if (result.error) {
      console.error(
        chalk.red(`\n✗ Failed to run skills CLI: ${result.error.message}`),
      );
      process.exit(1);
    }

    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  });

// ---------------------------------------------------------------------------
// trellis lane (Agent Lanes W2)
// ---------------------------------------------------------------------------

registerLaneCommands(program);

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

program.parse();
