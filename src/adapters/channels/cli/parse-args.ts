// BEACON — CLI argv → canonical Command parser (E10·T-453). A PURE function: it maps the `beacon`
// binary's native input (argv) onto the channel-agnostic `Command` set from @/ports/interaction — the
// single command surface every channel shares (ADR-023). No IO, no clock, no core: parsing only.
//
// SECURITY (T-454, Art. XIII): the command surface deliberately exposes ONLY `alert:draft`. There is NO
// `alert:send` / `alert:emit` verb here. Sending an alert is a separate, authenticated approval step —
// a DRAFT alert cannot reach AlertSinkPort.emit at the type level — so it is intentionally NOT a channel
// command. This adapter therefore never wires an AlertSinkPort.
import type { Result } from '@/domain/shared/result.js';
import { ok, err } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import { APP_USER_ROLES } from '@/domain/app-user.js';
import type { AppUserRole } from '@/domain/app-user.js';
import { asId } from '@/domain/value-objects/ids.js';
import type {
  RegionId,
  IncidentId,
  PublicReportId,
  AppUserId,
} from '@/domain/value-objects/ids.js';
import type { Position } from '@/domain/value-objects/geo.js';
import type {
  Command,
  StatusCommand,
  IncidentsCommand,
  SourcesCommand,
  ReportCommand,
  VerifyCommand,
} from '@/ports/interaction.js';

/** A fully-parsed CLI invocation: the canonical command + the RBAC role the router will enforce. */
export interface ParsedInvocation {
  readonly command: Command;
  readonly actorRole: AppUserRole;
}

// The CLI trusts the LOCAL operator (ADR-023 §security: CLI auth = local trust). The role (via --role)
// carries the RBAC rank the router enforces; this id is recorded for audit on the verify (decide) path.
const CLI_ACTOR_ID = asId<AppUserId>('cli-local-operator');

const DECISIONS = ['TRIAGED', 'VERIFIED', 'REJECTED'] as const;

type FlagValue = string | true;
type Flags = ReadonlyMap<string, FlagValue>;

/** Map argv → a canonical Command + role, or a typed PARSE_ERROR on anything unknown/malformed. */
export function parseArgs(argv: readonly string[]): Result<ParsedInvocation, DomainError> {
  const verb = argv[0];
  if (verb === undefined) return parseError('no command given');
  const { positionals, flags } = tokenize(argv.slice(1));
  const roleRes = resolveRole(flags);
  if (!roleRes.ok) return roleRes;
  const cmdRes = parseCommand(verb, positionals, flags);
  if (!cmdRes.ok) return cmdRes;
  return ok({ command: cmdRes.value, actorRole: roleRes.value });
}

function parseError(message: string): Result<never, DomainError> {
  return err(new DomainError('PARSE_ERROR', message));
}

/** Split trailing argv into positionals + flags. `--key value` → entry; bare `--flag` → boolean true. */
function tokenize(rest: readonly string[]): { positionals: string[]; flags: Map<string, FlagValue> } {
  const positionals: string[] = [];
  const flags = new Map<string, FlagValue>();
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i]!;
    if (!tok.startsWith('--')) {
      positionals.push(tok);
      continue;
    }
    const key = tok.slice(2);
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(key, next);
      i++;
    } else {
      flags.set(key, true);
    }
  }
  return { positionals, flags };
}

function resolveRole(flags: Flags): Result<AppUserRole, DomainError> {
  const raw = flags.get('role');
  if (raw === undefined) return ok('PUBLIC'); // least privilege by default
  if (raw === true) return parseError('--role requires a value');
  if ((APP_USER_ROLES as readonly string[]).includes(raw)) return ok(raw as AppUserRole);
  return parseError(`unknown role: ${raw} (expected ${APP_USER_ROLES.join('|')})`);
}

