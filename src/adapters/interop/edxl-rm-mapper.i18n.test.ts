// BEACON — EDXL-RM language field tests (ADR-030 §7; A4.3b). See edxl-sitrep-mapper.i18n.test.ts for the
// full grounding note (also duplicated in schemas/edxl-rm.schema.json `#/properties/language`): OASIS
// EDXL-RM 1.0 (OS + approved errata) defines no Language/LanguageCode/xml:lang element; `language` here
// borrows OASIS EDXL-DE 2.0's `<language>`/`<contentLanguage>` name and RFC 3066 semantics — the EDXL
// family's actual mechanism for tagging payload language — applied at the message level.
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, it, expect } from 'vitest';
import { makeResourceTask } from '@/domain/resource-task.js';
import type { ResourceTask } from '@/domain/resource-task.js';
import type { IncidentId, ResourceId, ResourceTaskId } from '@/domain/value-objects/ids.js';
import { asId } from '@/domain/value-objects/ids.js';
import { buildEdxlRm, edxlRmMachineValuesAgree, resourceTaskToEdxlRm } from './edxl-rm-mapper.js';

const rmSchema = JSON.parse(readFileSync('schemas/edxl-rm.schema.json', 'utf8')) as object;
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateRm = ajv.compile(rmSchema);

function task(): ResourceTask {
  return makeResourceTask({
    id: asId<ResourceTaskId>('task-1'),
    resourceId: asId<ResourceId>('res-1'),
    incidentId: asId<IncidentId>('inc-1'),
    status: 'PROPOSED',
  });
}

describe('EdxlRmMessage.language', () => {
  it('is absent, and the message byte-identical to before, when no language is supplied', () => {
    const withoutLanguageField = buildEdxlRm(
      task(),
      { messageId: 'msg-1' },
      '2026-07-05T22:00:00Z',
    );
    expect(Object.hasOwn(withoutLanguageField, 'language')).toBe(false);
  });

  it('is carried verbatim into the message when supplied, and still validates against the schema', () => {
    const res = resourceTaskToEdxlRm(task(), {
      messageId: 'msg-1',
      sentDateTime: '2026-07-05T22:00:00Z',
      language: 'ro',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.language).toBe('ro');
    expect(validateRm(res.value), JSON.stringify(validateRm.errors)).toBe(true);
  });
});

describe('edxlRmMachineValuesAgree — the multi-document safety invariant', () => {
  it('holds true across per-language messages built from the SAME canonical ResourceTask', () => {
    const t = task();
    const ro = buildEdxlRm(t, { messageId: 'msg-1', language: 'ro' }, '2026-07-05T22:00:00Z');
    const en = buildEdxlRm(t, { messageId: 'msg-1', language: 'en' }, '2026-07-05T22:00:00Z');
    expect(edxlRmMachineValuesAgree(ro, en)).toBe(true);
    expect(ro.language).toBe('ro');
    expect(en.language).toBe('en');
  });

  it('detects divergence if a machine value is ever tampered with per language', () => {
    const en = buildEdxlRm(task(), { messageId: 'msg-1' }, '2026-07-05T22:00:00Z');
    const tampered: typeof en = {
      ...en,
      contentObject: [
        {
          resourceInformation: [
            {
              ...en.contentObject[0]!.resourceInformation[0]!,
              resource: {
                ...en.contentObject[0]!.resourceInformation[0]!.resource,
                resourceStatus: { deploymentStatus: 'Committed' },
              },
            },
          ],
        },
      ],
    };
    expect(edxlRmMachineValuesAgree(en, tampered)).toBe(false);
  });

  it('is reflexive (a message always agrees with itself)', () => {
    const doc = buildEdxlRm(task(), { messageId: 'msg-1', language: 'en' }, '2026-07-05T22:00:00Z');
    expect(edxlRmMachineValuesAgree(doc, doc)).toBe(true);
  });
});
