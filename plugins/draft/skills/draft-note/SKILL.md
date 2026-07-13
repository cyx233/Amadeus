---
description: "Save a note to the DRAFT cache (reusable context, not a script)"
argument-hint: "[--name <name>]"
allowed-tools: ["Bash", "Read", "Write"]
---

# Draft Note

Save reusable context as a note. Notes cache knowledge that stays stable across sessions.

## Steps

1. `--name` provided → use it. Otherwise ask.
2. Check for existing notes in the target directory
   - If a note with the same name exists → read it, show diff, update in-place (Edit)
   - If no conflict → proceed to create new file
3. Extract from conversation: core fact, constraints, scope.
4. Write to `~/.claude/notes/<name>.md`:

```markdown
---
draft: note
name: <name>
description: <one-line summary>
---

<content — concise, actionable>
```

## Target directory

Always `~/.claude/notes/` (global, shared across all projects).

Show the note, ask if user wants to edit.

## Rules

- Short — injected on every match
- One note = one concept
- Plain language for LLM consumption
