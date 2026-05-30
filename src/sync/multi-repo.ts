/**
 * Multi-Repo Linking — Cross-repo entity references.
 *
 * Enables entities in one Trellis repo to reference entities in another.
 * Linked repos are registered with a local alias and remote path/URL.
 * Cross-repo references use the format: `@alias:entityId`
 *
 * @module trellis/sync
 */

import type { TrellisKernel } from '../core/kernel/trellis-kernel.js';
import type { Fact, Link } from '../core/store/eav-store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LinkedRepo {
  /** Local alias for the remote repo (e.g. "backend", "shared-lib"). */
  alias: string;
  /** Path or URL to the remote repo. */
  location: string;
  /** Optional human-readable description. */
  description?: string;
  /** When this link was established. */
  linkedAt: string;
  /** Last sync timestamp. */
  lastSyncedAt?: string;
}

export interface CrossRepoRef {
  /** The repo alias. */
  repoAlias: string;
  /** The entity ID in the remote repo. */
  entityId: string;
}

// ---------------------------------------------------------------------------
// Multi-Repo Manager
// ---------------------------------------------------------------------------

export class MultiRepoManager {
  private kernel: TrellisKernel;

  constructor(kernel: TrellisKernel) {
    this.kernel = kernel;
  }

  /**
   * Link a remote repository.
   */
  async linkRepo(alias: string, location: string, description?: string): Promise<void> {
    const id = `repo:${alias}`;
    const existing = this.kernel.getEntity(id);
    if (existing) {
      throw new Error(`Repo alias "${alias}" is already linked to "${existing.facts.find(f => f.a === 'location')?.v}".`);
    }

    await this.kernel.createEntity(id, 'LinkedRepo', {
      alias,
      location,
      ...(description ? { description } : {}),
      linkedAt: new Date().toISOString(),
    });
  }

  /**
   * Unlink a remote repository.
   */
  async unlinkRepo(alias: string): Promise<void> {
    const id = `repo:${alias}`;
    await this.kernel.deleteEntity(id);
  }

  /**
   * List all linked repos.
   */
  listLinkedRepos(): LinkedRepo[] {
    const entities = this.kernel.listEntities('LinkedRepo');
    return entities.map((e) => {
      const get = (a: string) => e.facts.find((f) => f.a === a)?.v;
      return {
        alias: String(get('alias') ?? ''),
        location: String(get('location') ?? ''),
        description: get('description') as string | undefined,
        linkedAt: String(get('linkedAt') ?? ''),
        lastSyncedAt: get('lastSyncedAt') as string | undefined,
      };
    });
  }

  /**
   * Get a linked repo by alias.
   */
  getLinkedRepo(alias: string): LinkedRepo | null {
    const entity = this.kernel.getEntity(`repo:${alias}`);
    if (!entity) return null;
    const get = (a: string) => entity.facts.find((f) => f.a === a)?.v;
    return {
      alias: String(get('alias') ?? ''),
      location: String(get('location') ?? ''),
      description: get('description') as string | undefined,
      linkedAt: String(get('linkedAt') ?? ''),
      lastSyncedAt: get('lastSyncedAt') as string | undefined,
    };
  }

  /**
   * Create a cross-repo link: entity in this repo → entity in remote repo.
   */
  async addCrossRepoLink(
    sourceEntityId: string,
    attribute: string,
    targetRepoAlias: string,
    targetEntityId: string,
  ): Promise<void> {
    const repo = this.getLinkedRepo(targetRepoAlias);
    if (!repo) {
      throw new Error(`Repo alias "${targetRepoAlias}" is not linked. Use linkRepo() first.`);
    }

    const crossRef = `@${targetRepoAlias}:${targetEntityId}`;
    await this.kernel.addLink(sourceEntityId, attribute, crossRef);
  }

  /**
   * Remove a cross-repo link.
   */
  async removeCrossRepoLink(
    sourceEntityId: string,
    attribute: string,
    targetRepoAlias: string,
    targetEntityId: string,
  ): Promise<void> {
    const crossRef = `@${targetRepoAlias}:${targetEntityId}`;
    await this.kernel.removeLink(sourceEntityId, attribute, crossRef);
  }

  /**
   * Find all cross-repo references from a given entity.
   */
  getCrossRepoLinks(entityId: string): Array<{ attribute: string; ref: CrossRepoRef }> {
    const store = this.kernel.getStore();
    const links = store.getLinksByEntity(entityId);
    const results: Array<{ attribute: string; ref: CrossRepoRef }> = [];

    for (const link of links) {
      if (link.e1 !== entityId) continue;
      const parsed = parseCrossRepoRef(link.e2);
      if (parsed) {
        results.push({ attribute: link.a, ref: parsed });
      }
    }

    return results;
  }

  /**
   * Find all cross-repo references pointing to a specific remote entity.
   */
  findReferencesTo(repoAlias: string, entityId: string): Link[] {
    const crossRef = `@${repoAlias}:${entityId}`;
    const store = this.kernel.getStore();
    return store.getAllLinks().filter((l) => l.e2 === crossRef);
  }

  /**
   * Update the lastSyncedAt timestamp for a linked repo.
   */
  async markSynced(alias: string): Promise<void> {
    await this.kernel.updateEntity(`repo:${alias}`, {
      lastSyncedAt: new Date().toISOString(),
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a cross-repo reference string.
 * Format: `@alias:entityId`
 */
export function parseCrossRepoRef(ref: string): CrossRepoRef | null {
  if (!ref.startsWith('@')) return null;
  const colonIdx = ref.indexOf(':', 1);
  if (colonIdx === -1) return null;
  return {
    repoAlias: ref.slice(1, colonIdx),
    entityId: ref.slice(colonIdx + 1),
  };
}

/**
 * Format a cross-repo reference string.
 */
export function formatCrossRepoRef(repoAlias: string, entityId: string): string {
  return `@${repoAlias}:${entityId}`;
}
