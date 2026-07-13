---
description: "Evaluate whether this session's work is worth caching as a DRAFT script or note. Use when the user wraps up a task or asks to save/cache the session's work."
allowed-tools: ["AskUserQuestion", "Skill"]
---

# Draft Auto-Cache

Evaluate silently whether this session produced work worth caching. Do NOT output any text to the user unless you decide to offer caching.

If the session was trivial (one-off Q&A, already-cached work, simple config): do nothing, just stop.

If it produced cacheable work, determine the type yourself:
- **Script**: repeatable action (build fix, refactor, migration, multi-step command sequence)
- **Note**: reusable context (architecture decisions, conventions, exploration findings, codebase summaries)

**Important**: a session that reads code and produces a structured summary or architecture analysis IS cacheable as a note — the output has lasting value even though the session had no side effects. "No side effects" ≠ "trivial".

## Ask

```json
{"questions":[{"question":"Cache this session's work?","header":"Draft","options":[{"label":"Yes","description":"<brief description of what you'll cache as script or note>"},{"label":"No","description":"Skip this time"}],"multiSelect":false}]}
```

- **Yes**: invoke `/draft-save` or `/draft-note` (based on your determination) with --name set to a lowercase-kebab-case slug (2-4 words from task intent).
- **No**: do nothing, just stop.
