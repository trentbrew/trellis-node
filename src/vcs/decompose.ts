/**
 * VCS Op Decomposition
 *
 * Converts high-level VcsOps into primitive EAV store operations
 * (addFacts, addLinks, deleteFacts, deleteLinks).
 */

import type { Fact, Link } from '../core/store/eav-store.js';
import type { VcsOp } from './types.js';
import {
  fileEntityId,
  dirEntityId,
  issueEntityId,
  criterionEntityId,
  decisionEntityId,
  laneEntityId,
} from './types.js';
import { dirname } from 'path';

export interface DecomposedOp {
  addFacts: Fact[];
  addLinks: Link[];
  deleteFacts: Fact[];
  deleteLinks: Link[];
}

function pickFacts(input: unknown): Fact[] {
  if (!Array.isArray(input)) return [];
  return input.filter((item): item is Fact => {
    const fact = item as Partial<Fact>;
    return (
      typeof fact.e === 'string' &&
      typeof fact.a === 'string' &&
      (typeof fact.v === 'string' ||
        typeof fact.v === 'number' ||
        typeof fact.v === 'boolean')
    );
  });
}

function pickLinks(input: unknown): Link[] {
  if (!Array.isArray(input)) return [];
  return input.filter((item): item is Link => {
    const link = item as Partial<Link>;
    return (
      typeof link.e1 === 'string' &&
      typeof link.a === 'string' &&
      typeof link.e2 === 'string'
    );
  });
}

/**
 * Decomposes a VcsOp into primitive store operations.
 */
