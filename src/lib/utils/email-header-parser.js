/**
 * Raw email-header parser (RFC 5322 §3.6, folded-header unfolding per §3.2.3).
 *
 * Reads a block of headers, unfolds continuation lines, and returns an
 * ordered list of fields together with small lookup helpers. This module is
 * pure: no DOM, no network.
 *
 * @module email-header-parser
 */

/**
 * @typedef {Object} ParsedHeaderField
 * @property {string} key   Header name, lower-cased for stable lookups.
 * @property {string} value Unfolded value: continuation whitespace collapsed to
 *                          a single space and leading indentation stripped.
 * @property {number} rawLineIndex 0-based line index in the original paste
 *                                  (the first line of the field, before unfolding).
 */

/**
 * @typedef {Object} ParsedEmailHeaders
 * @property {ParsedHeaderField[]} allHeaders Ordered as they appeared in the source.
 * @property {(key: string) => string | null} field    Value of the first field matching `key` (case-insensitive), or null.
 * @property {(key: string) => string[]} fields       Values of every field matching `key`, in order of appearance.
 * @property {string} raw  The raw text exactly as pasted by the user (kept for the "Raw headers" view).
 */

/**
 * Unfolds RFC 5322 folded headers: a continuation line is one that starts with
 * space or tab; it belongs to the previous field and is joined with a single
 * space after trimming its own leading whitespace.
 *
 * @param {string} text
 * @returns {string[]} Logical, unfolded header lines (name/value pairs joined).
 */
function unfoldHeaders(text) {
  const lines = text.split(/\r?\n/);
  /** @type {string[]} */
  const unfolded = [];
  for (const line of lines) {
    /* Skip blank lines: in a "headers only" paste a blank line may appear
       between two fields, and it never starts a continuation. Stopping at the
       first blank line would wrongly drop the fields that follow (RFC 5325
       says the header block ends at the first *empty* line only when followed
       by a body; when no body is present we keep reading). */
    if (line.length === 0) {
      continue;
    }
    if ((line[0] === ' ' || line[0] === '\t') && unfolded.length > 0) {
      /* Continuation of the previous field. Collapse surrounding whitespace
         differences but keep the logical single-space separator intact. */
      const prev = unfolded.length - 1;
      unfolded[prev] += ' ' + line.trim();
    } else {
      unfolded.push(line);
    }
  }
  return unfolded;
}

/**
 * Tokenises unfolded lines into `[key, value]` pairs.
 *
 * @param {string[]} unfolded
 * @returns {ParsedHeaderField[]}
 */
function tokenize(unfolded) {
  /** @type {ParsedHeaderField[]} */
  const fields = [];
  for (let i = 0; i < unfolded.length; i++) {
    const line = unfolded[i];
    const colon = line.indexOf(':');
    if (colon === -1) {
      /* Not a valid field line — skip but keep parsing so one bad line never
         aborts the whole header block (AC15). */
      continue;
    }
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key === '') {
      continue;
    }
    fields.push({ key: key.toLowerCase(), value, rawLineIndex: i });
  }
  return fields;
}

/**
 * Parses a block of raw email headers.
 *
 * @param {string} raw
 * @returns {ParsedEmailHeaders}
 */
export function parseHeaders(raw) {
  const text = (raw ?? '').trimEnd();
  const unfolded = unfoldHeaders(text);
  const allHeaders = tokenize(unfolded);
  return {
    allHeaders,
    raw: text,
    field(key) {
      const f = allHeaders.find((h) => h.key === key.toLowerCase());
      return f ? f.value : null;
    },
    fields(key) {
      const k = key.toLowerCase();
      return allHeaders.filter((h) => h.key === k).map((h) => h.value);
    },
  };
}
