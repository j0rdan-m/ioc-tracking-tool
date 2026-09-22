/**
 * Formats an ISO timestamp the way the investigation history displays it
 * (`22/09/2026 17:03`). UTC is used on purpose: the stored dates are compared
 * across sessions and a stable reference avoids any drift between them.
 *
 * Pure helper — exercised by `npm run smoke`.
 *
 * @param {string} iso
 * @returns {string} `DD/MM/YYYY HH:mm`, or `—` when the value is not a date.
 */
export function formatTimestamp(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  const pad = (/** @type {number} */ value) => String(value).padStart(2, '0');
  return (
    `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
  );
}
