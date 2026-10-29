# BEACON CLI channel (`beacon`)

A zero-extra-dependency **driving adapter** over the existing hexagonal core (ADR-023). It maps `argv`
onto the channel-agnostic `Command` set in `@/ports/interaction`, dispatches through the single
`InteractionPort` (via `buildInteraction`), and renders the **universal Envelope** — human-readable by
default, raw JSON with `--json`. It runs **fully offline/air-gapped** against the built-in demo seed
(`DEFAULT_SEED`: US `us-ca` + RO `ro`). **Zero core change** — this is the reference channel and the
primary e2e target.

## Running the CLI

The CLI is invoked through the `cli` npm script (which runs `bin.ts` with `tsx` — no build step, no
`dist/`):

```bash
npm run cli -- <command> [args…]
# e.g.
npm run cli -- status --region us-ca
```

Everything after `--` is forwarded verbatim to the binary. `bin.ts` is a thin wrapper: it calls
`run(process.argv.slice(2), {})`, writes stdout, and sets the exit code (0 on success, 1 on any
parse/domain error). All logic lives in `run.ts` / `parse-args.ts` / `render.ts`, so the binary stays
trivial and fully testable.

> **Roadmap — installable `beacon` binary.** Publishing a globally-installable `beacon` command (so
> `beacon status` works without `npm run cli --`) means adding a compiled build step and a
> `package.json#bin` entry pointing at the emitted JS, e.g. `"bin": { "beacon": "dist/adapters/channels/
> cli/bin.js" }`. The current repo is `noEmit` (tsx runs the TS directly), so this is a future packaging
> task, not wired today.

In the command reference below, `beacon <cmd>` is shorthand for `npm run cli -- <cmd>`.

## Commands

| Invocation | Golden-path step | Min role |
|---|---|---|
| `beacon status [--region <id>]` | monitor | PUBLIC |
| `beacon incidents [--region <id>]` | monitor | PUBLIC |
| `beacon sitrep <incidentId>` | assess (cited SitRep + citations) | PUBLIC |
| `beacon sources [--region <id>]` | monitor | PUBLIC |
| `beacon report --text "<t>" --consent [--lat <n> --lng <n>]` | intake (consent required) | PUBLIC |
| `beacon verify <reportId> <TRIAGED\|VERIFIED\|REJECTED>` | decide (HITL) | VERIFIER |
| `beacon alert:draft <incidentId> --headline "<h>"` | act (DRAFT only) | VERIFIER |

Global flags: `--role <PUBLIC\|RESPONDER\|VERIFIER\|EM>` (default `PUBLIC`, sets the RBAC rank the router
enforces), `--json` (print the raw Envelope instead of the human view).

### Examples

```bash
beacon status --region us-ca
beacon sitrep us-ca-wildfire-demo --json
beacon report --text "smoke rising over the ridge" --consent --lat 39.5 --lng -121.6
beacon verify rep-1 TRIAGED --role VERIFIER
beacon alert:draft ro-flood-demo --headline "Siret river rising" --role VERIFIER
```

With the default in-memory store, each `npm run cli` invocation builds a fresh core, so a report created
by one invocation is not there for the next; report ids are also `rep-<timestamp>-<n>`, so `verify rep-1`
from a shell answers `NOT_FOUND`. The `verify` example works when the CLI is driven in one process with a
shared `CliDeps.port` and a counter `newId`, as `cli-e2e.test.ts` does (`run.ts`).

## Guarantees (identical to the HTTP API — ADR-023 §guarantees)

- **Provenance + freshness** on every data response (F1); the human view always prints them.
- **Citations** (`field → sourceId`) on every `sitrep` (F2).
- **Deterministic truth** — numbers come from the core, never the LLM; offline the SitRep degrades to
  `aiMode: deterministic-only` (F7) yet stays cited.
- **HITL before public action (Art. XIII)** — `verify` requires a `VERIFIER`; `report` starts UNVERIFIED.

## Security: no emit surface (T-454, Art. XIII)

The command surface exposes **only `alert:draft`**. There is **no `alert:send` / `alert:emit`** verb —
sending an alert is a separate, authenticated approval step, and a DRAFT alert cannot reach
`AlertSinkPort.emit` at the type level. This adapter therefore **never wires an `AlertSinkPort`**. Any
`alert:send`-style input is an unknown command → a typed `PARSE_ERROR`, never an action.
