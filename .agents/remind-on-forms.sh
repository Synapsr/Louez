#!/usr/bin/env bash
# PreToolUse hook — fires on Write/Edit when the target file is form-related.
# Detection: filename pattern (form/ dir, form- prefix, -form suffix) OR
# file content containing form markers (<form>, useAppForm, type="email", etc.).
# Invoked from .claude/settings.json and .codex/hooks.json.
set -u

input=$(cat)
file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ -z "$file_path" ] && exit 0

# Scope to TS/JS files only — forms don't live elsewhere.
if ! printf '%s' "$file_path" | grep -qE '\.(ts|tsx|js|jsx)$'; then
  exit 0
fi

match_filename() {
  printf '%s' "$file_path" | grep -qE '(/form/|/form-|-form\.[jt]sx?$)'
}

match_content() {
  local content
  content=$(printf '%s' "$input" | jq -r '[.tool_input.content // "", .tool_input.new_string // "", ((.tool_input.edits // []) | map(.new_string // "") | join("\n"))] | join("\n")' 2>/dev/null)
  [ -z "$content" ] && return 1
  printf '%s' "$content" | grep -qE '<form[[:space:]>]|useAppForm|form\.App(Form|Field)|<input[^>]*type="(email|password)"'
}

if match_filename || match_content; then
  cat <<'EOF'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"Form-related file detected (by filename or content). This project MUST use TanStack Form via useAppForm — see docs/from-scratch/05-frontend.md (Forms section). IMPORTANT: if you find existing files in the codebase using useState + manual validation for form logic (some dialog components do this), those are VIOLATIONS of the doc — do NOT follow that local convention, apply the documented pattern instead. Required: useAppForm, form.AppField + registered field components from hooks/form/form.tsx, revalidateLogic validation, Zod schemas (inline or in lib/validators/), form.SubscribeButton for submits, async operations wrapped in useMutation (never inline in onSubmit)."}}
EOF
fi
exit 0
