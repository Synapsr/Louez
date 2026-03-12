# Contributing to Louez

Thanks for your interest in contributing to Louez! Whether it's a bug fix, new feature, documentation improvement, or translation — every contribution matters.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [pnpm](https://pnpm.io/) v9+
- [Docker](https://www.docker.com/) (for MySQL)

### Local Setup

```bash
# Fork the repo on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/Louez.git
cd Louez

# Install dependencies
pnpm install

# Copy the example environment file
cp .env.example .env.local

# Start the database (MySQL via Docker)
docker-compose up db -d

# Push the schema to the database
pnpm db:push

# Start the dev server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and you're ready to go.

## Making Changes

1. **Create a branch** from `main`:

   ```bash
   git checkout -b fix/short-description
   ```

   Use prefixes: `fix/`, `feat/`, `docs/`, `refactor/`, `chore/`.

2. **Make your changes.** Keep commits focused — one logical change per commit.

3. **Test your changes** locally. Make sure the app builds:

   ```bash
   pnpm build
   ```

4. **Lint and format:**

   ```bash
   pnpm lint
   pnpm format
   ```

5. **Push and open a PR** against `main`:

   ```bash
   git push origin fix/short-description
   ```

## Pull Request Guidelines

- Keep PRs small and focused. One feature or fix per PR.
- Write a clear title and description explaining *what* and *why*.
- Link related issues (e.g., "Closes #42").
- Make sure the build passes before requesting review.

## What Can I Work On?

- **Good first issues**: Look for issues labeled [`good first issue`](https://github.com/Synapsr/Louez/labels/good%20first%20issue).
- **Bug reports**: Found a bug? [Open an issue](https://github.com/Synapsr/Louez/issues/new).
- **Feature ideas**: Start a [Discussion](https://github.com/Synapsr/Louez/discussions) first to align on the approach.
- **Translations**: Add or improve translations in `src/messages/`.
- **Documentation**: Improve the README, add guides, or clarify existing docs.

## Project Structure

```
Louez/
├── apps/web/           # Next.js application
│   ├── app/            # App Router pages
│   ├── components/     # React components
│   ├── lib/            # Utilities, DB schema, email templates
│   └── messages/       # i18n translation files
├── packages/           # Shared packages
├── docs/               # Documentation
└── docker/             # Docker configuration
```

## Code Style

- TypeScript everywhere.
- Tailwind CSS for styling (v4).
- Use existing shadcn/ui components before adding new ones.
- Follow the patterns you see in the codebase.

## Reporting Security Issues

Please do **not** open public issues for security vulnerabilities. Email [security@louez.io](mailto:security@louez.io) instead. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the [Apache 2.0 License](LICENSE).
