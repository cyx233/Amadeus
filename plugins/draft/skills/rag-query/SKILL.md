# RAG Query (with live-mem cache)

Retrieves relevant context from the workspace knowledge base. **Always runs
draft-match first** — if the live-mem cache has a matching script/note, use
that directly. Only falls through to LightRAG on cache miss.

## When to use

When the agent needs background knowledge about the workspace (architecture,
past decisions, how something was done before) that isn't in the immediate
file context.

## Steps

1. Run draft-match first (the agent should invoke `/draft-match` or the
   draft-match skill). If it returns a hit, use that — done.

2. On miss, query LightRAG:

```bash
curl -s "${LIGHTRAG_URL:-http://lightrag:9621}/query" \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"$ARGUMENTS\", \"mode\": \"hybrid\"}" | jq -r '.response'
```

3. If LightRAG also misses, tell the user no cached knowledge was found and
   proceed with normal problem-solving.

## After task completion

If the session produced reusable work, invoke `/draft-auto-cache` to
potentially write it back to the live-mem cache for next time.
