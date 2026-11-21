// BEACON — CAP v1.2 XML serialization tests (2026-11-21). These pin three rules read off the OASIS schema
// (CAP-v1.2.xsd): root namespace, element SEQUENCE, and the CAP dateTime form — plus value fidelity and
// escaping. They are NOT an XSD validation: no validator is a dependency, so a cardinality or enumeration
// error the types do not already prevent would pass here (docs/SPEC.md §7 has the manual check). The XML
// is read back with the same parser the inbound CAP adapters use, so "what we write" is compared with
// "what a consumer parses", not with a string we also wrote.
import { describe, expect, it } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import { makeAlert } from '@/domain/alert.js';
import type { AlertId, AppUserId, IncidentId } from '@/domain/value-objects/ids.js';
import { asId } from '@/domain/value-objects/ids.js';
import { alertToCap } from './cap-mapper.js';
import type { CapAlert } from './cap-mapper.js';
import { CAP_XML_MEDIA_TYPE, CAP_XML_NAMESPACE, capAlertToXml, toCapDateTime } from './cap-xml.js';

const FULL: CapAlert = {
  identifier: 'beacon-alert-1',
  sender: 'cap@beacon.example',
  sent: '2026-07-07T10:00:00.000Z',
  status: 'Actual',
  msgType: 'Update',
  scope: 'Public',
  code: ['profile:CAP-BEACON:1.0'],
  references: 'cap@beacon.example,beacon-alert-0,2026-07-07T09:00:00.000Z',
  info: [
    {
      language: 'en-US',
      category: ['Fire', 'Safety'],
      event: 'Wildfire',
      responseType: ['Evacuate', 'Monitor'],
      urgency: 'Immediate',
      severity: 'Severe',
      certainty: 'Observed',
      eventCode: [{ valueName: 'SAME', value: 'FRW' }],
      expires: '2026-07-07T16:00:00Z',
      senderName: 'County EOC <test> & partners',
      headline: 'Evacuate zone A',
      description: 'Fire is moving south; "leave now" applies to zone A.',
      instruction: 'Take Highway 50 east.',
      web: 'https://example.org/alert/1',
      parameter: [{ valueName: 'BEACON:trend', value: 'ESCALATING' }],
      area: [
        {
          areaDesc: 'Zone A',
          polygon: ['38.47,-120.14 38.34,-119.95 38.52,-119.74 38.47,-120.14'],
          circle: ['38.5,-120.0 5.0'],
          geocode: [{ valueName: 'FIPS6', value: '006017' }],
        },
      ],
    },
  ],
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  isArray: (name) =>
    [
      'info',
      'category',
      'responseType',
      'eventCode',
      'parameter',
      'area',
      'polygon',
      'circle',
      'geocode',
      'code',
    ].includes(name),
});

/** Element names of `parent`'s direct children, in document order. */
function childOrder(xml: string, parent: string): string[] {
  const open = xml.indexOf(`<${parent}`);
  const start = xml.indexOf('>', open) + 1;
  const end = xml.indexOf(`</${parent}>`, start);
  const names: string[] = [];
  let depth = 0;
  for (const m of xml.slice(start, end).matchAll(/<(\/?)([A-Za-z]+)[^>]*>/g)) {
    const closing = m[1] === '/';
    if (!closing && depth === 0) names.push(m[2] as string);
    depth += closing ? -1 : 1;
  }
  return names;
}

describe('toCapDateTime — the CAP dateTime form', () => {
  it('writes UTC as -00:00 (CAP forbids the Z designator) and drops fractional seconds', () => {
    expect(toCapDateTime('2026-07-07T10:00:00.000Z')).toBe('2026-07-07T10:00:00-00:00');
    expect(toCapDateTime('2026-07-07T10:00:00Z')).toBe('2026-07-07T10:00:00-00:00');
  });

  it('keeps a numeric offset as given', () => {
    expect(toCapDateTime('2026-06-27T14:30:00-07:00')).toBe('2026-06-27T14:30:00-07:00');
    expect(toCapDateTime('2026-06-27T14:30:00.250+03:00')).toBe('2026-06-27T14:30:00+03:00');
  });

  it('returns a non-instant unchanged rather than inventing a time', () => {
    expect(toCapDateTime('not a time')).toBe('not a time');
  });
});

