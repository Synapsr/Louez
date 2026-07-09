#!/usr/bin/env bash
# SessionStart hook — routes to a model-specific instructions file.
#
# The SessionStart payload is the ONLY hook input that carries the active model
# (field `.model`, e.g. "claude-fable-5", "claude-opus-4-8[1m]"). We map it to a
# short family name and, if CLAUDE.<name>.md exists at the repo root, inject it
# as additionalContext so the running model loads its own instructions.
#
# The `.model` field is optional and Codex never sends it, so a missing/unknown
# model simply exits 0 (no-op). Invoked from .claude/settings.json.
set -u

input=$(cat)

model=$(printf '%s' "$input" | jq -r '.model // empty' 2>/dev/null)
[ -z "$model" ] && exit 0

case "$model" in
  *fable*)  name=fable ;;
  *opus*)   name=opus ;;
  *sonnet*) name=sonnet ;;
  *haiku*)  name=haiku ;;
  *) exit 0 ;;
esac

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
file="$root/CLAUDE.$name.md"
[ -f "$file" ] || exit 0

jq -n --arg model "$model" --arg src "CLAUDE.$name.md" --rawfile body "$file" \
  '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:("Model-specific instructions for \($model) (loaded from \($src)) — follow these in addition to AGENTS.md; on any conflict, the model-specific file wins.\n\n---\n\n" + $body)}}'

exit 0
