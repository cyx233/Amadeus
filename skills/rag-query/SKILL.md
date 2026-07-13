# RAG Query

Retrieves relevant context from the workspace knowledge base (LightRAG).

## When to use

When the agent needs background knowledge about the workspace (architecture,
past decisions, how something was done before) that isn't in the immediate
file context.

## Steps

```bash
curl -s "${LIGHTRAG_URL:-http://lightrag:9621}/query" \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"$ARGUMENTS\", \"mode\": \"hybrid\"}" | jq -r '.response'
```

If LightRAG misses, tell the user no cached knowledge was found and proceed
with normal problem-solving.
