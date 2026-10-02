import assert from 'node:assert/strict';
import { test } from 'node:test';
import { run } from '../src/run.js';
import { branch, edit, git, makeRepo, move, rules, write } from './helpers.js';

const js = (dir) => {
  write(dir, 'lib.js', 'export function greet(name) {\n  return `hi ${name}`;\n}\n\nexport const LIMIT = 5;\n');
  write(dir, 'app.js', "import { greet } from './lib.js';\n\nexport const a = 1;\n");
};

test('removed-symbol: call to a function the other branch deleted', () => {
  const dir = makeRepo(js);
  branch(dir, 'x', (d) => {
    write(d, 'lib.js', 'export function hello(name) {\n  return `hi ${name}`;\n}\n\nexport const LIMIT = 5;\n');
  });
  branch(dir, 'y', (d) => edit(d, 'app.js', 'export const a = 1;', 'export const a = greet("bob");'));
  const r = run({ cwd: dir, includeBase: false });
  assert.deepEqual(rules(r), ['removed-symbol:greet']);
  assert.equal(r.pairs[0].textual.clean, true);
});

test('removed-symbol: moved definition is not removed', () => {
  const dir = makeRepo(js);
  branch(dir, 'x', (d) => {
    write(d, 'lib.js', 'export const LIMIT = 5;\n');
    write(d, 'greet.js', 'export function greet(name) {\n  return `hi ${name}`;\n}\n');
  });
  branch(dir, 'y', (d) => edit(d, 'app.js', 'export const a = 1;', 'export const a = greet("bob");'));
  assert.deepEqual(rules(run({ cwd: dir, includeBase: false })), []);
});

test('removed-symbol: names in strings and comments are ignored', () => {
  const dir = makeRepo(js);
  branch(dir, 'x', (d) => write(d, 'lib.js', 'export const LIMIT = 5;\n'));
  branch(dir, 'y', (d) => edit(d, 'app.js', 'export const a = 1;', '// greet is gone\nexport const a = "greet";'));
  assert.deepEqual(rules(run({ cwd: dir, includeBase: false })), []);
});

test('signature-change: new call with the old arity', () => {
  const dir = makeRepo(js);
  branch(dir, 'x', (d) => edit(d, 'lib.js', 'greet(name)', 'greet(name, punctuation)'));
  branch(dir, 'y', (d) => edit(d, 'app.js', 'export const a = 1;', 'export const a = greet("bob");'));
  const r = run({ cwd: dir, includeBase: false });
  assert.deepEqual(rules(r), ['signature-change:greet']);
});

test('signature-change: optional parameter keeps old calls valid', () => {
  const dir = makeRepo(js);
  branch(dir, 'x', (d) => edit(d, 'lib.js', 'greet(name)', 'greet(name, punctuation = "!")'));
  branch(dir, 'y', (d) => edit(d, 'app.js', 'export const a = 1;', 'export const a = greet("bob");'));
  assert.deepEqual(rules(run({ cwd: dir, includeBase: false })), []);
});

test('moved-path: relative import of a renamed file', () => {
  const dir = makeRepo((d) => {
    js(d);
    write(d, 'util/fmt.js', 'export const f = 1;\n');
  });
  branch(dir, 'x', (d) => move(d, 'util/fmt.js', 'util/format.js'));
  branch(dir, 'y', (d) => write(d, 'util/use.js', "import { f } from './fmt.js';\nexport default f;\n"));
  const r = run({ cwd: dir, includeBase: false });
  assert.deepEqual(rules(r), ['moved-path:util/fmt.js']);
});

test('moved-path: extensionless and index imports', () => {
  const dir = makeRepo((d) => {
    js(d);
    write(d, 'ui/button/index.js', 'export const B = 1;\n');
  });
  branch(dir, 'x', (d) => move(d, 'ui/button/index.js', 'ui/button/main.js'));
  branch(dir, 'y', (d) => write(d, 'page.js', "import { B } from './ui/button';\nexport default B;\n"));
  assert.deepEqual(rules(run({ cwd: dir, includeBase: false })), ['moved-path:ui/button/index.js']);
});

test('moved-path: python relative import', () => {
  const dir = makeRepo((d) => {
    write(d, 'pkg/__init__.py', '');
    write(d, 'pkg/cart.py', 'def total(items):\n    return 0\n');
    write(d, 'pkg/main.py', 'X = 1\n');
  });
  branch(dir, 'x', (d) => move(d, 'pkg/cart.py', 'pkg/basket.py'));
  branch(dir, 'y', (d) => edit(d, 'pkg/main.py', 'X = 1', 'from . import cart\nX = 1'));
  assert.deepEqual(rules(run({ cwd: dir, includeBase: false })), ['moved-path:pkg/cart.py']);
});

test('duplicate-definition: same function added at two places in one file', () => {
  const dir = makeRepo((d) => write(d, 'u.py', 'def a():\n    pass\n\n\n\n\n\n\n\ndef z():\n    pass\n'));
  branch(dir, 'x', (d) => edit(d, 'u.py', 'def a():\n    pass\n', 'def a():\n    pass\n\ndef slugify(s):\n    return s\n'));
  branch(dir, 'y', (d) => edit(d, 'u.py', 'def z():\n    pass\n', 'def z():\n    pass\n\ndef slugify(s):\n    return s.lower()\n'));
  assert.deepEqual(rules(run({ cwd: dir, includeBase: false })), ['duplicate-definition:slugify']);
});

