/**
 * Trellis Federation — Remote Manager
 *
 * Handles remote workspace configuration and pull operations.
 * Implements read-only mirroring with watermark-based incremental sync.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import type { VcsOp } from '../vcs/types.js';
import { TrellisVcsEngine } from '../engine.js';
import type {
  RemoteConfig,
  RemotesConfig,
  PullResult,
  PullAllResult,
} from './types.js';

export class RemoteManager {
  private trellisPath: string;
  private remotesPath: string;

  constructor(trellisPath: string) {
    this.trellisPath = trellisPath;
    this.remotesPath = join(trellisPath, 'remotes.json');
  }

  /** Load remotes configuration */
  loadRemotes(): RemotesConfig {
    if (!existsSync(this.remotesPath)) {
      return { remotes: {} };
    }
    try {
      const content = readFileSync(this.remotesPath, 'utf8');
      return JSON.parse(content) as RemotesConfig;
    } catch (error) {
      throw new Error(`Failed to load remotes config: ${error}`);
    }
  }

  /** Save remotes configuration */
  saveRemotes(config: RemotesConfig): void {
    try {
      // Ensure .trellis directory exists
      if (!existsSync(this.trellisPath)) {
        mkdirSync(this.trellisPath, { recursive: true });
      }
      writeFileSync(this.remotesPath, JSON.stringify(config, null, 2), 'utf8');
    } catch (error) {
      throw new Error(`Failed to save remotes config: ${error}`);
    }
  }

  /** Add a new remote */
  addRemote(name: string, path: string): void {
    const config = this.loadRemotes();

    if (config.remotes[name]) {
      throw new Error(`Remote '${name}' already exists`);
    }

    const resolvedPath = resolve(path);

    // Validate remote is a Trellis repository
    if (!TrellisVcsEngine.isRepo(resolvedPath)) {
      throw new Error(`Not a TrellisVCS repository: ${resolvedPath}`);
    }

    config.remotes[name] = {
      name,
      path: resolvedPath,
    };

    this.saveRemotes(config);
  }

  /** Remove a remote */
  removeRemote(name: string): void {
    const config = this.loadRemotes();

    if (!config.remotes[name]) {
      throw new Error(`Remote '${name}' not found`);
    }

    delete config.remotes[name];
    this.saveRemotes(config);
  }

  /** List all remotes */
  listRemotes(): RemoteConfig[] {
    const config = this.loadRemotes();
    return Object.values(config.remotes);
  }

  /** Pull new ops from a specific remote */
  async pullRemote(
    remoteName: string,
    localEngine: TrellisVcsEngine,
  ): Promise<PullResult> {
    const startTime = Date.now();
    const config = this.loadRemotes();
    const remote = config.remotes[remoteName];

    if (!remote) {
      throw new Error(`Remote '${remoteName}' not found`);
    }

    const errors: string[] = [];
    let newOps = 0;
    let latestOpId = remote.lastOpId || '';

    try {
      // Open remote engine
      const remoteEngine = new TrellisVcsEngine({ rootPath: remote.path });
      remoteEngine.open();
      const remoteOps = remoteEngine.getOps();

      if (remoteOps.length === 0) {
        return {
          remote: remoteName,
          newOps: 0,
          latestOpId: '',
          durationMs: Date.now() - startTime,
          errors: [],
        };
      }

      // Find ops to pull (those after last watermark)
      const lastOpHash = remote.lastOpId;
      let startIndex = 0;

      if (lastOpHash) {
        startIndex = remoteOps.findIndex((op) => op.hash === lastOpHash);
        if (startIndex === -1) {
          // Last op not found, pull all (might be corrupted state)
          startIndex = 0;
          errors.push(
            `Last op hash ${lastOpHash} not found in remote, pulling all ops`,
          );
        } else {
          startIndex++; // Start after the last pulled op
        }
      }

      const opsToPull = remoteOps.slice(startIndex);

      if (opsToPull.length > 0) {
        // Prefix entity IDs with remote name
        const prefixedOps = opsToPull.map((op) =>
          this.prefixOpEntities(op, remoteName),
        );

        // Import ops into local engine
        for (const op of prefixedOps) {
          (localEngine as any).opLog.append(op);
          newOps++;
        }

        latestOpId = remoteOps[remoteOps.length - 1].hash;
      }

      // Update watermark
      remote.lastOpId = latestOpId;
      remote.pulledAt = new Date().toISOString();
      this.saveRemotes(config);
    } catch (error) {
      errors.push(`Failed to pull from remote: ${error}`);
    }

    return {
      remote: remoteName,
      newOps,
      latestOpId,
      durationMs: Date.now() - startTime,
      errors,
    };
  }

  /** Pull from all configured remotes */
  async pullAll(localEngine: TrellisVcsEngine): Promise<PullAllResult> {
    const config = this.loadRemotes();
    const remoteNames = Object.keys(config.remotes);

    if (remoteNames.length === 0) {
      return {
        results: [],
        totalNewOps: 0,
        totalDurationMs: 0,
      };
    }

    const startTime = Date.now();
    const results: PullResult[] = [];
    let totalNewOps = 0;

    for (const remoteName of remoteNames) {
      try {
        const result = await this.pullRemote(remoteName, localEngine);
        results.push(result);
        totalNewOps += result.newOps;
      } catch (error) {
        results.push({
          remote: remoteName,
          newOps: 0,
          latestOpId: '',
          durationMs: 0,
          errors: [`Failed to pull: ${error}`],
        });
      }
    }

    return {
      results,
      totalNewOps,
      totalDurationMs: Date.now() - startTime,
    };
  }

  /** Prefix entity IDs in operations with remote name */
  private prefixOpEntities(op: VcsOp, remoteName: string): VcsOp {
    const prefixed = { ...op };

    // Prefix entity IDs in VCS payload for issue operations
    if (op.vcs) {
      const vcs = { ...op.vcs };

      // Prefix issue IDs
      if (vcs.issueId && !vcs.issueId.includes(':')) {
        vcs.issueId = `${remoteName}:${vcs.issueId}`;
      }

      // Prefix parent issue ID
      if (vcs.parentIssueId && !vcs.parentIssueId.includes(':')) {
        vcs.parentIssueId = `${remoteName}:${vcs.parentIssueId}`;
      }

      // Prefix blocked by issue ID
      if (vcs.blockedByIssueId && !vcs.blockedByIssueId.includes(':')) {
        vcs.blockedByIssueId = `${remoteName}:${vcs.blockedByIssueId}`;
      }

      // Prefix decision ID
      if (vcs.decisionId && !vcs.decisionId.includes(':')) {
        vcs.decisionId = `${remoteName}:${vcs.decisionId}`;
      }

      prefixed.vcs = vcs;
    }

    // Prefix entity IDs in facts
    if (op.facts) {
      prefixed.facts = op.facts.map((fact) => {
        if (
          fact.e === 'entity' &&
          fact.a === 'id' &&
          typeof fact.v === 'string' &&
          !fact.v.includes(':')
        ) {
          return { ...fact, v: `${remoteName}:${fact.v}` };
        }
        if (
          fact.e === 'entity' &&
          fact.a === 'from' &&
          typeof fact.v === 'string' &&
          !fact.v.includes(':')
        ) {
          return { ...fact, v: `${remoteName}:${fact.v}` };
        }
        if (
          fact.e === 'entity' &&
          fact.a === 'to' &&
          typeof fact.v === 'string' &&
          !fact.v.includes(':')
        ) {
          return { ...fact, v: `${remoteName}:${fact.v}` };
        }
        return fact;
      });
    }

    // Prefix entity IDs in links
    if (op.links) {
      prefixed.links = op.links.map((link) => ({
        ...link,
        e1: link.e1.includes(':') ? link.e1 : `${remoteName}:${link.e1}`,
        e2: link.e2.includes(':') ? link.e2 : `${remoteName}:${link.e2}`,
      }));
    }

    // Mark operation as from remote by adding a fact
    if (!prefixed.facts) prefixed.facts = [];
    prefixed.facts.push({
      e: 'op',
      a: 'remote',
      v: remoteName,
    });

    return prefixed;
  }
}
