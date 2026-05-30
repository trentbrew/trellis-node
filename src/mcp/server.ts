/**
 * TrellisVCS MCP Server
 *
 * @module mcp
 *
 * Exposes TrellisVcsEngine as an MCP (Model Context Protocol) server,
 * enabling any MCP-compatible AI agent to interact with TrellisVCS
 * repositories through structured tool calls and resource queries.
 *
 * Tools provide write/query actions (status, log, milestone, branch, etc.).
 * Resources provide read-only context (op stream, file list, garden clusters).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { resolve } from 'path';
import { TrellisVcsEngine } from '../engine.js';
import { HookRegistry } from '../decisions/index.js';
import { wrapToolHandler } from '../decisions/auto-capture.js';
import type { DecisionRecorder } from '../decisions/auto-capture.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getEngine(rootPath: string): TrellisVcsEngine {
  const absPath = resolve(rootPath);
  if (!TrellisVcsEngine.isRepo(absPath)) {
    throw new Error(`Not a TrellisVCS repository: ${absPath}`);
  }
  const engine = new TrellisVcsEngine({ rootPath: absPath });
  engine.open();
  return engine;
}

function text(content: string) {
  return { content: [{ type: 'text' as const, text: content }] };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export function createTrellisMcpServer(): McpServer {
  const server = new McpServer({
    name: 'trellis-harness',
    version: '0.1.0',
  });

  // -----------------------------------------------------------------------
  // Tool: trellis_status
  // -----------------------------------------------------------------------
  server.registerTool(
    'trellis_status',
    {
      description:
        'Get the current status of a TrellisVCS repository: branch, op count, tracked files, and recent activity.',
      inputSchema: {
        path: z
          .string()
          .default('.')
          .describe('Path to the TrellisVCS repository root'),
      },
    },
    async ({ path }) => {
      const engine = getEngine(path);
      const s = engine.status();
      const lines = [
        `Branch: ${s.branch}`,
        `Total ops: ${s.totalOps}`,
        `Tracked files: ${s.trackedFiles}`,
        '',
        s.lastOp
          ? `Last op: ${s.lastOp.kind} at ${s.lastOp.timestamp}`
          : 'No ops yet.',
        '',
        'Recent activity:',
        ...s.recentOps
          .slice(-5)
          .map(
            (op) => `  ${op.kind} ${op.vcs?.filePath ?? ''} ${op.timestamp}`,
          ),
      ];
      return text(lines.join('\n'));
    },
  );

  // -----------------------------------------------------------------------
  // Tool: trellis_log
  // -----------------------------------------------------------------------
  server.registerTool(
    'trellis_log',
    {
      description:
        'Show operation history from the causal stream. Optionally filter by file path or limit results.',
      inputSchema: {
        path: z.string().default('.').describe('Repository root path'),
        limit: z
          .number()
          .optional()
          .describe('Maximum number of ops to return (default: 20)'),
        filePath: z
          .string()
          .optional()
          .describe('Filter ops by affected file path'),
      },
    },
    async ({ path, limit, filePath }) => {
      const engine = getEngine(path);
      const ops = engine.log({ limit: limit ?? 20, filePath });
      const lines = ops.map(
        (op) =>
          `[${op.timestamp}] ${op.kind} ${op.vcs?.filePath ?? ''} (${op.hash.slice(0, 20)}…)`,
      );
      return text(lines.length > 0 ? lines.join('\n') : 'No ops found.');
    },
  );

  // -----------------------------------------------------------------------
  // Tool: trellis_files
  // -----------------------------------------------------------------------
  server.registerTool(
    'trellis_files',
    {
      description: 'List all tracked files in the TrellisVCS repository.',
      inputSchema: {
        path: z.string().default('.').describe('Repository root path'),
      },
    },
    async ({ path }) => {
      const engine = getEngine(path);
      const files = engine.trackedFiles();
      const lines = files.map(
        (f) =>
          `${f.path}${f.contentHash ? ` (${f.contentHash.slice(0, 12)}…)` : ''}`,
      );
      return text(
        lines.length > 0
          ? `Tracked files (${lines.length}):\n${lines.join('\n')}`
          : 'No tracked files.',
      );
    },
  );

  // -----------------------------------------------------------------------
  // Tool: trellis_branch
  // -----------------------------------------------------------------------
  server.registerTool(
    'trellis_branch',
    {
      description:
        'List, create, switch, or delete branches. Action defaults to "list".',
      inputSchema: {
        path: z.string().default('.').describe('Repository root path'),
        action: z
          .enum(['list', 'create', 'switch', 'delete'])
          .default('list')
          .describe('Branch action to perform'),
        name: z
          .string()
          .optional()
          .describe('Branch name (required for create/switch/delete)'),
      },
    },
    async ({ path, action, name }) => {
      const engine = getEngine(path);

      if (action === 'list') {
        const branches = engine.listBranches();
        const lines = branches.map(
          (b) => `${b.isCurrent ? '* ' : '  '}${b.name}`,
        );
        return text(lines.join('\n'));
      }

      if (!name) {
        return text(`Error: branch name is required for "${action}".`);
      }

      if (action === 'create') {
        const op = await engine.createBranch(name);
        return text(`Created branch "${name}" (op: ${op.hash.slice(0, 20)}…)`);
      }
      if (action === 'switch') {
        engine.switchBranch(name);
        return text(`Switched to branch "${name}".`);
      }
      if (action === 'delete') {
        const op = await engine.deleteBranch(name);
        return text(`Deleted branch "${name}" (op: ${op.hash.slice(0, 20)}…)`);
      }

      return text(`Unknown action: ${action}`);
    },
  );

  // -----------------------------------------------------------------------
  // Tool: trellis_milestone
  // -----------------------------------------------------------------------
  server.registerTool(
    'trellis_milestone',
    {
      description:
        'Create or list milestones. Milestones are narrative checkpoints in the causal stream.',
      inputSchema: {
        path: z.string().default('.').describe('Repository root path'),
        action: z
          .enum(['list', 'create'])
          .default('list')
          .describe('Milestone action'),
        message: z
          .string()
          .optional()
          .describe('Milestone message (required for create)'),
        fromOpHash: z
          .string()
          .optional()
          .describe('Start of op range (auto-detected if omitted)'),
        toOpHash: z
          .string()
          .optional()
          .describe('End of op range (auto-detected if omitted)'),
      },
    },
    async ({ path, action, message, fromOpHash, toOpHash }) => {
      const engine = getEngine(path);

      if (action === 'list') {
        const milestones = engine.listMilestones();
        if (milestones.length === 0) return text('No milestones yet.');
        const lines = milestones.map(
          (m) =>
            `★ ${m.message} (${m.id.slice(0, 24)}…) — ${m.affectedFiles.length} files`,
        );
        return text(`Milestones (${milestones.length}):\n${lines.join('\n')}`);
      }

      if (!message) {
        return text('Error: message is required for creating a milestone.');
      }

      const op = await engine.createMilestone(message, {
        fromOpHash,
        toOpHash,
      });
      return text(
        `Created milestone "${message}" (op: ${op.hash.slice(0, 20)}…)`,
      );
    },
  );

  // -----------------------------------------------------------------------
  // Tool: trellis_diff
  // -----------------------------------------------------------------------
  server.registerTool(
    'trellis_diff',
    {
      description:
        'Show file-level diff between two points in the causal stream.',
      inputSchema: {
        path: z.string().default('.').describe('Repository root path'),
        fromHash: z.string().describe('Starting op hash'),
        toHash: z.string().describe('Ending op hash'),
      },
    },
    async ({ path, fromHash, toHash }) => {
      const engine = getEngine(path);
      const result = engine.diffOps(fromHash, toHash);
      if (result.diffs.length === 0) return text('No changes.');
      const lines = result.diffs.map(
        (d) =>
          `${d.kind}: ${d.path}${d.unifiedDiff ? '\n' + d.unifiedDiff : ''}`,
      );
      return text(lines.join('\n\n'));
    },
  );

  // -----------------------------------------------------------------------
  // Tool: trellis_garden
  // -----------------------------------------------------------------------
  server.registerTool(
    'trellis_garden',
    {
      description:
        'Explore the Idea Garden: list abandoned work clusters, search by keyword/file, view stats, or revive a cluster into a new branch.',
      inputSchema: {
        path: z.string().default('.').describe('Repository root path'),
        action: z
          .enum(['list', 'search', 'stats', 'revive'])
          .default('list')
          .describe('Garden action'),
        keyword: z
          .string()
          .optional()
          .describe('Search keyword (for search action)'),
        file: z
          .string()
          .optional()
          .describe('Filter by file path (for list/search)'),
        status: z
          .enum(['abandoned', 'draft', 'revived'])
          .optional()
          .describe('Filter by cluster status'),
        clusterId: z
          .string()
          .optional()
          .describe('Cluster ID (required for revive)'),
        limit: z.number().optional().describe('Max results (default: 10)'),
      },
    },
    async ({ path, action, keyword, file, status, clusterId, limit }) => {
      const engine = getEngine(path);
      const garden = engine.garden();

      if (action === 'stats') {
        const s = garden.stats();
        return text(
          [
            `Idea Garden Stats:`,
            `  Total clusters: ${s.total}`,
            `  Abandoned: ${s.abandoned}`,
            `  Draft: ${s.draft}`,
            `  Revived: ${s.revived}`,
            `  Total ops: ${s.totalOps}`,
            `  Affected files: ${s.totalFiles}`,
          ].join('\n'),
        );
      }

      if (action === 'revive') {
        if (!clusterId) return text('Error: clusterId is required for revive.');
        const result = garden.revive(clusterId);
        if (!result)
          return text(`Error: Could not revive cluster "${clusterId}".`);
        return text(
          `Revived cluster "${clusterId}" (${result.length} ops restored)`,
        );
      }

      if (action === 'search' || action === 'list') {
        const clusters = garden.search({
          keyword,
          file,
          status,
          limit: limit ?? 10,
        });
        if (clusters.length === 0) return text('No idea clusters found.');
        const lines = clusters.map(
          (c) =>
            `[${c.status}] ${c.id.slice(0, 20)}… — ${c.ops.length} ops, ${c.affectedFiles.length} files\n  Intent: ${c.estimatedIntent}`,
        );
        return text(`Idea clusters (${clusters.length}):\n${lines.join('\n')}`);
      }

      return text(`Unknown garden action: ${action}`);
    },
  );

  // -----------------------------------------------------------------------
  // Tool: trellis_parse
  // -----------------------------------------------------------------------
  server.registerTool(
    'trellis_parse',
    {
      description:
        'Parse a TypeScript/JavaScript file into AST-level entities (functions, classes, interfaces, imports).',
      inputSchema: {
        content: z.string().describe('File content to parse'),
        filePath: z
          .string()
          .describe(
            'File path (used for language detection, e.g. "src/auth.ts")',
          ),
      },
    },
    async ({ content, filePath }) => {
      const engine = getEngine('.');
      const result = engine.parseFile(content, filePath);
      if (!result)
        return text(
          `No parser available for "${filePath}". Currently supports .ts, .js, .tsx, .jsx.`,
        );
      const lines = [
        `Declarations (${result.declarations.length}):`,
        ...result.declarations.map(
          (d) => `  ${d.kind} ${d.name} (${d.id.slice(0, 16)}…)`,
        ),
        '',
        `Imports (${result.imports.length}):`,
        ...result.imports.map(
          (i) => `  ${i.specifiers.join(', ')} from "${i.source}"`,
        ),
        '',
        `Exports (${result.exports.length}):`,
        ...result.exports.map(
          (e) => `  ${e.name}${e.source ? ` from "${e.source}"` : ''}`,
        ),
      ];
      return text(lines.join('\n'));
    },
  );

  // -----------------------------------------------------------------------
  // Tool: trellis_semantic_diff
  // -----------------------------------------------------------------------
  server.registerTool(
    'trellis_semantic_diff',
    {
      description:
        'Compute a semantic diff between two versions of a TypeScript/JavaScript file. Returns structured AST-level patches (symbolAdd, symbolRemove, symbolModify, symbolRename, importAdd, etc.).',
      inputSchema: {
        oldContent: z.string().describe('Old file content'),
        newContent: z.string().describe('New file content'),
        filePath: z.string().describe('File path for language detection'),
      },
    },
    async ({ oldContent, newContent, filePath }) => {
      const engine = getEngine('.');
      const patches = engine.semanticDiff(oldContent, newContent, filePath);
      if (patches.length === 0) return text('No semantic changes detected.');
      const lines = patches.map((p) => {
        const base = `${p.kind}: ${(p as any).entityId ?? (p as any).source ?? ''}`;
        if ('newName' in p) return `${base} → ${(p as any).newName}`;
        return base;
      });
      return text(`Semantic patches (${patches.length}):\n${lines.join('\n')}`);
    },
  );

  // -----------------------------------------------------------------------
  // Tool: trellis_init
  // -----------------------------------------------------------------------
  server.registerTool(
    'trellis_init',
    {
      description:
        'Initialize a new TrellisVCS repository. Scans the directory and creates initial ops for all existing files.',
      inputSchema: {
        path: z
          .string()
          .default('.')
          .describe('Directory to initialize as a TrellisVCS repo'),
      },
    },
    async ({ path }) => {
      const absPath = resolve(path);
      if (TrellisVcsEngine.isRepo(absPath)) {
        return text(`Already a Trellis workspace: ${absPath}`);
      }
      const engine = new TrellisVcsEngine({ rootPath: absPath });
      const result = await engine.initRepo();
      return text(
        `Initialized Trellis workspace at ${absPath}\nOps created: ${result.opsCreated}`,
      );
    },
  );

  // -----------------------------------------------------------------------
  // Tool: trellis_issue_create
  // -----------------------------------------------------------------------
  server.registerTool(
    'trellis_issue_create',
    {
      description:
        'Create a new issue with title, priority, labels, acceptance criteria, and optional parent for sub-tasks.',
      inputSchema: {
        path: z.string().default('.').describe('Repository path'),
        title: z.string().describe('Issue title'),
        description: z.string().optional().describe('Short issue description'),
        status: z
          .enum(['backlog', 'queue'])
          .default('backlog')
          .describe('Initial status (defaults to backlog)'),
        priority: z
          .enum(['critical', 'high', 'medium', 'low'])
          .default('medium')
          .describe('Issue priority'),
        labels: z.string().optional().describe('Comma-separated labels'),
        assignee: z.string().optional().describe('Agent ID to assign'),
        parentId: z
          .string()
          .optional()
          .describe('Parent issue ID for sub-tasks (e.g. TRL-1)'),
        criteria: z
          .array(
            z.object({
              description: z.string(),
              command: z.string().optional(),
            }),
          )
          .optional()
          .describe('Acceptance criteria with optional test commands'),
      },
    },
    async ({
      path,
      title,
      description,
      status,
      priority,
      labels,
      assignee,
      parentId,
      criteria,
    }) => {
      const engine = getEngine(path);
      const parsedLabels = labels
        ? labels.split(',').map((l: string) => l.trim())
        : undefined;
      const op = await engine.createIssue(title, {
        description,
        status,
        priority,
        labels: parsedLabels,
        assignee,
        parentId,
        criteria,
      });
      const issue = engine.getIssue(op.vcs?.issueId ?? '');
      return text(
        `Issue created: ${op.vcs?.issueId}\n` +
          `Title: ${title}\nPriority: ${priority}\n` +
          (parsedLabels ? `Labels: ${parsedLabels.join(', ')}\n` : '') +
          (parentId ? `Parent: ${parentId}\n` : '') +
          (criteria ? `Criteria: ${criteria.length}\n` : ''),
      );
    },
  );

  // -----------------------------------------------------------------------
  // Tool: trellis_issue_list
  // -----------------------------------------------------------------------
  server.registerTool(
    'trellis_issue_list',
    {
      description:
        'List issues with optional filters by status, assignee, label, or parent.',
      inputSchema: {
        path: z.string().default('.').describe('Repository path'),
        status: z
          .enum(['backlog', 'queue', 'in_progress', 'paused', 'closed'])
          .optional()
          .describe('Filter by status'),
        assignee: z.string().optional().describe('Filter by assignee'),
        label: z.string().optional().describe('Filter by label'),
        parentId: z.string().optional().describe('Filter by parent issue ID'),
      },
    },
    async ({ path, status, assignee, label, parentId }) => {
      const engine = getEngine(path);
      const issues = engine.listIssues({ status, assignee, label, parentId });
      if (issues.length === 0) return text('No issues found.');
      const lines = issues.map(
        (i) =>
          `[${i.status}] ${i.id} — ${i.title ?? '(untitled)'}` +
          (i.priority ? ` (${i.priority})` : '') +
          (i.assignee ? ` → ${i.assignee}` : '') +
          (i.criteria.length > 0
            ? ` (${i.criteria.filter((c) => c.status === 'passed').length}/${i.criteria.length} AC)`
            : ''),
      );
      return text(`Issues (${issues.length}):\n${lines.join('\n')}`);
    },
  );

  // -----------------------------------------------------------------------
  // Tool: trellis_issue_triage
  // -----------------------------------------------------------------------
  server.registerTool(
    'trellis_issue_triage',
    {
      description:
        'Move an issue from backlog to queue status (ready for work).',
      inputSchema: {
        path: z.string().default('.').describe('Repository path'),
        id: z.string().describe('Issue ID (e.g. TRL-1)'),
      },
    },
    async ({ path, id }) => {
      const engine = getEngine(path);
      await engine.triageIssue(id);
      return text(`Triaged issue ${id} → queue`);
    },
  );

  // -----------------------------------------------------------------------
  // Tool: trellis_issue_update
  // -----------------------------------------------------------------------
  server.registerTool(
    'trellis_issue_update',
    {
      description:
        'Update issue metadata: title, description, status, priority, labels, or assignee.',
      inputSchema: {
        path: z.string().default('.').describe('Repository path'),
        id: z.string().describe('Issue ID (e.g. TRL-1)'),
        title: z.string().optional().describe('New title'),
        description: z.string().optional().describe('Short description'),
        status: z
          .enum(['backlog', 'queue', 'in_progress', 'paused', 'closed'])
          .optional()
          .describe('New status'),
        priority: z
          .enum(['critical', 'high', 'medium', 'low'])
          .optional()
          .describe('New priority'),
        labels: z.string().optional().describe('Comma-separated labels'),
        assignee: z.string().optional().describe('Agent to assign'),
        parent: z
          .string()
          .optional()
          .describe('Parent issue ID (re-parent sub-task)'),
        clearParent: z
          .boolean()
          .optional()
          .describe('Remove parent link'),
      },
    },
    async ({
      path,
      id,
      title,
      description,
      status,
      priority,
      labels,
      assignee,
      parent,
      clearParent,
    }) => {
      const engine = getEngine(path);
      const updates: Record<string, any> = {};
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (status !== undefined) updates.status = status;
      if (priority !== undefined) updates.priority = priority;
      if (labels !== undefined)
        updates.labels = labels.split(',').map((l: string) => l.trim());
      if (assignee !== undefined) updates.assignee = assignee;
      if (clearParent) updates.parentId = null;
      else if (parent !== undefined) updates.parentId = parent;
      await engine.updateIssue(id, updates);
      return text(`Updated issue ${id}`);
    },
  );

  // -----------------------------------------------------------------------
  // Tool: trellis_issue_start
  // -----------------------------------------------------------------------
  server.registerTool(
    'trellis_issue_start',
    {
      description:
        'Start working on an issue. Auto-creates a feature branch and assigns the current agent.',
      inputSchema: {
        path: z.string().default('.').describe('Repository path'),
        id: z.string().describe('Issue ID (e.g. TRL-1)'),
      },
    },
    async ({ path, id }) => {
      const engine = getEngine(path);
      await engine.startIssue(id);
      const issue = engine.getIssue(id);
      return text(
        `Started issue ${id}\n` +
          (issue?.branchName ? `Branch: ${issue.branchName}\n` : '') +
          (issue?.assignee ? `Assignee: ${issue.assignee}\n` : ''),
      );
    },
  );

  // -----------------------------------------------------------------------
  // Tool: trellis_issue_pause
  // -----------------------------------------------------------------------
  server.registerTool(
    'trellis_issue_pause',
    {
      description:
        'Pause an in-progress issue and switch back to the default branch. Requires a note explaining why and what must happen before resuming.',
      inputSchema: {
        path: z.string().default('.').describe('Repository path'),
        id: z.string().describe('Issue ID'),
        note: z
          .string()
          .describe('Why paused and what must happen before resuming'),
      },
    },
    async ({ path, id, note }) => {
      const engine = getEngine(path);
      await engine.pauseIssue(id, note);
      return text(
        `Paused issue ${id}\nNote: ${note}\nSwitched to: ${engine.getCurrentBranch()}`,
      );
    },
  );

  // -----------------------------------------------------------------------
  // Tool: trellis_issue_resume
  // -----------------------------------------------------------------------
  server.registerTool(
    'trellis_issue_resume',
    {
      description:
        'Resume a paused issue and switch back to its feature branch.',
      inputSchema: {
        path: z.string().default('.').describe('Repository path'),
        id: z.string().describe('Issue ID'),
      },
    },
    async ({ path, id }) => {
      const engine = getEngine(path);
      await engine.resumeIssue(id);
      const issue = engine.getIssue(id);
      return text(
        `Resumed issue ${id}\n` +
          (issue?.branchName ? `Branch: ${issue.branchName}\n` : ''),
      );
    },
  );

  // -----------------------------------------------------------------------
  // Tool: trellis_issue_check
  // -----------------------------------------------------------------------
  server.registerTool(
    'trellis_issue_check',
    {
      description:
        'Run all acceptance criteria for an issue. Executes test commands and reports pass/fail status.',
      inputSchema: {
        path: z.string().default('.').describe('Repository path'),
        id: z.string().describe('Issue ID'),
      },
    },
    async ({ path, id }) => {
      const engine = getEngine(path);
      const results = await engine.runCriteria(id);
      if (results.length === 0) return text('No acceptance criteria defined.');
      const lines = results.map(
        (r) =>
          `[${r.status.toUpperCase()}] ${r.description ?? r.id}` +
          (r.command ? ` ($ ${r.command})` : '') +
          (r.status === 'failed' && r.output
            ? `\n  ${r.output.split('\n')[0]}`
            : ''),
      );
      const passed = results.filter((r) => r.status === 'passed').length;
      return text(
        `Criteria results (${passed}/${results.length} passed):\n${lines.join('\n')}`,
      );
    },
  );

  // -----------------------------------------------------------------------
  // Tool: trellis_issue_close
  // -----------------------------------------------------------------------
  server.registerTool(
    'trellis_issue_close',
    {
      description:
        'Close an issue. All acceptance criteria must be passing. Requires confirm=true.',
      inputSchema: {
        path: z.string().default('.').describe('Repository path'),
        id: z.string().describe('Issue ID'),
        confirm: z
          .boolean()
          .default(false)
          .describe('Must be true to actually close the issue'),
      },
    },
    async ({ path, id, confirm }) => {
      const engine = getEngine(path);
      try {
        const result = await engine.closeIssue(id, { confirm });
        if (!result.op) {
          const lines = result.criteriaResults.map(
            (r) => `[${r.status}] ${r.description ?? r.id}`,
          );
          return text(
            `Criteria status for ${id}:\n${lines.join('\n')}\n\nAll criteria pass. Set confirm=true to close.`,
          );
        }
        return text(`Issue ${id} closed.`);
      } catch (err: any) {
        return text(`Error: ${err.message}`);
      }
    },
  );

  // ── trellis_issue_block ──────────────────────────────────────────────
  server.registerTool(
    'trellis_issue_block',
    {
      description: 'Mark an issue as blocked by another issue',
      inputSchema: {
        path: z.string().default('.').describe('Repository path'),
        id: z.string().describe('Issue ID to block (e.g. TRL-1)'),
        blockedBy: z.string().describe('Issue ID that blocks it (e.g. TRL-2)'),
      },
    },
    async ({ path, id, blockedBy }) => {
      const engine = getEngine(path);
      try {
        await (engine as any).blockIssue(id, blockedBy);
        return text(`Issue ${id} is now blocked by ${blockedBy}`);
      } catch (err: any) {
        return text(`Error: ${err.message}`);
      }
    },
  );

  // ── trellis_issue_unblock ────────────────────────────────────────────
  server.registerTool(
    'trellis_issue_unblock',
    {
      description: 'Remove a blocking relationship between issues',
      inputSchema: {
        path: z.string().default('.').describe('Repository path'),
        id: z.string().describe('Blocked issue ID (e.g. TRL-1)'),
        blockedBy: z
          .string()
          .describe('Blocking issue ID to remove (e.g. TRL-2)'),
      },
    },
    async ({ path, id, blockedBy }) => {
      const engine = getEngine(path);
      try {
        await (engine as any).unblockIssue(id, blockedBy);
        return text(`Issue ${id} is no longer blocked by ${blockedBy}`);
      } catch (err: any) {
        return text(`Error: ${err.message}`);
      }
    },
  );

  // -----------------------------------------------------------------------
  // Tool: trellis_issue_readiness
  // -----------------------------------------------------------------------
  server.registerTool(
    'trellis_issue_readiness',
    {
      description:
        'Check completion readiness: verifies no issues remain in queue, paused, or in-progress status.',
      inputSchema: {
        path: z.string().default('.').describe('Repository path'),
      },
    },
    async ({ path }) => {
      const engine = getEngine(path);
      const result = engine.checkCompletionReadiness();
      return text(result.summary);
    },
  );

  // -----------------------------------------------------------------------
  // Tool: trellis_refs
  // -----------------------------------------------------------------------
  server.registerTool(
    'trellis_refs',
    {
      description:
        'Query wiki-link [[...]] references: list outgoing refs from a file, find backlinks to an entity, or get index stats.',
      inputSchema: {
        path: z.string().default('.').describe('Repository root path'),
        action: z
          .enum(['outgoing', 'backlinks', 'stats'])
          .default('stats')
          .describe('Query action'),
        file: z
          .string()
          .optional()
          .describe('File path for outgoing refs (required for "outgoing")'),
        entity: z
          .string()
          .optional()
          .describe(
            'Entity target for backlinks (e.g. "TRL-5", "src/engine.ts")',
          ),
      },
    },
    async ({ path, action, file, entity }) => {
      const engine = getEngine(path);
      const { readFileSync } = require('fs');
      const { join } = require('path');
      const {
        buildRefIndex,
        getOutgoingRefs,
        getBacklinks,
        getIndexStats,
        createResolverContext,
        resolveRef,
      } = require('../links/index.js');

      const resolverCtx = createResolverContext(engine);
      const rootPath = engine.getRootPath();

      // Build index from all tracked files
      const trackedFiles = engine.trackedFiles();
      const fileContents: Array<{ path: string; content: string }> = [];
      for (const f of trackedFiles) {
        try {
          const absPath = join(rootPath, f.path);
          const content = readFileSync(absPath, 'utf-8');
          fileContents.push({ path: f.path, content });
        } catch {}
      }
      const index = buildRefIndex(fileContents, resolverCtx);

      if (action === 'stats') {
        const stats = getIndexStats(index);
        return text(
          [
            `Reference Index Stats:`,
            `  Files with refs: ${stats.totalFiles}`,
            `  Total refs: ${stats.totalRefs}`,
            `  Unique entities: ${stats.totalEntities}`,
          ].join('\n'),
        );
      }

      if (action === 'outgoing') {
        if (!file)
          return text('Error: file parameter is required for outgoing refs.');
        const refs = getOutgoingRefs(index, file);
        if (refs.length === 0)
          return text(`No [[...]] references found in: ${file}`);
        const lines = refs.map((ref: any) => {
          const resolved = resolveRef(ref, resolverCtx);
          return `[${resolved.state}] [[${ref.raw}]] → ${resolved.entityId ?? 'unresolved'} (L${ref.source.line})`;
        });
        return text(
          `References in ${file} (${refs.length}):\n${lines.join('\n')}`,
        );
      }

      if (action === 'backlinks') {
        if (!entity)
          return text('Error: entity parameter is required for backlinks.');
        const candidates = [
          `issue:${entity}`,
          `file:${entity}`,
          `symbol:${entity}`,
          `identity:${entity}`,
          `milestone:${entity}`,
          entity,
        ];
        for (const eid of candidates) {
          const sources = getBacklinks(index, eid);
          if (sources.length > 0) {
            const lines = sources.map(
              (s: any) => `  ${s.filePath}:${s.line} (${s.context})`,
            );
            return text(
              `Backlinks for ${eid} (${sources.length}):\n${lines.join('\n')}`,
            );
          }
        }
        return text(`No references found for: ${entity}`);
      }

      return text(`Unknown action: ${action}`);
    },
  );

  // -----------------------------------------------------------------------
  // Tool: trellis_refs_broken
  // -----------------------------------------------------------------------
  server.registerTool(
    'trellis_refs_broken',
    {
      description:
        'List all broken and stale wiki-link [[...]] references across the repository.',
      inputSchema: {
        path: z.string().default('.').describe('Repository root path'),
      },
    },
    async ({ path }) => {
      const engine = getEngine(path);
      const { readFileSync } = require('fs');
      const { join } = require('path');
      const {
        buildRefIndex,
        createResolverContext,
        resolveRef,
        StaleRefRegistry,
        getDiagnostics,
      } = require('../links/index.js');

      const resolverCtx = createResolverContext(engine);
      const rootPath = engine.getRootPath();

      // Build index
      const trackedFiles = engine.trackedFiles();
      const fileContents: Array<{ path: string; content: string }> = [];
      for (const f of trackedFiles) {
        try {
          const absPath = join(rootPath, f.path);
          const content = readFileSync(absPath, 'utf-8');
          fileContents.push({ path: f.path, content });
        } catch {}
      }
      const index = buildRefIndex(fileContents, resolverCtx);

      // Resolve all refs
      const registry = new StaleRefRegistry();
      const resolvedIds = new Set<string>();
      for (const [, refs] of index.outgoing) {
        for (const ref of refs) {
          const resolved = resolveRef(ref, resolverCtx);
          if (resolved.state === 'resolved' && resolved.entityId) {
            resolvedIds.add(resolved.entityId);
          }
        }
      }

      const diags = getDiagnostics(index, registry, resolvedIds);
      if (diags.length === 0)
        return text('No broken or stale references found.');

      const broken = diags.filter((d: any) => d.state === 'broken');
      const stale = diags.filter((d: any) => d.state === 'stale');

      const lines: string[] = [];
      if (broken.length > 0) {
        lines.push(`Broken references (${broken.length}):`);
        for (const d of broken) {
          lines.push(
            `  ✗ ${d.source.filePath}:${d.source.line} — ${d.message}`,
          );
        }
      }
      if (stale.length > 0) {
        if (lines.length > 0) lines.push('');
        lines.push(`Stale references (${stale.length}):`);
        for (const d of stale) {
          lines.push(
            `  ⚠ ${d.source.filePath}:${d.source.line} — ${d.message}`,
          );
        }
      }

      return text(lines.join('\n'));
    },
  );

  // -----------------------------------------------------------------------
  // Tool: trellis_search
  // -----------------------------------------------------------------------
  server.registerTool(
    'trellis_search',
    {
      description:
        'Semantic search across all embedded content (issues, milestones, markdown, code entities).',
      inputSchema: {
        path: z.string().default('.').describe('Repository root path'),
        query: z.string().describe('Natural language search query'),
        limit: z
          .number()
          .optional()
          .default(10)
          .describe('Max results (default: 10)'),
        types: z
          .string()
          .optional()
          .describe(
            'Comma-separated chunk types to filter (issue_title,issue_desc,milestone_msg,markdown,code_entity,doc_comment,summary_md)',
          ),
      },
    },
    async ({ path, query, limit, types }) => {
      const engine = getEngine(path);
      const { join } = require('path');
      const { EmbeddingManager } = require('../embeddings/index.js');

      const rootPath = engine.getRootPath();
      const dbPath = join(rootPath, '.trellis', 'embeddings.db');
      const manager = await EmbeddingManager.create(dbPath);

      try {
        const searchOpts: any = { limit: limit ?? 10 };
        if (types) {
          searchOpts.types = types.split(',').map((t: string) => t.trim());
        }

        const results = await manager.search(query, searchOpts);

        if (results.length === 0) {
          return text(
            'No results found. Run trellis_reindex to build the index.',
          );
        }

        const lines = results.map((r: any) => {
          const score = (r.score * 100).toFixed(1);
          const filePart = r.chunk.filePath ? ` (${r.chunk.filePath})` : '';
          const preview = r.chunk.content.slice(0, 150).replace(/\n/g, ' ');
          return `[${score}%] [${r.chunk.chunkType}]${filePart}\n  ${preview}`;
        });

        return text(
          `Search results for "${query}" (${results.length}):\n\n${lines.join('\n\n')}`,
        );
      } finally {
        manager.close();
      }
    },
  );

  // -----------------------------------------------------------------------
  // Tool: trellis_reindex
  // -----------------------------------------------------------------------
  server.registerTool(
    'trellis_reindex',
    {
      description:
        'Rebuild the semantic embedding index for all content in the repository.',
      inputSchema: {
        path: z.string().default('.').describe('Repository root path'),
      },
    },
    async ({ path }) => {
      const engine = getEngine(path);
      const { join } = require('path');
      const { EmbeddingManager } = require('../embeddings/index.js');

      const rootPath = engine.getRootPath();
      const dbPath = join(rootPath, '.trellis', 'embeddings.db');
      const manager = await EmbeddingManager.create(dbPath);

      try {
        const result = await manager.reindex(engine);
        const stats = manager.stats();

        return text(
          [
            `✓ Reindex complete: ${result.chunks} chunks embedded`,
            `Types: ${JSON.stringify(stats.byType)}`,
          ].join('\n'),
        );
      } finally {
        manager.close();
      }
    },
  );

  // -----------------------------------------------------------------------
  // Tool: trellis_decision_list
  // -----------------------------------------------------------------------
  server.registerTool(
    'trellis_decision_list',
    {
      description:
        'List decision traces, optionally filtered by tool name pattern, agent, time range, or related entity.',
      inputSchema: {
        path: z.string().default('.').describe('Repository path'),
        toolPattern: z
          .string()
          .optional()
          .describe('Glob pattern for tool name (e.g. "trellis_issue_*")'),
        entityId: z
          .string()
          .optional()
          .describe('Only decisions referencing this entity ID'),
        limit: z
          .number()
          .optional()
          .default(20)
          .describe('Max results (default 20)'),
      },
    },
    async ({ path, toolPattern, entityId, limit }) => {
      const engine = getEngine(path);
      const decisions = engine.queryDecisions({
        toolPattern: toolPattern ?? undefined,
        entityId: entityId ?? undefined,
        limit: limit ?? 20,
      });
      if (decisions.length === 0) {
        return text('No decision traces found.');
      }
      const lines = decisions.map(
        (d) =>
          `${d.id}  ${d.toolName}  ${d.createdAt ?? ''}${d.rationale ? `\n  → ${d.rationale}` : ''}`,
      );
      return text(lines.join('\n'));
    },
  );

  // -----------------------------------------------------------------------
  // Tool: trellis_decision_show
  // -----------------------------------------------------------------------
  server.registerTool(
    'trellis_decision_show',
    {
      description: 'Show full details of a decision trace by ID.',
      inputSchema: {
        path: z.string().default('.').describe('Repository path'),
        id: z.string().describe('Decision ID (e.g. DEC-1)'),
      },
    },
    async ({ path, id }) => {
      const engine = getEngine(path);
      const decision = engine.getDecision(id);
      if (!decision) {
        return text(`Decision ${id} not found.`);
      }
      const lines = [
        `ID: ${decision.id}`,
        `Tool: ${decision.toolName}`,
        `Created: ${decision.createdAt ?? 'unknown'}`,
        `Agent: ${decision.createdBy ?? 'unknown'}`,
      ];
      if (decision.context) lines.push(`Context: ${decision.context}`);
      if (decision.rationale) lines.push(`Rationale: ${decision.rationale}`);
      if (decision.alternatives && decision.alternatives.length > 0) {
        lines.push(`Alternatives: ${decision.alternatives.join(', ')}`);
      }
      if (decision.outputSummary) {
        lines.push(`Output: ${decision.outputSummary}`);
      }
      if (decision.relatedEntities.length > 0) {
        lines.push(`Related: ${decision.relatedEntities.join(', ')}`);
      }
      return text(lines.join('\n'));
    },
  );

  // -----------------------------------------------------------------------
  // Tool: trellis_decision_chain
  // -----------------------------------------------------------------------
  server.registerTool(
    'trellis_decision_chain',
    {
      description:
        'Trace all decisions that affected a given entity (issue, file, milestone).',
      inputSchema: {
        path: z.string().default('.').describe('Repository path'),
        entityId: z
          .string()
          .describe(
            'Entity ID to trace (e.g. "issue:TRL-5", "file:src/engine.ts")',
          ),
      },
    },
    async ({ path, entityId }) => {
      const engine = getEngine(path);
      const chain = engine.getDecisionChain(entityId);
      if (chain.length === 0) {
        return text(`No decision traces found for ${entityId}.`);
      }
      const lines = chain.map(
        (d) =>
          `${d.id}  ${d.toolName}  ${d.createdAt ?? ''}${d.rationale ? `\n  → ${d.rationale}` : ''}`,
      );
      return text(
        `Decision chain for ${entityId} (${chain.length} decisions):\n${lines.join('\n')}`,
      );
    },
  );

  return server;
}

// ---------------------------------------------------------------------------
// Auto-Capture Helpers (for external wiring)
// ---------------------------------------------------------------------------

/**
 * The shared hook registry for this MCP server instance.
 * External agent harnesses can register pre/post hooks here.
 */
export const hookRegistry = new HookRegistry();

/**
 * Create a DecisionRecorder that persists to a given repo path.
 */
export function createRecorder(repoPath: string): DecisionRecorder {
  return async (decision) => {
    const engine = getEngine(repoPath);
    await engine.recordDecision(decision);
  };
}