function parseCommand(
  verb: string,
  pos: readonly string[],
  flags: Flags,
): Result<Command, DomainError> {
  switch (verb) {
    case 'status':
      return ok(withRegion<StatusCommand>({ verb: 'status' }, flags));
    case 'incidents':
      return ok(withRegion<IncidentsCommand>({ verb: 'incidents' }, flags));
    case 'sources':
      return ok(withRegion<SourcesCommand>({ verb: 'sources' }, flags));
    case 'sitrep':
      return parseSitRep(pos);
    case 'report':
      return parseReport(flags);
    case 'verify':
      return parseVerify(pos);
    case 'alert:draft':
      return parseAlertDraft(pos, flags);
    // NOTE (T-454): no `alert:send`/`alert:emit` case exists by design — emit is a separate, authenticated step (Art. XIII).
    default:
      return parseError(`unknown command: ${verb}`);
  }
}

/** status/incidents/sources share one shape ({ verb, regionId? }); attach the optional --region. */
function withRegion<C extends { readonly verb: string }>(base: C, flags: Flags): C {
  const region = flagString(flags, 'region');
  return region ? { ...base, regionId: asId<RegionId>(region) } : base;
}

function parseSitRep(pos: readonly string[]): Result<Command, DomainError> {
  const incidentId = pos[0];
  if (incidentId === undefined) return parseError('sitrep requires <incidentId>');
  return ok({ verb: 'sitrep', incidentId: asId<IncidentId>(incidentId) });
}

/** intake — REQUIRES --consent (consent is a literal `true` precondition, EV4/Art. XIV). */
function parseReport(flags: Flags): Result<Command, DomainError> {
  const text = flagString(flags, 'text');
  if (text === undefined) return parseError('report requires --text "<t>"');
  const consent = flags.get('consent');
  if (consent !== true && consent !== 'true') {
    return parseError('report requires --consent (consent is mandatory before intake)');
  }
  const locRes = parseLocation(flags);
  if (!locRes.ok) return locRes;
  const command: ReportCommand = {
    verb: 'report',
    consent: true,
    text,
    ...(locRes.value ? { location: locRes.value } : {}),
  };
  return ok(command);
}

/** Optional precise location. --lat/--lng must appear together and be numeric; stored as [lon, lat]. */
function parseLocation(flags: Flags): Result<Position | undefined, DomainError> {
  const lat = flagString(flags, 'lat');
  const lng = flagString(flags, 'lng');
  if (lat === undefined && lng === undefined) return ok(undefined);
  if (lat === undefined || lng === undefined) {
    return parseError('--lat and --lng must be provided together');
  }
  const latN = Number(lat);
  const lngN = Number(lng);
  if (Number.isNaN(latN) || Number.isNaN(lngN)) return parseError('--lat/--lng must be numbers');
  return ok([lngN, latN] as Position); // RFC 7946 order: [lon, lat]
}

function parseVerify(pos: readonly string[]): Result<Command, DomainError> {
  const reportId = pos[0];
  const decision = pos[1];
  if (reportId === undefined || decision === undefined) {
    return parseError('verify requires <reportId> <TRIAGED|VERIFIED|REJECTED>');
  }
  if (!(DECISIONS as readonly string[]).includes(decision)) {
    return parseError(`invalid decision: ${decision} (expected ${DECISIONS.join('|')})`);
  }
  return ok({
    verb: 'verify',
    reportId: asId<PublicReportId>(reportId),
    decision: decision as VerifyCommand['decision'],
    actorId: CLI_ACTOR_ID,
  });
}

function parseAlertDraft(pos: readonly string[], flags: Flags): Result<Command, DomainError> {
  const incidentId = pos[0];
  if (incidentId === undefined) return parseError('alert:draft requires <incidentId>');
  const headline = flagString(flags, 'headline');
  if (headline === undefined) return parseError('alert:draft requires --headline "<h>"');
  return ok({ verb: 'alert:draft', incidentId: asId<IncidentId>(incidentId), headline });
}

/** A flag's string value, or undefined when absent or supplied as a bare boolean flag. */
function flagString(flags: Flags, key: string): string | undefined {
  const value = flags.get(key);
  return typeof value === 'string' ? value : undefined;
}
