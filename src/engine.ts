/**
 * TrellisVCS Engine
 *
 * The composition root that ties together the trellis-core kernel,
 * the file watcher, the ingestion pipeline, and VCS middleware.
 *
 * Usage:
 *   const engine = new TrellisVcsEngine({ rootPath: '/path/to/repo' });
 *   await engine.init();    // scan + create initial ops
 *   engine.watch();         // start continuous monitoring
 *   engine.stop();          // stop watcher
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { EAVStore } from './core/store/eav-store.js';
import type { Fact, Link } from './core/store/eav-store.js';
import { FileWatcher, type ScanProgress } from './watcher/fs-watcher.js';
import { Ingestion } from './watcher/ingestion.js';
import { decompose } from './vcs/decompose.js';
import { createVcsOp, isVcsOpKind } from './vcs/ops.js';
import type { VcsOp, TrellisVcsConfig, FileChangeEvent } from './vcs/types.js';
import { DEFAULT_CONFIG } from './vcs/types.js';
import { BlobStore } from './vcs/blob-store.js';
import type { EngineContext, ApplyOpOptions } from './vcs/engine-context.js';
import * as branchMod from './vcs/branch.js';
import * as milestoneMod from './vcs/milestone.js';
import * as checkpointMod from './vcs/checkpoint.js';
import * as diffMod from './vcs/diff.js';
import * as mergeMod from './vcs/merge.js';
import * as issueMod from './vcs/issue.js';
import * as decisionMod from './decisions/index.js';
import { IdeaGarden, buildMilestonedOpHashes } from './garden/index.js';
import {
  typescriptParser,
  pythonParser,
  goParser,
  rustParser,
  rubyParser,
  javaParser,
  csharpParser,
} from './semantic/index.js';
import type {
  ParseResult,
  SemanticPatch,
  ParserAdapter,
} from './semantic/types.js';
import { inferProjectContext } from './scaffold/infer.js';
import { loadProfile } from './scaffold/profile.js';
import { writeAgentScaffold } from './scaffold/write.js';
import type { ProjectContext } from './scaffold/infer.js';

import { JsonOpLog, LaneOpLog } from './vcs/op-log.js';
import * as laneMod from './vcs/lane.js';
import type { LaneMeta } from './vcs/lane.js';
import * as lanePromoteMod from './vcs/lane-promote.js';
import type { LanePromoteResult } from './vcs/lane-promote.js';
import * as materializeMod from './vcs/lane-materialize.js';
import type {
  IntegrationCache,
  MaterializationStats,
} from './vcs/lane-materialize.js';

/**
 * Parse an ignore file (.gitignore or .trellisignore) and return normalized
 * patterns. Strips comments, blank lines, and trailing slashes.
 */
function parseIgnoreFile(filePath: string): string[] {
  if (!existsSync(filePath)) return [];
  try {
    const content = readFileSync(filePath, 'utf-8');
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .map((line) => line.replace(/\/$/, '')); // strip trailing slash
  } catch {
    return [];
  }
}

/**
 * Read ignore patterns from both .gitignore and .trellisignore.
 * .trellisignore allows ignoring paths that are tracked by Git but
 * should not be tracked by TrellisVCS (e.g. source-linked dependencies).
 */
function readIgnorePatterns(rootPath: string): string[] {
  return [
    ...parseIgnoreFile(join(rootPath, '.gitignore')),
    ...parseIgnoreFile(join(rootPath, '.trellisignore')),
  ];
}

const TRELLIS_GITIGNORE_ENTRY = '.trellis/';

function hasTrellisGitignoreEntry(content: string): boolean {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .some((line) => {
      const normalized = line.replace(/\/$/, '');
      return normalized === '.trellis' || normalized === '/.trellis';
    });
}

function ensureTrellisGitignoreEntry(rootPath: string): void {
  const gitignorePath = join(rootPath, '.gitignore');
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, `${TRELLIS_GITIGNORE_ENTRY}\n`);
    return;
  }

  const content = readFileSync(gitignorePath, 'utf-8');
  if (hasTrellisGitignoreEntry(content)) {
    return;
  }

  const separator = content.length === 0 || content.endsWith('\n') ? '' : '\n';
  writeFileSync(
    gitignorePath,
    `${content}${separator}${TRELLIS_GITIGNORE_ENTRY}\n`,
  );
}

// ---------------------------------------------------------------------------
// Config persistence
// ---------------------------------------------------------------------------

interface PersistedConfig {
  rootPath: string;
  ignorePatterns: string[];
  debounceMs: number;
  defaultBranch: string;
  agentId: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface InitProgress {
  phase: 'discovering' | 'hashing' | 'recording' | 'scaffolding' | 'done';
  current: number;
  total: number;
  message: string;
}

/** Issue lifecycle ops land on integration; issueUpdate/criterionAdd stay lane-local. */
const ISSUE_INTEGRATION_KINDS = new Set<string>([
  'vcs:issueCreate',
  'vcs:issueStart',
  'vcs:issuePause',
  'vcs:issueResume',
  'vcs:issueClose',
  'vcs:issueReopen',
  'vcs:criterionUpdate',
  'vcs:issueBlock',
  'vcs:issueUnblock',
]);

export class TrellisVcsEngine {
  private config: TrellisVcsConfig;
  private store: EAVStore;
  private opLog: JsonOpLog;
  private watcher: FileWatcher | null = null;
  private ingestion: Ingestion | null = null;
  private agentId: string;
  private currentBranch: string = 'main';
  private checkpointOpCount: number = 0;
  private checkpointThreshold: number = 100;
  private _pendingAutoCheckpoint: boolean = false;
  private _blobStore: BlobStore | null = null;
  private activeLaneId?: string;
  private activeLaneLog: LaneOpLog | null = null;
  private integrationCache: IntegrationCache | null = null;
  private materializationStats: MaterializationStats =
    materializeMod.emptyMaterializationStats();

