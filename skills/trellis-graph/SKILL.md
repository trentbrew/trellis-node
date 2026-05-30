---
name: trellis-graph
description: >
  Skill for working with the Trellis knowledge graph — creating, querying,
  linking, and managing entities (tasks, events, notes, people, projects, etc.)
  using the TQL Graph API via MCP tools. Use this skill whenever the user asks
  you to interact with their Trellis data, create entities, query the graph,
  or manage relationships between entities.
---

# Trellis Graph Skill

Trellis is a personal knowledge graph where everything is an entity with typed
properties and semantic links. The graph powers a Nuxt web app running on
`localhost:$TRELLIS_PORT` with realtime sync — any mutations you make via MCP tools
appear instantly in the browser UI.

## IMPORTANT: Always Use MCP Tools

**Never use `curl`, `fetch`, or raw HTTP requests to interact with the Trellis API.**
You have 48 MCP tools available — use them directly. They handle authentication,
error formatting, and JSON serialization automatically.

| Instead of...                     | Use this MCP tool                                                    |
| --------------------------------- | -------------------------------------------------------------------- |
| `curl /api/graph/health`          | `graph_health`                                                       |
| `curl /api/graph/query`           | `query_graph`                                                        |
| `curl /api/graph/ontologies`      | `get_schema`                                                         |
| `curl /api/graph/catalog`         | `get_catalog`                                                        |
| `curl /api/graph/node/:id`        | `get_node`                                                           |
| `curl /api/graph/mutate` (create) | `create_node`                                                        |
| `curl /api/graph/mutate` (update) | `update_node`                                                        |
| `curl /api/graph/mutate` (delete) | `delete_node`                                                        |
| `curl /api/graph/mutate` (link)   | `link_nodes`                                                         |
| `curl /api/platform/*`            | Use the corresponding platform tool (e.g. `list_orgs`, `create_tag`) |

The MCP tools are the **only** supported interface for AI agents. Raw HTTP calls
may break, miss error handling, or hit undocumented routes.

## Entity Architecture

### Two-Axis Type System

Every entity has an **entity class** (structural shape) and an **entity type** (specific kind):

| Class         | Description                              | Types                                                                  |
| ------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| **temporal**  | Has date/time span, lives on a calendar  | task, event, trip, payment, appointment, reminder, deadline, milestone |
| **document**  | Has rich content body                    | note, file, page, template, slide_deck, bookmark                       |
| **actor**     | Represents a person/entity with identity | person, contact, organization, vendor                                  |
| **container** | Groups/organizes other entities          | project, folder, collection, goal                                      |

Every entity must have a `type` fact. `createdAt`/`updatedAt` are auto-managed.

### Common Fields (all entities)

- `id` — Unique string identifier (e.g. `"task-abc123"`)
- `type` — Entity type string
- `title` — Display name (required)
- `description` — Optional rich text
- `tags` — String array
- `owner` — User ID who owns the entity
- `involved` — Array of user IDs
- `category` — Optional classification string
- `references` — Array of `FileReference | EntityReference` objects
- `createdAt` / `updatedAt` — ISO 8601 timestamps
- `zoneId` — Campus Zone this entity lives in (e.g. `"entity:founder-facility-lab"`) — see below
- `facilityId` — Campus Facility containing the zone (Phase 0: always `"entity:founder-facility"`)

### Temporal Fields (temporal class only)

- `startDate` — `YYYY-MM-DD` (required for most temporal types)
- `endDate` — `YYYY-MM-DD` (optional, for multi-day items)
- `allDay` — Boolean
- `startTime` / `endTime` — `HH:mm` (when not all-day)
- `priority` — `critical | high | medium | low`
- `urgency` — `urgent | not-urgent`
- `taskStatus` — `pending | in-progress | on-track | due-soon | overdue | completed` (tasks only)
- `reminders` — Array of `{ id, timing, method }`
- `recurrence` — `{ frequency, interval?, weekdays?, endDate?, occurrences? }`

### Document Fields (document class only)

