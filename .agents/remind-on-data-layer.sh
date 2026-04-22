#!/usr/bin/env bash
# PreToolUse hook — fires on Write/Edit for data-layer files (schema, routes, queries, drizzle config).
# Invoked from .claude/settings.json and .codex/hooks.json.
set -u

input=$(cat)
file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ -z "$file_path" ] && exit 0

if printf '%s' "$file_path" | grep -qE '(schema\.[^/]+\.ts$|route\.[^/]+\.ts$|\.queries\.ts$|drizzle\.config\.ts$|/lib/queries/|/server/routes/|/packages/(api|database)/)'; then
  cat <<'EOF'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"Data layer file detected. Read docs/code-review/04-data-layer.md (Drizzle + oRPC + React Query rules) and docs/from-scratch/04-backend.md (full setup) before proceeding. Key rules: options factories (not wrapper hooks), .output() on every procedure, Zod input validation, transactions for multi-step writes."}}
EOF
fi
exit 0
