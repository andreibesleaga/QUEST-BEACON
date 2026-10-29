# AGENTS.md — BEACON

For coding agents. Read [`llms.txt`](llms.txt) first: it holds the project rules ("Absolute rules"),
the read-first order, the architecture map and the adapter pattern. This file adds only what an agent
needs before its first command, and points elsewhere for the rest.

## Commands

```bash
nvm use && npm ci                        # Node 24 (.nvmrc), lockfile-exact install
npm test                                 # vitest run, offline, no .env needed
npm run typecheck && npm run lint && npm run format:check && npm run boundaries
npm run test:coverage                    # the CI gate: coverage floors in vitest.config.ts + the front's tests
npm run build                            # next build
npx playwright install --with-deps chromium && npx playwright test   # browser gates (builds and starts the app)
npm run docs                             # OpenAPI contract test
npm run cli -- status --region us-ca     # the core over the CLI channel, offline seed
```

What each gate protects and what CI runs: `CONTRIBUTING.md` §2 and §7, `docs/DEVELOPER_HANDBOOK.md` §10.

## Rules

- The "Absolute rules" in `llms.txt` apply to every change; `CONTRIBUTING.md` has the Definition of
  Done and the commit convention. Coverage floors are never lowered; no new dependency without a
  recorded decision; never write a secret into a tracked file.
- Changing `.github/workflows/` needs the maintainer's approval (`CONTRIBUTING.md` §7).
- `agents/AGENTS.md` and `agents/CONSTITUTION.md`, named in `CONTRIBUTING.md` and older documents,
  are the maintainer's private governance files and are not in this repository.
- This repository is exported from the maintainer's private monorepo (`npm run export:public` there
  replaces every file here except `.git` and `.env`), so a change made only here is overwritten by the
  next export unless it is also made there.

## Where things are

- Code map, request and composition flows, debugging table, shortest paths for an agent:
  `docs/DEVELOPER_HANDBOOK.md` (§1, §3–§4, §6, §13).
- Architecture diagrams and the ADR index: `docs/architecture/C4_ARCHITECTURE.md`.
- The API: `docs/api/openapi.yaml`. Every variable: `docs/architecture/CONFIGURATION.md` and `.env.example`.
- What is not done: `docs/SPEC.md` §13 and `docs/audit/UNIMPLEMENTED_REGISTER.md`.
