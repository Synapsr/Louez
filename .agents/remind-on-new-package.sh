#!/usr/bin/env bash
# PreToolUse hook — fires on Write when creating a new shared package.
# Invoked from .claude/settings.json and .codex/hooks.json.
set -u

input=$(cat)
file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ -z "$file_path" ] && exit 0

if printf '%s' "$file_path" | grep -qE 'packages/[^/]+/(package\.json|src/index\.ts)$'; then
  cat <<'EOF'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"New shared package file detected. Read docs/from-scratch/03-packages.md before proceeding. Confirm: @repo/ scope, proper package.json exports, shared tsconfig extension, src/index.ts as entry point. Check if a package already covers this concern before creating a new one."}}
EOF
fi
exit 0
