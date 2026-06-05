/**
 * Contextual example commands and EQL-S queries for the current repo.
 */

import type { BranchInfo } from '../vcs/branch.js';
import type { IssueInfo } from '../vcs/issue.js';
import type { MilestoneInfo } from '../vcs/milestone.js';

export interface ExampleSection {
  title: string;
  commands: string[];
}

export interface RepoExamples {
  sections: ExampleSection[];
  eql: string[];
}

function eqlLiteral(value: string): string {
  return JSON.stringify(value);
}

function formatEqlQuery(query: string): string {
  const escaped = query.replace(/'/g, "'\\''");
  return `trellis query '${escaped}'`;
}

export function buildRepoExamples(input: {
  issues: IssueInfo[];
  milestones: MilestoneInfo[];
  branches: BranchInfo[];
  files: Array<{ path: string }>;
}): RepoExamples {
  const { issues, milestones, branches, files } = input;
  const sections: ExampleSection[] = [];

  sections.push({
    title: 'Status & history',
    commands: ['trellis -h', 'trellis status', 'trellis log'],
  });

  const issueCommands = ['trellis issue list', 'trellis issue create -t "New task"'];
  for (const issue of issues.slice(0, 5)) {
    issueCommands.push(`trellis issue show ${issue.id}`);
    if (issue.status === 'backlog' || issue.status === 'queue') {
      issueCommands.push(`trellis issue start ${issue.id}`);
    }
  }
  sections.push({
    title: issues.length ? `Issues (${issues.length})` : 'Issues',
    commands: issueCommands,
  });

  const milestoneCommands = [
    'trellis milestone list',
    'trellis milestone create -m "Ship milestone"',
  ];
  for (const m of milestones.slice(0, 3)) {
    milestoneCommands.push(`trellis log -n 5  # milestone: ${m.message ?? m.id}`);
  }
  sections.push({
    title: milestones.length ? `Milestones (${milestones.length})` : 'Milestones',
    commands: milestoneCommands,
  });

  if (branches.length) {
    sections.push({
      title: `Branches (${branches.length})`,
      commands: ['trellis branch -l', ...branches.slice(0, 3).map((b) => `trellis branch ${b.name}`)],
    });
  }

  if (files.length) {
    const fileCommands = files.slice(0, 4).map((f) => `trellis log -f ${f.path}`);
    sections.push({
      title: `Files (${files.length})`,
      commands: fileCommands,
    });
  }

  const eql: string[] = [
    formatEqlQuery('find ?e where type = "Issue"'),
    formatEqlQuery('find ?e where type = "FileNode"'),
  ];

  if (issues.length) {
    eql.push(formatEqlQuery('find ?e where type = "Issue" and status = "backlog"'));
    const sample = issues[0];
    if (sample.title) {
      eql.push(formatEqlQuery(`find ?e where title = ${eqlLiteral(sample.title)}`));
    }
    if (sample.priority) {
      eql.push(formatEqlQuery(`find ?e where priority = ${eqlLiteral(sample.priority)}`));
    }
    eql.push(`trellis fact query -e issue:${sample.id.replace(/^issue:/, '')}`);
    eql.push(`trellis link query -e issue:${sample.id.replace(/^issue:/, '')}`);
  }

  if (files.length) {
    const fp = files[0].path;
    eql.push(formatEqlQuery(`find ?e where path = ${eqlLiteral(fp)}`));
  }

  if (milestones.length && milestones[0].message) {
    eql.push(formatEqlQuery(`find ?e where type = "Milestone"`));
  }

  return { sections, eql };
}
