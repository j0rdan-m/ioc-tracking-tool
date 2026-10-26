import { createProviderRawResponse } from '../utils/provider-response.js';

class ProviderResponseError extends Error {
  constructor(message, raw) {
    super(message);
    this.name = 'ProviderResponseError';
    this.raw = raw;
  }
}

/**
 * @typedef {Object} FastCheckField
 * @property {string} label Field label.
 * @property {string} value Field value (plain text, may span several lines).
 * @property {'good' | 'warn' | 'bad'} [tone] Optional severity used for color.
 */

/**
 * @typedef {Object} FastCheckResult
 * @property {'ok' | 'empty' | 'error'} status Outcome of the check.
 * @property {string | null} summary One-line takeaway shown under the title.
 * @property {FastCheckField[]} fields Key facts extracted from the response.
 * @property {string | null} message Human-readable detail for empty/error.
 * @property {import('../types.js').ProviderRawResponse | null} raw Bounded raw response, when available.
 */

/**
 * @typedef {Object} FastCheckDefinition
 * @property {string} id Stable check identifier (used as list key).
 * @property {string} label Check label displayed in the UI.
 * @property {string | null} toolId Catalog tool backing this check, if any.
 * @property {(value: string, options?: { signal?: AbortSignal }) => Promise<FastCheckResult>} run
 */

export class FastAnalyzerService {
  /** @type {typeof fetch} */
  fetch;
  /** @type {number} */
  timeoutMs;

