import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export class GitError extends Error {}

/**
 * Run git and return {code, stdout, stderr}. Never throws on non-zero exit.
 * @param {string} cwd
 * @param {string[]} args
 * @param {{env?: Record<string,string>}} [opts]
 */
export function gitRaw(cwd, args, opts = {}) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    env: { ...process.env, ...opts.env },
  });
  if (r.error) throw new GitError(`could not run git: ${r.error.message}`);
  if (process.env.CLEANBREAK_DEBUG) process.stderr.write(`[git] ${args.join(' ')} -> ${r.status}\n`);
  return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
}

/** Run git, throw GitError on failure, return stdout. */
export function git(cwd, args, opts) {
  const r = gitRaw(cwd, args, opts);
  if (r.code !== 0) throw new GitError(`git ${args.join(' ')} failed: ${r.stderr.trim()}`);
  return r.stdout;
}

export function repoRoot(cwd) {
  const r = gitRaw(cwd, ['rev-parse', '--show-toplevel']);
  if (r.code !== 0) throw new GitError('not inside a git repository');
  return r.stdout.trim();
}

/** Resolve a ref to a commit sha, or null if it does not exist. */
export function resolve(cwd, ref) {
  const r = gitRaw(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  return r.code === 0 ? r.stdout.trim() : null;
}

export function mergeBase(cwd, a, b) {
  const r = gitRaw(cwd, ['merge-base', a, b]);
  return r.code === 0 ? r.stdout.trim() : null;
}

/** Guess the integration branch: origin/HEAD, then main, then master. */
export function detectBase(cwd) {
  const head = gitRaw(cwd, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  const candidates = [head.code === 0 ? head.stdout.trim() : null, 'main', 'master', 'trunk', 'develop'];
  for (const c of candidates) if (c && resolve(cwd, c)) return c;
  return null;
}

export function localBranches(cwd) {
  const out = git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
  return out.split('\n').filter(Boolean);
}

/**
 * List worktrees with the branch they have checked out.
 * @returns {{path: string, head: string, branch: string|null}[]}
 */
export function worktrees(cwd) {
  const out = git(cwd, ['worktree', 'list', '--porcelain']);
  const list = [];
  let cur = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      cur = { path: line.slice(9), head: '', branch: null };
      list.push(cur);
    } else if (cur && line.startsWith('HEAD ')) cur.head = line.slice(5);
    else if (cur && line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
  }
  return list.filter((w) => w.head && !/^0+$/.test(w.head));
}

/**
 * Capture uncommitted + untracked work of a worktree as a commit object without
 * touching its index, working tree or any ref. Returns null when the tree is clean.
 */
export function snapshotWorktree(path) {
  const status = gitRaw(path, ['status', '--porcelain']);
  if (status.code !== 0 || !status.stdout.trim()) return null;
  const tmp = mkdtempSync(join(tmpdir(), 'cleanbreak-idx-'));
  try {
    const env = { GIT_INDEX_FILE: join(tmp, 'index') };
    git(path, ['read-tree', 'HEAD'], { env });
    git(path, ['add', '-A'], { env });
    const tree = git(path, ['write-tree'], { env }).trim();
    return git(path, ['commit-tree', tree, '-p', 'HEAD', '-m', 'cleanbreak snapshot'], { env: { ...env, ...IDENTITY } }).trim();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const IDENTITY = {
  GIT_AUTHOR_NAME: 'cleanbreak',
  GIT_AUTHOR_EMAIL: 'cleanbreak@localhost',
  GIT_COMMITTER_NAME: 'cleanbreak',
  GIT_COMMITTER_EMAIL: 'cleanbreak@localhost',
};

/**
 * Simulate a merge in the object database only.
 * @returns {{clean: boolean, tree: string, conflicts: string[]}}
 */
export function mergeTree(cwd, a, b) {
  const r = gitRaw(cwd, ['merge-tree', '--write-tree', '--name-only', a, b]);
  if (r.code > 1) throw new GitError(`git merge-tree failed: ${r.stderr.trim() || r.stdout.trim()}`);
  const lines = r.stdout.split('\n');
  const tree = lines[0].trim();
  const conflicts = [];
  if (r.code === 1) {
    for (const l of lines.slice(1)) {
      if (!l) break;
      conflicts.push(l);
    }
  }
  return { clean: r.code === 0, tree, conflicts: [...new Set(conflicts)] };
}

/** Create a throwaway merge commit for a clean merge tree. */
export function commitTree(cwd, tree, parents) {
  const args = ['commit-tree', tree, '-m', 'cleanbreak trial merge'];
  for (const p of parents) args.push('-p', p);
  return git(cwd, args, { env: IDENTITY }).trim();
}

/** Run `fn(dir)` inside a temporary detached worktree of `commit`. */
export function withWorktree(cwd, commit, fn) {
  const base = mkdtempSync(join(tmpdir(), 'cleanbreak-wt-'));
  const dir = join(base, 'wt');
  mkdirSync(dir, { recursive: true });
  git(cwd, ['worktree', 'add', '--detach', '--force', dir, commit]);
  try {
    return fn(dir);
  } finally {
    gitRaw(cwd, ['worktree', 'remove', '--force', dir]);
    rmSync(base, { recursive: true, force: true });
  }
}

/** Read one file from a tree/commit, or null when absent. */
export function showFile(cwd, treeish, path) {
  const r = gitRaw(cwd, ['show', `${treeish}:${path}`]);
  return r.code === 0 ? r.stdout : null;
}

export function pathExists(cwd, treeish, path) {
  return gitRaw(cwd, ['cat-file', '-e', `${treeish}:${path}`]).code === 0;
}

/**
 * Word-grep a tree. Returns matching lines as {file, line, text}.
 * @returns {{file: string, line: number, text: string}[]}
 */
export function grepTree(cwd, treeish, word) {
  const r = gitRaw(cwd, ['grep', '-n', '-I', '-w', '-F', '-e', word, treeish]);
  if (r.code > 1) return [];
  const out = [];
  const prefix = `${treeish}:`;
  for (const l of r.stdout.split('\n')) {
    if (!l.startsWith(prefix)) continue;
    const m = /^(.*?):(\d+):(.*)$/.exec(l.slice(prefix.length));
    if (m) out.push({ file: m[1], line: Number(m[2]), text: m[3] });
  }
  return out;
}
