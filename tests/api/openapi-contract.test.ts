// BEACON — the OpenAPI document is well-formed and complete (`npm run docs`).
//
// Replaces the external `redocly lint` step with a zero-dependency contract check that runs in the
// same runner as everything else: the document parses, is OpenAPI 3.x, every operation carries an
// operationId, a summary, responses and the role extension the RBAC docs and the service-worker policy
// key on, every local `$ref` resolves, operationIds are unique, no operation is still marked planned,
// and the servers list keeps the documented local target. The redocly config stays in docs/api for
// anyone who has the tool; this test is the gate.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { load as parseYaml } from 'js-yaml';

const FILE = fileURLToPath(new URL('../../docs/api/openapi.yaml', import.meta.url));
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;
const ROLES = ['PUBLIC', 'RESPONDER', 'VERIFIER', 'EM'];

interface Operation {
  operationId?: string;
  summary?: string;
  responses?: Record<string, unknown>;
  'x-required-role'?: string;
  'x-status'?: string;
}
interface Doc {
  openapi: string;
  info: { title: string; version: string };
  servers?: { url: string }[];
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, unknown> };
}

const doc = parseYaml(readFileSync(FILE, 'utf8')) as Doc;

function operations(): { path: string; method: string; op: Operation }[] {
  const out: { path: string; method: string; op: Operation }[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of METHODS) {
      const op = item[method];
      if (typeof op === 'object' && op !== null) out.push({ path, method, op: op as Operation });
    }
  }
  return out;
}

function collectRefs(node: unknown, acc: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => collectRefs(n, acc));
  else if (typeof node === 'object' && node !== null) {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === '$ref' && typeof v === 'string') acc.push(v);
      else collectRefs(v, acc);
    }
  }
  return acc;
}

function resolves(ref: string): boolean {
  if (!ref.startsWith('#/')) return false;
  let node: unknown = doc;
  for (const seg of ref.slice(2).split('/')) {
    if (typeof node !== 'object' || node === null) return false;
    node = (node as Record<string, unknown>)[seg.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return node !== undefined;
}

describe('docs/api/openapi.yaml', () => {
  it('is an OpenAPI 3 document with the documented local server', () => {
    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.info.title.length).toBeGreaterThan(0);
    expect(doc.servers?.some((s) => s.url.includes('localhost:3000'))).toBe(true);
  });

  it('has the expected shape (paths, operations, schemas) — figures quoted in the README', () => {
    expect(Object.keys(doc.paths).length).toBeGreaterThanOrEqual(36);
    expect(operations().length).toBeGreaterThanOrEqual(39);
    expect(Object.keys(doc.components.schemas).length).toBeGreaterThanOrEqual(66);
  });

  it('every operation has an operationId, a summary and responses', () => {
    for (const { path, method, op } of operations()) {
      const where = `${method.toUpperCase()} ${path}`;
      expect(op.operationId, where).toMatch(/^[a-zA-Z][a-zA-Z0-9]*$/);
      expect((op.summary ?? '').length, where).toBeGreaterThan(0);
      expect(Object.keys(op.responses ?? {}).length, where).toBeGreaterThan(0);
    }
  });

  it('operationIds are unique', () => {
    const ids = operations().map((o) => o.op.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every operation but the liveness probe declares its minimum role', () => {
    for (const { path, method, op } of operations()) {
      if (path === '/health') continue;
      expect(ROLES, `${method.toUpperCase()} ${path}`).toContain(op['x-required-role']);
    }
  });

  it('nothing documented is still marked planned', () => {
    for (const { path, method, op } of operations()) {
      expect(op['x-status'], `${method.toUpperCase()} ${path}`).not.toBe('planned');
    }
  });

  it('every local $ref resolves', () => {
    const refs = collectRefs(doc);
    expect(refs.length).toBeGreaterThan(50);
    const dangling = refs.filter((r) => !resolves(r));
    expect(dangling).toEqual([]);
  });
});