  constructor(options = {}) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 12000;
  }

  getChecks(iocType) {
    switch (iocType) {
      case 'ip':
        return [
          this.define('ip-intel', 'IP intelligence (geo, ASN, hosting)', 'ipapi-is', (value, options) =>
            this.ipIntel(value, options),
          ),
          this.define('ip-rdap', 'Network registration (RDAP)', null, (value, options) =>
            this.rdapIp(value, options),
          ),
        ];
      case 'domain':
        return [
          this.define('domain-rdap', 'Registration & registrar (RDAP)', null, (value, options) =>
            this.rdapDomain(value, options),
          ),
          this.define('domain-certs', 'TLS certificates (crt.sh)', 'crtsh', async (value, options) => {
            const domain = this.bareDomain(value);
            return this.crtsh(domain, options);
          }),
        ];
      case 'url':
        return [
          this.define('url-rdap', 'Registration of the URL hostname (RDAP)', null, (value, options) =>
            this.rdapDomain(this.bareDomain(value), options),
          ),
          this.define('url-certs', 'TLS certificates of the hostname (crt.sh)', 'crtsh', async (value, options) => {
            const domain = this.bareDomain(value);
            return this.crtsh(domain, options);
          }),
        ];
      case 'email':
        return [
          this.define('email-rdap', 'Registration of the email domain (RDAP)', null, (value, options) =>
            this.rdapDomain(this.requireEmailDomain(value), options),
          ),
        ];
      default:
        return [];
    }
  }

  define(id, label, toolId, implementation) {
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
            message: this.describeError(error),
            raw: error instanceof ProviderResponseError ? error.raw : null,
          };
        }
      },
    };
  }

  async fetchJson(url, options = {}) {
    const { timeoutMs = this.timeoutMs, headers, signal } = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), timeoutMs);
    const onExternalAbort = () => controller.abort();
    signal?.addEventListener('abort', onExternalAbort, { once: true });
    try {
      const response = await this.fetch(url, { signal: controller.signal, headers });
      const body = typeof response.text === 'function'
        ? await response.text()
        : JSON.stringify(await response.json());
      const raw = createProviderRawResponse({
        url,
        status: response.status,
        contentType: response.headers?.get?.('content-type') ?? null,
        body,
      });
      if (!response.ok) {
        const message = response.status === 404
          ? 'HTTP 404 — not found'
          : response.status === 403
            ? 'HTTP 403 — blocked by the provider'
            : `HTTP ${response.status}`;
        throw new ProviderResponseError(message, raw);
      }
      let data;
      try {
        data = JSON.parse(body);
      } catch {
        throw new ProviderResponseError('The provider returned invalid JSON.', raw);
      }
      return { data, raw };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  async ipIntel(value, options = {}) {
    const ip = value.trim();
    let payload;
    try {
      payload = await this.fetchJson(`https://api.ipapi.is/?q=${encodeURIComponent(ip)}`, options);
    } catch {
      payload = await this.fetchJson(`https://ipwho.is/${encodeURIComponent(ip)}`, options);
    }
    const { data, raw } = payload;
    if (!data || data.success === false) {
      return { status: 'empty', summary: null, fields: [], message: 'No data returned for this IP.', raw };
    }
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
    const flags = [
      ['is_bogon', 'Bogon / reserved range', 'warn'],
      ['is_datacenter', 'Datacenter / hosting range', 'warn'],
      ['is_crawler', 'Crawler / bot', 'warn'],
      ['is_proxy', 'Proxy exit node', 'warn'],
      ['is_vpn', 'VPN exit node', 'warn'],
      ['is_tor', 'Tor exit node', 'bad'],
      ['is_abuser', 'Reported for abuse', 'bad'],
    ];
    for (const [key, label, tone] of flags) {
      if (data[key] === true) {
        fields.push({ label, value: 'Yes', tone });
      }
    }
    const summary = [company, location].filter(Boolean).join(' · ') || null;
    return { status: 'ok', summary, fields, message: null, raw };
  }

  async rdapIp(value, options = {}) {
    const ip = value.trim();
    const { data, raw } = await this.fetchJson(`https://rdap.org/ip/${encodeURIComponent(ip)}`, {
      ...options,
      headers: { Accept: 'application/rdap+json, application/json', ...options.headers },
    });
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
    const registrant = this.entityName(data, 'registrant');
    if (registrant) {
      fields.push({ label: 'Registrant', value: registrant });
    }
    if (fields.length === 0) {
      return { status: 'empty', summary: null, fields: [], message: 'RDAP returned no usable data for this IP.', raw };
    }
    return { status: 'ok', summary: data?.name ? String(data.name) : null, fields, message: null, raw };
  }

  async rdapDomain(value, options = {}) {
    const domain = this.bareDomain(value);
    const { data, raw } = await this.fetchJson(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      ...options,
      headers: { Accept: 'application/rdap+json, application/json', ...options.headers },
    });
    const fields = [];
    const registrar = this.entityName(data, 'registrar');
    if (registrar) {
      fields.push({ label: 'Registrar', value: registrar });
    }
    const created = this.formatDate(this.eventDate(data, 'registration'));
    const updated = this.formatDate(this.eventDate(data, 'last changed'));
    const expires = this.formatDate(this.eventDate(data, 'expiration'));
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
      return { status: 'empty', summary: null, fields: [], message: 'RDAP returned no usable data for this domain (some TLDs do not publish it).', raw };
    }
    return {
      status: 'ok',
      summary: registrar ? `Registered via ${registrar}` : null,
      fields,
      message: null,
      raw,
    };
  }

  entityName(data, role) {
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

  eventDate(data, action) {
    const event = (data?.events ?? []).find((/** @type {any} */ candidate) => candidate?.eventAction === action);
    return typeof event?.eventDate === 'string' ? event.eventDate : null;
  }

  formatDate(isoDate) {
    return isoDate ? isoDate.slice(0, 10) : null;
  }

  bareDomain(value) {
    const trimmed = value.trim();
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || trimmed.includes('/')) {
      return this.requireHost(trimmed);
    }
    return trimmed.toLowerCase();
  }

  requireHost(value) {
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

  requireEmailDomain(value) {
    const domain = value.trim().split('@').pop() ?? '';
    if (!domain.includes('.')) {
      throw new Error('Could not read a domain from this email address.');
    }
    return domain.toLowerCase();
  }

  async crtsh(value, options = {}) {
    const domain = this.bareDomain(value);
    const { data: entries, raw } = await this.fetchJson(
      `https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`,
      {
        timeoutMs: Math.max(this.timeoutMs, 20000),
        ...options,
        headers: { Accept: 'application/json', ...options.headers },
      }
    );
    if (!Array.isArray(entries) || entries.length === 0) {
      return { status: 'empty', summary: null, fields: [], message: 'No certificate found for this domain in the CT logs.', raw };
    }
    const names = [];
    const issuers = [];
    let latestIssued = null;
    const seenNames = new Set();
    for (const entry of entries.slice(0, 400)) {
      if (typeof entry?.name_value === 'string') {
        for (const raw of entry.name_value.split('\n')) {
          const name = raw.trim();
          if (name && !name.includes('@')) {
            const normalizedName = name.replace(/^\*\.?/, '').toLowerCase();
            if (!seenNames.has(normalizedName)) {
              seenNames.add(normalizedName);
              names.push(normalizedName);
            }
          }
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
    const summary = `${entries.length} certificate entries`;
    return {
      status: 'ok',
      summary,
      fields,
      message: null,
      raw,
    };
  }

  describeError(error) {
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
}