  constructor(
    opts: { rootPath: string; agentId?: string } & Partial<TrellisVcsConfig>,
  ) {
    // Merge default ignore patterns with .gitignore if present
    const gitignorePatterns = readIgnorePatterns(opts.rootPath);
    const mergedIgnore = [
      ...new Set([
        ...(opts.ignorePatterns ?? DEFAULT_CONFIG.ignorePatterns),
        ...gitignorePatterns,
      ]),
    ];

    this.config = {
      rootPath: opts.rootPath,
      ignorePatterns: mergedIgnore,
      debounceMs: opts.debounceMs ?? DEFAULT_CONFIG.debounceMs,
      defaultBranch: opts.defaultBranch ?? DEFAULT_CONFIG.defaultBranch,
      dbPath: opts.dbPath ?? DEFAULT_CONFIG.dbPath,
    };
    this.agentId = opts.agentId ?? `agent:${process.env.USER ?? 'unknown'}`;
    this.store = new EAVStore();
    this.opLog = new JsonOpLog(
      join(this.config.rootPath, '.trellis', 'ops.json'),
    );
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Initialize a new TrellisVCS repo. Creates .trellis/ directory and config.
   */
  async initRepo(opts?: {
    onProgress?: (progress: InitProgress) => void;
  }): Promise<{ opsCreated: number; context: ProjectContext }> {
    ensureTrellisGitignoreEntry(this.config.rootPath);

    const trellisDir = join(this.config.rootPath, '.trellis');
    if (!existsSync(trellisDir)) {
      mkdirSync(trellisDir, { recursive: true });
    }

    // Initialize blob store
    this._blobStore = new BlobStore(trellisDir);

    // Write config
    const configPath = join(trellisDir, 'config.json');
    const persistedConfig: PersistedConfig = {
      rootPath: this.config.rootPath,
      ignorePatterns: this.config.ignorePatterns,
      debounceMs: this.config.debounceMs,
      defaultBranch: this.config.defaultBranch,
      agentId: this.agentId,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(configPath, JSON.stringify(persistedConfig, null, 2));

    // Load existing ops (empty for new repo)
    this.opLog.load();

    // Create initial branch op
    const branchOp = await createVcsOp('vcs:branchCreate', {
      agentId: this.agentId,
      previousHash: this.opLog.getLastOp()?.hash,
      vcs: {
        branchName: this.config.defaultBranch,
      },
    });
    await this.applyOp(branchOp);

    // Scan filesystem and create file-add ops for all existing files
    const scanner = new FileWatcher({
      rootPath: this.config.rootPath,
      ignorePatterns: [...this.config.ignorePatterns, '.trellis'],
      debounceMs: this.config.debounceMs,
      onEvent: () => {},
    });
    const events = await scanner.scan({
      onProgress: (progress: ScanProgress) => {
        if (progress.phase === 'done') {
          return;
        }
        opts?.onProgress?.({
          phase: progress.phase,
          current: progress.current,
          total: progress.total,
          message: progress.message,
        });
      },
    });

    let opsCreated = 1; // branch op
    opts?.onProgress?.({
      phase: 'recording',
      current: 0,
      total: events.length,
      message: `Scanning ${events.length} initial file operations…`,
    });
    for (const event of events) {
      // Store file content in blob store
      if (event.contentHash) {
        try {
          const absPath = join(this.config.rootPath, event.path);
          const content = await readFile(absPath);
          await this._blobStore!.put(content);
        } catch {}
      }

      const op = await createVcsOp('vcs:fileAdd', {
        agentId: this.agentId,
        previousHash: this.opLog.getLastOp()?.hash,
        vcs: {
          filePath: event.path,
          contentHash: event.contentHash,
          size: event.size,
        },
      });
      await this.applyOp(op);
      opsCreated++;
      const scannedFiles = opsCreated - 1;
      if (scannedFiles % 25 === 0 || scannedFiles === events.length) {
        opts?.onProgress?.({
          phase: 'recording',
          current: scannedFiles,
          total: events.length,
          message: `Scanned ${scannedFiles}/${events.length} initial file ops`,
        });
      }
    }

    await this.flushAutoCheckpoint();

    // --- Agent scaffold ---
    opts?.onProgress?.({
      phase: 'scaffolding',
      current: 0,
      total: 1,
      message: 'Inferring project context…',
    });
    const context = await inferProjectContext(this.config.rootPath, {
      precomputedFileCount: events.length,
    });
    const profile = loadProfile();
    writeAgentScaffold(this.config.rootPath, { profile, context });

    opts?.onProgress?.({
      phase: 'done',
      current: opsCreated,
      total: opsCreated,
      message: `Initialized repository with ${opsCreated} operations`,
    });
    return { opsCreated, context };
  }

  /**
   * Open an existing TrellisVCS repo. Loads ops and replays into EAV store.
   */
  open(): { opsReplayed: number } {
    this.opLog.load();

    // Initialize blob store
    const trellisDir = join(this.config.rootPath, '.trellis');
    this._blobStore = new BlobStore(trellisDir);

    // Load config
    const configPath = join(this.config.rootPath, '.trellis', 'config.json');
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, 'utf-8');
      const persisted: PersistedConfig = JSON.parse(raw);
      this.agentId = persisted.agentId;
      // Re-merge persisted patterns with .gitignore + .trellisignore
      const filePatterns = readIgnorePatterns(this.config.rootPath);
      this.config.ignorePatterns = [
        ...new Set([...persisted.ignorePatterns, ...filePatterns]),
      ];
      this.config.debounceMs = persisted.debounceMs;
      this.config.defaultBranch = persisted.defaultBranch;
    }

    // Load branch + lane session state
    this.loadCurrentBranch();

    const integrationOps = this.opLog.readAll();
    const laneOps = this.activeLaneLog
      ? this.activeLaneLog.readAll()
      : undefined;
    const activeMeta = this.activeLaneId
      ? this.getLaneMeta(this.activeLaneId)
      : undefined;
    this.refreshMaterializedStore(integrationOps, laneOps, activeMeta);

    const laneReplayed = this.materializationStats.laneOpsReplayed;
    return {
      opsReplayed:
        this.materializationStats.integrationOpsReplayed + laneReplayed,
    };
  }

  /**
   * Start watching the filesystem for changes.
   */
  watch(): void {
    this.ingestion = new Ingestion({
      agentId: this.agentId,
      lastOpHash: this.getActiveJournal().getLastOp()?.hash,
      onOp: (op) => this.applyOp(op),
    });

    this.watcher = new FileWatcher({
      rootPath: this.config.rootPath,
      ignorePatterns: [...this.config.ignorePatterns, '.trellis'],
      debounceMs: this.config.debounceMs,
      onEvent: async (event) => {
        // Store blob for file adds/modifies
        if (
          (event.type === 'add' || event.type === 'modify') &&
          event.contentHash &&
          this._blobStore
        ) {
          try {
            const absPath = join(this.config.rootPath, event.path);
            const content = await readFile(absPath);
            await this._blobStore.put(content);
          } catch {}
        }
        await this.ingestion!.process(event);
      },
    });

    // Scan to populate known files map, reconcile against op log for
    // untracked files, then start watching for live changes.
    this.watcher.scan().then(async (scanEvents) => {
      // Build set of paths already tracked in the op log
      const trackedPaths = new Set(this.trackedFiles().map((f) => f.path));

      // Emit fileAdd ops for files on disk that aren't in the op log
      for (const event of scanEvents) {
        if (!trackedPaths.has(event.path)) {
          // Store blob
          if (event.contentHash && this._blobStore) {
            try {
              const absPath = join(this.config.rootPath, event.path);
              const content = await readFile(absPath);
              await this._blobStore.put(content);
            } catch {}
          }
          await this.ingestion!.process(event);
        }
      }

      this.watcher!.start();
    });
  }

