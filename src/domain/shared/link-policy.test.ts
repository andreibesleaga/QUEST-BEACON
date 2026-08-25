// BEACON — link-only URL policy tests (MW-D/D5; src/domain/shared/link-policy.ts).
import { describe, it, expect } from 'vitest';
import { InvariantViolation } from '../errors.js';
import { LINK_POLICY_MAX_LENGTH, assertLinkOnlyUrl, isLinkOnlyUrl } from './link-policy.js';

describe('isLinkOnlyUrl', () => {
  it('accepts an absolute https URL to a named host', () => {
    expect(isLinkOnlyUrl('https://emergency.copernicus.eu/mapping/list-of-components/EMSR773')).toBe(true);
    expect(isLinkOnlyUrl('https://example.org')).toBe(true);
  });

  it('rejects every non-https scheme (the href-injection guard)', () => {
    for (const raw of [
      'http://example.org',
      'javascript:alert(1)',
      'data:text/html;base64,PHN2Zz4=',
      'mailto:ops@example.org',
      'ftp://example.org/file',
      '//example.org/protocol-relative',
    ]) {
      expect(isLinkOnlyUrl(raw), raw).toBe(false);
    }
  });

  it('rejects IP-literal hosts (the SSRF / metadata pivot)', () => {
    expect(isLinkOnlyUrl('https://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isLinkOnlyUrl('https://127.0.0.1/admin')).toBe(false);
    expect(isLinkOnlyUrl('https://[::1]/admin')).toBe(false);
  });

  it('rejects a non-string, an empty string, and anything over the length cap', () => {
    expect(isLinkOnlyUrl(undefined)).toBe(false);
    expect(isLinkOnlyUrl(42)).toBe(false);
    expect(isLinkOnlyUrl('')).toBe(false);
    const overLong = `https://example.org/${'a'.repeat(LINK_POLICY_MAX_LENGTH)}`;
    expect(overLong.length).toBeGreaterThan(LINK_POLICY_MAX_LENGTH);
    expect(isLinkOnlyUrl(overLong)).toBe(false);
  });

  it('rejects an https-prefixed string the URL parser cannot parse', () => {
    // Starts with the right scheme, so only the PARSE step can catch it.
    expect(isLinkOnlyUrl('https://')).toBe(false);
  });
});

describe('assertLinkOnlyUrl', () => {
  it('passes a valid link through silently', () => {
    expect(() => {
      assertLinkOnlyUrl('https://example.org/product', 'Thing.url');
    }).not.toThrow();
  });

  it('throws an InvariantViolation naming the field and the offending value', () => {
    expect(() => {
      assertLinkOnlyUrl('http://example.org', 'Thing.url');
    }).toThrow(InvariantViolation);
    expect(() => {
      assertLinkOnlyUrl('http://example.org', 'Thing.url');
    }).toThrow(/Thing\.url must be an https:\/\/ URL.*http:\/\/example\.org/);
  });
});