test('identical additions merge into one definition and are not flagged', () => {
  const dir = makeRepo((d) => write(d, 'u.py', 'def a():\n    pass\n'));
  const add = (d) => edit(d, 'u.py', 'def a():\n    pass\n', 'def a():\n    pass\n\ndef same():\n    return 1\n');
  branch(dir, 'x', add);
  branch(dir, 'y', add);
  assert.deepEqual(rules(run({ cwd: dir, includeBase: false })), []);
});

test('textual conflicts are reported separately', () => {
  const dir = makeRepo(js);
  branch(dir, 'x', (d) => edit(d, 'app.js', 'export const a = 1;', 'export const a = 2;'));
  branch(dir, 'y', (d) => edit(d, 'app.js', 'export const a = 1;', 'export const a = 3;'));
  const r = run({ cwd: dir, includeBase: false });
  assert.equal(r.pairs[0].textual.clean, false);
  assert.deepEqual(r.pairs[0].textual.files, ['app.js']);
});

test('go: removed function used by another branch', () => {
  const dir = makeRepo((d) => {
    write(d, 'a.go', 'package p\n\nfunc Total(xs []int) int {\n\treturn 0\n}\n');
    write(d, 'b.go', 'package p\n\nvar B = 1\n');
  });
  branch(dir, 'x', (d) => edit(d, 'a.go', 'func Total(', 'func Sum('));
  branch(dir, 'y', (d) => edit(d, 'b.go', 'var B = 1', 'var B = Total(nil)'));
  assert.deepEqual(rules(run({ cwd: dir, includeBase: false })), ['removed-symbol:Total']);
});

test('base participates: branch vs a main that moved on', () => {
  const dir = makeRepo(js);
  branch(dir, 'feature', (d) => edit(d, 'app.js', 'export const a = 1;', 'export const a = greet("bob");'));
  git(dir, 'switch', '-q', 'main');
  edit(dir, 'lib.js', 'export function greet(name)', 'export function hello(name)');
  git(dir, 'commit', '-qam', 'rename on main');
  assert.deepEqual(rules(run({ cwd: dir })), ['removed-symbol:greet']);
  assert.deepEqual(rules(run({ cwd: dir, includeBase: false })), []);
});

test('uncommitted worktree changes are included and the worktree is untouched', () => {
  const dir = makeRepo(js);
  branch(dir, 'x', (d) => write(d, 'lib.js', 'export const LIMIT = 5;\n'));
  git(dir, 'worktree', 'add', '-q', `${dir}-wt`, '-b', 'y');
  write(`${dir}-wt`, 'app.js', "import { greet } from './lib.js';\nexport const a = greet('x');\n");
  const before = git(`${dir}-wt`, 'status', '--porcelain');
  const r = run({ cwd: dir, includeBase: false });
  assert.ok(r.refs.includes('y (+uncommitted)'));
  assert.deepEqual(rules(r), ['removed-symbol:greet']);
  assert.equal(git(`${dir}-wt`, 'status', '--porcelain'), before);
  assert.equal(git(`${dir}-wt`, 'stash', 'list'), '');
  assert.deepEqual(rules(run({ cwd: dir, includeBase: false, worktrees: false })), []);
});

test('config: ignore globs and ignoreSymbols', () => {
  const dir = makeRepo(js);
  branch(dir, 'x', (d) => write(d, 'lib.js', 'export const LIMIT = 5;\n'));
  branch(dir, 'y', (d) => edit(d, 'app.js', 'export const a = 1;', 'export const a = greet("bob");'));
  assert.deepEqual(rules(run({ cwd: dir, includeBase: false, config: { ignore: ['app.js'] } })), []);
  assert.deepEqual(rules(run({ cwd: dir, includeBase: false, config: { ignoreSymbols: ['greet'] } })), []);
});

test('verify: confirms a real failure and stays quiet when the command passes', () => {
  const dir = makeRepo((d) => {
    write(d, 'lib.js', 'export function greet(n) {\n  return n;\n}\n');
    write(d, 'app.js', 'export const a = 1;\n');
    write(d, 'check.js', "import './app.js';\n");
  });
  branch(dir, 'x', (d) => write(d, 'lib.js', 'export const LIMIT = 5;\n'));
  branch(dir, 'y', (d) => write(d, 'app.js', "import { greet } from './lib.js';\nexport const a = greet('bob');\n"));
  assert.equal(run({ cwd: dir, includeBase: false, verify: 'node check.js' }).pairs[0].verify.status, 'failed');
  assert.equal(run({ cwd: dir, includeBase: false, verify: 'true' }).pairs[0].verify.status, 'passed');
  assert.equal(run({ cwd: dir, includeBase: false, verify: 'false' }).pairs[0].verify.status, 'inconclusive');
});
