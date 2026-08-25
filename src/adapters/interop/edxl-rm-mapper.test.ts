// BEACON — EDXL-RM mapper tests (E7·T-296/T-302/T-303). EDXL-RM validates against edxl-rm.schema.json and
// canonical→EDXL→canonical round-trips EXACTLY (correlation id, status, shelter, geo target preserved).
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { makeResourceTask } from '@/domain/resource-task.js';
import type { ResourceTask, ResourceTaskStatus } from '@/domain/resource-task.js';
import type { IncidentId, ResourceId, ResourceTaskId, ShelterId } from '@/domain/value-objects/ids.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { PolygonGeometry } from '@/domain/value-objects/geo.js';
import { resourceTaskToEdxlRm, edxlRmToResourceTask } from './edxl-rm-mapper.js';

const rmSchema = JSON.parse(readFileSync('schemas/edxl-rm.schema.json', 'utf8')) as object;
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateRm = ajv.compile(rmSchema);

const TARGET: PolygonGeometry = {
  type: 'Polygon',
  coordinates: [[[-118.3, 34.0], [-118.2, 34.0], [-118.2, 34.1], [-118.3, 34.1], [-118.3, 34.0]]],
};

function taskWith(status: ResourceTaskStatus): ResourceTask {
  return makeResourceTask({
    id: asId<ResourceTaskId>('task-1'),
    resourceId: asId<ResourceId>('res-engine-7'),
    incidentId: asId<IncidentId>('inc-1'),
    status,
    shelterId: asId<ShelterId>('shelter-9'),
    target: TARGET,
    edxlRmRef: 'urn:beacon:rm:corr-1',
  });
}

const SENT = '2026-07-05T14:30:00-07:00';

describe('resourceTaskToEdxlRm (T-296/T-303)', () => {
  it('produces an EDXL-RM message that validates against edxl-rm.schema.json', () => {
    const res = resourceTaskToEdxlRm(taskWith('PROPOSED'), { sentDateTime: SENT });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(validateRm(res.value)).toBe(true);
    expect(res.value.messageType).toBe('RequestResource');
    expect(res.value.originatingMessageID).toBe('urn:beacon:rm:corr-1');
    const info = res.value.contentObject[0]?.resourceInformation[0];
    expect(info?.resource.resourceStatus?.deploymentStatus).toBe('Requested');
  });

  it('marks a reply-type message (TASKED→CommitResource) with precedingMessageID', () => {
    const res = resourceTaskToEdxlRm(taskWith('TASKED'), { sentDateTime: SENT });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.messageType).toBe('CommitResource');
    expect(res.value.precedingMessageID).toBe('urn:beacon:rm:corr-1');
    expect(validateRm(res.value)).toBe(true);
  });
});

describe('EDXL-RM round-trip (T-302 — canonical→EDXL→canonical equals)', () => {
  const statuses: ResourceTaskStatus[] = ['PROPOSED', 'TASKED', 'ENROUTE', 'ONSCENE', 'CLEARED'];
  for (const status of statuses) {
    it(`round-trips a ${status} task exactly`, () => {
      const task = taskWith(status);
      const forward = resourceTaskToEdxlRm(task, { sentDateTime: SENT });
      expect(forward.ok).toBe(true);
      if (!forward.ok) return;
      const back = edxlRmToResourceTask(forward.value);
      expect(back.ok).toBe(true);
      if (!back.ok) return;
      expect(back.value).toEqual(task);
    });
  }

  it('round-trips a minimal task (no shelter/target) exactly', () => {
    const task = makeResourceTask({
      id: asId<ResourceTaskId>('task-min'),
      resourceId: asId<ResourceId>('res-1'),
      incidentId: asId<IncidentId>('inc-1'),
      status: 'PROPOSED',
      edxlRmRef: 'urn:beacon:rm:corr-min',
    });
    const forward = resourceTaskToEdxlRm(task, { sentDateTime: SENT });
    expect(forward.ok).toBe(true);
    if (!forward.ok) return;
    const back = edxlRmToResourceTask(forward.value);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.value).toEqual(task);
    expect('shelterId' in back.value).toBe(false);
    expect('target' in back.value).toBe(false);
  });
});

describe('edxlRmToResourceTask (inbound guards)', () => {
  it('rejects a message with no ResourceInformation', () => {
    const res = edxlRmToResourceTask({
      messageType: 'RequestResource',
      messageID: 'm1',
      sentDateTime: SENT,
      messageContentType: 'RequestResource',
      originatingMessageID: 'm1',
      contentObject: [{ resourceInformation: [] }],
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('PARSE_ERROR');
  });
});
