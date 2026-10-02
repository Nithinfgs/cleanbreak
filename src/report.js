/**
 * Terminal rendering. Plain strings in, plain strings out; colour is optional.
 */

const CODES = { red: 31, green: 32, yellow: 33, cyan: 36, gray: 90, bold: 1, dim: 2 };

export function painter(enabled) {
  const p = (code) => (s) => (enabled ? `\u001b[${code}m${s}\u001b[0m` : String(s));
  return Object.fromEntries(Object.entries(CODES).map(([k, v]) => [k, p(v)]));
}

const RULE_TITLE = {
  'removed-symbol': 'removed symbol still in use',
  'signature-change': 'signature changed under a new call',
  'moved-path': 'moved file still referenced',
  'duplicate-definition': 'duplicate definition',
};

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Status of one pair: 'ok' | 'conflict' | 'silent'. */
export function pairStatus(p) {
  if (p.findings.length) return 'silent';
  return p.textual.clean ? 'ok' : 'conflict';
}

export function summarize(result) {
  const count = { ok: 0, conflict: 0, silent: 0 };
  for (const p of result.pairs) count[pairStatus(p)]++;
  return { ...count, findings: result.pairs.reduce((n, p) => n + p.findings.length, 0) };
}

/**
 * @param {ReturnType<import('./run.js').run>} result
 * @param {{color?: boolean, matrix?: boolean}} [opts]
 */
export function render(result, opts = {}) {
  const c = painter(opts.color ?? false);
  const out = [];
  const total = (result.refs.length * (result.refs.length - 1)) / 2;
  out.push(
    `${c.bold('cleanbreak')} ${c.gray(`base ${result.base} · ${result.refs.length} refs · ${result.pairs.length} diverging pair${result.pairs.length === 1 ? '' : 's'} of ${total}`)}`,
  );
  out.push('');

  if (result.refs.length < 2) {
    out.push(`  nothing to compare: no branch or worktree is ahead of ${result.base}. Pass refs explicitly: cleanbreak <refA> <refB>`);
    return out.join('\n');
  }

  const flagged = result.pairs.filter((p) => p.findings.length || !p.textual.clean);
  if (!flagged.length) {
    out.push(`  ${c.green('✔')} no textual or semantic conflicts found`);
  }

  for (const p of flagged) {
    const silent = p.findings.length > 0;
    const badge =
      silent && p.textual.clean
        ? c.red('✖ merges clean, breaks anyway')
        : !p.textual.clean
          ? c.yellow('⚠ textual conflict')
          : c.red('✖ silent break');
    out.push(`  ${c.bold(p.a)} ${c.gray('×')} ${c.bold(p.b)}   ${badge}`);
    if (!p.textual.clean) out.push(`    ${c.yellow('conflicts in')} ${p.textual.files.join(', ')}`);
    for (const f of p.findings) {
      out.push(`    ${c.red(f.rule)} ${c.cyan(f.symbol)} ${c.gray(`— ${RULE_TITLE[f.rule]}`)}`);
      out.push(
        `      ${c.gray(clip(`${f.culprit.label}`, 28).padEnd(28))} ${f.culprit.file}:${f.culprit.line}  ${c.dim(clip(f.culprit.text, 60))}`,
      );
      out.push(
        `      ${c.gray(clip(`${f.victim.label}`, 28).padEnd(28))} ${f.victim.file}:${f.victim.line}  ${c.dim(clip(f.victim.text, 60))}`,
      );
      if (f.more) out.push(`      ${c.gray(`+${f.more} more use${f.more === 1 ? '' : 's'} in ${f.victim.file}`)}`);
      if (f.evidence) out.push(`      ${c.green('✔ confirmed:')} ${f.evidence}`);
    }
    if (p.verify) {
      const v = p.verify;
      if (v.status === 'failed') {
        out.push(`      ${c.red('✖ verified:')} \`${v.command}\` fails on the merge (exit ${v.code}), passes on both branches`);
        const lines = v.output.split('\n').filter(Boolean);
        const why = lines.find((l) => /^\w*Error\b/.test(l.trim())) ?? lines.at(-1);
        if (why) out.push(`        ${c.dim(clip(why.trim(), 100))}`);
      } else if (v.status === 'passed') out.push(`      ${c.yellow('? not reproduced:')} \`${v.command}\` passes on the merge`);
      else out.push(`      ${c.yellow('? inconclusive:')} \`${v.command}\` already fails on ${v.failing.join(', ')}`);
    }
    out.push('');
  }

  if (opts.matrix !== false && result.refs.length > 1 && result.refs.length <= 12) out.push(...matrix(result, c), '');

  const s = summarize(result);
  const parts = [`${c.red(`${s.silent} silent`)}`, `${c.yellow(`${s.conflict} textual`)}`, `${c.green(`${s.ok} clean`)}`];
  out.push(`  ${parts.join(c.gray(' · '))}`);
  return out.join('\n');
}

function matrix(result, c) {
  const names = result.refs;
  const short = (s) => clip(s, 22);
  const width = Math.max(...names.map((n) => short(n).length));
  const cell = new Map(result.pairs.map((p) => [`${p.a}\u0000${p.b}`, pairStatus(p)]));
  const glyph = (st) => (st === 'silent' ? c.red('✖') : st === 'conflict' ? c.yellow('⚠') : st === 'ok' ? c.green('✔') : c.gray('·'));
  const lines = [`  ${c.gray('pair matrix  ✔ clean  ⚠ textual conflict  ✖ merges clean but breaks')}`];
  names.forEach((row, i) => {
    const cells = names.map((col, j) => {
      if (i === j) return c.gray('·');
      const st = cell.get(`${row}\u0000${col}`) ?? cell.get(`${col}\u0000${row}`) ?? 'none';
      return st === 'none' ? c.gray('–') : glyph(st);
    });
    lines.push(`  ${short(row).padEnd(width)}  ${cells.join('  ')}`);
  });
  return lines;
}
