#!/usr/bin/env bash
# PreToolUse hook — fires on Write for any new TS/JS file.
# Invoked from .claude/settings.local.json and .codex/hooks.json.
set -u

input=$(cat)
file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ -z "$file_path" ] && exit 0

if printf '%s' "$file_path" | grep -qE '\.(ts|tsx|js|jsx)$'; then
  cat <<'EOF'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"Creating a new TS/JS file. Verify against docs/code-review/01-structure.md: kebab-case filename, use-* for hooks, util.* for utils, correct domain folder (components/<domain>/, hooks/, lib/queries/, lib/stores/, lib/validators/)."}}
EOF
fi
exit 0
