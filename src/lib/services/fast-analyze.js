/**
 * Fast-analyze service: first-read lookups on an IoC using free public APIs
 * that require no account or API key and accept direct browser calls (open
 * CORS). Providers verified in September 2026 — abuse.ch (ThreatFox,
 * MalwareBazaar) now requires an API key and urlscan.io does not send CORS
 * headers, so both stay "go further" deep links instead of live checks.
 *
 * Every check normalizes the provider payload into a small list of display
 * fields and never throws: failures surface as `{ status: 'error' }` results,
 * so the UI can degrade per provider.
 */

/**
 * @typedef {Object} FastCheckField
 * @property {string} label Field label.
 * @property {string} value Field value (plain text, may span several lines).
 * @property {'good' | 'warn' | 'bad'} [tone] Optional severity used for color.
 */

/**
 * @typedef {Object} FastCheckResult
 * @property {'ok' | 'empty' | 'error'} status Outcome of the check.
 * @property {string | null} summary    One-line takeaway shown under the title.
 * @property {FastCheckField[]} fields  Key facts extracted from the response.
 * @property {string | null} message    Human-readable detail for empty/error.
 */

/**
 * @typedef {Object} FastCheckDefinition
 * @property {string} id      Stable check identifier (used as list key).
 * @property {string} label   Check label displayed in the UI.
 * @property {string | null} toolId Catalog tool backing this check, if any.
 * @property {(value: string, options?: { signal?: AbortSignal }) => Promise<FastCheckResult>} run
 */

export class FastAnalyzerService {
  /** @type {typeof fetch} */
  #fetch;
  /** @type {number} */
  #timeoutMs;

  /**
   * @param {{ fetch?: typeof fetch, timeoutMs?: number }} [options]
   *   Inject a custom fetch for tests; defaults to the global one.
   */
  constructor(options = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMs = options.timeoutMs ?? 12000;
  }

