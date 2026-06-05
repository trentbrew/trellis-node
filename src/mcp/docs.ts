/**
 * Trellis Docs MCP Server
 *
 * Exposes TrellisVCS and TrellisDB documentation to any MCP-compatible
 * AI agent, enabling context-aware assistance for developers using Trellis.
 *
 * Modeled after the SvelteMCP pattern:
 *   - list-sections   → discover all doc sections
 *   - get-documentation → fetch full content for specific sections
 *   - trellis-check   → lint/validate trellis code patterns
 *
 * Usage (local):
 *   bun run src/mcp/docs.ts
 *
 * @module mcp/docs
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Documentation sections
// ---------------------------------------------------------------------------

interface DocSection {
  path: string;
  title: string;
  use_cases: string[];
  content: string;
}

const SECTIONS: DocSection[] = [
  // ── Overview ──────────────────────────────────────────────────────────────
  {
    path: 'overview',
    title: 'Trellis Overview',
    use_cases: [
      'Understanding what Trellis is',
      'Deciding whether to use TrellisVCS or TrellisDB',
      'Getting started with Trellis for the first time',
    ],
    content: `# Trellis Overview

Trellis is a graph-native, code-first platform with two distinct products:

## TrellisVCS — Graph-native Version Control
A version control system where every file save is an immutable op (operation).
Unlike Git, there is no staging area — changes are recorded automatically.

Key concepts:
- **Ops** — immutable, content-addressed change records with causal chaining
- **Milestones** — narrative checkpoints spanning a range of ops (≠ Git commits)
- **Branches** — same concept as Git, with CRDT merge support
- **Idea Garden** — detects and revives abandoned work clusters
- **Issues** — first-class task tracking with acceptance criteria

Three-tier ops:
- Tier 0: file-level changes
- Tier 1: structural changes (imports, exports)
- Tier 2: semantic/AST-level changes (symbolAdd, symbolRename)

## TrellisDB — Graph-native Database
A multi-tenant database exposing entities via REST + WebSocket APIs.
Uses an EAV (Entity-Attribute-Value) store internally with EQL-S query language.

Key concepts:
- **Entities** — typed records with arbitrary attributes
- **EQL-S** — structured query language: \`find <Type> where <attr> = <val>\`
- **Multi-tenancy** — separate SQLite databases per tenant
- **Real-time** — WebSocket subscriptions for live updates
- **Blob storage** — content-addressed file uploads

## When to use which
- Building an app with structured data storage → **TrellisDB**
- Version-controlling a codebase or document set → **TrellisVCS**
- AI agent needs to track decisions and work → **TrellisVCS** (issues + decisions)
`,
  },

  // ── VCS: Mental Model ─────────────────────────────────────────────────────
  {
    path: 'vcs/mental-model',
    title: 'TrellisVCS Mental Model',
    use_cases: [
      'Translating Git knowledge to TrellisVCS',
      'Understanding how ops differ from commits',
      'Learning what makes TrellisVCS unique vs Git',
    ],
    content: `# TrellisVCS Mental Model

## TrellisVCS is NOT Git

| Git Concept        | TrellisVCS Equivalent                                    |
|--------------------|----------------------------------------------------------|
| \`git add + commit\` | Automatic — every file change creates ops in real time   |
| \`git log\`          | \`trellis log\` — causal op stream                        |
| Tag / release      | \`trellis milestone create -m "…"\`                       |
| Branch             | \`trellis branch <name>\` — with CRDT support             |
| \`git diff\`         | \`trellis diff\` (file-level) or \`trellis sdiff\` (AST)   |
| \`git merge\`        | \`trellis merge <branch>\`                                |
| Stash / abandoned  | \`trellis garden\` — detects and revives abandoned work   |
| Issue / ticket     | \`trellis issue\` — first-class with acceptance criteria  |

## Key Differences

1. **No staging area.** Ops are created automatically when files change under \`trellis watch\`.
2. **Ops are immutable.** Never rewritten, rebased, or deleted. Run \`trellis repair\` if corrupted.
3. **Milestones ≠ commits.** A milestone spans a *range* of ops and carries a narrative message.
4. **Idea Garden.** Abandoned branches/work are automatically detected and can be revived.
5. **NEVER edit .trellis/ directly.** The op log is managed exclusively by the engine.

## Op anatomy
Each op has:
- \`hash\` — content-addressed SHA256 identifier
- \`kind\` — e.g. \`fileWrite\`, \`fileCopy\`, \`symbolAdd\`
- \`causal\` — hash of the previous op (causal chain)
- \`ts\` — timestamp
- \`payload\` — kind-specific data
`,
  },

  // ── VCS: Workflows ────────────────────────────────────────────────────────
  {
    path: 'vcs/workflows',
    title: 'TrellisVCS Workflows',
    use_cases: [
      'Learning common TrellisVCS workflows',
      'How to create milestones and branches',
      'How to explore and revive abandoned work',
      'How to run semantic diffs',
    ],
    content: `# TrellisVCS Workflows

## Starting Work
\`\`\`bash
trellis status          # current branch, op count, recent ops
trellis log --limit 20  # op history
trellis garden list     # check for abandoned work FIRST
\`\`\`

## Creating a Milestone
When you complete a meaningful unit of work:
\`\`\`bash
trellis milestone create -m "Implement user authentication"
trellis milestone list   # show all milestones
\`\`\`

## Branching
\`\`\`bash
trellis branch feature/new-parser  # create + switch
trellis branch                     # list branches
trellis branch -d old-experiment   # delete
trellis merge main                 # three-way merge
\`\`\`

## Idea Garden (abandoned work)
\`\`\`bash
trellis garden list              # all detected clusters
trellis garden search -k "auth"  # search by keyword
trellis garden stats             # cluster statistics
trellis garden revive <id>       # revive into a new branch
\`\`\`

## Semantic Analysis
\`\`\`bash
trellis parse src/engine.ts          # parse into AST entities
trellis sdiff src/old.ts src/new.ts  # semantic diff
\`\`\`

## Checking state before context-switching
Always run these before switching tasks:
\`\`\`bash
trellis status
trellis issue pause TRL-N  # if working on an issue
trellis milestone create -m "WIP: description"
\`\`\`
`,
  },

  // ── VCS: Issues ───────────────────────────────────────────────────────────
  {
    path: 'vcs/issues',
    title: 'TrellisVCS Issue Tracking',
    use_cases: [
      'Creating and managing issues',
      'Understanding issue statuses and lifecycle',
      'Adding acceptance criteria to issues',
      'Starting, pausing, and closing issues',
      'Blocking/unblocking issues',
    ],
    content: `# TrellisVCS Issue Tracking

## Issue Lifecycle
backlog → queue → in_progress ⇄ paused → closed

- **backlog** — default status for new issues
- **queue** — triaged, ready to start
- **in_progress** — actively being worked on
- **paused** — work paused, can resume later
- **closed** — all acceptance criteria passed + confirmed

## Creating Issues
\`\`\`bash
trellis issue create -t "Add Python parser" -P high -l parser \\
  --desc "Parses Python files into AST entities" \\
  --ac "test:bun test test/semantic/python" \\
  --ac "Handles decorators and async functions"

# With explicit status
trellis issue create -t "Urgent fix" -P critical -S open
\`\`\`

Priority levels: \`low\`, \`medium\`, \`high\`, \`critical\`

## Working on Issues
\`\`\`bash
trellis issue triage TRL-1      # backlog → queue
trellis issue start TRL-1       # queue/backlog → in_progress (auto-creates branch)
trellis issue pause TRL-1       # in_progress → paused
trellis issue resume TRL-1      # paused → in_progress
trellis issue check TRL-1       # run acceptance criteria
trellis issue close TRL-1 --confirm  # requires criteria to pass
\`\`\`

## Updating Issues
\`\`\`bash
trellis issue update TRL-1 --title "New title" --desc "Updated" \\
  --status queue -P high -l label1,label2 --assignee agent:cascade
trellis issue describe TRL-1 "Short description text"
\`\`\`

## Listing Issues
\`\`\`bash
trellis issue list              # all issues
trellis issue list --status backlog
trellis issue list --status in_progress
trellis issue active            # currently in_progress
\`\`\`

## Blocking Relationships
\`\`\`bash
trellis issue block TRL-3 --blocked-by TRL-1  # TRL-3 blocked by TRL-1
trellis issue unblock TRL-3 --blocked-by TRL-1
\`\`\`

## Best Practices
- Always use \`trellis issue start\` (not just branch) — creates linked branch with traceability
- Add acceptance criteria on creation so closure is unambiguous
- Use \`--ac "test:bun test <path>"\` for automated test criteria
- Always \`pause\` before context-switching to another issue
`,
  },

  // ── VCS: MCP Tools ────────────────────────────────────────────────────────
  {
    path: 'vcs/mcp-tools',
    title: 'TrellisVCS MCP Tools Reference',
    use_cases: [
      'Using TrellisVCS through an MCP client',
      'Looking up available MCP tool names and parameters',
      'Understanding what each MCP tool does',
    ],
    content: `# TrellisVCS MCP Tools Reference

All tools accept a \`path\` parameter (default: \`.\`) for the repository path.

## Repository Info
| Tool | Description |
|------|-------------|
| \`trellis_status\` | Branch, op count, tracked files, recent ops |
| \`trellis_log\` | Op history. Params: \`path\`, \`file?\`, \`limit?\` |
| \`trellis_files\` | List all tracked files |
| \`trellis_diff\` | File-level diff. Params: \`path\`, \`from\`, \`to\`, \`file?\` |
| \`trellis_init\` | Initialize a new repository. Params: \`path\` |

## Branches & Milestones
| Tool | Description |
|------|-------------|
| \`trellis_branch\` | List/create/switch/delete. Params: \`path\`, \`action\`, \`name?\` |
| \`trellis_milestone\` | List or create milestones. Params: \`path\`, \`action\`, \`message?\` |

## Semantic Analysis
| Tool | Description |
|------|-------------|
| \`trellis_parse\` | Parse TS/JS into AST. Params: \`content\`, \`fileId?\` |
| \`trellis_semantic_diff\` | Semantic diff. Params: \`oldContent\`, \`newContent\`, \`fileId?\` |

## Idea Garden
| Tool | Description |
|------|-------------|
| \`trellis_garden\` | List/search/stats/revive. Params: \`path\`, \`action\`, \`clusterId?\`, \`keyword?\` |

## Issues
| Tool | Description |
|------|-------------|
| \`trellis_issue_create\` | Create issue. Params: \`path\`, \`title\`, \`description?\`, \`priority?\`, \`labels?\`, \`status?\`, \`criteria?\` |
| \`trellis_issue_list\` | List/filter. Params: \`path\`, \`status?\` |
| \`trellis_issue_start\` | Start issue (auto-branch). Params: \`path\`, \`id\` |
| \`trellis_issue_pause\` | Pause. Params: \`path\`, \`id\` |
| \`trellis_issue_resume\` | Resume. Params: \`path\`, \`id\` |
| \`trellis_issue_triage\` | backlog → queue. Params: \`path\`, \`id\` |
| \`trellis_issue_update\` | Update metadata. Params: \`path\`, \`id\`, + optional fields |
| \`trellis_issue_check\` | Run criteria. Params: \`path\`, \`id\` |
| \`trellis_issue_close\` | Close (requires confirm=true). Params: \`path\`, \`id\`, \`confirm\` |
| \`trellis_issue_block\` | Mark blocked. Params: \`path\`, \`id\`, \`blockedBy\` |
| \`trellis_issue_unblock\` | Remove block. Params: \`path\`, \`id\`, \`blockedBy\` |

## Decisions
| Tool | Description |
|------|-------------|
| \`trellis_decision_list\` | List traces. Params: \`path\`, \`tool?\`, \`agent?\`, \`entity?\`, \`limit?\` |
| \`trellis_decision_show\` | Show trace. Params: \`path\`, \`id\` |
| \`trellis_decision_chain\` | All decisions for entity. Params: \`path\`, \`entity\` |
`,
  },

  // ── VCS: Decisions ────────────────────────────────────────────────────────
  {
    path: 'vcs/decisions',
    title: 'TrellisVCS Decision Traces',
    use_cases: [
      'Understanding the decision trace system',
      'Querying what decisions affected an entity',
      'Using decision traces for audit trails',
    ],
    content: `# TrellisVCS Decision Traces

Decision traces are automatically captured from MCP tool invocations.
They record what tool was called, with what inputs, what it produced,
and optionally: rationale, alternatives considered, and prompt context.

## CLI Usage
\`\`\`bash
trellis decision list                           # recent decisions
trellis decision list --tool trellis_issue_*    # filter by tool pattern
trellis decision list --agent cascade           # filter by agent
trellis decision show DEC-1                     # full trace details
trellis decision chain issue:TRL-5              # all decisions affecting TRL-5
trellis decision chain src/engine.ts            # decisions affecting a file
\`\`\`

## MCP Tool Usage
\`\`\`
trellis_decision_list  → path, tool?, agent?, entity?, limit?
trellis_decision_show  → path, id
trellis_decision_chain → path, entity
\`\`\`

## Entity references in wiki-links
Use \`[[wiki-links]]\` to reference entities in markdown/doc-comments:
- \`[[TRL-5]]\` — an issue
- \`[[src/engine.ts]]\` — a file
- \`[[src/engine.ts#createIssue]]\` — a symbol in a file
- \`[[decision:DEC-1]]\` — a decision trace

## External enrichment
Agent harnesses can enrich decision traces via pre/post hooks in
\`src/decisions/hooks.ts\`:
- \`rationale\` — why this decision was made
- \`alternatives\` — what else was considered
- \`promptContext\` — relevant prompt snippets
`,
  },

  // ── DB: Overview ──────────────────────────────────────────────────────────
  {
    path: 'db/overview',
    title: 'TrellisDB Overview',
    use_cases: [
      'Understanding TrellisDB architecture',
      'Learning about entities, tenants, and the EAV model',
      'Getting started with TrellisDB',
    ],
    content: `# TrellisDB Overview

TrellisDB is a multi-tenant, graph-native database exposing a REST + WebSocket API.
Data is stored using an Entity-Attribute-Value (EAV) model in SQLite.

## Core Concepts

### Entities
The fundamental data unit. An entity has:
- \`id\` — unique string identifier (auto-generated or provided)
- \`type\` — string type tag (e.g. \`"Note"\`, \`"User"\`, \`"Task"\`)
- Arbitrary key-value attributes

Example entity:
\`\`\`json
{
  "id": "note-abc123",
  "type": "Note",
  "title": "Meeting notes",
  "body": "Discussed Q1 roadmap...",
  "pinned": "true",
  "createdAt": "2024-01-15T10:00:00Z"
}
\`\`\`

### Multi-tenancy
Each tenant gets an isolated SQLite database.
Tenant is specified via JWT (preferred) or \`?tenantId=\` query param.

### Blobs
Files are stored content-addressed (by SHA256 hash).
Upload via \`POST /upload\`, download via \`GET /files/:hash\`.

## Setup
\`\`\`bash
bun add trellis          # install
npx trellis db init      # creates .trellis-db.json
bun run trellis db serve # start server (default port 3000)
\`\`\`

Config file (\`.trellis-db.json\`):
\`\`\`json
{
  "path": "./data",
  "port": 3000,
  "jwtSecret": "your-secret",
  "apiKey": "your-api-key"
}
\`\`\`
`,
  },

  // ── DB: REST API ──────────────────────────────────────────────────────────
  {
    path: 'db/rest-api',
    title: 'TrellisDB REST API Reference',
    use_cases: [
      'Making HTTP requests to TrellisDB',
      'CRUD operations on entities',
      'Uploading and downloading files',
      'Authentication with TrellisDB',
    ],
    content: `# TrellisDB REST API Reference

Base URL: \`http://localhost:3000\` (default)
Auth: \`Authorization: Bearer <jwt>\` or \`Authorization: ApiKey <key>\`

## Health
\`\`\`
GET /health
→ { status: "ok", ops: number, tenants: number }
\`\`\`

## Entities

### Create
\`\`\`
POST /entities
Content-Type: application/json
{ "type": "Note", "title": "Hello", "body": "World" }
→ { id, type, ...attrs }
\`\`\`

### Read
\`\`\`
GET /entities/:id
→ { id, type, ...attrs }
\`\`\`

### Update
\`\`\`
PUT /entities/:id
Content-Type: application/json
{ "title": "Updated title" }
→ { id, type, ...attrs }
\`\`\`

### Delete
\`\`\`
DELETE /entities/:id
→ { success: true }
\`\`\`

### List
\`\`\`
GET /entities?type=Note&limit=20&offset=0
→ { data: [...], total: number, limit: number, offset: number }
\`\`\`
Params: \`type?\`, \`limit?\` (default 20), \`offset?\` (default 0)

## Query (EQL-S)
\`\`\`
POST /query
Content-Type: application/json
{ "query": "find Note where pinned = \\"true\\" limit 10" }
→ { results: [...], count: number }
\`\`\`

## File Upload
\`\`\`
POST /upload
Content-Type: multipart/form-data  (field: "file")
→ { hash: "sha256-abc...", name, size, mimeType, url }
\`\`\`

## File Download
\`\`\`
GET /files/:hash
→ file content (Content-Disposition: attachment)
\`\`\`

## WebSocket (Real-time)
\`\`\`
GET /realtime  (Upgrade: websocket)
\`\`\`
Send: \`{ type: "subscribe", entityType: "Note" }\`
Receive: \`{ type: "entity:created" | "entity:updated" | "entity:deleted", entity }\`
`,
  },

  // ── DB: EQL-S Queries ─────────────────────────────────────────────────────
  {
    path: 'db/eql-queries',
    title: 'TrellisDB EQL-S Query Language',
    use_cases: [
      'Writing EQL-S queries for TrellisDB',
      'Filtering, sorting, and limiting results',
      'Understanding EQL-S syntax',
      'Translating SQL/GraphQL queries to EQL-S',
    ],
    content: `# TrellisDB EQL-S Query Language

EQL-S (Entity Query Language - Structured) queries entities by type and attributes.

## Basic Syntax
\`\`\`
find <EntityType> [where <conditions>] [order by <attr> asc|desc] [limit <n>] [offset <n>]
\`\`\`

## Examples

### Find all entities of a type
\`\`\`
find Note
\`\`\`

### Filter by attribute value
\`\`\`
find Note where pinned = "true"
find Task where status = "open"
find User where role = "admin"
\`\`\`

### Multiple conditions (AND)
\`\`\`
find Note where pinned = "true" where body != ""
\`\`\`

### Comparison operators
\`\`\`
find Task where priority > "2"
find Note where updatedAt < "2024-01-01"
\`\`\`
Operators: \`=\`, \`!=\`, \`>\`, \`<\`, \`>=\`, \`<=\`

### Contains / starts with (prefix match)
\`\`\`
find Note where title contains "meeting"
find User where email starts_with "admin"
\`\`\`

### Ordering and pagination
\`\`\`
find Note order by createdAt desc limit 10
find Note limit 20 offset 40
\`\`\`

### Selecting specific fields
\`\`\`
find Note select id, title, pinned
\`\`\`

## Via REST API
\`\`\`bash
curl -X POST http://localhost:3000/query \\
  -H "Content-Type: application/json" \\
  -d '{"query": "find Note where pinned = \\"true\\" limit 5"}'
\`\`\`

## Via SDK
\`\`\`ts
const results = await db.query('find Note where pinned = "true"');
\`\`\`
`,
  },

  // ── DB: SDK ───────────────────────────────────────────────────────────────
  {
    path: 'db/sdk',
    title: 'TrellisDB SDK Usage',
    use_cases: [
      'Using the TrellisDB JavaScript/TypeScript SDK',
      'CRUD operations from code',
      'Running queries from code',
      'Real-time subscriptions',
    ],
    content: `# Trellis Client SDK Usage

\`\`\`bash
bun add trellis   # or: npm install trellis
\`\`\`

## Initialize
\`\`\`ts
import { TrellisDb } from 'trellis/client';

const db = new TrellisDb({
  url: 'http://localhost:3000',
  apiKey: 'your-api-key',    // or: jwtToken
  tenantId: 'default',       // optional
});
\`\`\`

## CRUD

### Create
\`\`\`ts
const note = await db.create('Note', {
  title: 'Hello',
  body: 'World',
  pinned: 'false',
});
// → { id, type: 'Note', title, body, pinned }
\`\`\`

### Read
\`\`\`ts
const note = await db.get(id);
\`\`\`

### Update
\`\`\`ts
const updated = await db.update(id, { title: 'New title' });
\`\`\`

### Delete
\`\`\`ts
await db.delete(id);
\`\`\`

### List
\`\`\`ts
const { data, total } = await db.list({ type: 'Note', limit: 20 });
\`\`\`

## Query
\`\`\`ts
const results = await db.query('find Note where pinned = "true" limit 10');
\`\`\`

## File Upload
\`\`\`ts
const { hash, url } = await db.upload(file); // File | Blob | Buffer
\`\`\`

## Real-time Subscriptions
\`\`\`ts
db.subscribe('Note', (event) => {
  // event.type: 'entity:created' | 'entity:updated' | 'entity:deleted'
  // event.entity: the entity
  console.log(event);
});
db.unsubscribe('Note');
\`\`\`
`,
  },

  // ── DB: Inspector ─────────────────────────────────────────────────────────
  {
    path: 'db/inspector',
    title: 'TrellisDB Inspector Overlay',
    use_cases: [
      'Using the built-in DB inspector UI',
      'Adding the inspector to a frontend app',
      'Debugging database contents in the browser',
    ],
    content: `# TrellisDB Inspector Overlay

The DB Inspector is a Vue-based web component that auto-injects itself
as a floating, draggable overlay into any frontend that loads its script.

## How it works
The DB server serves the inspector at \`GET /__trellis/inspector.js\`.
When this script loads, it registers a \`<trellis-db-inspector>\` custom element
and appends it to \`<body>\`. No framework integration required.

## Adding to your app
\`\`\`html
<!-- In index.html — adjust URL to match your DB server -->
<script src="http://localhost:3000/__trellis/inspector.js"></script>
\`\`\`

If using Vite with a proxy (e.g. \`/api\` → \`http://localhost:3000\`):
\`\`\`html
<script src="/api/__trellis/inspector.js"></script>
\`\`\`

## Features
- **Entities tab** — browse all entities, filter by type, expand to see attributes
- **Query tab** — run EQL-S queries with ⌘↵ shortcut
- **Stats tab** — entity counts, health, REST API reference
- **Draggable** — drag the header to move it out of the way
- **DB URL display** — shows the connected DB server URL

## The db-url attribute
The \`db-url\` attribute is auto-detected from the script's \`src\` origin.
You can override it manually:
\`\`\`html
<trellis-db-inspector db-url="http://my-server:3000"></trellis-db-inspector>
\`\`\`

## Building the inspector
The inspector is built separately from the main trellis bundle:
\`\`\`bash
bun run build:inspector   # builds dist/db/inspector.js
bun run build             # full build (includes inspector)
\`\`\`
`,
  },

  // ── CLI Reference ─────────────────────────────────────────────────────────
  {
    path: 'cli/reference',
    title: 'Trellis CLI Reference',
    use_cases: [
      'Looking up CLI commands',
      'Running trellis from the terminal',
      'CLI flags and options for any command',
    ],
    content: `# Trellis CLI Reference

Install: \`bun add trellis\` or \`npm install trellis\`
Run: \`npx trellis <command>\` or \`bun run trellis <command>\`

## VCS Commands

### Status & Log
\`\`\`bash
trellis status
trellis log [--limit <n>] [--file <path>]
trellis files
\`\`\`

### Branching
\`\`\`bash
trellis branch [<name>]           # create+switch or list
trellis branch -d <name>          # delete
trellis merge <branch>            # three-way merge
\`\`\`

### Milestones
\`\`\`bash
trellis milestone create -m "<message>"
trellis milestone list
\`\`\`

### Diffing
\`\`\`bash
trellis diff <from-hash> <to-hash> [--file <path>]
trellis sdiff <old-file> <new-file>       # semantic/AST diff
trellis parse <file>                      # parse into AST entities
\`\`\`

### Idea Garden
\`\`\`bash
trellis garden list
trellis garden search -k <keyword>
trellis garden stats
trellis garden revive <cluster-id>
\`\`\`

### Issues
\`\`\`bash
trellis issue create -t "<title>" -P <priority> [-l <label>] [--desc "..."] [--ac "..."]
trellis issue list [--status <status>]
trellis issue active
trellis issue triage <id>
trellis issue start <id>
trellis issue pause <id>
trellis issue resume <id>
trellis issue update <id> [--title "..."] [--desc "..."] [--status <s>] [-P <p>]
trellis issue describe <id> "<description>"
trellis issue check <id>
trellis issue close <id> --confirm
\`\`\`

### Decisions
\`\`\`bash
trellis decision list [--tool <pattern>] [--agent <name>]
trellis decision show <id>
trellis decision chain <entity>
\`\`\`

## DB Commands
\`\`\`bash
trellis db init [--path <dir>] [--port <n>] [--key <secret>]
trellis db serve [--config <file>]
trellis db create --type <Type> --attr key=value ...
trellis db read <id>
trellis db update <id> --attr key=value ...
trellis db delete <id>
trellis db list [--type <Type>] [--limit <n>]
trellis db query "<eql-s query>"
trellis db upload <file>
trellis db import <json-file>
\`\`\`
`,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function listSections() {
  return SECTIONS.map(({ path, title, use_cases }) => ({
    path,
    title,
    use_cases,
  }));
}

function getSection(path: string): DocSection | undefined {
  return SECTIONS.find((s) => s.path === path);
}

function getSections(paths: string[]): DocSection[] {
  return paths.map((p) => getSection(p)).filter(Boolean) as DocSection[];
}

// ---------------------------------------------------------------------------
// Trellis-check patterns
// ---------------------------------------------------------------------------

interface CheckIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
}

function trellisCheck(code: string): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const lines = code.split('\n');

  lines.forEach((line, i) => {
    const ln = i + 1;

    // EQL-S: unquoted string values
    if (/\bfind\b.*\bwhere\b.*=\s*(?!["'])/.test(line)) {
      issues.push({
        severity: 'warning',
        message:
          'EQL-S: attribute values should be quoted strings (e.g. = "value")',
        line: ln,
      });
    }

    // Direct .trellis/ directory access
    if (/['"`.\/]\.trellis[\/'"` ]/.test(line)) {
      issues.push({
        severity: 'error',
        message:
          'Never read/write .trellis/ directly — use the CLI or MCP tools. Direct edits corrupt the op log.',
        line: ln,
      });
    }

    // git commands used instead of trellis
    const gitCmds = ['git commit', 'git add', 'git push', 'git stash'];
    for (const cmd of gitCmds) {
      if (line.includes(cmd)) {
        const trellisEquiv =
          cmd === 'git commit'
            ? 'trellis milestone create'
            : cmd === 'git stash'
              ? 'trellis garden'
              : 'trellis (ops are automatic)';
        issues.push({
          severity: 'info',
          message: `Consider using TrellisVCS instead of \`${cmd}\` → \`${trellisEquiv}\``,
          line: ln,
        });
      }
    }

    // Missing await on db SDK calls
    if (
      /(?:db|client)\.(create|update|delete|get|list|query|upload)\(/.test(
        line,
      ) &&
      !/await\s/.test(line) &&
      !/=\s*db\.|=\s*client\./.test(line)
    ) {
      issues.push({
        severity: 'warning',
        message: 'TrellisDB SDK methods are async — did you forget `await`?',
        line: ln,
      });
    }
  });

  return issues;
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'trellis-docs',
  version: '1.0.0',
});

// ── list-sections ────────────────────────────────────────────────────────────
server.registerTool(
  'list-sections',
  {
    description:
      'Discover all available Trellis documentation sections. ' +
      'Use this FIRST to find relevant sections, then call get-documentation.',
    inputSchema: {},
  },
  async () => {
    const sections = listSections();
    const lines = sections.map(
      (s) =>
        `## ${s.title}\npath: ${s.path}\nuse_cases:\n${s.use_cases.map((u) => `  - ${u}`).join('\n')}`,
    );
    return {
      content: [{ type: 'text' as const, text: lines.join('\n\n') }],
    };
  },
);

// ── get-documentation ────────────────────────────────────────────────────────
server.registerTool(
  'get-documentation',
  {
    description:
      'Fetch full documentation for one or more sections. ' +
      'Pass an array of section paths from list-sections. ' +
      'Fetch ALL sections relevant to the user task.',
    inputSchema: {
      sections: z
        .array(z.string())
        .describe(
          'Section paths to fetch, e.g. ["vcs/workflows", "db/eql-queries"]',
        ),
    },
  },
  async ({ sections: paths }) => {
    const found = getSections(paths);
    const missing = paths.filter((p) => !SECTIONS.find((s) => s.path === p));

    const parts: string[] = found.map((s) => s.content);
    if (missing.length > 0) {
      parts.push(
        `\n---\nUnknown section paths: ${missing.join(', ')}\nCall list-sections to see available paths.`,
      );
    }

    return {
      content: [{ type: 'text' as const, text: parts.join('\n\n---\n\n') }],
    };
  },
);

// ── trellis-check ────────────────────────────────────────────────────────────
server.registerTool(
  'trellis-check',
  {
    description:
      'Analyze code for common Trellis mistakes: ' +
      'malformed EQL-S queries, direct .trellis/ access, missing awaits, ' +
      'and Git commands that should be Trellis equivalents. ' +
      'Call this whenever writing TrellisDB or TrellisVCS code.',
    inputSchema: {
      code: z.string().describe('Code to analyze'),
      filename: z.string().optional().describe('Optional filename for context'),
    },
  },
  async ({ code, filename }) => {
    const issues = trellisCheck(code);

    if (issues.length === 0) {
      return {
        content: [{ type: 'text' as const, text: '✓ No issues found.' }],
      };
    }

    const header = filename ? `Issues in ${filename}:\n` : 'Issues found:\n';
    const lines = issues.map((issue) => {
      const loc = issue.line ? `L${issue.line}: ` : '';
      const icon =
        issue.severity === 'error'
          ? '✗'
          : issue.severity === 'warning'
            ? '⚠'
            : 'ℹ';
      return `${icon} [${issue.severity.toUpperCase()}] ${loc}${issue.message}`;
    });

    return {
      content: [{ type: 'text' as const, text: header + lines.join('\n') }],
    };
  },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
