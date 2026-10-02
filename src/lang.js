/**
 * Lightweight, line-oriented source understanding. This is deliberately not a
 * parser: it recognises definitions and calls on a single line, and every
 * finding built on it is re-checked against the merged tree afterwards.
 */

/**
 * @typedef {'js'|'py'|'go'|'rs'|'jvm'|'cs'|'rb'|'php'|'swift'|'c'} Lang
 * @typedef {{min: number, max: number}} Arity
 * @typedef {{name: string, kind: 'function'|'class'|'type'|'var', arity: Arity|null}} Definition
 */

const EXT = {
  js: ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts'],
  py: ['py', 'pyi'],
  go: ['go'],
  rs: ['rs'],
  jvm: ['java', 'kt', 'kts', 'scala', 'groovy'],
  cs: ['cs'],
  rb: ['rb'],
  php: ['php'],
  swift: ['swift'],
  c: ['c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh'],
};

const BY_EXT = new Map();
for (const [lang, exts] of Object.entries(EXT)) for (const e of exts) BY_EXT.set(e, lang);

/** @returns {Lang|null} */
export function languageOf(path) {
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  return m ? (BY_EXT.get(m[1].toLowerCase()) ?? null) : null;
}

export const SOURCE_GLOBS = Object.values(EXT)
  .flat()
  .map((e) => `*.${e}`);

const KEYWORDS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'function',
  'return',
  'with',
  'else',
  'do',
  'try',
  'super',
  'this',
  'constructor',
  'when',
  'match',
  'fn',
  'func',
  'def',
  'using',
  'lock',
  'foreach',
  'elif',
  'unless',
]);

const ID = '[A-Za-z_$][\\w$]*';
const MODS =
  '(?:(?:public|private|protected|internal|static|final|abstract|override|open|virtual|sealed|async|extern|unsafe|synchronized|native|default|readonly|partial|new|suspend|inline|operator|infix|export|declare|get|set)\\s+)';

/** Balanced-paren content starting at `open` (index of "("). Null when unclosed on this line. */
export function balanced(line, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return { inner: line.slice(open + 1, i), end: i };
    }
  }
  return null;
}

/** Split on top-level commas, respecting brackets, strings and (optionally) generics. */
export function splitTop(s, generics = true) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (generics && c === '<' && /[\w>]/.test(s[i - 1] ?? '')) depth++;
    else if (generics && c === '>' && depth > 0 && s[i - 1] !== '=' && s[i - 1] !== '-') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

/** @returns {Arity} */
function arityOf(inner, lang) {
  let min = 0;
  let max = 0;
  let variadic = false;
  for (const raw of splitTop(inner, lang !== 'py' && lang !== 'rb')) {
    const p = raw.trim();
    if (!p) continue;
    if (lang === 'py' && (/^(self|cls)\b/.test(p) || p === '/' || p === '*')) continue;
    if (lang === 'rs' && /^&?\s*(mut\s+)?self\b/.test(p)) continue;
    if (lang === 'py' ? p.startsWith('*') : p.startsWith('...') || /\.\.\./.test(p) || (lang === 'rb' && p.startsWith('*'))) {
      variadic = true;
      continue;
    }
    const optional = /=/.test(p.replace(/=>/g, '')) || (lang === 'js' && /^[\w$]+\?\s*(:|$)/.test(p));
    if (optional) {
      max++;
      continue;
    }
    min++;
    max++;
  }
  return { min, max: variadic ? Infinity : max };
}

