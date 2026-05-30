/**
 * Idea Garden — Cluster Detection
 *
 * DESIGN.md §7.2–7.4 — Identifies "idea clusters": contiguous sequences
 * of ops that were never incorporated into a milestone and were later
 * diverged from.
 *
 * Three detection heuristics:
 *   1. Context-switch detection (file-set shift)
 *   2. Branch abandonment (stale un-milestoned ops)
 *   3. Revert detection (ops undone by later ops)
 */

import type { VcsOp } from '../vcs/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IdeaCluster {
  id: string;
  ops: VcsOp[];
  firstOp: string;
  lastOp: string;
  affectedFiles: string[];
  affectedSymbols: string[]; // Tier 2 — empty for now
  estimatedIntent: string;
  createdAt: string;
  abandonedAt: string;
  status: 'abandoned' | 'draft' | 'revived';
  /** Which heuristic detected this cluster. */
  detectedBy: string;
}

export interface ClusterDetector {
  name: string;
  detect(ops: VcsOp[], milestonedOpHashes: Set<string>): IdeaCluster[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** VcsOp kinds that represent file-level work (not control ops). */
const FILE_OP_KINDS = new Set([
  'vcs:fileAdd',
  'vcs:fileModify',
  'vcs:fileDelete',
  'vcs:fileRename',
]);

function isFileOp(op: VcsOp): boolean {
  return FILE_OP_KINDS.has(op.kind);
}

function extractFiles(ops: VcsOp[]): string[] {
  const files = new Set<string>();
  for (const op of ops) {
    if (op.vcs?.filePath) files.add(op.vcs.filePath);
    if (op.vcs?.oldFilePath) files.add(op.vcs.oldFilePath);
  }
  return [...files];
}

function generateClusterId(prefix: string, ops: VcsOp[]): string {
  const hash = ops[0]?.hash?.slice(0, 8) ?? 'unknown';
  return `cluster:${prefix}-${hash}`;
}

// ---------------------------------------------------------------------------
// 1. Context-switch detector
// ---------------------------------------------------------------------------

/**
 * Detects clusters when the set of files being modified shifts abruptly.
 * Groups consecutive un-milestoned file ops by "file affinity" — when
 * the overlap between the current working set and the next op drops to zero,
 * a new group starts. Groups that are followed by a different group become
 * candidate clusters.
 */
export const contextSwitchDetector: ClusterDetector = {
  name: 'context-switch',

  detect(ops: VcsOp[], milestonedOpHashes: Set<string>): IdeaCluster[] {
    // Filter to un-milestoned file ops
    const fileOps = ops.filter(
      (o) => isFileOp(o) && !milestonedOpHashes.has(o.hash),
    );

    if (fileOps.length < 2) return [];

    // Group by file affinity windows
    const groups: VcsOp[][] = [];
    let currentGroup: VcsOp[] = [];
    let currentFiles = new Set<string>();

    for (const op of fileOps) {
      const opFile = op.vcs?.filePath;
      if (!opFile) continue;

      // Get directory prefix for affinity comparison
      const opDir = opFile.split('/').slice(0, -1).join('/') || '.';

      if (currentGroup.length === 0) {
        currentGroup.push(op);
        currentFiles.add(opDir);
        continue;
      }

      // Check if this op's directory overlaps with the current working set
      const currentDirs = [...currentFiles];
      const hasOverlap = currentDirs.some(
        (d) => opDir.startsWith(d) || d.startsWith(opDir) || d === opDir,
      );

      if (hasOverlap) {
        currentGroup.push(op);
        currentFiles.add(opDir);
      } else {
        // Context switch — close current group and start new
        if (currentGroup.length > 0) {
          groups.push(currentGroup);
        }
        currentGroup = [op];
        currentFiles = new Set([opDir]);
      }
    }

    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    // All groups except the last (most recent) are candidates
    const clusters: IdeaCluster[] = [];
    for (let i = 0; i < groups.length - 1; i++) {
      const group = groups[i];
      if (group.length < 2) continue; // Skip trivially small groups

      clusters.push({
        id: generateClusterId('ctx', group),
        ops: group,
        firstOp: group[0].hash,
        lastOp: group[group.length - 1].hash,
        affectedFiles: extractFiles(group),
        affectedSymbols: [],
        estimatedIntent: '',
        createdAt: group[0].timestamp,
        abandonedAt: group[group.length - 1].timestamp,
        status: 'abandoned',
        detectedBy: 'context-switch',
      });
    }

    return clusters;
  },
};

// ---------------------------------------------------------------------------
// 2. Revert detector
// ---------------------------------------------------------------------------

/**
 * Detects clusters where a file's content hash returns to a prior value,
 * indicating the intermediate ops were "reverted."
 */
export const revertDetector: ClusterDetector = {
  name: 'revert',

  detect(ops: VcsOp[], milestonedOpHashes: Set<string>): IdeaCluster[] {
    const clusters: IdeaCluster[] = [];

    // Track content hash history per file
    const hashHistory = new Map<string, { hash: string; opIdx: number }[]>();

    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (!isFileOp(op) || !op.vcs?.filePath || !op.vcs?.contentHash) continue;

      const filePath = op.vcs.filePath;
      if (!hashHistory.has(filePath)) {
        hashHistory.set(filePath, []);
      }

      const history = hashHistory.get(filePath)!;
      const currentHash = op.vcs.contentHash;

      // Check if this hash appeared before (revert)
      const priorIdx = history.findIndex((h) => h.hash === currentHash);
      if (priorIdx >= 0 && priorIdx < history.length - 1) {
        // Ops between priorIdx+1 and the current position were "reverted"
        const revertedStartIdx = history[priorIdx + 1].opIdx;
        const revertedEndIdx = history[history.length - 1].opIdx;
        const revertedOps = ops
          .slice(revertedStartIdx, revertedEndIdx + 1)
          .filter(
            (o) =>
              isFileOp(o) &&
              o.vcs?.filePath === filePath &&
              !milestonedOpHashes.has(o.hash),
          );

        if (revertedOps.length >= 2) {
          clusters.push({
            id: generateClusterId('rev', revertedOps),
            ops: revertedOps,
            firstOp: revertedOps[0].hash,
            lastOp: revertedOps[revertedOps.length - 1].hash,
            affectedFiles: [filePath],
            affectedSymbols: [],
            estimatedIntent: '',
            createdAt: revertedOps[0].timestamp,
            abandonedAt: op.timestamp,
            status: 'abandoned',
            detectedBy: 'revert',
          });
        }
      }

      history.push({ hash: currentHash, opIdx: i });
    }

    return clusters;
  },
};

// ---------------------------------------------------------------------------
// 3. Stale-branch detector
// ---------------------------------------------------------------------------

/**
 * Detects un-milestoned ops on branches that haven't seen activity recently.
 * Since we operate on a linear op stream for now, this looks for gaps
 * where file ops stop and then resume on different files.
 */
export const staleBranchDetector: ClusterDetector = {
  name: 'stale-branch',

  detect(ops: VcsOp[], milestonedOpHashes: Set<string>): IdeaCluster[] {
    const clusters: IdeaCluster[] = [];

    // Find branch create ops and their un-milestoned file ops
    const branchOps = new Map<string, VcsOp[]>();

    let currentBranch = 'main';
    for (const op of ops) {
      if (op.kind === 'vcs:branchCreate' && op.vcs?.branchName) {
        currentBranch = op.vcs.branchName;
        if (!branchOps.has(currentBranch)) {
          branchOps.set(currentBranch, []);
        }
      }

      if (isFileOp(op) && !milestonedOpHashes.has(op.hash)) {
        if (!branchOps.has(currentBranch)) {
          branchOps.set(currentBranch, []);
        }
        branchOps.get(currentBranch)!.push(op);
      }
    }

    // Check each branch for stale un-milestoned work
    for (const [branchName, fileOps] of branchOps) {
      if (branchName === 'main') continue; // Don't flag main
      if (fileOps.length < 2) continue;

      const lastOpTime = new Date(fileOps[fileOps.length - 1].timestamp).getTime();
      const now = Date.now();
      const daysSinceLastOp = (now - lastOpTime) / (1000 * 60 * 60 * 24);

      // Flag if no activity for > 7 days (configurable later)
      if (daysSinceLastOp > 7) {
        clusters.push({
          id: generateClusterId('stale', fileOps),
          ops: fileOps,
          firstOp: fileOps[0].hash,
          lastOp: fileOps[fileOps.length - 1].hash,
          affectedFiles: extractFiles(fileOps),
          affectedSymbols: [],
          estimatedIntent: '',
          createdAt: fileOps[0].timestamp,
          abandonedAt: fileOps[fileOps.length - 1].timestamp,
          status: 'abandoned',
          detectedBy: 'stale-branch',
        });
      }
    }

    return clusters;
  },
};

// ---------------------------------------------------------------------------
// Composite detector
// ---------------------------------------------------------------------------

/** All built-in detectors. */
export const defaultDetectors: ClusterDetector[] = [
  contextSwitchDetector,
  revertDetector,
  staleBranchDetector,
];

/**
 * Run all detectors and merge results (dedup by cluster ID).
 */
export function detectClusters(
  ops: VcsOp[],
  milestonedOpHashes: Set<string>,
  detectors: ClusterDetector[] = defaultDetectors,
): IdeaCluster[] {
  const seen = new Set<string>();
  const results: IdeaCluster[] = [];

  for (const detector of detectors) {
    const clusters = detector.detect(ops, milestonedOpHashes);
    for (const cluster of clusters) {
      if (!seen.has(cluster.id)) {
        seen.add(cluster.id);
        results.push(cluster);
      }
    }
  }

  // Sort by creation time (oldest first)
  results.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  return results;
}