  /**
   * Checks to run for an IoC type, in display order (fastest first).
   *
   * @param {'ip' | 'domain' | 'url' | 'file' | 'email' | 'username'} iocType
   * @returns {FastCheckDefinition[]}
   */
  getChecks(iocType) {
    switch (iocType) {
      case 'ip':
        return [
          this.#define('ip-intel', 'IP intelligence (geo, ASN, hosting)', 'ipapi-is', (value, options) =>
            this.#ipIntel(value, options),
          ),
          this.#define('ip-rdap', 'Network registration (RDAP)', null, (value, options) =>
            this.#rdapIp(value, options),
          ),
        ];
      case 'domain':
        return [
          this.#define('domain-rdap', 'Registration & registrar (RDAP)', null, (value, options) =>
            this.#rdapDomain(value, options),
          ),
          this.#define('domain-certs', 'TLS certificates (crt.sh)', 'crtsh', (value, options) =>
            this.#crtsh(value, options),
          ),
        ];
      case 'url':
        return [
          this.#define('url-rdap', 'Registration of the URL hostname (RDAP)', null, (value, options) =>
            this.#rdapDomain(requireHost(value), options),
          ),
          this.#define('url-certs', 'TLS certificates of the hostname (crt.sh)', 'crtsh', (value, options) =>
            this.#crtsh(requireHost(value), options),
          ),
        ];
      case 'email':
        return [
          this.#define('email-rdap', 'Registration of the email domain (RDAP)', null, (value, options) =>
            this.#rdapDomain(requireEmailDomain(value), options),
          ),
        ];
      default:
        // No free unauthenticated API is reachable from the browser for file
        // hashes and usernames — the UI falls back to "go further" links.
        return [];
    }
  }

  /**
   * Wraps an implementation so failures become `{ status: 'error' }` results
   * instead of rejections — the UI then degrades per check.
   *
   * @param {string} id
   * @param {string} label
   * @param {string | null} toolId
   * @param {(value: string, options?: { signal?: AbortSignal }) => Promise<FastCheckResult>} implementation
   * @returns {FastCheckDefinition}
   */
  #define(id, label, toolId, implementation) {
    return {
      id,
      label,
      toolId,
      run: async (value, options = {}) => {
        try {
          return await implementation(value, options);
        } catch (error) {
          return {
            status: 'error',
            summary: null,
            fields: [],
            message: describeError(error),
          };
        }
      },
    };
  }

  /**
   * JSON GET with a hard timeout combined with an optional external signal.
   *
   * @param {string} url
   * @param {{ timeoutMs?: number, headers?: Record<string, string>, signal?: AbortSignal }} [options]
   * @returns {Promise<any>} Parsed JSON body.
   */
  async #fetchJson(url, options = {}) {
    const { timeoutMs = this.#timeoutMs, headers, signal } = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), timeoutMs);
    const onExternalAbort = () => controller.abort();
    signal?.addEventListener('abort', onExternalAbort, { once: true });
    try {
      const response = await this.#fetch(url, { signal: controller.signal, headers });
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('HTTP 404 — not found');
        }
        if (response.status === 403) {
          throw new Error('HTTP 403 — blocked by the provider');
        }
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  /**
   * IP intelligence: ipapi.is (a catalog tool with a free keyless API), with
   * ipwho.is as a silent fallback when the primary provider is unreachable.
   *
   * @param {string} value
   * @param {{ signal?: AbortSignal, headers?: Record<string, string> }} [options]
   * @returns {Promise<FastCheckResult>}
   */
  async #ipIntel(value, options = {}) {
    const ip = value.trim();
    /** @type {any} */
    let data;
    try {
      data = await this.#fetchJson(`https://api.ipapi.is/?q=${encodeURIComponent(ip)}`, options);
    } catch {
      data = await this.#fetchJson(`https://ipwho.is/${encodeURIComponent(ip)}`, options);
    }
    if (!data || data.success === false) {
      return emptyResult('No data returned for this IP.');
    }
    /** @type {FastCheckField[]} */
    const fields = [];
    const company = data.company ?? data.connection?.org ?? data.connection?.isp;
    const asn =
      typeof data.asn === 'string' && data.asn !== ''
        ? data.asn
        : data.connection?.asn
          ? `AS${data.connection.asn}`
          : null;
    const location = [data.city, data.region, data.country?.name ?? data.country]
      .filter((part) => typeof part === 'string' && part !== '')
      .join(', ');
    if (company) {
      fields.push({ label: 'Company', value: String(company) });
    }
    if (asn) {
      fields.push({ label: 'ASN', value: String(asn) });
    }
    if (location) {
      fields.push({ label: 'Location', value: location });
    }
    // Risk flags are only shown when the provider flags them as true.
    const flags = /** @type {const} */ ([
      ['is_bogon', 'Bogon / reserved range', 'warn'],
      ['is_datacenter', 'Datacenter / hosting range', 'warn'],
      ['is_crawler', 'Crawler / bot', 'warn'],
      ['is_tor', 'Tor exit node', 'bad'],
      ['is_abuser', 'Reported for abuse', 'bad'],
    ]);
    for (const [key, label, tone] of flags) {
      if (data[key] === true) {
        fields.push({ label, value: 'Yes', tone });
      }
    }
    const summary = [company, location].filter(Boolean).join(' · ') || null;
    return { status: 'ok', summary, fields, message: null };
  }

  /**
   * Registration data for an IP network via RDAP (rdap.org redirects to the
   * responsible RIR; both ends send open CORS headers).
   *
   * @param {string} value
   * @param {{ signal?: AbortSignal, headers?: Record<string, string> }} [options]
   * @returns {Promise<FastCheckResult>}
   */
  async #rdapIp(value, options = {}) {
    const ip = value.trim();
    const data = await this.#fetchJson(`https://rdap.org/ip/${encodeURIComponent(ip)}`, {
      ...options,
      headers: { Accept: 'application/rdap+json, application/json', ...options.headers },
    });
    /** @type {FastCheckField[]} */
    const fields = [];
    if (data?.name) {
      fields.push({ label: 'Network', value: String(data.name) });
    }
    if (data?.startAddress && data?.endAddress) {
      fields.push({ label: 'Range', value: `${data.startAddress} — ${data.endAddress}` });
    }
    if (data?.country) {
      fields.push({ label: 'Country', value: String(data.country) });
    }
    if (data?.type) {
      fields.push({ label: 'Type', value: String(data.type) });
    }
    const registrant = entityName(data, 'registrant');
    if (registrant) {
      fields.push({ label: 'Registrant', value: registrant });
    }
    if (fields.length === 0) {
      return emptyResult('RDAP returned no usable data for this IP.');
    }
    return { status: 'ok', summary: data?.name ? String(data.name) : null, fields, message: null };
  }

  /**
   * Domain registration data via RDAP: registrar, creation / expiration dates,
   * lock statuses and nameservers.
   *
   * @param {string} value
   * @param {{ signal?: AbortSignal, headers?: Record<string, string> }} [options]
   * @returns {Promise<FastCheckResult>}
   */
  async #rdapDomain(value, options = {}) {
    const domain = bareDomain(value);
    const data = await this.#fetchJson(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      ...options,
      headers: { Accept: 'application/rdap+json, application/json', ...options.headers },
    });
    /** @type {FastCheckField[]} */
    const fields = [];
    const registrar = entityName(data, 'registrar');
    if (registrar) {
      fields.push({ label: 'Registrar', value: registrar });
    }
    const created = formatDate(eventDate(data, 'registration'));
    const updated = formatDate(eventDate(data, 'last changed'));
    const expires = formatDate(eventDate(data, 'expiration'));
    if (created) {
      fields.push({ label: 'Created', value: created });
    }
    if (updated) {
      fields.push({ label: 'Updated', value: updated });
    }
    if (expires) {
      fields.push({ label: 'Expires', value: expires });
    }
    if (Array.isArray(data?.status) && data.status.length > 0) {
      fields.push({ label: 'Status', value: data.status.join(', ') });
    }
    const nameservers = (data?.nameservers ?? [])
      .map((/** @type {any} */ ns) => (typeof ns?.ldhName === 'string' ? ns.ldhName.toLowerCase() : null))
      .filter(Boolean);
    if (nameservers.length > 0) {
      fields.push({ label: 'Nameservers', value: nameservers.join(', ') });
    }
    if (fields.length === 0) {
      return emptyResult('RDAP returned no usable data for this domain (some TLDs do not publish it).');
    }
    return {
      status: 'ok',
      summary: registrar ? `Registered via ${registrar}` : null,
      fields,
      message: null,
    };
  }

  /**
   * Certificate transparency lookup on crt.sh (a catalog tool with a free
   * keyless JSON endpoint and open CORS): reveals subdomains and issuers.
   * crt.sh can be slow under load, hence the generous timeout.
   *
   * @param {string} value
   * @param {{ signal?: AbortSignal, headers?: Record<string, string> }} [options]
   * @returns {Promise<FastCheckResult>}
   */
  async #crtsh(value, options = {}) {
    const domain = bareDomain(value);
    const entries = await this.#fetchJson(
      `https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`,
      {
        timeoutMs: Math.max(this.#timeoutMs, 20000),
        ...options,
        headers: { Accept: 'application/json', ...options.headers },
      },
    );
    if (!Array.isArray(entries) || entries.length === 0) {
      return emptyResult('No certificate found for this domain in the CT logs.');
    }
    /** @type {string[]} */
    const names = [];
    /** @type {string[]} */
    const issuers = [];
    /** @type {string | null} */
    let latestIssued = null;
    // crt.sh can return thousands of rows for busy domains: sample the head.
    for (const entry of entries.slice(0, 400)) {
      for (const raw of String(entry?.name_value ?? '').split('\n')) {
        const name = raw.trim().replace(/^\*\./, '').toLowerCase();
        // crt.sh also indexes S/MIME certificates whose SAN is an email address.
        if (name && !name.includes('@') && !names.includes(name)) {
          names.push(name);
        }
      }
      const issuer = typeof entry?.issuer_name === 'string' ? entry.issuer_name : null;
      if (issuer && !issuers.includes(issuer)) {
        issuers.push(issuer);
      }
      const notBefore = typeof entry?.not_before === 'string' ? entry.not_before.slice(0, 10) : null;
      if (notBefore && (!latestIssued || notBefore > latestIssued)) {
        latestIssued = notBefore;
      }
    }
    /** @type {FastCheckField[]} */
    const fields = [{ label: 'Certificates', value: String(entries.length) }];
    if (latestIssued) {
      fields.push({ label: 'Latest issued', value: latestIssued });
    }
    if (names.length > 0) {
      fields.push({ label: 'Sample names', value: names.slice(0, 8).join('\n') });
    }
    if (issuers.length > 0) {
      fields.push({ label: 'Issuers seen', value: issuers.slice(0, 2).join(' · ') });
    }
    return {
      status: 'ok',
      summary: `${entries.length} certificate entries · latest issued ${latestIssued ?? 'unknown'}`,
      fields,
      message: null,
    };
  }
}

