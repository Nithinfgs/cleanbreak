import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commit, edit, git, move, write } from '../scripts/demo-repo.js';

export { commit, edit, git, move, write };

/** Create an empty repo with one initial commit built by `setup(dir)`. */
export function makeRepo(setup) {
  const dir = join(mkdtempSync(join(tmpdir(), 'cleanbreak-test-')), 'repo');
  git(tmpdir(), 'init', '-q', '-b', 'main', dir);
  setup(dir);
  commit(dir, 'initial');
  return dir;
}

/** Make a branch off main with `fn(dir)` applied and committed. */
export function branch(dir, name, fn) {
  git(dir, 'switch', '-q', 'main');
  git(dir, 'switch', '-q', '-c', name);
  fn(dir);
  commit(dir, name);
  git(dir, 'switch', '-q', 'main');
}

export const rules = (result) => result.pairs.flatMap((p) => p.findings.map((f) => `${f.rule}:${f.symbol}`)).sort();