- `content` — HTML rich text body
- `pinned` — Boolean
- `url` — String (bookmarks only)
- `favicon` / `thumbnail` / `siteName` / `excerpt` — Bookmark metadata

### Actor Fields (actor class only)

- `email` / `phone` — Contact info
- `avatar` — URL
- `role` — String

### Container Fields (container class only)

- `children` — Array of child entity IDs
- `progress` — 0–1 float
- `status` — `active | archived | completed | on-hold`
- `parentId` — Optional parent container ID

## Campus Substrate (Phase 0)

The graph is organized by a spatial ontology: every entity lives in a **Zone** inside a **Facility**. Six substrate types define the authority model:

| Type       | Class     | Role                                                                                                    |
| ---------- | --------- | ------------------------------------------------------------------------------------------------------- |
| `facility` | container | Holds zones (e.g. `entity:founder-facility`)                                                            |
| `zone`     | container | Capability-granting location (`lab`, `lobby`, `workshop`, `showroom`, `vault`, `classroom`, `giftshop`) |
| `agent`    | actor     | Autonomous actor bound to a facility                                                                    |
| `wallet`   | actor     | Identity + reputation projection for an agent                                                           |
| `decision` | document  | Rationale + context + outcome for each mutation                                                         |
| `artifact` | document  | Shipped work; published in a zone                                                                       |

**Default zones** in the founder Facility:

- `entity:founder-facility-lab` — private workspace (owner-only)
- `entity:founder-facility-lobby` — public READ + access requests
- `entity:founder-facility-workshop` — members-only collaboration
- `entity:founder-facility-showroom` — publish artifacts + pages (public READ)
- `entity:founder-facility-vault` — credentials + irreversible ops (owner + 2FA)

### Tagging mutations with a zone

Include `data.zoneId` and `data.facilityId` in `create_node` (or `update_node`) to publish into a specific zone. If you omit them, the server stamps the founder's Lab by default.

**Publish an artifact to the Showroom:**

```json
{
  "entityId": "entity:artifact-demo-v1",
  "type": "entity",
  "data": {
    "type": "artifact",
    "title": "Public demo build",
    "artifactType": "deliverable",
    "contentRef": "https://demo.example.com/v1",
    "zoneId": "entity:founder-facility-showroom",
    "facilityId": "entity:founder-facility",
    "publishedInZone": "entity:founder-facility-showroom",
    "createdByAgent": "entity:founder"
  }
}
```

**Record a decision you made in the Workshop:**

```json
{
  "entityId": "entity:decision-migrate-to-postgres",
  "type": "entity",
  "data": {
    "type": "decision",
    "title": "Migrate user store to Postgres",
    "rationale": "<p>Scale limits on SQLite…</p>",
    "outcome": "executed",
    "byAgent": "entity:founder",
    "inZone": "entity:founder-facility-workshop",
    "zoneId": "entity:founder-facility-workshop",
    "facilityId": "entity:founder-facility"
  }
}
```

### Zone guard (advisory)

Every mutation is evaluated against the target zone's grants and logged:

```
[zone-guard] ALLOW agent=entity:founder action=createNode zone=showroom event=#42
[zone-guard] DENY (advisory) agent=my-agent action=createNode zone=vault reason="…"
```

Both outcomes let the mutation commit in Phase 0. If you see `DENY`, audit the intent before Phase 1 flips on strict enforcement.

### Querying by zone

```
FIND entity AS ?e WHERE ?e.zoneId = "entity:founder-facility-lab"
FIND entity AS ?a WHERE ?a.type = "artifact" AND ?a.publishedInZone = "entity:founder-facility-showroom"
```

See `/agent` in the web app for a live op-log projection filtered by zone.

## Creating Entities

Always use `create_node` with:

1. A descriptive, unique `entityId` (e.g. `"task-weekly-review"`, `"note-meeting-notes-feb10"`)
2. The correct `type` from the list above
3. A `data` object with at minimum `{ title: "..." }`

### Examples

**Create a task:**

