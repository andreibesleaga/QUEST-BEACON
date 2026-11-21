// BEACON — CAP v1.2 XML serialization (2026-11-21; ADR-010, Art. XIII). OASIS CAP v1.2 is an XML standard:
// the JSON document `alertToCap` builds and validates is BEACON's internal form of it, and this module
// writes the same document as the XML a CAP consumer (an alert hub, an aggregator, another agency's system)
// actually reads. One document, two serializations — nothing is decided here: every value comes from the
// already-validated `CapAlert`, so the XML can never say something the JSON did not.
//
// What this does NOT do: it sends nothing. There is still no IPAWS origination and no outbound CAP feed
// (IPAWS_ENABLED=off; SPEC §13) — the XML is returned to the approver with the JSON, for hand-off.
//
// What is guaranteed, and by what. The three rules below are read off the OASIS schema (CAP-v1.2.xsd,
// docs.oasis-open.org/emergency/cap/v1.2/) and are PINNED by cap-xml.test.ts. Full XSD validation is NOT
// part of the test suite: the schema is not vendored and no XSD validator is a dependency. It was run by
// hand on 2026-11-21 (libxml2 2.14) on three documents — a draft, an approved alert and a fully populated
// update — and all three validated; docs/SPEC.md §7 gives the two commands to repeat it.
//   * namespace `urn:oasis:names:tc:emergency:cap:1.2` on the root;
//   * child elements in the SEQUENCE the schema declares (an XSD sequence is ordered — a valid set of
//     elements in the wrong order is an invalid document);
//   * dateTime in the CAP form `YYYY-MM-DDThh:mm:ss±hh:mm` — the standard forbids the `Z` designator
//     (UTC is written `-00:00`) and the schema's pattern admits no fractional seconds.
//
// Writer: fast-xml-parser's XMLBuilder — already a runtime dependency (the inbound CAP/RSS adapters parse
// with it), so escaping is the library's, not hand-rolled.
import { XMLBuilder } from 'fast-xml-parser';
import type { CapAlert, CapArea, CapInfo, CapNamedValue } from './cap-mapper.js';

export const CAP_XML_NAMESPACE = 'urn:oasis:names:tc:emergency:cap:1.2';
/** The registered media type for a CAP document (RFC-registered `application/cap+xml`). */
export const CAP_XML_MEDIA_TYPE = 'application/cap+xml';

const ISO_INSTANT = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * An ISO-8601 instant in CAP's dateTime form. `Z` becomes `-00:00` and fractional seconds are dropped;
 * an instant that already carries a numeric offset keeps it. Anything that is not an instant is returned
 * unchanged — the document was validated before it reached here, and inventing a time would be worse
 * than showing the one we were given.
 */
export function toCapDateTime(iso: string): string {
  const m = ISO_INSTANT.exec(iso);
  if (m === null) return iso;
  const [, seconds, zone] = m;
  return `${seconds}${zone === 'Z' ? '-00:00' : zone}`;
}

/** `sender,identifier,sent` triplets, space-delimited — each `sent` in the same form the XML itself uses. */
function referencesXml(references: string): string {
  return references
    .split(/\s+/)
    .filter((triplet) => triplet !== '')
    .map((triplet) => {
      const parts = triplet.split(',');
      const sent = parts.pop();
      return sent === undefined ? triplet : [...parts, toCapDateTime(sent)].join(',');
    })
    .join(' ');
}

type XmlNode = Record<string, unknown>;

/** Drop absent members so the builder writes no empty element for them. Key order is preserved. */
function present(node: XmlNode): XmlNode {
  return Object.fromEntries(
    Object.entries(node).filter(
      ([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0),
    ),
  );
}

const namedValues = (values: readonly CapNamedValue[] | undefined): XmlNode[] | undefined =>
  values?.map((v) => ({ valueName: v.valueName, value: v.value }));

// Member order below IS the schema's sequence for <area>, <info> and <alert>. Do not sort.
function areaNode(area: CapArea): XmlNode {
  return present({
    areaDesc: area.areaDesc,
    polygon: area.polygon,
    circle: area.circle,
    geocode: namedValues(area.geocode),
  });
}

function infoNode(info: CapInfo): XmlNode {
  return present({
    language: info.language,
    category: info.category,
    event: info.event,
    responseType: info.responseType,
    urgency: info.urgency,
    severity: info.severity,
    certainty: info.certainty,
    eventCode: namedValues(info.eventCode),
    expires: info.expires === undefined ? undefined : toCapDateTime(info.expires),
    senderName: info.senderName,
    headline: info.headline,
    description: info.description,
    instruction: info.instruction,
    web: info.web,
    parameter: namedValues(info.parameter),
    area: info.area?.map(areaNode),
  });
}

function alertNode(cap: CapAlert): XmlNode {
  return present({
    '@_xmlns': CAP_XML_NAMESPACE,
    identifier: cap.identifier,
    sender: cap.sender,
    sent: toCapDateTime(cap.sent),
    status: cap.status,
    msgType: cap.msgType,
    scope: cap.scope,
    code: cap.code,
    references: cap.references === undefined ? undefined : referencesXml(cap.references),
    info: cap.info.map(infoNode),
  });
}

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  indentBy: '  ',
  processEntities: true,
  suppressEmptyNode: false,
});

/** The CAP v1.2 XML document for an already-validated CAP alert. Deterministic: same input, same bytes. */
export function capAlertToXml(cap: CapAlert): string {
  const body = builder.build({ alert: alertNode(cap) }) as string;
  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
}
