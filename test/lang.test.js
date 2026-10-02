import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callArities, definitionsOnLine, hasWord, languageOf, splitTop, stripNoise } from '../src/lang.js';

const def = (lang, line) => definitionsOnLine(lang, line)[0];

test('languageOf maps extensions', () => {
  assert.equal(languageOf('a/b.tsx'), 'js');
  assert.equal(languageOf('x.py'), 'py');
  assert.equal(languageOf('README.md'), null);
});

test('js definitions and arity', () => {
  assert.deepEqual(def('js', 'export function foo(a, b = 1, ...rest) {'), {
    name: 'foo',
    kind: 'function',
    arity: { min: 1, max: Infinity },
  });
  assert.deepEqual(def('js', 'export const bar = (a, { b, c }) => a + b;'), { name: 'bar', kind: 'function', arity: { min: 2, max: 2 } });
  assert.deepEqual(def('js', 'const one = x => x;').arity, { min: 1, max: 1 });
  assert.equal(def('js', 'class Foo extends Bar {').kind, 'class');
  assert.equal(def('js', 'export const MAX = 5;').kind, 'var');
  assert.equal(def('js', '  const local = 5;'), undefined, 'indented locals are not definitions');
  assert.equal(def('js', '  async handle(req, res) {').name, 'handle');
  assert.equal(def('js', '  if (x) {'), undefined);
  assert.equal(def('js', '  const v = (a + b) * 2;'), undefined);
  assert.equal(def('js', 'const v = (a + b) * 2;').kind, 'var');
});

test('ts optional params and generics', () => {
  const d = def('js', 'export function f<T>(a: Map<string, T>, b?: number): void {');
  assert.deepEqual(d.arity, { min: 1, max: 2 });
});

test('python definitions skip self/cls', () => {
  assert.deepEqual(def('py', '    def run(self, a, b=2, *args):').arity, { min: 1, max: Infinity });
  assert.deepEqual(def('py', 'def go(x, y):').arity, { min: 2, max: 2 });
  assert.equal(def('py', 'MAX_ITEMS = 3').kind, 'var');
});

test('go, rust, java, ruby', () => {
  assert.deepEqual(def('go', 'func (s *Server) Handle(w http.ResponseWriter, r *http.Request) error {').arity, { min: 2, max: 2 });
  assert.deepEqual(def('rs', 'pub fn add(&self, a: i32, b: i32) -> i32 {').arity, { min: 2, max: 2 });
  assert.equal(def('jvm', '    public static int total(List<Item> items, int n) {').name, 'total');
  assert.deepEqual(def('rb', '  def greet(name, greeting = "hi")').arity, { min: 1, max: 2 });
  assert.deepEqual(def('rb', '  def ping').arity, { min: 0, max: 0 });
});

test('stripNoise ignores strings and comments', () => {
  assert.equal(hasWord(stripNoise('log("calcTotal failed") // calcTotal', 'js'), 'calcTotal'), false);
  assert.equal(hasWord(stripNoise('x = calcTotal(a)  # why', 'py'), 'calcTotal'), true);
  assert.equal(stripNoise(' * calcTotal docs', 'js'), '');
});

test('callArities counts top-level args', () => {
  assert.deepEqual(callArities('a(f(1, 2), [3, 4], "x,y")', 'a', 'js'), [3]);
  assert.deepEqual(callArities('a()', 'a', 'js'), [0]);
  assert.deepEqual(callArities('a(...xs)', 'a', 'js'), [null]);
  assert.deepEqual(callArities('obj.a(1) + a(1, 2)', 'a', 'js'), [1, 2]);
  assert.deepEqual(callArities('aa(1) + xa(2)', 'a', 'js'), []);
});

test('splitTop respects nesting', () => {
  assert.deepEqual(
    splitTop('a, {b, c}, d').map((s) => s.trim()),
    ['a', '{b, c}', 'd'],
  );
});
