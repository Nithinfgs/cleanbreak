import assert from 'node:assert/strict';
import { test } from 'node:test';
import { globToRegExp, parseDiff } from '../src/diff.js';

test('parseDiff handles modify, add, delete, rename', () => {
  const text = [
    'diff --git a/src/a.js b/src/a.js',
    'index 1..2 100644',
    '--- a/src/a.js',
    '+++ b/src/a.js',
    '@@ -3,2 +3,1 @@',
    '-old line',
    '--- not a header',
    '+new line',
    'diff --git a/n.js b/n.js',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/n.js',
    '@@ -0,0 +1,1 @@',
    '+hi',
    'diff --git a/d.js b/d.js',
    'deleted file mode 100644',
    '--- a/d.js',
    '+++ /dev/null',
    '@@ -1,1 +0,0 @@',
    '-bye',
    'diff --git a/old name.js b/new name.js',
    'similarity index 90%',
    'rename from old name.js',
    'rename to new name.js',
  ].join('\n');
  const f = parseDiff(text);
  assert.equal(f.length, 4);
  assert.deepEqual(f[0].removed, [
    { n: 3, text: 'old line' },
    { n: 4, text: '-- not a header' },
  ]);
  assert.deepEqual(f[0].added, [{ n: 3, text: 'new line' }]);
  assert.equal(f[1].status, 'A');
  assert.equal(f[2].status, 'D');
  assert.equal(f[2].path, 'd.js');
  assert.deepEqual([f[3].status, f[3].oldPath, f[3].path], ['R', 'old name.js', 'new name.js']);
});

test('globToRegExp', () => {
  assert.ok(globToRegExp('**/*.test.js').test('src/deep/a.test.js'));
  assert.ok(globToRegExp('**/*.test.js').test('a.test.js'));
  assert.ok(!globToRegExp('*.js').test('src/a.js'));
  assert.ok(globToRegExp('docs/**').test('docs/a/b.md'));
});