/**
 * @returns {FastCheckResult}
 */
function emptyResult(message) {
  return { status: 'empty', summary: null, fields: [], message };
}

/**
 * Maps thrown errors to short, UI-friendly sentences.
 *
 * @param {unknown} error
 * @returns {string}
 */
function describeError(error) {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return 'The provider did not answer in time.';
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'Cancelled.';
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'Failed to fetch') {
    return 'Unreachable from the browser (network or CORS restriction).';
  }
  return message || 'Unexpected failure.';
}

/**
 * Registrar / registrant human name out of an RDAP entity vcard.
 *
 * @param {any} data
 * @param {string} role
 * @returns {string | null}
 */
function entityName(data, role) {
  const entity = (data?.entities ?? []).find((/** @type {any} */ candidate) =>
    (candidate?.roles ?? []).includes(role),
  );
  const vcard = entity?.vcardArray?.[1];
  if (Array.isArray(vcard)) {
    const fn = vcard.find((/** @type {any[]} */ item) => item[0] === 'fn');
    if (typeof fn?.[3] === 'string' && fn[3] !== '') {
      return fn[3];
    }
  }
  return typeof entity?.handle === 'string' && entity.handle !== '' ? entity.handle : null;
}

/**
 * @param {any} data
 * @param {string} action
 * @returns {string | null}
 */
