#!/usr/bin/env bash
# PreToolUse hook — fires on Write/Edit for auth, middleware/proxy, API route handlers.
# Invoked from .claude/settings.json and .codex/hooks.json.
set -u

input=$(cat)
file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ -z "$file_path" ] && exit 0

if printf '%s' "$file_path" | grep -qE '(^|/)(middleware|proxy)\.ts$|/app/api/.*/route\.ts$|/packages/auth/|/server/(middleware|proxy)/|/server/auth/'; then
  cat <<'EOF'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"Security-sensitive file detected (auth, middleware/proxy, or API route). Read docs/code-review/06-security.md before proceeding. Key rules: every route checks authentication AND resource-level authorization (Permix), Zod validation on all external input, no secrets in client bundles, rate limiting on auth/email endpoints, file uploads validated by MIME + extension + size."}}
EOF
fi
exit 0
