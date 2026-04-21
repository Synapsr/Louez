#!/usr/bin/env bash
# PreToolUse hook — fires on git commit (including chained commands).
# Invoked from .claude/settings.json and .codex/hooks.json. Matcher: Bash.
set -u

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
[ -z "$cmd" ] && exit 0

if printf '%s' "$cmd" | grep -qE '(^|&&|;|\|\|)[[:space:]]*git[[:space:]]+commit([[:space:]]|$)'; then
  cat <<'EOF'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"git commit detected. Walk docs/code-review/07-checklist.md against the staged diff before proceeding: identify which domains are touched (structure/TS/React/data/forms/styling/security) and verify the relevant sections. Fix violations first."}}
EOF
fi
exit 0
