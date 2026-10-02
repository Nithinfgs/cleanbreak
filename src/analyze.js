import { posix } from 'node:path';
import { diffRange } from './diff.js';
import { grepTree, mergeBase, mergeTree, pathExists, showFile } from './git.js';
import { callArities, definitionsOnLine, hasWord, inRange, languageOf, stripNoise, usageQualifiers } from './lang.js';

/**
 * @typedef {{label: string, sha: string}} Ref
 * @typedef {{label: string, file: string, line: number, text: string}} Site
 * @typedef {{rule: 'removed-symbol'|'signature-change'|'moved-path'|'duplicate-definition', symbol: string, summary: string, culprit: Site, victim: Site, evidence: string, more?: number, meta?: any}} Finding
 * @typedef {{a: string, b: string, base: string, textual: {clean: boolean, files: string[], tree: string}, findings: Finding[], verify?: any}} PairResult
 */

/** Names too generic to flag when merely mentioned (not called). */
const GENERIC = new Set([
  'name',
  'data',
  'value',
  'values',
  'list',
  'item',
  'items',
  'type',
  'test',
  'main',
  'init',
  'self',
  'this',
  'None',
  'true',
  'false',
  'null',
  'result',
  'error',
  'index',
  'state',
  'props',
  'config',
  'options',
  'string',
  'number',
  'object',
  'array',
  'default',
]);

const MAX_LINE = 2000;

/**
 * @param {{cwd: string, ignore: RegExp[], ignoreSymbols: Set<string>, cache: Map<string, any>}} ctx
 * @param {Ref} a
 * @param {Ref} b
 * @returns {PairResult|null} null when the refs do not diverge
 */
export function analyzePair(ctx, a, b) {
  const base = mergeBase(ctx.cwd, a.sha, b.sha);
  if (!base || base === a.sha || base === b.sha) return null;

  const tm = mergeTree(ctx.cwd, a.sha, b.sha);
  const x = { ...a, changes: changesOf(ctx, base, a.sha) };
  const y = { ...b, changes: changesOf(ctx, base, b.sha) };

  /** @type {Finding[]} */
  const raw = [...fromDirection(ctx, x, y), ...fromDirection(ctx, y, x)];
  const findings = [...raw.filter((f) => confirm(ctx, tm.tree, f)), ...duplicates(ctx, tm.tree, x, y)];
  for (const f of findings) delete f.meta;
  return { a: a.label, b: b.label, base, textual: { clean: tm.clean, files: tm.conflicts, tree: tm.tree }, findings: dedupe(findings) };
}

function changesOf(ctx, base, sha) {
  const key = `${base}..${sha}`;
  if (!ctx.cache.has(key)) {
    const all = diffRange(ctx.cwd, base, sha);
    ctx.cache.set(
      key,
      all.filter((c) => !ctx.ignore.some((re) => re.test(c.path) || (c.oldPath && re.test(c.oldPath)))),
    );
  }
  return ctx.cache.get(key);
}

/** Collapse repeats of one symbol in one file into a single finding with a `more` count. */
function dedupe(findings) {
  /** @type {Map<string, Finding>} */
  const seen = new Map();
  for (const f of findings) {
    const k = `${f.rule}|${f.symbol}|${f.victim.file}|${f.culprit.label}`;
    const prev = seen.get(k);
    if (!prev) seen.set(k, { ...f, more: 0 });
    else if (!(prev.victim.line === f.victim.line)) prev.more += 1;
  }
  return [...seen.values()];
}

