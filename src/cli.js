import { readFileSync } from 'node:fs';
import { GitError } from './git.js';
import { render, summarize } from './report.js';
import { run } from './run.js';

const HELP = `cleanbreak - find branches that merge cleanly but break anyway

Usage
  cleanbreak [refs...] [options]

With no refs, cleanbreak compares every local branch that is ahead of the base
branch, every git worktree (including uncommitted changes), and the base itself.

Options
  --base <ref>       integration branch (default: origin/HEAD, main, master)
  --verify <cmd>     run <cmd> on each suspicious trial merge to confirm a real break
  --fail-on <mode>   exit 1 on: any (default) | silent | never
  --json             machine-readable output
  --no-worktrees     ignore git worktrees and uncommitted work
  --no-base          do not compare branches against the moved base branch
  -C <dir>           run as if started in <dir>
  --color, --no-color  force or disable colour (NO_COLOR is also respected)
  -v, --version      print version
  -h, --help         print this help

Exit codes: 0 nothing found, 1 problems found (see --fail-on), 2 usage or git error.
`;

export function parseArgs(argv) {
  const o = { refs: [], failOn: 'any', json: false, color: undefined };
  const need = (i, flag) => {
    if (i + 1 >= argv.length) throw new UsageError(`${flag} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-v' || a === '--version') o.version = true;
    else if (a === '--json') o.json = true;
    else if (a === '--no-color') o.color = false;
    else if (a === '--color') o.color = true;
    else if (a === '--no-worktrees') o.worktrees = false;
    else if (a === '--no-base') o.includeBase = false;
    else if (a === '--base') o.base = need(i++, a);
    else if (a === '--verify') o.verify = need(i++, a);
    else if (a === '-C') o.cwd = need(i++, a);
    else if (a === '--fail-on') {
      o.failOn = need(i++, a);
      if (!['any', 'silent', 'never'].includes(o.failOn)) throw new UsageError('--fail-on must be any, silent or never');
    } else if (a.startsWith('-')) throw new UsageError(`unknown option: ${a}`);
    else o.refs.push(a);
  }
  return o;
}

class UsageError extends Error {}

/**
 * @param {string[]} argv
 * @param {{out: (s: string) => unknown, err: (s: string) => unknown}} [io]
 * @returns {number} exit code
 */
export function main(argv, io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) }) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    io.err(`cleanbreak: ${e.message}\n\n${HELP}`);
    return 2;
  }
  if (opts.help) return (io.out(HELP), 0);
  if (opts.version) {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return (io.out(`${pkg.version}\n`), 0);
  }

  try {
    const result = run(opts);
    const color = opts.color ?? (process.stdout.isTTY && !process.env.NO_COLOR);
    io.out(opts.json ? `${JSON.stringify(result, null, 2)}\n` : `${render(result, { color })}\n`);
    const s = summarize(result);
    if (opts.failOn === 'never') return 0;
    if (s.silent > 0) return 1;
    return opts.failOn === 'any' && s.conflict > 0 ? 1 : 0;
  } catch (e) {
    if (e instanceof GitError) {
      io.err(`cleanbreak: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
}