```json
{
  "entityId": "task-review-pr-42",
  "type": "task",
  "data": {
    "title": "Review PR #42",
    "startDate": "2026-02-11",
    "priority": "high",
    "taskStatus": "pending",
    "tags": ["code-review", "frontend"]
  }
}
```

**Create a note:**

```json
{
  "entityId": "note-standup-feb10",
  "type": "note",
  "data": {
    "title": "Standup Notes — Feb 10",
    "content": "<p>Discussed MCP integration and skill system.</p>",
    "pinned": false,
    "tags": ["standup", "engineering"]
  }
}
```

**Create a person:**

```json
{
  "entityId": "person-jane-doe",
  "type": "person",
  "data": {
    "title": "Jane Doe",
    "email": "jane@example.com",
    "role": "Engineering Lead"
  }
}
```

**Create a project:**

```json
{
  "entityId": "project-mcp-integration",
  "type": "project",
  "data": {
    "title": "Project Management Integration",
    "status": "active",
    "startDate": "2026-02-10",
    "endDate": "2026-03-01"
  }
}
```

## Linking Entities

Use `link_nodes` with semantic relation names:

| Relation     | Meaning                 | Example              |
| ------------ | ----------------------- | -------------------- |
| `assignedTo` | Task/item → Person      | task-1 → person-jane |
| `belongsTo`  | Entity → Project/Folder | task-1 → project-mcp |
| `references` | Bidirectional reference | note-1 → task-2      |
| `dependsOn`  | Task dependency chain   | task-2 → task-1      |
| `parentOf`   | Container hierarchy     | project-1 → folder-1 |
| `childOf`    | Inverse of parentOf     | folder-1 → project-1 |

## Querying

Use `query_graph` with EQL-S syntax:

```
FIND tasks AS t WHERE t.priority = "high" RETURN t.title, t.startDate, t.taskStatus
```

```
FIND notes AS n RETURN n.title, n.updatedAt ORDER BY n.updatedAt DESC LIMIT 10
```

```
FIND projects AS p WHERE p.status = "active" RETURN p.title, p.progress
```

## Introspection

**Start here:** Call `get_graph_summary` first. It replaces `graph_health` + `get_schema` + `get_catalog` in a single round trip and gives you everything needed to orient yourself in the graph.

| Tool                | When to use                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `get_graph_summary` | **Always call first** — compact overview of health, entity types, ontologies, attributes, links, recent mutations |
| `graph_health`      | Quick liveness check only (fact/link counts)                                                                      |
| `get_schema`        | Full ontology field definitions (when you need field-level detail)                                                |
| `get_catalog`       | Full attribute distribution (77 attrs, verbose — prefer `get_graph_summary`)                                      |
| `get_mutation_log`  | Full recent mutation history                                                                                      |

### `get_graph_summary` response shape

```json
{
  "health": {
    "status": "ok",
    "factCount": 8306,
    "linkCount": 39,
    "entityCount": 456
  },
  "entityTypes": [
    { "type": "event", "count": 450 },
    { "type": "task", "count": 6 }
  ],
  "ontologies": {
    "total": 46,
    "system": ["task", "note", "event", "..."],
    "user": []
  },
  "topAttributes": [
    { "attribute": "title", "distinctCount": 43, "cardinality": "one" }
  ],
  "links": { "total": 39, "relations": ["assignedTo", "belongsTo"] },
  "recentMutations": [
    {
      "action": "createNode",
      "entityId": "entity:gcal-...",
      "timestamp": "..."
    }
  ]
}
```

Optional `limit` parameter caps list lengths (default: 10).

## Ontology CRUD (Runtime Type Creation)

You can create new entity types at runtime using the ontology tools. When you create
an ontology, the new type **automatically appears** in the Trellis UI sidebar, browse
pages, and dialogs — zero code changes needed.

### Field Value Types (Notion-compatible)

`title`, `rich_text`, `number`, `select`, `multi_select`, `status`, `date`, `people`,
`files`, `checkbox`, `url`, `email`, `phone_number`, `relation`, `rollup`, `formula`

### Create an Ontology