/** Collect definitions per name from changed lines. */
function collectDefs(changes, side) {
  /** @type {Map<string, {file: string, line: number, text: string, arities: any[], kind: string, indent: number}>} */
  const map = new Map();
  for (const c of changes) {
    const lang = languageOf(c.path);
    if (!lang) continue;
    for (const l of side === 'removed' ? c.removed : c.added) {
      if (l.text.length > MAX_LINE) continue;
      for (const d of definitionsOnLine(lang, l.text)) {
        const e = map.get(d.name) ?? {
          file: side === 'removed' ? (c.oldPath ?? c.path) : c.path,
          line: l.n,
          text: l.text.trim(),
          arities: [],
          kind: d.kind,
          indent: /^\s*/.exec(l.text)[0].length,
        };
        if (d.arity) e.arities.push(d.arity);
        map.set(d.name, e);
      }
    }
  }
  return map;
}

/** Qualifier the name is reached through on this line, or null when any use is bare. */
function memberOf(code, name) {
  const q = usageQualifiers(code, name);
  return q.length && q.every((v) => v !== null) ? q[0] : null;
}

const EXPLICIT_IMPORTS = new Set(['js', 'py', 'rs']);
const stem = (p) => posix.basename(p).replace(/\.[^.]+$/, '');

/**
 * Could the victim file actually see the symbol the culprit file defined?
 * Without this, a removed local `next` or `query` "breaks" every file that uses the same word.
 */
function visible(ctx, tree, f) {
  const { kind, indent, member } = f.meta;
  const from = f.culprit.file;
  const to = f.victim.file;
  const lang = languageOf(from);
  if (!lang) return false;
  const qualified = member && (member === stem(from) || member === posix.basename(posix.dirname(from)));
  const method = member && !qualified;
  if (method && !(kind === 'function' && indent > 0)) return false;
  if (from === to) return indent === 0 || !EXPLICIT_IMPORTS.has(lang) || !!method || !!qualified;

  const text = showFile(ctx.cwd, tree, to) ?? '';
  if (EXPLICIT_IMPORTS.has(lang)) return !!qualified || text.split('\n').some((line) => referencesPath(to, line, from));
  return posix.dirname(from) === posix.dirname(to) || !!qualified || hasWord(text, stem(from));
}

