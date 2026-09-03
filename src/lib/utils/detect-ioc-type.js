/**
 * Lightweight IoC-type detection over free-form query text, used to pre-apply
 * the matching IoC-type filter as the user types.
 *
 * Checks run from the most specific shape to the least specific one; the
 * returned identifiers match the catalog's `iocTypes` definitions.
 *
 * @param {string} query Raw user input.
 * @returns {'ip' | 'domain' | 'url' | 'file' | 'email' | null} The detected
 *   IoC type id, or null when the query is not recognizable as an IoC.
 */
export function detectIocType(query) {
  const value = query.trim();
  if (value === '') {
    return null;
  }

  // URL with an explicit scheme.
  if (/^https?:\/\/\S+$/i.test(value)) {
    return 'url';
  }

  // Bare domain followed by a path (evil.com/login).
  if (/^[a-z0-9.-]+\.[a-z]{2,}\/\S*$/i.test(value)) {
    return 'url';
  }

  // Email address: local@domain.tld without spaces.
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(value)) {
    return 'email';
  }

  // IPv4: four dot-separated octets, each in the 0-255 range.
  const ipv4Match = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match && ipv4Match.slice(1).every((octet) => Number(octet) <= 255)) {
    return 'ip';
  }

  // IPv6 (pragmatic): hex groups separated by colons, with a double colon or
  // the full eight groups.
  const colonCount = (value.match(/:/g) ?? []).length;
  if (/^[0-9a-f:]+$/i.test(value) && (value.includes('::') || colonCount === 7)) {
    return 'ip';
  }

  // File hashes: MD5 (32), SHA-1 (40) and SHA-256 (64) hex digests.
  if (
    /^[a-f0-9]{32}$/i.test(value) ||
    /^[a-f0-9]{40}$/i.test(value) ||
    /^[a-f0-9]{64}$/i.test(value)
  ) {
    return 'file';
  }

  // Domain: dotted labels ending with an alphabetic TLD (at least 2 letters).
  if (/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(value)) {
    return 'domain';
  }

  return null;
}
