#!/bin/bash
# Patch TaskMaster's minified dist for an AI-SDK v5 bug that affects ALL
# providers (not just Bedrock), so this patch ships in every image.
#
# The dist is minified with content-hashed filenames, so the patch flips a
# single token anchored on a string that appears EXACTLY ONCE across the whole
# package, asserting a before/after count. If a future task-master version
# changes the minified output (0 or >1 matches), the build fails loudly instead
# of silently mis-patching — that's the signal to re-verify the anchor (or drop
# the patch once the upstream fix, PR #1706, ships).
#
# This file is sourced by the dev-only patch script, which adds a Bedrock-only
# temperature patch on top. Keep the helper reusable.
set -euo pipefail

TM_DIR="${TM_DIR:-$(npm root -g)/task-master-ai/dist}"

# `|| true` on the greps: grep exits 1 when it finds nothing, which would trip
# `set -e`/pipefail — but "found 0" is a value we assert on, not an error.
tm_count() { grep -rhoF "$1" "$TM_DIR"/*.js 2>/dev/null | wc -l | tr -d ' ' || true; }

# Apply one exactly-once literal replacement across the dist, asserting the
# needle is present exactly once before and gone after.
tm_patch_once() {
  local label="$1" needle="$2" replacement="$3"
  local before after file
  before="$(tm_count "$needle")"
  if [ "$before" != "1" ]; then
    echo "[patch-taskmaster] $label: expected exactly 1 occurrence, found $before — aborting" >&2
    echo "[patch-taskmaster] task-master minified output changed; re-verify the anchor." >&2
    exit 1
  fi
  file="$(grep -rlF "$needle" "$TM_DIR"/*.js | head -1)"
  # Literal string replace via node (no regex-escaping headaches for JS tokens).
  node -e '
    const fs = require("fs");
    const [file, needle, repl] = process.argv.slice(1);
    const s = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, s.replace(needle, repl));
  ' "$file" "$needle" "$replacement"
  after="$(tm_count "$needle")"
  if [ "$after" != "0" ]; then
    echo "[patch-taskmaster] $label: replace failed, needle still present — aborting" >&2
    exit 1
  fi
  echo "[patch-taskmaster] $label patched in $(basename "$file")"
}

# maxTokens — the generateObject path passes `maxTokens:e.maxTokens`, but AI SDK
# 5 (task-master bundles ai@5.0.219) renamed the option to `maxOutputTokens`.
# The old key is silently ignored, so structured generation (parse-prd, expand,
# add-task, analyze-complexity, update) falls back to the provider default
# (~4096) and truncates larger outputs (finishReason:"length"). Provider-
# agnostic — every provider hits it. generateText already uses the correct key;
# only generateObject is wrong, so anchor on the unique schemaDescription prefix
# to avoid touching generateText's `maxOutputTokens:e.maxTokens`.
# Upstream fix: https://github.com/eyaltoledano/claude-task-master/pull/1706
# (open, unreleased) — remove this patch once it ships in a pinned version.
tm_patch_once "maxTokens" '}`,maxTokens:e.maxTokens' '}`,maxOutputTokens:e.maxTokens'
