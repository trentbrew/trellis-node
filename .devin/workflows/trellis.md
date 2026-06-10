---
description: TrellisVCS workflow skill for graph-native version control
---

# TrellisVCS Workflow

See `AGENTS.md` at the project root for the full agent guide.

## Quick Reference

1. **Check status** before any VCS operation:

```bash
trellis status
```

2. **Check the Idea Garden** before starting new features:

```bash
trellis garden list
trellis garden search -k "<keyword>"
```

3. **Create milestones** (not commits) at meaningful points:

```bash
trellis milestone create -m "Description of completed work"
```

4. **Use semantic diffs** for TypeScript/JavaScript review:

```bash
trellis sdiff src/old.ts src/new.ts
```

5. **Branch** for experimental work:

```bash
trellis branch feature/my-feature
```

6. **Create issues** (defaults to `backlog` status):

```bash
trellis issue create -t "Task title" -P high -l label \
  --desc "Short description" \
  --ac "test:bun test test/my-test" \
  --ac "Manual review description"
```

7. **Triage** issues from backlog → open when ready:

```bash
trellis issue triage TRL-1
```

8. **Start issues** (works from backlog or open; auto-creates branch, auto-assigns):

```bash
trellis issue start TRL-1
```

9. **Pause/resume** when context-switching:

```bash
trellis issue pause TRL-1    # switches to default branch
trellis issue resume TRL-1   # switches back to issue branch
```

10. **Update** issue metadata:

```bash
trellis issue update TRL-1 --title "New title" --desc "Updated" --status open -P high
trellis issue describe TRL-1 "Short description text"
```

11. **Check and close** with two-phase gate:

```bash
trellis issue check TRL-1              # run acceptance criteria
trellis issue close TRL-1 --confirm    # requires all AC pass + confirm
```

## Key Rules

- **Never** modify `.trellis/` directly
- Ops are automatic — no staging or committing needed
- Milestones replace commits as the unit of narrative
- Always check the garden for abandoned work before starting fresh
- **Start issues, don't just branch** — `trellis issue start` provides better traceability
- **Pause before context-switching** — `trellis issue pause` first
- **Two-phase close gate** — all acceptance criteria must pass AND `--confirm` required
- **Issues default to backlog** — use `trellis issue triage` to move to open, or `trellis issue start` to jump to in_progress
- **Add descriptions** — use `--desc` on create or `trellis issue describe` for short descriptions
