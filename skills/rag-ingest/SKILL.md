# RAG Ingest

Index workspace files into LightRAG for retrieval.

## When to use

When the user asks to "index this repo", "learn this codebase", or when
starting work on a new project for the first time.

## Steps

Index all text files in the current workspace (excluding node_modules, .git,
binary files):

```bash
find . -type f \( -name "*.ts" -o -name "*.js" -o -name "*.py" -o -name "*.md" \
  -o -name "*.json" -o -name "*.yaml" -o -name "*.yml" -o -name "*.toml" \
  -o -name "*.rs" -o -name "*.go" -o -name "*.java" \) \
  ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/dist/*" \
  ! -path "*/build/*" | head -500 | while read -r f; do
    curl -s "${LIGHTRAG_URL:-http://lightrag:9621}/documents/text" \
      -H "Content-Type: application/json" \
      -d "{\"text\": $(jq -Rs . < "$f"), \"metadata\": {\"path\": \"$f\"}}" > /dev/null
done
echo "Indexing complete."
```

ponytail: naive serial ingest, batch endpoint when throughput matters.
