/**
 * Email-header analyser (RFC 5322 + RFC 7601 Authentication-Results).
 *
 * Pure module: no DOM, no network. Turns a {@link ParsedEmailHeaders} object
 * into a structured {@link EmailHeaderAnalysis} ready for display. IoC reuse is
 * delegated to the V1.1 `extractIocs()` pipeline on the analyser's caller.
 *
 * @module email-header-analyzer
 */

/** @typedef {import('./email-header-parser.js').ParsedEmailHeaders} ParsedEmailHeaders */
/** @typedef {import('../types.js').IocTypeId} IocTypeId */

/**
 * Classification of an IP address found in a Received header.
 * @typedef {'public' | 'private' | 'loopback' | 'linklocal' | 'unknown'} IpKind
 */

/**
 * @typedef {Object} ReceivedHop
 * @property {string} raw        Value of the Received field as parsed.
 * @property {string | null} host Name given in the `from` clause (HELO or literal).
 * @property {string | null} ip   IPv4 literal found in the `from` or `by` clause, if any.
 * @property {IpKind} ipKind      Classification of the IP (public/private/loopback/linklocal/unknown).
 * @property {string | null} date RFC 5322 date string, if a date is present.
 * @property {string | null} dateIso ISO 8601 date if parseable, else null.
 */

/**
 * Result of one authentication mechanism.
 * @typedef {Object} EmailAuthResult
 * @property {string | null} result One of PASS/FAIL/SOFTFAIL/NEUTRAL/NONE/TEMPERROR/PERMERROR/UNKNOWN for SPF,
 *                                  PASS/FAIL/BESTGUESSPASS/NONE/UNKNOWN for DMARC, PASS/FAIL for DKIM, else the raw string.
 * @property {string | null} domain  smtp.mailfrom / header.d / header.from domain, when available.
 * @property {string | null} selector DKIM selector (s=), when available.
 */

/**
 * @typedef {Object} EmailHeaderAnalysis
 * @property {{from: string | null, replyTo: string | null, returnPath: string | null, messageIdDomain: string | null}} summary
 * @property {{spf: EmailAuthResult, dkim: EmailAuthResult, dmarc: EmailAuthResult}} auth
 * @property {{from: string | null, replyTo: string | null, returnPath: string | null, dkim: string | null, messageId: string | null, differs: boolean}} identity
 * @property {ReceivedHop[]} mailPath            Ordered earliest → final receiving server.
 * @property {string | null} earliestPublicIp     First public IP encountered (or null).
 * @property {{earliest: string | null, latest: string | null, durationMs: number | null}} transit
 * @property {{icon: 'info' | 'warn' | 'ok', label: string}[]} signals Descriptive, factual. Never a verdict.
 * @property {{ips: string[], domains: string[], emails: string[]}} iocs Raw IoC candidates for the
 *        V1.1 extractor (defanged/refanged/normalized downstream by callers).
 */

