/**
 * Refang / defang / normalization of defanged indicators.
 *
 * Threat reports deliberately neutralize observables ("hxxps://evil[.]com")
 * so scanners and mail filters do not fire on them. This module restores the
 * exploitable form (refang) and produces the neutralized form (defang).
 *
 * Pure module — no DOM, no network — exercised by `npm run smoke`.
 *
 * The tricky part is keeping track of WHERE each output character came from:
 * refanging shrinks the text ("[.]" becomes "."), so character positions move.
 * `refang()` therefore also returns a source-interval map (srcStart/srcEnd,
 * one entry per output character), letting callers map a match found in the
 * refanged text back to the exact original substring (raw defanged value).
 */

/**
 * Rewrite rules, tried in order at each position. The `i` flag accepts
 * uppercase variants (HXXPS) found in some reports; replacements are the
 * canonical lowercase forms.
 *
 * @type {{ find: RegExp, replace: string }[]}
 */
const REFANG_RULES = [
  { find: /hxxps/iy, replace: 'https' }, // before hxxp: longest match first
  { find: /hxxp/iy, replace: 'http' },
  { find: /\[\.\]|\(\.\)|\[dot\]|\(dot\)/iy, replace: '.' },
  { find: /\[@\]|\[at\]|\(at\)/iy, replace: '@' },
];

/**
 * Refangs a text and maps every output character back to its source interval.
 *
 * @param {string} text Raw text, possibly containing defanged indicators.
 * @returns {{ value: string, srcStart: Int32Array, srcEnd: Int32Array }}
 *   `value` is the refanged text; `srcStart[i]`/`srcEnd[i]` give the half-open
 *   source interval (in `text`) the i-th output character was produced from.
 */
export function refang(text) {
  /** @type {number[]} */
  const srcStart = [];
  /** @type {number[]} */
  const srcEnd = [];
  /** @type {string[]} */
  const out = [];

  let i = 0;
  while (i < text.length) {
    let matched = false;
    for (const rule of REFANG_RULES) {
      rule.find.lastIndex = i;
      const hit = rule.find.exec(text);
      if (hit) {
        for (const char of rule.replace) {
          out.push(char);
          srcStart.push(i);
          srcEnd.push(i + hit[0].length);
        }
        i += hit[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      out.push(text[i]);
      srcStart.push(i);
      srcEnd.push(i + 1);
      i += 1;
    }
  }

  return {
    value: out.join(''),
    srcStart: Int32Array.from(srcStart),
    srcEnd: Int32Array.from(srcEnd),
  };
}

/** @param {string} text @returns {string} The refanged text. */
export function refangValue(text) {
  return refang(text).value;
}

/**
 * Strips the punctuation a sentence may have glued to an indicator
 * ("176.128.43.70.", "example.com,"), keeping dots that belong to it.
 *
 * @param {string} value
 * @returns {string}
 */
export function stripEdgePunctuation(value) {
  return value.replace(/^[.,;:!?"'“”‘’<([{]+/, '').replace(/[.,;:!?"'“”‘’>)\]}]+$/, '');
}

/**
 * Produces the canonical exploitable form of one indicator.
 *
 * - refangs, trims and strips sentence punctuation;
 * - lowercases everything except the path/query/hash part of a URL (hosts and
 *   schemes are case-insensitive, URL paths are not).
 *
 * @param {string} raw Value as encountered in the text (possibly defanged).
 * @param {'ip' | 'domain' | 'url' | 'file' | 'email'} typeId
 * @returns {string}
 */
export function normalizeIoc(raw, typeId) {
  const refanged = stripEdgePunctuation(refangValue(raw).trim());
  if (typeId === 'url') {
    try {
      const parsed = new URL(refanged);
      // new URL() already lowercases scheme and host; path/search/hash keep
      // their original case because paths are case-sensitive.
      return parsed.origin + parsed.pathname + parsed.search + parsed.hash;
    } catch {
      return refanged;
    }
  }
  return refanged.toLowerCase();
}

/**
 * Produces the neutralized (defanged) form of an exploitable indicator.
 * Hashes contain no scheme, dots or at-sign, so they are returned unchanged.
 *
 * @param {string} normalized The exploitable (refanged) value.
 * @param {'ip' | 'domain' | 'url' | 'file' | 'email'} typeId
 * @returns {string}
 */
export function defangIoc(normalized, typeId) {
  if (typeId === 'file') {
    return normalized;
  }
  let defanged = normalized;
  if (defanged.toLowerCase().startsWith('https://')) {
    defanged = `hxxps://${defanged.slice(8)}`;
  } else if (defanged.toLowerCase().startsWith('http://')) {
    defanged = `hxxp://${defanged.slice(7)}`;
  }
  return defanged.replaceAll('.', '[.]').replaceAll('@', '[@]');
}