/** Findings where `x`'s changes invalidate things `y` newly relies on. */
function fromDirection(ctx, x, y) {
  /** @type {Finding[]} */
  const out = [];
  const removed = collectDefs(x.changes, 'removed');
  const added = collectDefs(x.changes, 'added');
  const gone = [...removed.keys()].filter((n) => !added.has(n) && !ctx.ignoreSymbols.has(n));
  const resigned = [...removed.keys()].filter((n) => {
    const r = removed.get(n);
    const ad = added.get(n);
    return ad && r.arities.length && ad.arities.length && !ctx.ignoreSymbols.has(n);
  });

  const site = (ref, file, line, text) => ({ label: ref.label, file, line, text: text.trim() });

  for (const c of y.changes) {
    const lang = languageOf(c.path);
    if (!lang) continue;
    for (const l of c.added) {
      if (l.text.length > MAX_LINE) continue;
      const code = stripNoise(l.text, lang);
      if (!code.trim()) continue;
      const here = new Set(definitionsOnLine(lang, l.text).map((d) => d.name));

      for (const name of gone) {
        if (here.has(name) || !hasWord(code, name) || name.length < 3) continue;
        const call = callArities(code, name, lang).length > 0;
        if (!call && (name.length < 4 || GENERIC.has(name))) continue;
        const r = removed.get(name);
        out.push({
          rule: 'removed-symbol',
          symbol: name,
          summary: `${x.label} removes \`${name}\`, ${y.label} still uses it`,
          culprit: site(x, r.file, r.line, r.text),
          victim: site(y, c.path, l.n, l.text),
          evidence: '',
          meta: { kind: r.kind, indent: r.indent, member: memberOf(code, name) },
        });
      }

      for (const name of resigned) {
        if (here.has(name) || !hasWord(code, name)) continue;
        const oldR = removed.get(name).arities;
        const newR = added.get(name).arities;
        for (const n of callArities(code, name, lang)) {
          if (n === null || !oldR.some((r) => inRange(n, r)) || newR.some((r) => inRange(n, r))) continue;
          const ad = added.get(name);
          out.push({
            rule: 'signature-change',
            symbol: name,
            summary: `${x.label} changes the signature of \`${name}\`, ${y.label} calls it with ${n} argument${n === 1 ? '' : 's'}`,
            culprit: site(x, ad.file, ad.line, ad.text),
            victim: site(y, c.path, l.n, l.text),
            evidence: '',
            meta: { kind: ad.kind, indent: ad.indent, member: memberOf(code, name) },
          });
        }
      }
    }
  }

  for (const fc of x.changes) {
    if (fc.status !== 'R' && fc.status !== 'D') continue;
    const oldPath = fc.status === 'R' ? fc.oldPath : fc.path;
    if (!oldPath || y.changes.some((c) => c.path === oldPath || c.oldPath === oldPath)) continue;
    for (const c of y.changes) {
      for (const l of c.added) {
        if (l.text.length > MAX_LINE || !referencesPath(c.path, l.text, oldPath)) continue;
        out.push({
          rule: 'moved-path',
          symbol: oldPath,
          summary: `${x.label} ${fc.status === 'R' ? `moves \`${oldPath}\` to \`${fc.path}\`` : `deletes \`${oldPath}\``}, ${y.label} still references it`,
          culprit: site(x, fc.path, 1, fc.status === 'R' ? `renamed from ${oldPath}` : 'file deleted'),
          victim: site(y, c.path, l.n, l.text),
          evidence: '',
        });
      }
    }
  }
  return out;
}

/** Re-check a candidate finding against the simulated merge result. */
function confirm(ctx, tree, f) {
  if ((f.rule === 'removed-symbol' || f.rule === 'signature-change') && !visible(ctx, tree, f)) return false;
  if (f.rule === 'removed-symbol') {
    const hits = grepTree(ctx.cwd, tree, f.symbol);
    if (!hits.length) return false;
    const stillDefined = hits.some((h) => {
      const lang = languageOf(h.file);
      return lang && definitionsOnLine(lang, h.text).some((d) => d.name === f.symbol);
    });
    if (stillDefined) return false;
    f.evidence = `no definition of \`${f.symbol}\` remains in the merged tree`;
    return true;
  }
  if (f.rule === 'signature-change') {
    const n = callArities(stripNoise(f.victim.text, languageOf(f.victim.file) ?? 'js'), f.symbol, 'js').find((v) => v !== null);
    const defs = grepTree(ctx.cwd, tree, f.symbol).flatMap((h) => {
      const lang = languageOf(h.file);
      return lang ? definitionsOnLine(lang, h.text).filter((d) => d.name === f.symbol && d.arity) : [];
    });
    if (!defs.length || n === undefined || defs.some((d) => inRange(n, d.arity))) return false;
    f.evidence = `merged definition accepts ${defs.map((d) => range(d.arity)).join(' or ')} argument(s), call passes ${n}`;
    return true;
  }
  if (f.rule === 'moved-path') {
    if (pathExists(ctx.cwd, tree, f.symbol)) return false;
    f.evidence = `\`${f.symbol}\` does not exist in the merged tree`;
    return true;
  }
  return true;
}

const range = (a) => (a.max === Infinity ? `${a.min}+` : a.min === a.max ? `${a.min}` : `${a.min}-${a.max}`);

/** Number of times `name` is defined in `text`; overloads and property setters are not duplicates. */
function countDefs(text, lang, name, kind) {
  const lines = text.split('\n');
  return lines.filter((t, i) => {
    if (!definitionsOnLine(lang, t).some((m) => m.name === name && m.kind === kind)) return false;
    return !(lang === 'py' && /^\s*@[\w.]*(setter|getter|deleter|overload|register)\b/.test(lines[i - 1] ?? ''));
  }).length;
}

/**
 * Both sides add a definition with the same name to the same file and the merge keeps both.
 * Compared against each side's own copy so a name that was already defined twice is not blamed on the merge.
 */
function duplicates(ctx, tree, x, y) {
  /** @type {Finding[]} */
  const out = [];
  for (const cx of x.changes) {
    const lang = languageOf(cx.path);
    const cy = y.changes.find((c) => c.path === cx.path);
    if (!lang || !cy) continue;
    const namesX = new Map();
    for (const l of cx.added) for (const d of definitionsOnLine(lang, l.text)) namesX.set(d.name, { l, d });
    for (const l of cy.added) {
      for (const d of definitionsOnLine(lang, l.text)) {
        if (d.kind === 'var' || !namesX.has(d.name) || ctx.ignoreSymbols.has(d.name)) continue;
        const merged = showFile(ctx.cwd, tree, cx.path);
        if (!merged) continue;
        const count = countDefs(merged, lang, d.name, d.kind);
        const own = Math.max(
          countDefs(showFile(ctx.cwd, x.sha, cx.path) ?? '', lang, d.name, d.kind),
          countDefs(showFile(ctx.cwd, y.sha, cx.path) ?? '', lang, d.name, d.kind),
        );
        if (count < 2 || count <= own) continue;
        const other = namesX.get(d.name);
        out.push({
          rule: 'duplicate-definition',
          symbol: d.name,
          summary: `${x.label} and ${y.label} both add \`${d.name}\` to ${cx.path}`,
          culprit: { label: x.label, file: cx.path, line: other.l.n, text: other.l.text.trim() },
          victim: { label: y.label, file: cx.path, line: l.n, text: l.text.trim() },
          evidence: `the merged file defines \`${d.name}\` ${count} times`,
        });
      }
    }
  }
  return out;
}

/** Does `line` (added in `file`) import or mention `oldPath`? */
export function referencesPath(file, line, oldPath) {
  const noExt = oldPath.replace(/\.[^./]+$/, '');
  const dir = posix.dirname(file);
  const isIndex = /^index\.[^.]+$/.test(posix.basename(oldPath));
  const matches = (spec) => {
    if (!spec) return false;
    if (spec === oldPath || spec === noExt) return true;
    if (spec.startsWith('.')) {
      const r = posix.normalize(posix.join(dir, spec));
      return r === oldPath || r === noExt || (isIndex && r === posix.dirname(oldPath));
    }
    return noExt.includes('/') && (spec.endsWith(`/${oldPath}`) || spec.endsWith(`/${noExt}`));
  };

  if (oldPath.includes('/') && line.includes(oldPath)) return true;
  for (const m of line.matchAll(/['"]([^'"\n]+)['"]/g)) if (matches(m[1])) return true;

  const lang = languageOf(file);
  if (lang === 'py') {
    const m = /^\s*(?:from\s+(\.*)([\w.]*)\s+import\s+(.+)|import\s+([\w.]+))/.exec(line);
    if (m) {
      const relative = m[1] ?? '';
      const mod = (m[2] ?? m[4] ?? '').split('.').filter(Boolean).join('/');
      const names = (m[3] ?? '')
        .split(',')
        .map((n) => n.trim().split(/\s+/)[0])
        .filter(Boolean);
      const root = relative ? posix.join(dir, ...Array(relative.length - 1).fill('..')) : '';
      const target = noExt.replace(/\/__init__$/, '');
      for (const c of [mod, ...names.map((n) => (mod ? `${mod}/${n}` : n))]) {
        if (!c) continue;
        const p = relative ? posix.join(root, c) : c;
        if (relative ? target === p : target === p || target.endsWith(`/${p}`)) return true;
      }
    }
  } else if (lang === 'rs') {
    const m = /^\s*(?:pub\s+)?mod\s+(\w+)\s*;/.exec(line);
    if (m) return [posix.join(dir, `${m[1]}.rs`), posix.join(dir, m[1], 'mod.rs')].includes(oldPath);
  }
  return false;
}