/* ---- IPv4 literals: matches dotted-quads optionally wrapped in [] ---- */
/** @param {string} s */
const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const PRIVATE_RE =
  /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3})$|^(172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$|^(192\.168\.\d{1,3}\.\d{1,3})$/;
const LOOPBACK_RE = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const LINKLOCAL_RE = /^169\.254\.\d{1,3}\.\d{1,3}$/;

/** @param {string} ip @returns {IpKind} */
function classifyIp(ip) {
  if (LOOPBACK_RE.test(ip)) return 'loopback';
  if (PRIVATE_RE.test(ip)) return 'private';
  if (LINKLOCAL_RE.test(ip)) return 'linklocal';
  return 'public';
}

/**
 * Extract the domain from an address or a message-id. Trailing whitespace or a
 * closing angle bracket is tolerated, so both `user@example.com` and the
 * standard `<id@example.com>` form resolve to `example.com`.
 */
const EMAIL_DOMAIN_RE = /@([A-Za-z0-9.-]+)[\s>]*$/;
/** @param {string} s */
const extractEmailDomain = (s) => {
  const m = s.match(EMAIL_DOMAIN_RE);
  return m ? m[1] : null;
};
/** Extract address from `Name <addr>` or `<addr>` or `addr`. */
const ADDR_SPEC_RE = /<([^>]+)>|([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+)/;
/** @param {string} s */
const extractAddress = (s) => {
  const m = s.match(ADDR_SPEC_RE);
  return m ? (m[1] ?? m[2]) ?? null : null;
};

const AUTH_RESULT_RE = /(?:^|;\s*)(spf|dkim|dmarc)\s*=\s*(\w+)(?:\s+(.+?))?(?=;\s*(?:spf|dkim|dmarc)=|$)/gi;

/**
 * Parse an Authentication-Results value (single string, already unfolded) into
 * SPF/DKIM/DMARC results.
 *
 * @param {string | null} value
 * @returns {{spf: EmailAuthResult, dkim: EmailAuthResult, dmarc: EmailAuthResult}}
 */
function parseAuthenticationResults(value) {
  /** @type {EmailAuthResult} */
  const empty = { result: null, domain: null, selector: null };
  const out = { spf: { ...empty }, dkim: { ...empty }, dmarc: { ...empty } };
  if (!value) return out;
  const re = new RegExp(AUTH_RESULT_RE.source, AUTH_RESULT_RE.flags);
  let m;
  while ((m = re.exec(value)) !== null) {
    const [_, mech, res, rest] = m; // eslint-disable-line @typescript-eslint/no-unused-vars
    const mechL = mech.toLowerCase();
    const target =
      (mechL === 'spf' && out.spf) ||
      (mechL === 'dkim' && out.dkim) ||
      (mechL === 'dmarc' && out.dmarc);
    if (!target) continue;
    target.result = res ? res.toUpperCase() : null;
    if (rest) {
      const dm = rest.match(/smtp\.mailfrom=([^\s;]+)/i);
      if (dm) target.domain = dm[1];
      const hd = rest.match(/header\.d=([^\s;]+)/i);
      if (hd) target.domain = hd[1];
      const hf = rest.match(/header\.from=([^\s;]+)/i);
      if (hf) target.domain = target.domain ?? hf[1];
      const sel = rest.match(/selector\s*=\s*([^\s;]+)/i);
      if (sel) target.selector = sel[1];
    }
  }
  return out;
}

/**
 * Parse a Received header value into a structured hop.
 *
 * @param {string} value
 * @returns {ReceivedHop}
 */
function parseReceived(value) {
  const hostMatch = value.match(/^from\s+(\S+)/i);
  const host = hostMatch ? hostMatch[1].replace(/^[\(\[].*?[\)\]]$/, '') : null;
  const ipMatch = value.match(IP_RE);
  const ip = ipMatch ? ipMatch[0] : null;
  const dateMatch = value.match(/;\s*([^;]+)$/);
  const dateStr = dateMatch ? dateMatch[1].trim() : null;
  return {
    raw: value,
    host,
    ip,
    ipKind: ip ? classifyIp(ip) : 'unknown',
    date: dateStr,
    dateIso: toIsoDate(dateStr),
  };
}

/**
 * Converts an RFC 5322 date string to ISO 8601 without ever throwing: some MTAs
 * emit non-standard dates, and a single malformed one must degrade to `null`
 * (surfaced as an "unparsed hop" signal) instead of aborting the analysis.
 *
 * @param {string | null} dateStr
 * @returns {string | null}
 */
function toIsoDate(dateStr) {
  if (!dateStr) return null;
  const time = Date.parse(dateStr);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/**
 * Main analysis entry point.
 *
 * @param {ParsedEmailHeaders} parsed
 * @returns {EmailHeaderAnalysis}
 */
export function analyzeHeaders(parsed) {
  const fromRaw = parsed.field('From');
  const replyToRaw = parsed.field('Reply-To');
  const returnPathRaw = parsed.field('Return-Path');
  const messageId = parsed.field('Message-ID');
  const authResults =
    parsed.field('Authentication-Results') ?? parsed.field('ARC-Authentication-Results') ?? null;
  const receivedSfp = parsed.field('Received-SPF');

  const fromAddr = fromRaw ? extractAddress(fromRaw) : null;
  const replyToAddr = replyToRaw ? extractAddress(replyToRaw) : null;
  const returnPathAddr = returnPathRaw ? extractAddress(returnPathRaw) : null;

  const fromDomain = fromAddr ? extractEmailDomain(fromAddr) : null;
  const replyToDomain = replyToAddr ? extractEmailDomain(replyToAddr) : null;
  const returnPathDomain = returnPathAddr ? extractEmailDomain(returnPathAddr) : null;
  const messageIdDomain = messageId ? extractEmailDomain(messageId) : null;

  // --- Authentication results ---------------------------------------------
  const auth = parseAuthenticationResults(authResults);
  if (!auth.spf.result && receivedSfp) {
    const s = receivedSfp.match(/(\w+)(?:\s|$)/i);
    if (s) {
      auth.spf = { ...auth.spf, result: s[1].toUpperCase() };
      const sm = receivedSfp.match(/smtp\.mailfrom=([^\s;]+)/i);
      if (sm) auth.spf.domain = sm[1];
    }
  }
  // DKIM fallback: DKIM-Signature d= / s=
  if (!auth.dkim.result || !auth.dkim.domain) {
    for (const sig of parsed.fields('DKIM-Signature')) {
      const d = sig.match(/(\s|;|^)d=([^;\s]+)/i);
      const s = sig.match(/(\s|;|^)s=([^;\s]+)/i);
      if (d) {
        auth.dkim.domain = auth.dkim.domain ?? d[2];
        if (!auth.dkim.selector && s) auth.dkim.selector = s[2];
        if (!auth.dkim.result) auth.dkim.result = 'PASS';
      }
    }
  }

  // --- Mail path (Received fields are appended per hop; reverse for display)
  const receivedValues = parsed.fields('Received');
  /** @type {ReceivedHop[]} */
  const hops = receivedValues.map(parseReceived);
  const mailPath = hops.slice().reverse();

  let earliestPublic = null;
  for (const hop of mailPath) {
    if (hop.ip && classifyIp(hop.ip) === 'public') {
      earliestPublic = hop.ip;
      break;
    }
  }

  // --- Transit timing -----------------------------------------------------
    const dates = mailPath.map((h) => h.dateIso).filter((d) => d !== null);
  let earliest = null;
  let latest = null;
  let durationMs = null;
  if (dates.length) {
    const sorted = dates.slice().sort((a, b) => Date.parse(a) - Date.parse(b));
    earliest = sorted[0];
    latest = sorted[sorted.length - 1];
    const diff = Date.parse(sorted[sorted.length - 1]) - Date.parse(sorted[0]);
    durationMs = Number.isFinite(diff) && diff >= 0 ? diff : null;
  }

  // --- Identity comparison ------------------------------------------------
  const identity = {
    from: fromDomain,
    replyTo: replyToDomain,
    returnPath: returnPathDomain,
    dkim: auth.dkim.domain,
    messageId: messageIdDomain,
    differs: false,
  };
    const identities = [identity.from, identity.replyTo, identity.returnPath, identity.dkim, identity.messageId]
    .filter(Boolean);
  identity.differs = new Set(identities).size > 1;

  // --- Signals (factual, never a verdict) ---------------------------------
  const signals = [];
  const add = (/** @type {'info' | 'warn' | 'ok'} */ icon, /** @type {string} */ label) =>
    signals.push({ icon, label });

  if (auth.spf.result === 'PASS') add('ok', `SPF ${auth.spf.result}`);
  if (auth.dkim.result === 'PASS') add('ok', `DKIM ${auth.dkim.result}`);
  if (auth.dmarc.result === 'PASS') add('ok', `DMARC ${auth.dmarc.result}`);
  if (auth.spf.result === 'FAIL') add('warn', 'SPF failed');
  if (auth.dkim.result === 'FAIL') add('warn', 'DKIM failed');
  if (auth.dmarc.result === 'FAIL') add('warn', 'DMARC failed');

  if (identity.from && identity.replyTo && identity.from !== identity.replyTo)
    add('warn', 'Reply-To domain differs from From domain');
  if (identity.from && identity.returnPath && identity.from !== identity.returnPath)
    add('info', 'Return-Path domain differs from From domain');
  if (identity.from && identity.messageId && identity.from !== identity.messageId)
    add('warn', 'Message-ID domain differs from From domain');
  if (identity.from && identity.dkim && identity.from !== identity.dkim)
    add('info', 'DKIM signing domain differs from From domain');

  const hasPrivateIp = hops.some((h) => h.ip && classifyIp(h.ip) !== 'public');
  if (hasPrivateIp) add('info', 'Private or local IP present in mail path');

    const unparsed = hops.some((h) => !h.ip && !h.date);
  if (unparsed) add('warn', 'Unable to fully parse one or more Received headers');

  // --- IoC candidates -----------------------------------------------------
    const ips = hops.map((h) => h.ip).filter((x) => x !== null).filter((ip) => classifyIp(ip) === 'public');
  const domains = [fromDomain, replyToDomain, returnPathDomain, auth.dkim.domain, messageIdDomain].filter((x) => x != null);
  for (const hop of hops) {
    if (hop.host) domains.push(hop.host);
  }
  const emails = [fromAddr, replyToAddr, returnPathAddr].filter((x) => x != null);

  return {
    summary: { from: fromAddr, replyTo: replyToAddr, returnPath: returnPathAddr, messageIdDomain },
    auth,
    identity,
    mailPath,
    earliestPublicIp: earliestPublic,
    transit: { earliest, latest, durationMs },
    signals,
    iocs: { ips, domains, emails },
  };
}