  /**
   * Stop watching.
   */
  stop(): void {
    this.watcher?.stop();
    this.watcher = null;
    this.ingestion = null;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /**
   * Returns all ops in the causal stream.
   */
  getOps(): VcsOp[] {
    return this.opLog.readAll();
  }

  /**
   * Returns the total number of ops.
   */
  getOpCount(): number {
    return this.opLog.count();
  }

  /**
   * Returns the EAV store for direct querying.
   */
  getStore(): EAVStore {
    return this.store;
  }

  /**
   * Returns the blob store for content retrieval.
   */
  getBlobStore(): BlobStore | null {
    return this._blobStore;
  }

  /**
   * Returns the current status: tracked files, last op, branch info.
   */
  status(): {
    branch: string;
    totalOps: number;
    trackedFiles: number;
    lastOp: VcsOp | undefined;
    recentOps: VcsOp[];
  } {
    const ops = this.opLog.readAll();
    const fileEntities = this.store
      .getFactsByAttribute('type')
      .filter((f) => f.v === 'FileNode');

    return {
      branch: this.currentBranch,
      totalOps: ops.length,
      trackedFiles: fileEntities.length,
      lastOp: ops[ops.length - 1],
      recentOps: ops.slice(-10),
    };
  }

  /**
   * Returns op history, optionally filtered by file path.
   */
  log(opts?: { limit?: number; filePath?: string }): VcsOp[] {
    let ops = this.opLog.readAll();

    if (opts?.filePath) {
      ops = ops.filter((op) => {
        const vcs = op.vcs;
        return (
          vcs?.filePath === opts.filePath || vcs?.oldFilePath === opts.filePath
        );
      });
    }

    if (opts?.limit) {
      ops = ops.slice(-opts.limit);
    }

    return ops;
  }

  /**
   * Returns all tracked file paths and their content hashes.
   */
  trackedFiles(): Array<{ path: string; contentHash: string | undefined }> {
    const fileTypeFacts = this.store
      .getFactsByAttribute('type')
      .filter((f) => f.v === 'FileNode');

    return fileTypeFacts.map((f) => {
      const pathFacts = this.store
        .getFactsByEntity(f.e)
        .filter((ef) => ef.a === 'path');
      const hashFacts = this.store
        .getFactsByEntity(f.e)
        .filter((ef) => ef.a === 'contentHash');
      return {
        path: (pathFacts[0]?.v as string) ?? f.e,
        contentHash: hashFacts[0]?.v as string | undefined,
      };
    });
  }

  /**
   * Returns the root path of the repository.
   */
  getRootPath(): string {
    return this.config.rootPath;
  }

  /**
   * Checks if a .trellis directory exists at the root path.
   */
  static isRepo(rootPath: string): boolean {
    return existsSync(join(rootPath, '.trellis', 'config.json'));
  }

  static repair(rootPath: string): { recovered: number; lost: number } {
    const opsPath = join(rootPath, '.trellis', 'ops.json');
    return JsonOpLog.repair(opsPath);
  }

  // -------------------------------------------------------------------------
  // Branch Management (delegated to src/vcs/branch.ts)
  // -------------------------------------------------------------------------

  async createBranch(name: string): Promise<VcsOp> {
    const op = await branchMod.createBranch(
      this._ctx(),
      name,
      this.currentBranch,
    );
    await this.flushAutoCheckpoint();
    return op;
  }

  switchBranch(name: string): void {
    branchMod.switchBranch(this._ctx(), name);
    this.currentBranch = name;
    const state = branchMod.loadBranchState(this.config.rootPath);
    branchMod.saveBranchState(this.config.rootPath, {
      ...state,
      currentBranch: name,
    });
  }

  listBranches(): branchMod.BranchInfo[] {
    return branchMod.listBranches(this._ctx(), this.currentBranch);
  }

  async deleteBranch(name: string): Promise<VcsOp> {
    const op = await branchMod.deleteBranch(
      this._ctx(),
      name,
      this.currentBranch,
    );
    await this.flushAutoCheckpoint();
    return op;
  }

  getCurrentBranch(): string {
    return this.currentBranch;
  }

  /** Integration branch head op hash from the materialized store (ADR 0004). */
  getBranchHeadOpHash(branchName: string = this.currentBranch): string | undefined {
    return branchMod.getBranchHeadOpHash(this._ctx(), branchName);
  }

  getActiveLaneId(): string | undefined {
    return this.activeLaneId;
  }

  /** Last enter/leave/open materialization counters (W4). */
  getMaterializationStats(): MaterializationStats {
    return { ...this.materializationStats };
  }

  listLanes(): LaneMeta[] {
    return laneMod.listLaneMetas(this.trellisDir());
  }

  getIntegrationOpCount(): number {
    return this.opLog.count();
  }

  getLaneOpCount(laneId: string): number {
    const log = new LaneOpLog(laneMod.laneDir(this.trellisDir(), laneId));
    log.load();
    return log.count();
  }

  getLaneMeta(laneId: string): LaneMeta | undefined {
    return laneMod.loadLaneMeta(this.trellisDir(), laneId);
  }

  /** Active lane linked to an issue, if any. */
  findLaneForIssue(issueId: string): LaneMeta | undefined {
    const normalized = issueId.startsWith('issue:')
      ? issueId
      : `issue:${issueId}`;
    return this.listLanes().find(
      (lane) => lane.issueId === normalized && lane.status === 'active',
    );
  }

  /**
   * Enter lane from TRELLIS_LANE_ID when set (hooks/MCP/subprocess agents).
   */
  async syncEnvLaneFromEnv(): Promise<void> {
    const laneId = process.env.TRELLIS_LANE_ID?.trim();
    if (!laneId) return;
    if (this.activeLaneId === laneId) return;
    if (this.activeLaneId) {
      throw new Error(
        `TRELLIS_LANE_ID=${laneId} conflicts with active lane '${this.activeLaneId}'`,
      );
    }
    await this.enterLane(laneId);
  }

  /** Ops and touched files in a lane journal (for `trellis lane diff`). */
  summarizeLane(laneId: string): {
    meta: LaneMeta;
    ops: VcsOp[];
    filePaths: string[];
    integrationHead?: string;
  } {
    const meta = this.getLaneMeta(laneId);
    if (!meta) {
      throw new Error(`Lane not found: ${laneId}`);
    }
    const log = new LaneOpLog(laneMod.laneDir(this.trellisDir(), laneId));
    log.load();
    const ops = log.readAll();
    const filePaths = [
      ...new Set(
        ops
          .map((op) => op.vcs?.filePath ?? op.vcs?.oldFilePath)
          .filter((p): p is string => Boolean(p)),
      ),
    ];
    return {
      meta,
      ops,
      filePaths,
      integrationHead: this.getBranchHeadOpHash(meta.targetBranch),
    };
  }

  /**
   * Fork a new agent lane from the current integration branch head.
   * Writes `vcs:laneCreate` to the integration journal only.
   */
  async createLane(opts?: {
    fromBranch?: string;
    targetBranch?: string;
    issueId?: string;
    sessionId?: string;
    worktreePath?: string;
  }): Promise<LaneMeta> {
    if (this.activeLaneId) {
      throw new Error(
        `Cannot create a lane while inside lane '${this.activeLaneId}' — leave first`,
      );
    }

    const baseBranch = opts?.fromBranch ?? this.currentBranch;
    const baseOpHash =
      branchMod.getBranchHeadOpHash(this._ctx(), baseBranch) ??
      this.opLog.getLastOp()?.hash;
    if (!baseOpHash) {
      throw new Error(
        `No integration head on branch '${baseBranch}' to fork lane from`,
      );
    }

    const meta = laneMod.createLaneMeta(this.trellisDir(), {
      baseBranch,
      baseOpHash,
      targetBranch: opts?.targetBranch ?? baseBranch,
      agentId: this.agentId,
      issueId: opts?.issueId,
      sessionId: opts?.sessionId,
      worktreePath: opts?.worktreePath,
    });

    const op = await createVcsOp('vcs:laneCreate', {
      agentId: this.agentId,
      previousHash: this.opLog.getLastOp()?.hash,
      vcs: {
        laneId: meta.id,
        baseBranch: meta.baseBranch,
        baseOpHash: meta.baseOpHash,
        targetBranch: meta.targetBranch,
        issueId: meta.issueId,
      },
    });
    await this.applyOp(op);
    return meta;
  }

  /**
   * Fork a lane for a new session (ADR 0006 sibling, ADR 0007 child).
   */
  async forkLane(
    parentLaneId: string,
    opts?: {
      sessionId?: string;
      issueId?: string;
      worktreePath?: string;
      forkKind?: laneMod.LaneForkKind;
    },
  ): Promise<LaneMeta> {
    if (this.activeLaneId) {
      throw new Error(
        `Cannot fork a lane while inside lane '${this.activeLaneId}' — leave first`,
      );
    }

    const parent = laneMod.loadLaneMeta(this.trellisDir(), parentLaneId);
    if (!parent) {
      throw new Error(`Lane not found: ${parentLaneId}`);
    }
    if (parent.status !== 'active') {
      throw new Error(
        `Lane '${parentLaneId}' is ${parent.status} — cannot fork`,
      );
    }

    const forkKind = opts?.forkKind ?? 'sibling';
    const forkedAt = new Date().toISOString();
    const parentLog = new LaneOpLog(
      laneMod.laneDir(this.trellisDir(), parentLaneId),
    );
    parentLog.load();
    const parentLaneOps = parentLog.readAll();
    const parentHead = laneMod.resolveLaneHeadFromJournal(parent, parentLaneOps);

    if (forkKind === 'child') {
      const meta = laneMod.createLaneMeta(this.trellisDir(), {
        baseBranch: parent.baseBranch,
        baseOpHash: parent.baseOpHash,
        targetBranch: parent.targetBranch,
        agentId: this.agentId,
        issueId: opts?.issueId ?? parent.issueId,
        sessionId: opts?.sessionId,
        worktreePath: opts?.worktreePath,
        parentLaneId: parent.id,
        forkKind: 'child',
        forkedAt,
        virtualBaseOpHash: parentHead,
      });

      const op = await createVcsOp('vcs:laneCreate', {
        agentId: this.agentId,
        previousHash: this.opLog.getLastOp()?.hash,
        vcs: {
          laneId: meta.id,
          baseBranch: meta.baseBranch,
          baseOpHash: meta.baseOpHash,
          targetBranch: meta.targetBranch,
          issueId: meta.issueId,
          sessionId: meta.sessionId,
          parentLaneId: parent.id,
          forkKind: 'child',
          virtualBaseOpHash: parentHead,
        },
      });
      await this.applyOp(op);
      return meta;
    }

    const meta = laneMod.createLaneMeta(this.trellisDir(), {
      baseBranch: parent.baseBranch,
      baseOpHash: parent.baseOpHash,
      targetBranch: parent.targetBranch,
      agentId: this.agentId,
      issueId: opts?.issueId ?? parent.issueId,
      sessionId: opts?.sessionId,
      worktreePath: opts?.worktreePath,
      parentLaneId: parent.id,
      forkKind: 'sibling',
      forkedAt,
    });

    const op = await createVcsOp('vcs:laneCreate', {
      agentId: this.agentId,
      previousHash: this.opLog.getLastOp()?.hash,
      vcs: {
        laneId: meta.id,
        baseBranch: meta.baseBranch,
        baseOpHash: meta.baseOpHash,
        targetBranch: meta.targetBranch,
        issueId: meta.issueId,
        sessionId: meta.sessionId,
        parentLaneId: parent.id,
        forkKind: 'sibling',
      },
    });
    await this.applyOp(op);
    return meta;
  }

  /**
   * Enter a lane: route subsequent writes to its isolated journal.
   */
  async enterLane(laneId: string): Promise<LaneMeta> {
    if (this.activeLaneId) {
      throw new Error(
        `Already in lane '${this.activeLaneId}' — leave before entering another`,
      );
    }

    const meta = laneMod.loadLaneMeta(this.trellisDir(), laneId);
    if (!meta) {
      throw new Error(`Lane not found: ${laneId}`);
    }
    if (meta.status !== 'active') {
      throw new Error(`Lane '${laneId}' is ${meta.status} — cannot enter`);
    }

    this.activeLaneId = laneId;
    this.activeLaneLog = new LaneOpLog(laneMod.laneDir(this.trellisDir(), laneId));
    this.activeLaneLog.load();

    this.refreshMaterializedStore(
      this.opLog.readAll(),
      this.activeLaneLog.readAll(),
      meta,
    );

    branchMod.saveBranchState(this.config.rootPath, {
      currentBranch: this.currentBranch,
      activeLaneId: laneId,
    });
    this.syncIngestionLastOpHash();
    return meta;
  }

  /** Leave the active lane and restore integration-only materialized state. */
  async leaveLane(): Promise<void> {
    if (!this.activeLaneId) return;

    this.activeLaneId = undefined;
    this.activeLaneLog = null;
    branchMod.saveBranchState(this.config.rootPath, {
      currentBranch: this.currentBranch,
    });
    this.restoreIntegrationOnlyStore();
    this.syncIngestionLastOpHash();
  }

  /** Mark a lane dropped (leaves first if it is the active lane). */
  async dropLane(laneId: string): Promise<void> {
    if (this.activeLaneId === laneId) {
      await this.leaveLane();
    }

    const meta = laneMod.loadLaneMeta(this.trellisDir(), laneId);
    if (!meta) {
      throw new Error(`Lane not found: ${laneId}`);
    }
    if (meta.status === 'dropped') return;

    meta.status = 'dropped';
    meta.updatedAt = new Date().toISOString();
    laneMod.saveLaneMeta(this.trellisDir(), meta);

    const op = await createVcsOp('vcs:laneDrop', {
      agentId: this.agentId,
      previousHash: this.opLog.getLastOp()?.hash,
      vcs: {
        laneId: meta.id,
        laneStatus: 'dropped',
      },
    });
    await this.applyOp(op);
  }

  /**
   * Promote a lane journal onto the integration branch (ADR 0002, ADR 0003).
   */
  async promoteLane(
    laneId: string,
    opts?: { dryRun?: boolean; explain?: boolean; toBranch?: string },
  ): Promise<LanePromoteResult> {
    const meta = this.getLaneMeta(laneId);
    if (!meta) {
      throw new Error(`Lane not found: ${laneId}`);
    }
    if (meta.status !== 'active') {
      throw new Error(`Lane '${laneId}' is ${meta.status} — cannot promote`);
    }

    if (this.activeLaneId === laneId) {
      await this.leaveLane();
    } else if (this.activeLaneId) {
      throw new Error(
        `Cannot promote while inside lane '${this.activeLaneId}' — leave first`,
      );
    }

    const targetBranch = opts?.toBranch ?? meta.targetBranch;
    const integrationOps = this.opLog.readAll();
    const snapshotHead =
      lanePromoteMod.resolveBranchHeadFromOps(integrationOps, targetBranch) ??
      branchMod.getBranchHeadOpHash(this._ctx(), targetBranch);
    if (!snapshotHead) {
      throw new Error(`No head on branch '${targetBranch}' to promote onto`);
    }

    const laneLog = new LaneOpLog(laneMod.laneDir(this.trellisDir(), laneId));
    laneLog.load();
    const laneOps = laneLog.readAll();

    let parentLaneOps: VcsOp[] | undefined;
    if (meta.forkKind === 'child' && meta.parentLaneId) {
      parentLaneOps = this.loadLaneJournalOps(meta.parentLaneId);
    }

    const plan = await lanePromoteMod.planLanePromote({
      laneId,
      meta,
      targetBranch,
      snapshotHead,
      integrationOps: this.opLog.readAll(),
      laneOps,
      parentLaneOps,
      blobStore: this._blobStore,
    });

    if (opts?.dryRun || !plan.canPromote) {
      return { ...plan, promoted: false };
    }

    meta.status = 'promoting';
    meta.updatedAt = new Date().toISOString();
    laneMod.saveLaneMeta(this.trellisDir(), meta);

    const startOp = await createVcsOp('vcs:lanePromoteStart', {
      agentId: this.agentId,
      previousHash: this.opLog.getLastOp()?.hash,
      vcs: {
        laneId,
        targetBranch,
        baseOpHash: meta.baseOpHash,
      },
    });
    await this.applyOp(startOp, { skipBranchAdvance: true });

    const currentHead =
      lanePromoteMod.resolveBranchHeadFromOps(this.opLog.readAll(), targetBranch) ??
      branchMod.getBranchHeadOpHash(this._ctx(), targetBranch);
    if (currentHead !== snapshotHead) {
      meta.status = 'active';
      meta.updatedAt = new Date().toISOString();
      laneMod.saveLaneMeta(this.trellisDir(), meta);

      const abortOp = await createVcsOp('vcs:lanePromoteAbort', {
        agentId: this.agentId,
        previousHash: this.opLog.getLastOp()?.hash,
        vcs: { laneId },
      });
      await this.applyOp(abortOp, { skipBranchAdvance: true });
      throw new Error(
        `Integration head moved during promote — retry after integration settles`,
      );
    }

    let previousHash = this.opLog.getLastOp()?.hash;
    let lastReplayedHash: string | undefined;
    let opsAppended = 0;

    for (const action of plan.opsToReplay) {
      let opToApply: VcsOp;

      if (action.mergedContent !== undefined && action.sourceOp.vcs?.filePath) {
        const contentHash = await this._blobStore!.put(
          Buffer.from(action.mergedContent, 'utf-8'),
        );
        opToApply = await createVcsOp('vcs:fileModify', {
          agentId: action.sourceOp.agentId,
          previousHash,
          vcs: {
            filePath: action.sourceOp.vcs.filePath,
            contentHash,
            laneId: action.sourceOp.vcs.laneId ?? laneId,
          },
        });
      } else {
        opToApply = await lanePromoteMod.rechainOpForIntegration(
          action.sourceOp,
          previousHash,
        );
      }

      await this.applyOp(opToApply, { skipBranchAdvance: true });
      previousHash = opToApply.hash;
      lastReplayedHash = opToApply.hash;
      opsAppended++;
    }

    if (lastReplayedHash) {
      await this.appendBranchAdvance(lastReplayedHash);
    }

    const completeOp = await createVcsOp('vcs:lanePromoteComplete', {
      agentId: this.agentId,
      previousHash: this.opLog.getLastOp()?.hash,
      vcs: {
        laneId,
        targetBranch,
        laneStatus: 'promoted',
      },
    });
    await this.applyOp(completeOp, { skipBranchAdvance: true });

    meta.status = 'promoted';
    meta.headOpHash = lastReplayedHash ?? meta.headOpHash;
    meta.updatedAt = new Date().toISOString();
    laneMod.saveLaneMeta(this.trellisDir(), meta);

    this.invalidateIntegrationCache();
    this.refreshMaterializedStore(this.opLog.readAll());
    this.syncIngestionLastOpHash();

    return {
      ...plan,
      promoted: true,
      integrationOpsAppended: opsAppended + 2,
      completeOpHash: completeOp.hash,
    };
  }

  // -------------------------------------------------------------------------
  // Milestones (delegated to src/vcs/milestone.ts)
  // -------------------------------------------------------------------------

  async createMilestone(
    message: string,
    opts?: { fromOpHash?: string; toOpHash?: string },
  ): Promise<VcsOp> {
    const op = await milestoneMod.createMilestone(this._ctx(), message, opts);
    await this.flushAutoCheckpoint();
    return op;
  }

  listMilestones(): milestoneMod.MilestoneInfo[] {
    return milestoneMod.listMilestones(this._ctx());
  }

  // -------------------------------------------------------------------------
  // Checkpoints (delegated to src/vcs/checkpoint.ts)
  // -------------------------------------------------------------------------

  async createCheckpoint(
    trigger: checkpointMod.CheckpointTrigger = 'manual',
  ): Promise<VcsOp> {
    const op = await checkpointMod.createCheckpoint(this._ctx(), trigger);
    this.checkpointOpCount = 0;
    return op;
  }

  listCheckpoints(): checkpointMod.CheckpointInfo[] {
    return checkpointMod.listCheckpoints(this._ctx());
  }

  setCheckpointThreshold(threshold: number): void {
    this.checkpointThreshold = threshold;
  }

  // -------------------------------------------------------------------------
  // Diff & Merge (delegated to src/vcs/diff.ts, src/vcs/merge.ts)
  // -------------------------------------------------------------------------

  /**
   * Diff two branches by comparing their file states.
   */
  diffBranches(branchA: string, branchB: string): diffMod.DiffResult {
    const ops = this.opLog.readAll();
    // Build file state for each branch by walking all ops
    // (branch-scoped filtering comes later; for now, single linear stream)
    const stateA = diffMod.buildFileStateAtOp(ops);
    const stateB = diffMod.buildFileStateAtOp(ops);
    return diffMod.diffFileStates(stateA, stateB, this._blobStore);
  }

  /**
   * Diff between two op hashes in the causal stream.
   */
  diffOps(fromHash: string, toHash: string): diffMod.DiffResult {
    return diffMod.diffOpRange(
      this.opLog.readAll(),
      fromHash,
      toHash,
      this._blobStore,
    );
  }

  /**
   * Diff the current state against a specific op hash (e.g. a milestone).
   */
  diffFromOp(opHash: string): diffMod.DiffResult {
    const ops = this.opLog.readAll();
    const stateA = diffMod.buildFileStateAtOp(ops, opHash);
    const stateB = diffMod.buildFileStateAtOp(ops);
    return diffMod.diffFileStates(stateA, stateB, this._blobStore);
  }

  /**
   * Three-way merge: merge source branch state into current branch state.
   * Uses the fork-point (branch creation op) as the common ancestor.
   */
  mergeBranch(sourceBranch: string): mergeMod.MergeResult {
    const ops = this.opLog.readAll();

    // Find the branch creation op to determine fork point
    const branchOp = ops.find(
      (o) =>
        o.kind === 'vcs:branchCreate' && o.vcs?.branchName === sourceBranch,
    );
    const forkHash = branchOp?.vcs?.targetOpHash;

    // Build three states
    const base = forkHash
      ? diffMod.buildFileStateAtOp(ops, forkHash)
      : new Map<string, diffMod.FileState>();
    const ours = diffMod.buildFileStateAtOp(ops); // current full state
    const theirs = diffMod.buildFileStateAtOp(ops); // same stream for now

    return mergeMod.threeWayMerge(base, ours, theirs, this._blobStore);
  }

  // -------------------------------------------------------------------------
  // Semantic Parsing (delegated to src/semantic/)
  // -------------------------------------------------------------------------

  private _parsers: ParserAdapter[] = [
    typescriptParser,
    pythonParser,
    goParser,
    rustParser,
    rubyParser,
    javaParser,
    csharpParser,
  ];

  /**
   * Parse a file's content into AST-level entities.
   */
  parseFile(content: string, filePath: string): ParseResult | null {
    const ext = filePath.split('.').pop() ?? '';
    const parser = this._parsers.find((p) =>
      p.languages.some((lang) => {
        if (lang === 'typescript') return ext === 'ts';
        if (lang === 'javascript')
          return ext === 'js' || ext === 'mjs' || ext === 'cjs';
        if (lang === 'tsx') return ext === 'tsx';
        if (lang === 'jsx') return ext === 'jsx';
        if (lang === 'python') return ext === 'py' || ext === 'pyi';
        if (lang === 'go') return ext === 'go';
        if (lang === 'rust') return ext === 'rs';
        if (lang === 'ruby') return ext === 'rb';
        if (lang === 'java') return ext === 'java';
        if (lang === 'csharp') return ext === 'cs';
        return false;
      }),
    );
    if (!parser) return null;
    return parser.parse(content, filePath);
  }

  /**
   * Compute semantic diff between two versions of a file.
   */
  semanticDiff(
    oldContent: string,
    newContent: string,
    filePath: string,
  ): SemanticPatch[] {
    const parser = this._parsers.find((p) =>
      p.languages.some((lang) => {
        const ext = filePath.split('.').pop() ?? '';
        if (lang === 'typescript') return ext === 'ts';
        if (lang === 'javascript')
          return ext === 'js' || ext === 'mjs' || ext === 'cjs';
        if (lang === 'tsx') return ext === 'tsx';
        if (lang === 'jsx') return ext === 'jsx';
        if (lang === 'python') return ext === 'py' || ext === 'pyi';
        if (lang === 'go') return ext === 'go';
        if (lang === 'rust') return ext === 'rs';
        if (lang === 'ruby') return ext === 'rb';
        if (lang === 'java') return ext === 'java';
        if (lang === 'csharp') return ext === 'cs';
        return false;
      }),
    );
    if (!parser) return [];
    const oldResult = parser.parse(oldContent, filePath);
    const newResult = parser.parse(newContent, filePath);
    return parser.diff(oldResult, newResult);
  }

  // -------------------------------------------------------------------------
  // Idea Garden (delegated to src/garden/)
  // -------------------------------------------------------------------------

  private _garden: IdeaGarden | null = null;

  /**
   * Get the Idea Garden instance for exploring abandoned work.
   */
  garden(): IdeaGarden {
    if (!this._garden) {
      this._garden = new IdeaGarden({
        readAllOps: () => this.opLog.readAll(),
        getMilestonedOpHashes: () =>
          buildMilestonedOpHashes(this.opLog.readAll()),
      });
    }
    return this._garden;
  }

  // -------------------------------------------------------------------------
  // Issue Management (delegated to src/vcs/issue.ts)
  // -------------------------------------------------------------------------

  async createIssue(
    title: string,
    opts?: {
      priority?: 'critical' | 'high' | 'medium' | 'low';
      labels?: string[];
      assignee?: string;
      parentId?: string;
      description?: string;
      status?: 'backlog' | 'queue';
      criteria?: Array<{ description: string; command?: string }>;
    },
  ): Promise<VcsOp> {
    const op = await issueMod.createIssue(
      this._ctx(),
      this.config.rootPath,
      title,
      opts,
    );
    await this.flushAutoCheckpoint();
    return op;
  }

  async updateIssue(
    id: string,
    updates: {
      title?: string;
      description?: string;
      priority?: 'critical' | 'high' | 'medium' | 'low';
      labels?: string[];
      assignee?: string;
      status?: 'backlog' | 'queue' | 'in_progress' | 'paused' | 'closed';
      parentId?: string | null;
    },
  ): Promise<VcsOp> {
    const op = await issueMod.updateIssue(this._ctx(), id, updates);
    await this.flushAutoCheckpoint();
    return op;
  }

  async startIssue(id: string, opts?: { lane?: boolean }): Promise<VcsOp> {
    if (this.activeLaneId) {
      await this.leaveLane();
    }

    const issue = issueMod.getIssue(this._ctx(), id);
    if (!issue) throw new Error(`Issue ${id} not found.`);

    const slug = (issue.title ?? id)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    const branchName = `issue/${id}-${slug}`;

    // Create the branch
    await this.createBranch(branchName);

    // Emit the issueStart op
    const op = await issueMod.startIssue(this._ctx(), id, branchName);

    // Switch to the branch
    this.switchBranch(branchName);

    if (opts?.lane !== false) {
      const issueKey = id.startsWith('issue:') ? id : `issue:${id}`;
      let lane = this.findLaneForIssue(issueKey);
      if (!lane) {
        lane = await this.createLane({ issueId: issueKey });
      }
      await this.enterLane(lane.id);
    }

    await this.flushAutoCheckpoint();
    return op;
  }

  async pauseIssue(id: string, note: string): Promise<VcsOp> {
    if (this.activeLaneId) {
      await this.leaveLane();
    }

    const op = await issueMod.pauseIssue(this._ctx(), id, note);

    // Switch back to default branch
    this.switchBranch(this.config.defaultBranch);

    await this.flushAutoCheckpoint();
    return op;
  }

  async resumeIssue(id: string, opts?: { lane?: boolean }): Promise<VcsOp> {
    const issue = issueMod.getIssue(this._ctx(), id);
    if (!issue) throw new Error(`Issue ${id} not found.`);
    if (!issue.branchName)
      throw new Error(`Issue ${id} has no tracked branch.`);

    const op = await issueMod.resumeIssue(this._ctx(), id);

    // Switch to the issue branch
    this.switchBranch(issue.branchName);

    if (opts?.lane !== false) {
      const issueKey = id.startsWith('issue:') ? id : `issue:${id}`;
      const lane = this.findLaneForIssue(issueKey);
      if (lane) {
        await this.enterLane(lane.id);
      }
    }

    await this.flushAutoCheckpoint();
    return op;
  }

  async closeIssue(
    id: string,
    opts?: { confirm?: boolean },
  ): Promise<{ op?: VcsOp; criteriaResults: issueMod.CriterionResult[] }> {
    if (this.activeLaneId) {
      await this.leaveLane();
    }

    const result = await issueMod.closeIssue(this._ctx(), id, opts);
    if (result.op) {
      await this.flushAutoCheckpoint();
    }
    return result;
  }

  async triageIssue(id: string): Promise<VcsOp> {
    const op = await issueMod.triageIssue(this._ctx(), id);
    await this.flushAutoCheckpoint();
    return op;
  }

  async reopenIssue(id: string): Promise<VcsOp> {
    const op = await issueMod.reopenIssue(this._ctx(), id);
    await this.flushAutoCheckpoint();
    return op;
  }

  checkCompletionReadiness(): issueMod.CompletionReadiness {
    return issueMod.checkCompletionReadiness(this._ctx());
  }

  async assignIssue(id: string, agentId: string): Promise<VcsOp> {
    const op = await issueMod.assignIssue(this._ctx(), id, agentId);
    await this.flushAutoCheckpoint();
    return op;
  }

  async blockIssue(id: string, blockedById: string): Promise<VcsOp> {
    const op = await issueMod.blockIssue(this._ctx(), id, blockedById);
    await this.flushAutoCheckpoint();
    return op;
  }

  async unblockIssue(id: string, blockedById: string): Promise<VcsOp> {
    const op = await issueMod.unblockIssue(this._ctx(), id, blockedById);
    await this.flushAutoCheckpoint();
    return op;
  }

  async addCriterion(
    issueId: string,
    description: string,
    command?: string,
  ): Promise<VcsOp> {
    const op = await issueMod.addCriterion(
      this._ctx(),
      issueId,
      description,
      command,
    );
    await this.flushAutoCheckpoint();
    return op;
  }

  async setCriterionStatus(
    issueId: string,
    criterionIndex: number,
    status: 'passed' | 'failed' | 'pending',
  ): Promise<VcsOp> {
    const op = await issueMod.setCriterionStatus(
      this._ctx(),
      issueId,
      criterionIndex,
      status,
    );
    await this.flushAutoCheckpoint();
    return op;
  }

  async runCriteria(issueId: string): Promise<issueMod.CriterionResult[]> {
    return issueMod.runCriteria(this._ctx(), issueId, this.config.rootPath);
  }

  listIssues(filters?: issueMod.IssueFilters): issueMod.IssueInfo[] {
    return issueMod.listIssues(this._ctx(), filters);
  }

  getIssue(id: string): issueMod.IssueInfo | null {
    return issueMod.getIssue(this._ctx(), id);
  }

  getActiveIssues(): issueMod.IssueInfo[] {
    return issueMod.getActiveIssues(this._ctx());
  }

  // -------------------------------------------------------------------------
  // Decision Traces
  // -------------------------------------------------------------------------

  async recordDecision(input: decisionMod.DecisionInput): Promise<VcsOp> {
    const op = await decisionMod.recordDecision(
      this._ctx(),
      this.config.rootPath,
      input,
    );
    await this.flushAutoCheckpoint();
    return op;
  }

  queryDecisions(filter?: decisionMod.DecisionFilter): decisionMod.Decision[] {
    return decisionMod.queryDecisions(this._ctx(), filter);
  }

  getDecisionChain(entityId: string): decisionMod.Decision[] {
    return decisionMod.getDecisionChain(this._ctx(), entityId);
  }

  getDecision(id: string): decisionMod.Decision | null {
    return decisionMod.getDecision(this._ctx(), id);
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private _ctx(): EngineContext {
    return {
      store: this.store,
      agentId: this.agentId,
      readAllOps: () => this.getActiveJournal().readAll(),
      getLastOp: () => this.getActiveJournal().getLastOp(),
      applyOp: (op, opts) => this.applyOp(op, opts),
    };
  }

  private trellisDir(): string {
    return join(this.config.rootPath, '.trellis');
  }

  private getActiveJournal(): JsonOpLog | LaneOpLog {
    if (this.activeLaneId && this.activeLaneLog) {
      return this.activeLaneLog;
    }
    return this.opLog;
  }

  private invalidateIntegrationCache(): void {
    this.integrationCache = null;
  }

  private loadLaneJournalOps(laneId: string): VcsOp[] {
    const log = new LaneOpLog(laneMod.laneDir(this.trellisDir(), laneId));
    log.load();
    return log.readAll();
  }

  private refreshMaterializedStore(
    integrationOps: VcsOp[],
    laneOps?: VcsOp[],
    meta?: LaneMeta,
  ): void {
    const laneMeta =
      meta ??
      (this.activeLaneId ? this.getLaneMeta(this.activeLaneId) : undefined);

    if (laneMeta?.forkKind === 'child' && laneMeta.parentLaneId) {
      const parentLaneOps = this.loadLaneJournalOps(laneMeta.parentLaneId);
      const { store, stats } = materializeMod.materializeChildForkEntry(
        integrationOps,
        laneMeta.baseOpHash,
        parentLaneOps,
        laneOps ?? [],
      );
      this.store = store;
      this.materializationStats = stats;
      return;
    }

    const tailHash = integrationOps[integrationOps.length - 1]?.hash;
    const { store, cache, stats } = materializeMod.materializeIntegrationOps(
      integrationOps,
      this.integrationCache,
      tailHash,
    );
    this.integrationCache = cache;

    if (laneOps !== undefined) {
      const overlay = materializeMod.overlayLaneOps(store, laneOps);
      this.store = overlay.store;
      this.materializationStats = {
        ...stats,
        laneOpsReplayed: overlay.laneOpsReplayed,
      };
      return;
    }

    this.store = store;
    this.materializationStats = stats;
  }

  /** Swap back to cached integration store without replaying the journal. */
  private restoreIntegrationOnlyStore(): void {
    const integrationOps = this.opLog.readAll();
    const tailHash = integrationOps[integrationOps.length - 1]?.hash;
    const { store, cache, stats } = materializeMod.materializeIntegrationOps(
      integrationOps,
      this.integrationCache,
      tailHash,
    );
    this.integrationCache = cache;
    this.store = store;
    this.materializationStats = {
      ...stats,
      laneOpsReplayed: 0,
    };
  }

  private rebuildStore(ops: VcsOp[]): void {
    this.store = new EAVStore();
    for (const op of ops) {
      this.replayOp(op);
    }
  }

  private syncIngestionLastOpHash(): void {
    if (this.ingestion) {
      this.ingestion.setLastOpHash(this.getActiveJournal().getLastOp()?.hash);
    }
  }

  private stampLaneId(op: VcsOp): void {
    if (!this.activeLaneId) return;
    op.vcs = { ...op.vcs, laneId: this.activeLaneId };
  }

  private requireActiveLaneLog(): LaneOpLog {
    if (!this.activeLaneId || !this.activeLaneLog) {
      throw new Error('No active lane journal');
    }
    return this.activeLaneLog;
  }

  private isIssueIntegrationOp(kind: string): boolean {
    return ISSUE_INTEGRATION_KINDS.has(kind);
  }

  private async applyOp(op: VcsOp, opts?: ApplyOpOptions): Promise<void> {
    const inLane = Boolean(this.activeLaneId);
    const forceIntegration =
      Boolean(opts?.allowIntegrationWrite) ||
      (inLane && this.isIssueIntegrationOp(op.kind));

    let opToApply = op;
    if (inLane && forceIntegration) {
      const intLast = this.opLog.getLastOp();
      if (intLast?.hash !== op.previousHash && isVcsOpKind(op.kind)) {
        opToApply = await createVcsOp(op.kind, {
          agentId: op.agentId,
          previousHash: intLast?.hash,
          vcs: op.vcs ?? {},
        });
      }
    }

    if (inLane && !forceIntegration) {
      this.stampLaneId(opToApply);
    }

    const decomposed = decompose(opToApply);

    if (decomposed.deleteFacts.length > 0) {
      this.store.deleteFacts(decomposed.deleteFacts);
    }
    if (decomposed.deleteLinks.length > 0) {
      this.store.deleteLinks(decomposed.deleteLinks);
    }
    if (decomposed.addFacts.length > 0) {
      this.store.addFacts(decomposed.addFacts);
    }
    if (decomposed.addLinks.length > 0) {
      this.store.addLinks(decomposed.addLinks);
    }

    if (inLane && !forceIntegration) {
      const laneLog = this.requireActiveLaneLog();
      laneLog.append(opToApply);
      laneMod.updateLaneHead(
        this.trellisDir(),
        this.activeLaneId!,
        opToApply.hash,
      );

      if (
        opToApply.kind !== 'vcs:checkpointCreate' &&
        this.checkpointThreshold > 0
      ) {
        this.checkpointOpCount++;
        if (this.checkpointOpCount >= this.checkpointThreshold) {
          this._pendingAutoCheckpoint = true;
        }
      }
      return;
    }

    this.opLog.append(opToApply);

    if (inLane && forceIntegration) {
      const meta = this.getLaneMeta(this.activeLaneId!);
      this.refreshMaterializedStore(
        this.opLog.readAll(),
        this.activeLaneLog!.readAll(),
        meta,
      );
    } else if (!inLane) {
      if (!this.integrationCache) {
        this.integrationCache = {
          tailHash: opToApply.hash,
          store: this.store,
        };
      } else {
        this.integrationCache.tailHash = opToApply.hash;
      }
    }

    if (
      opToApply.kind !== 'vcs:checkpointCreate' &&
      this.checkpointThreshold > 0
    ) {
      this.checkpointOpCount++;
      if (this.checkpointOpCount >= this.checkpointThreshold) {
        this._pendingAutoCheckpoint = true;
      }
    }

    if (
      !opts?.skipBranchAdvance &&
      branchMod.shouldAdvanceBranchHead(opToApply.kind)
    ) {
      await this.appendBranchAdvance(opToApply.hash);
    }
  }

  private async appendBranchAdvance(targetOpHash: string): Promise<void> {
    const advanceOp = await createVcsOp('vcs:branchAdvance', {
      agentId: this.agentId,
      previousHash: this.opLog.getLastOp()?.hash,
      vcs: {
        branchName: this.currentBranch,
        targetOpHash,
      },
    });
    await this.applyOp(advanceOp, {
      skipBranchAdvance: true,
      allowIntegrationWrite: true,
    });
  }

  private async flushAutoCheckpoint(): Promise<void> {
    if (this._pendingAutoCheckpoint) {
      this._pendingAutoCheckpoint = false;
      await this.createCheckpoint('op-count');
    }
  }

  private loadCurrentBranch(): void {
    const state = branchMod.loadBranchState(this.config.rootPath);
    this.currentBranch = state.currentBranch;
    this.activeLaneId = state.activeLaneId;
    this.activeLaneLog = null;

    if (this.activeLaneId) {
      const meta = laneMod.loadLaneMeta(this.trellisDir(), this.activeLaneId);
      if (meta && meta.status === 'active') {
        this.activeLaneLog = new LaneOpLog(
          laneMod.laneDir(this.trellisDir(), this.activeLaneId),
        );
        this.activeLaneLog.load();
      } else {
        this.activeLaneId = undefined;
      }
    }
  }

  private replayOp(op: VcsOp): void {
    // Same as applyOp but doesn't persist (ops are already in the log)
    const decomposed = decompose(op);

    if (decomposed.deleteFacts.length > 0) {
      this.store.deleteFacts(decomposed.deleteFacts);
    }
    if (decomposed.deleteLinks.length > 0) {
      this.store.deleteLinks(decomposed.deleteLinks);
    }
    if (decomposed.addFacts.length > 0) {
      this.store.addFacts(decomposed.addFacts);
    }
    if (decomposed.addLinks.length > 0) {
      this.store.addLinks(decomposed.addLinks);
    }
  }
}