function eventDate(data, action) {
  const event = (data?.events ?? []).find((/** @type {any} */ candidate) => candidate?.eventAction === action);
  return typeof event?.eventDate === 'string' ? event.eventDate : null;
}

/** @param {string | null} isoDate @returns {string | null} */
function formatDate(isoDate) {
  return isoDate ? isoDate.slice(0, 10) : null;
}

/**
 * Strips scheme / path / port from user input to keep a bare domain.
 *
 * @param {string} value
 * @returns {string}
 */
function bareDomain(value) {
  const trimmed = value.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || trimmed.includes('/')) {
    return requireHost(trimmed);
  }
  return trimmed.toLowerCase();
}

/**
 * Extracts a hostname from a URL typed with or without a scheme; throws a
 * friendly error when no plausible hostname can be read.
 *
 * @param {string} value
 * @returns {string}
 */
function requireHost(value) {
  const trimmed = value.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let hostname;
  try {
    hostname = new URL(withScheme).hostname;
  } catch {
    throw new Error('Could not read a hostname from this URL.');
  }
  if (!hostname || !hostname.includes('.')) {
    throw new Error('Could not read a hostname from this URL.');
  }
  return hostname.toLowerCase();
}

/**
 * Extracts the domain part of an email address.
 *
 * @param {string} value
 * @returns {string}
 */
function requireEmailDomain(value) {
  const domain = value.trim().split('@').pop() ?? '';
  if (!domain.includes('.')) {
    throw new Error('Could not read a domain from this email address.');
  }
  return domain.toLowerCase();
}
