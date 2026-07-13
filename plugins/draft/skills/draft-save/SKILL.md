---
description: "Save current session work as a reusable bash/python script"
argument-hint: "[--name <name>] [--commit <ref>]"
allowed-tools: ["Bash", "Read", "Write"]
---

# Draft Save

Save this session's work as a controllable, reusable script.

## Source

- `--commit <ref>`: read `git diff $COMMIT~1..$COMMIT`
- Otherwise: review what was done in this conversation

## Before writing

1. List existing scripts in the target directory
2. If a script with the same name OR overlapping purpose already exists:
   - Show the user a diff of old vs new
   - Default to updating in-place (Edit) rather than overwriting (Write)
   - If the scope changed significantly, ask whether to update or create a separate script
3. If no overlap found, proceed with new file creation

## What to extract

- Side effects only (file edits, writes, installs, deploys)
- Final state only (collapse retries)
- Verification step at the end if one existed
- Hardcoded values → `@param`

## Output

Pick the language that fits the task. Frontmatter format:

```
# @draft
# @name <name>
# @description <one line>
# @param <name> <type> "<description>" [default]
```

## Target directory

Always `~/.claude/scripts/` (global, shared across all projects).

Write to `<target>/<name>.<ext>`, `chmod +x`.
Show the script, ask if user wants to edit.
