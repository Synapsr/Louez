#!/usr/bin/env bash
# SessionStart hook — fires on every new Claude Code / Codex session.
# Invoked from .claude/settings.local.json and .codex/hooks.json.
cat <<'EOF'
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Reminder: classify the task mode (from-scratch / migration / development) before writing code. See AGENTS.md Step 1. State the mode explicitly at the start of your first response."}}
EOF
exit 0