```json
{
  "id": "trellis:schema/invoice",
  "version": "1.0.0",
  "fields": [
    { "name": "title", "valueType": "title", "required": true },
    { "name": "amount", "valueType": "number" },
    { "name": "vendor", "valueType": "rich_text" },
    { "name": "dueDate", "valueType": "date" },
    {
      "name": "status",
      "valueType": "select",
      "selectOptions": ["pending", "paid", "overdue"]
    }
  ]
}
```

### Entity Class Inference

The system infers entity class from fields:

- **temporal** — Has `startDate`, `endDate`, `dueDate`, `allDay`, etc.
- **document** — Has `content`, `pinned`, `body`, etc.
- **actor** — Has `email`, `phone`, `avatar`, `firstName`, etc.
- **container** — Default when no specific indicators found

### Update an Ontology

Use `update_ontology` with the full field list (replaces all existing fields).

### Delete an Ontology

Use `delete_ontology` — removes the type schema. Existing entities of that type remain
in the graph but the type disappears from the UI.

## Platform Tools

Beyond graph CRUD, the MCP server exposes 33 platform tools for managing
workspace resources. All platform data is stored in the TQL kernel and
persists across restarts.

### Workspace Context

- `list_orgs` — List all organizations
- `create_org` — Create an org (idempotent by slug)
- `get_org` — Get org by slug
- `list_apps` — List apps/worlds (optionally scoped by orgId)
- `create_app` — Create an app (idempotent by slug)
- `update_app` — Update app properties
- `delete_app` — Delete an app
- `get_context` — Get current org + app context

### Collections & Pages

- `list_collections` / `create_collection` / `update_collection` / `delete_collection`
- `list_pages` / `create_page` / `update_page` / `delete_page`

### Entity Enrichment

- `list_comments` — List comments on an entity
- `add_comment` — Add a comment (auto-links to parent entity)
- `list_tags` / `create_tag` — Tag management (idempotent)
- `assign_tags` — Assign tags to entity (auto-creates missing tags)

### Bulk Operations & Workflows

- `bulk_update` — Batch update entities matching an EQL-S query
- `bulk_delete` — Batch delete entities matching an EQL-S query
- `list_workflows` / `create_workflow` / `update_workflow` / `delete_workflow`

### Settings & Invites

- `get_setting` / `set_setting` / `list_settings` — Key-value settings (app or user scoped)
- `send_invite` — Send workspace invitation

### Platform ID Conventions

| Resource     | ID Format                        | Example                                  |
| ------------ | -------------------------------- | ---------------------------------------- |
| Organization | `platform:org/<slug>`            | `platform:org/media-cms`                 |
| App/World    | `platform:app/<slug>`            | `platform:app/production`                |
| Collection   | `platform:collection/<slug>`     | `platform:collection/episodes`           |
| Page         | `platform:page/<slug>-<ts>`      | `platform:page/dashboard-mlx6yjnj`       |
| Tag          | `platform:tag/<slug>`            | `platform:tag/priority`                  |
| Workflow     | `platform:workflow/<slug>-<ts>`  | `platform:workflow/auto-triage-mlx6yv0g` |
| Comment      | `comment:<uuid>`                 | `comment:1890044d-67a1-...`              |
| Setting      | `platform:setting/<scope>/<key>` | `platform:setting/app/theme`             |

## Best Practices

1. **Always set a title** — Every entity needs at minimum a `title` field
2. **Use descriptive IDs** — `"task-deploy-v2"` not `"abc123"`
3. **Set dates as ISO strings** — `"2026-02-10"` for dates, `"14:30"` for times
4. **Link after creating** — Create both entities first, then link them
5. **Check before creating** — Use `query_graph` to avoid duplicates
6. **Use tags liberally** — Tags are the primary cross-cutting classification
7. **Mutations are realtime** — The browser UI updates instantly via SSE
8. **Creates are idempotent** — `create_org`, `create_app`, `create_tag`, `create_collection` return existing if slug matches
9. **Use context** — Set org/app context once, then all scoped commands use it automatically
