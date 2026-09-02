/**
 * Deterministically maps a string to a hue in [0, 360).
 * Used to give every category a stable accent color without hardcoding it.
 *
 * @param {string} value
 * @returns {number}
 */
export function hueFromString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 360;
  }
  return hash;
}
