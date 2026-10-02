import assert from 'node:assert/strict';
import { test } from 'node:test';
import { main, parseArgs } from '../src/cli.js';
import { buildDemo } from '../scripts/demo-repo.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const capture = () => {
  const io = { o: '', e: '', out: (s) => (io.o += s), err: (s) => (io.e += s) };
  return io;
};

test('parseArgs', () => {
  const o = parseArgs(['a', 'b', '--base', 'dev', '--json', '--fail-on', 'silent', '-C', '/x']);
  assert.deepEqual([o.refs, o.base, o.json, o.failOn, o.cwd], [['a', 'b'], 'dev', true, 'silent', '/x']);
  assert.throws(() => parseArgs(['--nope']), /unknown option/);
  assert.throws(() => parseArgs(['--base']), /needs a value/);
  assert.throws(() => parseArgs(['--fail-on', 'x']), /--fail-on/);
});

test('cli: demo repo produces findings, json, and exit codes', () => {
  const dir = buildDemo(join(mkdtempSync(join(tmpdir(), 'cleanbreak-cli-')), 'shop'));
  const io = capture();
  assert.equal(main(['-C', dir, '--no-color'], io), 1);
  assert.match(io.o, /merges clean, breaks anyway/);
  assert.match(io.o, /calcTotal/);

  const j = capture();
  assert.equal(main(['-C', dir, '--json', '--fail-on', 'never'], j), 0);
  const parsed = JSON.parse(j.o);
  assert.equal(parsed.base, 'main');
  assert.ok(parsed.pairs.some((p) => p.findings.some((f) => f.rule === 'moved-path')));

  const only = capture();
  assert.equal(main(['-C', dir, 'agent/tax', 'agent/move-format', '--no-color'], only), 0);
  assert.match(only.o, /no textual or semantic conflicts/);
});

test('cli: errors exit 2', () => {
  const io = capture();
  assert.equal(main(['-C', tmpdir(), '--no-color'], io), 2);
  assert.match(io.e, /not inside a git repository|unknown|could not/);
  assert.equal(main(['--bogus'], capture()), 2);
  const v = capture();
  assert.equal(main(['--version'], v), 0);
  assert.match(v.o, /^\d+\.\d+\.\d+/);
});
