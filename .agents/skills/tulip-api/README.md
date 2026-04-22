# Tulip API Expert Skill

Expert knowledge skill for Tulip Insurance API integration. Provides Claude Code with complete business rules, workflows, error handling patterns, and technical specifications for the Tulip API.

## Overview

This skill makes AI agents experts in the Tulip Insurance API by providing:
- Complete API documentation from the docs site
- OpenAPI 3.x specification with all endpoints and schemas
- Business rules and eligibility constraints
- Integration patterns and error handling best practices
- Real-world examples and workflows

## Build Process

The skill is automatically built from the documentation source in `apps/docs/content/docs/`.

### Building the Skill

```bash
# From the skill directory
npm run build

# Or directly
bash scripts/build.sh
```

This will:
1. Copy all documentation files from `apps/docs/content/docs/`
2. Copy the OpenAPI specification from `apps/docs/content/openapi.json`
3. Generate the `llms.txt` index
4. Output the complete skill to `/Users/thibaudcanaud/__WORKSPACE__/__TULIP__/__DEV__/tulip-api-skills`

### Publishing to Skills.sh

```bash
npm run publish:skill
```

This will build the skill and publish it to the Skills.sh registry.

## Directory Structure

**Source** (this directory):
```
apps/docs/skills/tulip-api-expert/
├── SKILL.md              # Main skill instructions
├── package.json          # NPM package config
├── README.md            # This file
├── .gitignore           # Git ignore rules
├── references/          # Reference docs (synced from content/docs)
└── scripts/
    └── build.sh         # Build script
```

**Output** (build target):
```
/Users/thibaudcanaud/__WORKSPACE__/__TULIP__/__DEV__/tulip-api-skills/
├── SKILL.md
├── package.json
├── README.md
├── .gitignore
└── references/
    ├── concepts/
    ├── guides/
    ├── api-reference/
    ├── getting-started/
    ├── resources/
    ├── openapi.json
    └── llms.txt
```

## Maintenance

The skill stays synchronized with the documentation automatically through the build script. When docs are updated in `apps/docs/content/docs/`, run `npm run build` to update the skill.

### Automation

You can automate the build process by:
- Running the build script as part of the docs deployment pipeline
- Adding a pre-commit hook to rebuild on doc changes
- Setting up a CI/CD job to rebuild and publish on merge to main