/** Remove string contents and comments so identifiers inside them are ignored. */
export function stripNoise(line, lang) {
  let s = line;
  if (lang !== 'rs') s = s.replace(/'(?:\\.|[^'\\])*'/g, "''");
  s = s.replace(/"(?:\\.|[^"\\])*"/g, '""');
  if (lang === 'js') s = s.replace(/`(?:\\.|[^`\\])*`/g, '``');
  s = s.replace(/\/\*.*?\*\//g, ' ');
  if (lang === 'py' || lang === 'rb') s = s.replace(/#.*$/, '');
  else if (lang === 'php') s = s.replace(/(\/\/|#).*$/, '');
  else s = s.replace(/\/\/.*$/, '');
  if (/^\s*(\*|\/\*)/.test(s)) return '';
  return s;
}

function fn(lang, line, re, kind = 'function') {
  const m = re.exec(line);
  if (!m) return null;
  const name = m[1];
  const open = line.indexOf('(', m.index + m[0].length - 1);
  const b = open >= 0 ? balanced(line, open) : null;
  return { name, kind, arity: b ? arityOf(b.inner, lang) : null, rest: b ? line.slice(b.end + 1) : '' };
}

const named = (re, kind) => (line) => {
  const m = re.exec(line);
  return m ? { name: m[1], kind, arity: null, rest: '' } : null;
};

/** @type {Record<Lang, ((lang: Lang, line: string) => any)[]>} */
const RULES = {
  js: [
    (l, s) => fn(l, s, new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s*\\*?\\s*(${ID})\\s*(?:<[^>]*>)?\\s*\\(`)),
    (l, s) => named(new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:abstract\\s+)?class\\s+(${ID})`), 'class')(s),
    (l, s) => named(new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:interface|type|enum)\\s+(${ID})`), 'type')(s),
    (l, s) => {
      const d = fn(
        l,
        s,
        new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+(${ID})\\s*(?::[^=]+)?=\\s*(?:async\\s+)?(?:function\\b[^(]*)?\\(`),
      );
      if (d && (/^\s*(?::[^=]*)?=>/.test(d.rest) || /=\s*(?:async\s+)?function/.test(s))) return d;
      return null;
    },
    (l, s) => {
      const m = new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+(${ID})\\s*(?::[^=]+)?=\\s*(?:async\\s+)?(${ID})\\s*=>`).exec(s);
      return m ? { name: m[1], kind: 'function', arity: { min: 1, max: 1 } } : null;
    },
    (l, s) => {
      const m = new RegExp(`^(\\s*)(?:export\\s+)?(?:const|let|var)\\s+(${ID})\\b`).exec(s);
      return m && (m[1] === '' || /^\s*export\b/.test(s)) ? { name: m[2], kind: 'var', arity: null } : null;
    },
    (l, s) => {
      const d = fn(l, s, new RegExp(`^\\s+(?:${MODS})*(${ID})\\s*(?:<[^>]*>)?\\s*\\(`));
      return d && !KEYWORDS.has(d.name) && /^\s*(?::\s*[^{;]+)?\{\s*$/.test(d.rest) ? d : null;
    },
  ],
  py: [
    (l, s) => fn(l, s, /^\s*(?:async\s+)?def\s+(\w+)\s*\(/),
    (l, s) => named(/^\s*class\s+(\w+)/, 'class')(s),
    (l, s) => named(/^([A-Z_][A-Z0-9_]*)\s*(?::[^=]+)?=/, 'var')(s),
  ],
  go: [
    (l, s) => fn(l, s, /^func\s+(?:\([^)]*\)\s*)?(\w+)\s*(?:\[[^\]]*\])?\s*\(/),
    (l, s) => named(/^type\s+(\w+)/, 'type')(s),
    (l, s) => named(/^(?:const|var)\s+(\w+)/, 'var')(s),
  ],
  rs: [
    (l, s) => fn(l, s, /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(/),
    (l, s) => named(/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|type|union)\s+(\w+)/, 'type')(s),
    (l, s) => named(/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const|static)\s+(\w+)\s*:/, 'var')(s),
  ],
  jvm: [
    (l, s) => fn(l, s, new RegExp(`^\\s*${MODS}*fun\\s+(?:<[^>]*>\\s*)?(?:[\\w.<>?]+\\.)?(\\w+)\\s*\\(`)),
    (l, s) => fn(l, s, /^\s*(?:(?:private|protected|public|override|final|abstract)\s+)*def\s+(\w+)\s*\(/),
    (l, s) => fn(l, s, new RegExp(`^\\s*${MODS}+(?:<[^>]+>\\s*)?[\\w<>\\[\\],.?]+(?:\\s*<[^>]*>)?\\s+(\\w+)\\s*\\(`)),
    (l, s) => named(new RegExp(`^\\s*${MODS}*(?:class|interface|enum|object|record|trait)\\s+(\\w+)`), 'class')(s),
  ],
  cs: [
    (l, s) => fn(l, s, new RegExp(`^\\s*${MODS}+(?:<[^>]+>\\s*)?[\\w<>\\[\\],.?]+(?:\\s*<[^>]*>)?\\s+(\\w+)\\s*(?:<[^>]*>)?\\s*\\(`)),
    (l, s) => named(new RegExp(`^\\s*${MODS}*(?:class|interface|enum|struct|record)\\s+(\\w+)`), 'class')(s),
  ],
  rb: [
    (l, s) => {
      const m = /^\s*def\s+(?:self\.)?(\w+[?!=]?)\s*(\(|$)/.exec(s);
      if (!m) return null;
      if (m[2] === '') return { name: m[1], kind: 'function', arity: { min: 0, max: 0 } };
      return fn(l, s, /^\s*def\s+(?:self\.)?(\w+[?!=]?)\s*\(/);
    },
    (l, s) => named(/^\s*(?:class|module)\s+(\w+)/, 'class')(s),
  ],
  php: [
    (l, s) => fn(l, s, new RegExp(`^\\s*${MODS}*function\\s+&?(\\w+)\\s*\\(`)),
    (l, s) => named(/^\s*(?:abstract\s+|final\s+)?(?:class|interface|trait|enum)\s+(\w+)/, 'class')(s),
  ],
  swift: [
    (l, s) => fn(l, s, new RegExp(`^\\s*${MODS}*func\\s+(\\w+)\\s*(?:<[^>]*>)?\\s*\\(`)),
    (l, s) => named(new RegExp(`^\\s*${MODS}*(?:class|struct|enum|protocol|actor)\\s+(\\w+)`), 'class')(s),
  ],
  c: [
    (l, s) => {
      const m = /^\s*#\s*define\s+(\w+)(\()?/.exec(s);
      if (!m) return null;
      if (!m[2]) return { name: m[1], kind: 'var', arity: null };
      return fn(l, s, /^\s*#\s*define\s+(\w+)\(/);
    },
    (l, s) => named(/^\s*(?:typedef\s+)?(?:struct|enum|union|class)\s+(\w+)\s*(?:\{|$|:)/, 'type')(s),
  ],
};

/**
 * Definitions recognised on one source line (zero or one).
 * @param {Lang} lang
 * @param {string} line
 * @returns {Definition[]}
 */
export function definitionsOnLine(lang, line) {
  const code = stripNoise(line, lang);
  if (!code.trim()) return [];
  for (const rule of RULES[lang]) {
    const d = rule(lang, code);
    if (d && d.name && !KEYWORDS.has(d.name)) return [{ name: d.name, kind: d.kind, arity: d.arity }];
  }
  return [];
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\$]/g, '\\$&');

export function hasWord(code, name) {
  return new RegExp(`(?<![\\w$])${escapeRe(name)}(?![\\w$])`).test(code);
}

/**
 * Argument counts of every call to `name` on this (noise-stripped) line.
 * `null` entries mean "could not count" (spread, unclosed paren).
 * @returns {(number|null)[]}
 */
export function callArities(code, name, lang) {
  const out = [];
  const re = new RegExp(`(?<![\\w$])${escapeRe(name)}\\s*\\(`, 'g');
  let m;
  while ((m = re.exec(code))) {
    const b = balanced(code, m.index + m[0].length - 1);
    if (!b) {
      out.push(null);
      continue;
    }
    const args = splitTop(b.inner, false)
      .map((a) => a.trim())
      .filter(Boolean);
    out.push(args.some((a) => a.startsWith('...') || a.startsWith('*')) ? null : args.length);
  }
  void lang;
  return out;
}

/**
 * For each occurrence of `name` in noise-stripped code: the identifier it is accessed through
 * (`cart` in `cart.total`), or null for a bare reference.
 * @returns {(string|null)[]}
 */
export function usageQualifiers(code, name) {
  const out = [];
  const re = new RegExp(`(?<![\\w$])${escapeRe(name)}(?![\\w$])`, 'g');
  let m;
  while ((m = re.exec(code))) {
    const before = code.slice(0, m.index);
    const q = /([\w$]+)\s*(?:\?\.|\.|::|->)\s*$/.exec(before);
    out.push(q ? q[1] : /(?:\?\.|\.|::|->)\s*$/.test(before) ? '?' : null);
  }
  return out;
}

export const inRange = (n, a) => n >= a.min && n <= a.max;
