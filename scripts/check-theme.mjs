/**
 * Guards the design system. Run with `npm run theme`.
 *
 * The whole look of the app must be editable from `src/styles/theme.css`: every
 * `var(--token)` used in the frontend must be declared there, and components
 * must consume tokens instead of hard-coding a colour, a radius, a font size or
 * a shadow. A violation fails the check with the offending file and line, so a
 * stray `#38bdf8` or `border-radius: 10px` cannot slip back into a component.
 */
import { readFileSync, readdirSync } from 'node:fs';

const THEME_PATH = 'src/styles/theme.css';
const SRC_DIR = 'src';

/** Every file under `src`, with its contents. @param {string} dir */
function readSources(dir) {
  /** @type {{ path: string, content: string }[]} */
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    if (!/\.(svelte|css|js)$/.test(entry.name)) continue;
    const path = `${entry.parentPath}/${entry.name}`;
    files.push({ path, content: readFileSync(path, 'utf8') });
  }
  return files;
}

const sources = readSources(SRC_DIR);
const theme = sources.find((file) => file.path === THEME_PATH);
if (!theme) {
  throw new Error(`Theme: ${THEME_PATH} is missing — it is the single source of style truth.`);
}

/** Token declared in the theme, i.e. `--name: value`. */
const DECLARED = /(^|[\s;{])(--[a-z0-9-]+)\s*:/gm;
/** Token consumed anywhere, i.e. `var(--name)`. */
const USED = /var\(\s*(--[a-z0-9-]+)/g;

/** @param {string} content @param {RegExp} re @param {number} group */
function collect(content, re, group) {
  const found = new Set();
  for (const match of content.matchAll(re)) found.add(match[group]);
  return found;
}

// A token may also be assigned by a component itself (e.g. the per-card
// `--category-hue`) — that counts as declared too.
const declared = new Set(collect(theme.content, DECLARED, 2));
const localDeclarations = new Set();
for (const file of sources) {
  if (file.path === THEME_PATH) continue;
  for (const token of collect(file.content, DECLARED, 2)) localDeclarations.add(token);
}

for (const file of sources) {
  for (const token of collect(file.content, USED, 1)) {
    if (!declared.has(token) && !localDeclarations.has(token)) {
      throw new Error(
        `Theme: ${file.path} uses var(${token}) but ${THEME_PATH} declares no such token.`,
      );
    }
  }
}

// Components may not hard-code style values that the theme is responsible for.
const FORBIDDEN = [
  { re: /#[0-9a-fA-F]{3,8}\b/, what: 'a hex colour' },
  { re: /\brgba?\(/, what: 'an rgb() colour (use a colour token)' },
  { re: /\bhsla?\(\s*[0-9]/, what: 'an hsl() colour with literal channels' },
  { re: /border-radius:\s*[0-9]/, what: 'a numeric border-radius (use --radius-*)' },
  { re: /box-shadow:\s*[0-9]/, what: 'a numeric box-shadow (use --shadow-*)' },
  { re: /font-size:\s*[0-9]/, what: 'a numeric font-size (use --font-size-*)' },
  { re: /font-family:(?!\s*var\()/, what: 'a literal font-family (use --font-*)' },
  { re: /z-index:\s*[0-9]/, what: 'a numeric z-index (use --z-*)' },
];

for (const file of sources.filter((candidate) => candidate.path.endsWith('.svelte'))) {
  for (const rule of FORBIDDEN) {
    const match = file.content.match(rule.re);
    if (match) {
      const line = file.content.slice(0, match.index).split('\n').length;
      throw new Error(
        `Theme: ${file.path}:${line} hard-codes ${rule.what} — "${match[0].trim()}". ` +
          `Add a token to ${THEME_PATH} instead.`,
      );
    }
  }
}

console.log(
  `THEME OK — ${declared.size} tokens in ${THEME_PATH}, all references resolved, ` +
    'no hard-coded colour/radius/font-size in components.',
);
