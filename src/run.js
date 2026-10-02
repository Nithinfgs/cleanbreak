import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzePair } from './analyze.js';
import { globToRegExp } from './diff.js';
import {
  GitError,
  commitTree,
  detectBase,
  localBranches,
  mergeBase,
  repoRoot,
  resolve,
  snapshotWorktree,
  withWorktree,
  worktrees,
} from './git.js';

/**
 * @typedef {import('./analyze.js').Ref} Ref
 * @typedef {import('./analyze.js').PairResult} PairResult
 * @typedef {{cwd?: string, base?: string, refs?: string[], worktrees?: boolean, includeBase?: boolean, verify?: string, config?: object}} Options
 */

const CONFIG_FILE = '.cleanbreakrc.json';

export function loadConfig(root) {
  const p = join(root, CONFIG_FILE);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    throw new GitError(`could not parse ${CONFIG_FILE}: ${e.message}`);
  }
}

/**
 * Decide which refs to compare.
 * @returns {{base: string, refs: Ref[]}}
 */
export function discoverRefs(root, opts, config) {
  const baseName = opts.base ?? config.base ?? detectBase(root);
  if (!baseName) throw new GitError('could not detect a base branch; pass --base <ref>');
  const baseSha = resolve(root, baseName);
  if (!baseSha) throw new GitError(`unknown base ref: ${baseName}`);

  /** @type {Map<string, Ref>} */
  const refs = new Map();
  const add = (label, sha) => {
    if (!refs.has(label)) refs.set(label, { label, sha });
  };

  if (opts.refs?.length) {
    for (const r of opts.refs) {
      const sha = resolve(root, r);
      if (!sha) throw new GitError(`unknown ref: ${r}`);
      add(r, sha);
    }
  } else {
    for (const b of localBranches(root)) {
      const sha = resolve(root, b);
      if (sha && b !== baseName && mergeBase(root, baseSha, sha) !== sha) add(b, sha);
    }
  }

  if (opts.worktrees !== false) {
    for (const wt of worktrees(root)) {
      const snap = snapshotWorktree(wt.path);
      const name = wt.branch ?? `detached@${wt.head.slice(0, 7)}`;
      if (snap) {
        const wanted = !opts.refs?.length || opts.refs.includes(name);
        if (wanted) {
          refs.delete(name);
          add(`${name} (+uncommitted)`, snap);
        }
      } else if (!opts.refs?.length && wt.branch === null && mergeBase(root, baseSha, wt.head) !== wt.head) {
        add(name, wt.head);
      }
    }
  }

  if (opts.includeBase !== false) {
    const dirtyBase = [...refs.values()].find((r) => r.label === `${baseName} (+uncommitted)`);
    if (!dirtyBase && !refs.has(baseName)) add(baseName, baseSha);
  }
  return { base: baseName, refs: [...refs.values()] };
}

/**
 * Compare every pair of refs.
 * @param {Options} opts
 */
export function run(opts = {}) {
  const root = repoRoot(opts.cwd ?? process.cwd());
  const config = { ...loadConfig(root), ...(opts.config ?? {}) };
  const { base, refs } = discoverRefs(root, opts, config);

  const ctx = {
    cwd: root,
    ignore: (config.ignore ?? []).map(globToRegExp),
    ignoreSymbols: new Set(config.ignoreSymbols ?? []),
    cache: new Map(),
  };

  /** @type {PairResult[]} */
  const pairs = [];
  for (let i = 0; i < refs.length; i++) {
    for (let j = i + 1; j < refs.length; j++) {
      const r = analyzePair(ctx, refs[i], refs[j]);
      if (r) pairs.push(r);
    }
  }

  if (opts.verify) for (const p of pairs) verifyPair(root, p, refs, opts.verify);
  const used = new Set(pairs.flatMap((p) => [p.a, p.b]));
  return { root, base, refs: refs.map((r) => r.label).filter((l) => used.has(l) || l !== base), pairs };
}

/** Run a user command on the trial merge to turn a suspicion into a fact. */
function verifyPair(root, pair, refs, command) {
  if (!pair.textual.clean || !pair.findings.length) return;
  const a = refs.find((r) => r.label === pair.a);
  const b = refs.find((r) => r.label === pair.b);
  const merged = commitTree(root, pair.textual.tree, [a.sha, b.sha]);
  const exec = (sha) =>
    withWorktree(root, sha, (dir) => {
      const r = spawnSync(command, { cwd: dir, shell: true, encoding: 'utf8', timeout: 5 * 60_000 });
      return {
        ok: r.status === 0,
        code: r.status,
        output: `${r.stdout ?? ''}${r.stderr ?? ''}`
          .replaceAll(`/private${dir}`, '.')
          .replaceAll(dir, '.')
          .trim()
          .split('\n')
          .slice(-40)
          .join('\n'),
      };
    });
  const result = exec(merged);
  if (result.ok) {
    pair.verify = { command, status: 'passed', ...result };
    return;
  }
  const failing = [a, b].filter((r) => !exec(r.sha).ok).map((r) => r.label);
  pair.verify = failing.length ? { command, status: 'inconclusive', failing, ...result } : { command, status: 'failed', ...result };
}