export function decompose(op: VcsOp): DecomposedOp {
  const result: DecomposedOp = {
    addFacts: [],
    addLinks: [],
    deleteFacts: [],
    deleteLinks: [],
  };

  const vcs = op.vcs;
  if (!vcs) return result;

  if (vcs.issueId && vcs.oldIssueStatus) {
    result.deleteFacts.push({
      e: issueEntityId(vcs.issueId),
      a: 'status',
      v: vcs.oldIssueStatus,
    });
  }

  switch (op.kind) {
    case 'vcs:fileAdd': {
      if (!vcs.filePath) break;
      const eid = fileEntityId(vcs.filePath);
      const dir = dirname(vcs.filePath);
      const did = dirEntityId(dir === '.' ? '' : dir);

      result.addFacts.push(
        { e: eid, a: 'type', v: 'FileNode' },
        { e: eid, a: 'path', v: vcs.filePath },
      );
      if (vcs.contentHash) {
        result.addFacts.push({ e: eid, a: 'contentHash', v: vcs.contentHash });
      }
      if (vcs.size !== undefined) {
        result.addFacts.push({ e: eid, a: 'size', v: vcs.size });
      }
      if (vcs.language) {
        result.addFacts.push({ e: eid, a: 'language', v: vcs.language });
      }
      result.addFacts.push({ e: eid, a: 'lastModified', v: op.timestamp });

      // Ensure directory entity exists
      result.addFacts.push(
        { e: did, a: 'type', v: 'DirectoryNode' },
        { e: did, a: 'path', v: dir === '.' ? '' : dir },
      );
      result.addLinks.push({ e1: did, a: 'contains', e2: eid });
      break;
    }

    case 'vcs:fileModify': {
      if (!vcs.filePath) break;
      const eid = fileEntityId(vcs.filePath);

      // Delete old contentHash/size facts, add new ones
      if (vcs.oldContentHash) {
        result.deleteFacts.push({
          e: eid,
          a: 'contentHash',
          v: vcs.oldContentHash,
        });
      }
      if (vcs.contentHash) {
        result.addFacts.push({ e: eid, a: 'contentHash', v: vcs.contentHash });
      }
      if (vcs.size !== undefined) {
        // We approximate: delete old size by marking for update
        result.addFacts.push({ e: eid, a: 'size', v: vcs.size });
      }
      result.addFacts.push({ e: eid, a: 'lastModified', v: op.timestamp });
      break;
    }

    case 'vcs:fileDelete': {
      if (!vcs.filePath) break;
      const eid = fileEntityId(vcs.filePath);
      const dir = dirname(vcs.filePath);
      const did = dirEntityId(dir === '.' ? '' : dir);

      // Remove file entity facts
      result.deleteFacts.push(
        { e: eid, a: 'type', v: 'FileNode' },
        { e: eid, a: 'path', v: vcs.filePath },
      );
      if (vcs.contentHash) {
        result.deleteFacts.push({
          e: eid,
          a: 'contentHash',
          v: vcs.contentHash,
        });
      }
      result.deleteLinks.push({ e1: did, a: 'contains', e2: eid });
      break;
    }

    case 'vcs:fileRename': {
      if (!vcs.filePath || !vcs.oldFilePath) break;
      const eid = fileEntityId(vcs.oldFilePath); // identity preserved
      const oldDir = dirname(vcs.oldFilePath);
      const newDir = dirname(vcs.filePath);
      const oldDid = dirEntityId(oldDir === '.' ? '' : oldDir);
      const newDid = dirEntityId(newDir === '.' ? '' : newDir);

      // Update path fact
      result.deleteFacts.push({ e: eid, a: 'path', v: vcs.oldFilePath });
      result.addFacts.push({ e: eid, a: 'path', v: vcs.filePath });
      result.addFacts.push({ e: eid, a: 'lastModified', v: op.timestamp });

      // Update directory links
      result.deleteLinks.push({ e1: oldDid, a: 'contains', e2: eid });

      // Ensure new directory exists
      result.addFacts.push(
        { e: newDid, a: 'type', v: 'DirectoryNode' },
        { e: newDid, a: 'path', v: newDir === '.' ? '' : newDir },
      );
      result.addLinks.push({ e1: newDid, a: 'contains', e2: eid });
      break;
    }

    case 'vcs:branchCreate': {
      if (!vcs.branchName) break;
      const bid = `branch:${vcs.branchName}`;
      result.addFacts.push(
        { e: bid, a: 'type', v: 'Branch' },
        { e: bid, a: 'name', v: vcs.branchName },
        { e: bid, a: 'createdAt', v: op.timestamp },
        { e: bid, a: 'createdBy', v: op.agentId },
      );
      if (vcs.targetOpHash) {
        result.addFacts.push({ e: bid, a: 'headOpHash', v: vcs.targetOpHash });
      }
      if (vcs.baseBranch) {
        result.addLinks.push({
          e1: bid,
          a: 'forkedFrom',
          e2: `branch:${vcs.baseBranch}`,
        });
      }
      break;
    }

    case 'vcs:branchDelete': {
      if (!vcs.branchName) break;
      const bid = `branch:${vcs.branchName}`;
      result.deleteFacts.push(
        { e: bid, a: 'type', v: 'Branch' },
        { e: bid, a: 'name', v: vcs.branchName },
      );
      break;
    }

    case 'vcs:branchAdvance': {
      if (!vcs.branchName || !vcs.targetOpHash) break;
      const bid = `branch:${vcs.branchName}`;
      // Update head pointer
      result.addFacts.push({ e: bid, a: 'headOpHash', v: vcs.targetOpHash });
      break;
    }

    case 'vcs:milestoneCreate': {
      if (!vcs.milestoneId) break;
      const mid = vcs.milestoneId;
      result.addFacts.push(
        { e: mid, a: 'type', v: 'Milestone' },
        { e: mid, a: 'createdAt', v: op.timestamp },
        { e: mid, a: 'createdBy', v: op.agentId },
      );
      if (vcs.message) {
        result.addFacts.push({ e: mid, a: 'message', v: vcs.message });
      }
      if (vcs.fromOpHash) {
        result.addFacts.push({ e: mid, a: 'fromOpHash', v: vcs.fromOpHash });
      }
      if (vcs.toOpHash) {
        result.addFacts.push({ e: mid, a: 'toOpHash', v: vcs.toOpHash });
      }
      break;
    }

    case 'vcs:checkpointCreate': {
      const cid = `checkpoint:${op.hash}`;
      result.addFacts.push(
        { e: cid, a: 'type', v: 'Checkpoint' },
        { e: cid, a: 'createdAt', v: op.timestamp },
        { e: cid, a: 'atOpHash', v: op.hash },
      );
      if (vcs.trigger) {
        result.addFacts.push({ e: cid, a: 'trigger', v: vcs.trigger });
      }
      break;
    }

    // ----- Issue tracking -----

    case 'vcs:issueCreate': {
      if (!vcs.issueId) break;
      const eid = issueEntityId(vcs.issueId);
      result.addFacts.push(
        { e: eid, a: 'type', v: 'Issue' },
        { e: eid, a: 'status', v: vcs.issueStatus ?? 'backlog' },
        { e: eid, a: 'createdAt', v: op.timestamp },
        { e: eid, a: 'createdBy', v: op.agentId },
      );
      if (vcs.issueTitle) {
        result.addFacts.push({ e: eid, a: 'title', v: vcs.issueTitle });
      }
      if (vcs.issueDescription) {
        result.addFacts.push({
          e: eid,
          a: 'description',
          v: vcs.issueDescription,
        });
      }
      if (vcs.issuePriority) {
        result.addFacts.push({ e: eid, a: 'priority', v: vcs.issuePriority });
      }
      if (vcs.issueLabels && vcs.issueLabels.length > 0) {
        result.addFacts.push({
          e: eid,
          a: 'labels',
          v: vcs.issueLabels.join(','),
        });
      }
      if (vcs.issueAssignee) {
        result.addFacts.push({ e: eid, a: 'assignee', v: vcs.issueAssignee });
      }
      if (vcs.parentIssueId) {
        result.addLinks.push({
          e1: eid,
          a: 'childOf',
          e2: issueEntityId(vcs.parentIssueId),
        });
      }
      break;
    }

    case 'vcs:issueUpdate': {
      if (!vcs.issueId) break;
      const eid = issueEntityId(vcs.issueId);
      if (vcs.issueStatus) {
        result.addFacts.push({ e: eid, a: 'status', v: vcs.issueStatus });
      }
      if (vcs.issuePriority) {
        result.addFacts.push({ e: eid, a: 'priority', v: vcs.issuePriority });
      }
      if (vcs.issueLabels) {
        result.addFacts.push({
          e: eid,
          a: 'labels',
          v: vcs.issueLabels.join(','),
        });
      }
      if (vcs.issueTitle) {
        result.addFacts.push({ e: eid, a: 'title', v: vcs.issueTitle });
      }
      if (vcs.issueAssignee) {
        result.addFacts.push({ e: eid, a: 'assignee', v: vcs.issueAssignee });
      }
      if (vcs.issueDescription !== undefined) {
        result.addFacts.push({
          e: eid,
          a: 'description',
          v: vcs.issueDescription,
        });
      }
      if (vcs.oldParentIssueId) {
        result.deleteLinks.push({
          e1: eid,
          a: 'childOf',
          e2: issueEntityId(vcs.oldParentIssueId),
        });
      }
      if (vcs.parentIssueId) {
        result.addLinks.push({
          e1: eid,
          a: 'childOf',
          e2: issueEntityId(vcs.parentIssueId),
        });
      }
      break;
    }

    case 'vcs:issueStart': {
      if (!vcs.issueId) break;
      const eid = issueEntityId(vcs.issueId);
      result.addFacts.push(
        { e: eid, a: 'status', v: 'in_progress' },
        { e: eid, a: 'startedAt', v: op.timestamp },
      );
      if (vcs.issueAssignee) {
        result.addFacts.push({ e: eid, a: 'assignee', v: vcs.issueAssignee });
      }
      if (vcs.branchName) {
        result.addLinks.push({
          e1: eid,
          a: 'trackedOn',
          e2: `branch:${vcs.branchName}`,
        });
      }
      break;
    }

    case 'vcs:issuePause': {
      if (!vcs.issueId) break;
      const eid = issueEntityId(vcs.issueId);
      result.addFacts.push(
        { e: eid, a: 'status', v: 'paused' },
        { e: eid, a: 'pausedAt', v: op.timestamp },
      );
      if (vcs.pauseNote) {
        result.addFacts.push({ e: eid, a: 'pauseNote', v: vcs.pauseNote });
      }
      break;
    }

    case 'vcs:issueResume': {
      if (!vcs.issueId) break;
      const eid = issueEntityId(vcs.issueId);
      result.addFacts.push(
        { e: eid, a: 'status', v: 'in_progress' },
        { e: eid, a: 'resumedAt', v: op.timestamp },
        { e: eid, a: 'pauseNote', v: '' },
      );
      break;
    }

    case 'vcs:issueClose': {
      if (!vcs.issueId) break;
      const eid = issueEntityId(vcs.issueId);
      result.addFacts.push(
        { e: eid, a: 'status', v: 'closed' },
        { e: eid, a: 'closedAt', v: op.timestamp },
      );
      break;
    }

    case 'vcs:issueReopen': {
      if (!vcs.issueId) break;
      const eid = issueEntityId(vcs.issueId);
      result.addFacts.push({ e: eid, a: 'status', v: 'queue' });
      break;
    }

    case 'vcs:criterionAdd': {
      if (!vcs.criterionId || !vcs.issueId) break;
      const ceid = vcs.criterionId;
      result.addFacts.push(
        { e: ceid, a: 'type', v: 'Criterion' },
        { e: ceid, a: 'status', v: 'pending' },
        { e: ceid, a: 'createdAt', v: op.timestamp },
      );
      if (vcs.criterionDescription) {
        result.addFacts.push({
          e: ceid,
          a: 'description',
          v: vcs.criterionDescription,
        });
      }
      if (vcs.criterionCommand) {
        result.addFacts.push({
          e: ceid,
          a: 'command',
          v: vcs.criterionCommand,
        });
      }
      result.addLinks.push({
        e1: ceid,
        a: 'criterionOf',
        e2: issueEntityId(vcs.issueId),
      });
      break;
    }

    case 'vcs:criterionUpdate': {
      if (!vcs.criterionId) break;
      const ceid = vcs.criterionId;
      if (vcs.criterionStatus) {
        result.addFacts.push({ e: ceid, a: 'status', v: vcs.criterionStatus });
      }
      if (vcs.criterionOutput) {
        result.addFacts.push({
          e: ceid,
          a: 'lastOutput',
          v: vcs.criterionOutput,
        });
      }
      result.addFacts.push({ e: ceid, a: 'lastRunAt', v: op.timestamp });
      break;
    }

    // ----- Issue blocking -----

    case 'vcs:issueBlock': {
      if (!vcs.issueId || !vcs.blockedByIssueId) break;
      const eid = issueEntityId(vcs.issueId);
      const blockerEid = issueEntityId(vcs.blockedByIssueId);
      result.addLinks.push({ e1: eid, a: 'blockedBy', e2: blockerEid });
      break;
    }

    case 'vcs:issueUnblock': {
      if (!vcs.issueId || !vcs.blockedByIssueId) break;
      const eid = issueEntityId(vcs.issueId);
      const blockerEid = issueEntityId(vcs.blockedByIssueId);
      result.deleteLinks.push({ e1: eid, a: 'blockedBy', e2: blockerEid });
      break;
    }

    // ----- Decision traces -----

    case 'vcs:decisionRecord': {
      if (!vcs.decisionId) break;
      const did = decisionEntityId(vcs.decisionId);
      result.addFacts.push(
        { e: did, a: 'type', v: 'Decision' },
        { e: did, a: 'createdAt', v: op.timestamp },
        { e: did, a: 'createdBy', v: op.agentId },
      );
      if (vcs.decisionToolName) {
        result.addFacts.push({
          e: did,
          a: 'toolName',
          v: vcs.decisionToolName,
        });
      }
      if (vcs.decisionToolInput) {
        result.addFacts.push({
          e: did,
          a: 'toolInput',
          v: vcs.decisionToolInput,
        });
      }
      if (vcs.decisionToolOutput) {
        result.addFacts.push({
          e: did,
          a: 'outputSummary',
          v: vcs.decisionToolOutput,
        });
      }
      if (vcs.decisionContext) {
        result.addFacts.push({ e: did, a: 'context', v: vcs.decisionContext });
      }
      if (vcs.decisionRationale) {
        result.addFacts.push({
          e: did,
          a: 'rationale',
          v: vcs.decisionRationale,
        });
      }
      if (vcs.decisionAlternatives) {
        result.addFacts.push({
          e: did,
          a: 'alternatives',
          v: vcs.decisionAlternatives,
        });
      }
      break;
    }

    case 'vcs:laneCreate': {
      if (!vcs.laneId) break;
      const lid = laneEntityId(vcs.laneId);
      result.addFacts.push(
        { e: lid, a: 'type', v: 'AgentLane' },
        { e: lid, a: 'status', v: 'active' },
        { e: lid, a: 'createdAt', v: op.timestamp },
        { e: lid, a: 'createdBy', v: op.agentId },
      );
      if (vcs.baseBranch) {
        result.addFacts.push({ e: lid, a: 'baseBranch', v: vcs.baseBranch });
      }
      if (vcs.baseOpHash) {
        result.addFacts.push({ e: lid, a: 'baseOpHash', v: vcs.baseOpHash });
      }
      if (vcs.targetBranch) {
        result.addFacts.push({ e: lid, a: 'targetBranch', v: vcs.targetBranch });
      }
      if (vcs.baseOpHash) {
        result.addFacts.push({ e: lid, a: 'headOpHash', v: vcs.baseOpHash });
      }
      if (vcs.issueId) {
        result.addFacts.push({ e: lid, a: 'issueId', v: vcs.issueId });
      }
      if (vcs.sessionId) {
        result.addFacts.push({ e: lid, a: 'sessionId', v: vcs.sessionId });
      }
      if (vcs.parentLaneId) {
        result.addFacts.push({ e: lid, a: 'parentLaneId', v: vcs.parentLaneId });
        result.addLinks.push({
          e1: lid,
          a: 'forkedFrom',
          e2: laneEntityId(vcs.parentLaneId),
        });
      }
      if (vcs.forkKind) {
        result.addFacts.push({ e: lid, a: 'forkKind', v: vcs.forkKind });
      }
      if (vcs.virtualBaseOpHash) {
        result.addFacts.push({
          e: lid,
          a: 'virtualBaseOpHash',
          v: vcs.virtualBaseOpHash,
        });
      }
      break;
    }

    case 'vcs:laneDrop': {
      if (!vcs.laneId) break;
      const lid = laneEntityId(vcs.laneId);
      if (vcs.laneStatus) {
        result.deleteFacts.push({ e: lid, a: 'status', v: 'active' });
        result.addFacts.push({ e: lid, a: 'status', v: vcs.laneStatus });
      }
      break;
    }

    case 'vcs:lanePromoteStart': {
      if (!vcs.laneId) break;
      const lid = laneEntityId(vcs.laneId);
      result.deleteFacts.push({ e: lid, a: 'status', v: 'active' });
      result.addFacts.push({ e: lid, a: 'status', v: 'promoting' });
      break;
    }

    case 'vcs:lanePromoteComplete': {
      if (!vcs.laneId) break;
      const lid = laneEntityId(vcs.laneId);
      result.deleteFacts.push({ e: lid, a: 'status', v: 'promoting' });
      result.addFacts.push({ e: lid, a: 'status', v: 'promoted' });
      if (vcs.targetBranch) {
        result.addFacts.push({ e: lid, a: 'promotedToBranch', v: vcs.targetBranch });
      }
      break;
    }

    case 'vcs:lanePromoteAbort': {
      if (!vcs.laneId) break;
      const lid = laneEntityId(vcs.laneId);
      result.deleteFacts.push({ e: lid, a: 'status', v: 'promoting' });
      result.addFacts.push({ e: lid, a: 'status', v: 'active' });
      break;
    }

    // ----- EAV store (CMS / knowledge graph) -----

    case 'vcs:storeAssert': {
      result.addFacts.push(...pickFacts(vcs.facts));
      break;
    }

    case 'vcs:storeRetract': {
      result.deleteFacts.push(...pickFacts(vcs.facts));
      break;
    }

    case 'vcs:storeLink': {
      result.addLinks.push(...pickLinks(vcs.links));
      break;
    }

    case 'vcs:storeUnlink': {
      result.deleteLinks.push(...pickLinks(vcs.links));
      break;
    }
  }

  return result;
}
