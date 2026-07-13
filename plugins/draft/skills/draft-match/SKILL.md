---
description: "Check the DRAFT cache for previously saved scripts and notes matching the current task. Use BEFORE starting any nontrivial task (setup, fix, migration, refactor, investigation) — a cached script may finish it in seconds."
allowed-tools: ["Bash", "Read"]
---

# Draft Match

List the cache catalog:

```!
node "${CLAUDE_PLUGIN_ROOT}/scripts/lib/scan.js" --all
```

Each line is `type<TAB>name<TAB>path<TAB>description`.

- Compare the current task against the names and descriptions. Judge relevance yourself — only pick items that genuinely apply.
- For a matched script: Read it, then run it (it's executable) instead of re-implementing.
- For a matched note: Read it and apply its content as context.
- Empty output or no relevant items: proceed with the task normally.