describe('capAlertToXml — one document, a second serialization', () => {
  const xml = capAlertToXml(FULL);
  const doc = (parser.parse(xml) as { alert: Record<string, unknown> }).alert;
  const info = (doc.info as Record<string, unknown>[])[0] as Record<string, unknown>;

  it('is an XML document whose root is <alert> in the CAP 1.2 namespace', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<alert ')).toBe(true);
    expect(doc['@_xmlns']).toBe(CAP_XML_NAMESPACE);
    expect(CAP_XML_NAMESPACE).toBe('urn:oasis:names:tc:emergency:cap:1.2');
    expect(CAP_XML_MEDIA_TYPE).toBe('application/cap+xml');
  });

  it('writes the children of <alert>, <info> and <area> in the order the CAP schema declares', () => {
    expect(childOrder(xml, 'alert')).toEqual([
      'identifier',
      'sender',
      'sent',
      'status',
      'msgType',
      'scope',
      'code',
      'references',
      'info',
    ]);
    expect(childOrder(xml, 'info')).toEqual([
      'language',
      'category',
      'category',
      'event',
      'responseType',
      'responseType',
      'urgency',
      'severity',
      'certainty',
      'eventCode',
      'expires',
      'senderName',
      'headline',
      'description',
      'instruction',
      'web',
      'parameter',
      'area',
    ]);
    expect(childOrder(xml, 'area')).toEqual(['areaDesc', 'polygon', 'circle', 'geocode']);
  });

  it('carries every value of the JSON document, unchanged', () => {
    expect(doc.identifier).toBe(FULL.identifier);
    expect(doc.sender).toBe(FULL.sender);
    expect(doc.status).toBe('Actual');
    expect(doc.msgType).toBe('Update');
    expect(doc.scope).toBe('Public');
    expect(doc.code).toEqual(['profile:CAP-BEACON:1.0']);
    expect(info.category).toEqual(['Fire', 'Safety']);
    expect(info.responseType).toEqual(['Evacuate', 'Monitor']);
    expect(info.eventCode).toEqual([{ valueName: 'SAME', value: 'FRW' }]);
    expect(info.parameter).toEqual([{ valueName: 'BEACON:trend', value: 'ESCALATING' }]);
    const area = (info.area as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(area.areaDesc).toBe('Zone A');
    expect(area.polygon).toEqual(FULL.info[0]?.area?.[0]?.polygon);
    expect(area.circle).toEqual(['38.5,-120.0 5.0']);
    expect(area.geocode).toEqual([{ valueName: 'FIPS6', value: '006017' }]);
  });

  it('writes every instant in the CAP form, including the one inside <references>', () => {
    expect(doc.sent).toBe('2026-07-07T10:00:00-00:00');
    expect(info.expires).toBe('2026-07-07T16:00:00-00:00');
    expect(doc.references).toBe('cap@beacon.example,beacon-alert-0,2026-07-07T09:00:00-00:00');
    expect(xml).not.toMatch(/\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/);
  });

  it('escapes markup in free text, and a consumer reads the original back', () => {
    expect(xml).toContain('County EOC &lt;test&gt; &amp; partners');
    expect(info.senderName).toBe('County EOC <test> & partners');
    expect(info.description).toBe('Fire is moving south; "leave now" applies to zone A.');
  });

  it('writes no element for an absent member', () => {
    const minimal: CapAlert = {
      identifier: 'a',
      sender: 's@example.org',
      sent: '2026-07-07T10:00:00Z',
      status: 'Draft',
      msgType: 'Alert',
      scope: 'Public',
      info: [
        {
          category: ['Fire'],
          event: 'Wildfire',
          urgency: 'Unknown',
          severity: 'Unknown',
          certainty: 'Unknown',
        },
      ],
    };
    const out = capAlertToXml(minimal);
    expect(childOrder(out, 'alert')).toEqual([
      'identifier',
      'sender',
      'sent',
      'status',
      'msgType',
      'scope',
      'info',
    ]);
    expect(childOrder(out, 'info')).toEqual([
      'category',
      'event',
      'urgency',
      'severity',
      'certainty',
    ]);
  });

  it('is deterministic: the same document serializes to the same bytes', () => {
    expect(capAlertToXml(FULL)).toBe(xml);
  });
});

describe('capAlertToXml × alertToCap — the real mapper output serializes', () => {
  it('turns an approved alert into CAP XML with status Actual', () => {
    const approved = makeAlert({
      id: asId<AlertId>('alert-xml-1'),
      incidentId: asId<IncidentId>('inc-1'),
      capStatus: 'ACTUAL',
      category: 'Fire',
      severity: 'SEVERE',
      area: {
        type: 'Polygon',
        coordinates: [
          [
            [-118.3, 34.0],
            [-118.2, 34.0],
            [-118.2, 34.1],
            [-118.3, 34.0],
          ],
        ],
      },
      approvedBy: asId<AppUserId>('user-em-1'),
      sentAt: '2026-07-07T10:00:00.000Z',
    });
    const cap = alertToCap(approved, { event: 'Wildfire', responseType: ['Evacuate'] });
    if (!cap.ok) throw new Error(`expected a valid CAP document: ${cap.error.message}`);
    const xml = capAlertToXml(cap.value);
    const doc = (parser.parse(xml) as { alert: Record<string, unknown> }).alert;
    expect(doc.status).toBe('Actual');
    expect(doc.identifier).toBe(cap.value.identifier);
    expect(doc.sent).toBe('2026-07-07T10:00:00-00:00');
  });
});
