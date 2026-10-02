import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, renameSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'demo',
  GIT_AUTHOR_EMAIL: 'demo@example.com',
  GIT_COMMITTER_NAME: 'demo',
  GIT_COMMITTER_EMAIL: 'demo@example.com',
};

export const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export function write(dir, file, content) {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), content);
}

export function edit(dir, file, from, to) {
  const s = readFileSync(join(dir, file), 'utf8');
  if (!s.includes(from)) throw new Error(`${file}: "${from}" not found`);
  writeFileSync(join(dir, file), s.replace(from, to));
}

export function commit(dir, message) {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
}

export function move(dir, from, to) {
  mkdirSync(dirname(join(dir, to)), { recursive: true });
  renameSync(join(dir, from), join(dir, to));
}

/**
 * A tiny shop app plus five "agent" branches, each fine on its own.
 * `node main.js` exits non-zero when a merge leaves a dangling reference.
 */
export function buildDemo(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  write(dir, 'package.json', '{ "name": "shop", "type": "module" }\n');
  write(
    dir,
    'src/cart.js',
    `export function calcTotal(items) {
  return items.reduce((sum, i) => sum + i.price * i.qty, 0);
}

export function applyDiscount(total, percent) {
  return total - (total * percent) / 100;
}
`,
  );
  write(dir, 'src/format.js', `export function money(n) {\n  return '$' + n.toFixed(2);\n}\n`);
  write(
    dir,
    'src/index.js',
    `import { calcTotal, applyDiscount } from './cart.js';
import { money } from './format.js';

const items = [{ price: 12.5, qty: 2 }, { price: 3, qty: 4 }];

export function run() {
  const total = calcTotal(items);

  const discounted = applyDiscount(total, 10);
  console.log('total', money(discounted));
}
`,
  );
  write(dir, 'main.js', `import { run } from './src/index.js';\n\nrun();\n`);
  commit(dir, 'initial shop');

  git(dir, 'switch', '-q', '-c', 'agent/rename-total');
  edit(dir, 'src/cart.js', 'export function calcTotal', 'export function computeTotal');
  edit(dir, 'src/index.js', 'import { calcTotal,', 'import { computeTotal,');
  edit(dir, 'src/index.js', 'const total = calcTotal(items);', 'const total = computeTotal(items);');
  commit(dir, 'refactor: rename calcTotal to computeTotal');

  git(dir, 'switch', '-q', 'main');
  git(dir, 'switch', '-q', '-c', 'agent/receipt');
  write(
    dir,
    'src/receipt.js',
    `import { calcTotal, applyDiscount } from './cart.js';
import { money } from './format.js';

export function receipt(items) {
  const total = applyDiscount(calcTotal(items), 5);
  console.log('receipt', money(total));
}
`,
  );
  write(
    dir,
    'main.js',
    `import { run } from './src/index.js';
import { receipt } from './src/receipt.js';

run();
receipt([{ price: 10, qty: 1 }]);
`,
  );
  commit(dir, 'feat: print a receipt');

  git(dir, 'switch', '-q', 'main');
  git(dir, 'switch', '-q', '-c', 'agent/discount-tiers');
  edit(dir, 'src/cart.js', 'export function applyDiscount(total, percent) {', 'export function applyDiscount(total, percent, tier) {');
  edit(dir, 'src/cart.js', '  return total - (total * percent) / 100;', '  return total - (total * (percent + tier.bonus)) / 100;');
  edit(dir, 'src/index.js', 'applyDiscount(total, 10);', 'applyDiscount(total, 10, { bonus: 2 });');
  commit(dir, 'feat: discount tiers');

  git(dir, 'switch', '-q', 'main');
  git(dir, 'switch', '-q', '-c', 'agent/move-format');
  move(dir, 'src/format.js', 'src/lib/format.js');
  edit(dir, 'src/index.js', "from './format.js'", "from './lib/format.js'");
  commit(dir, 'chore: move format helpers to lib/');

  git(dir, 'switch', '-q', 'main');
  git(dir, 'switch', '-q', '-c', 'agent/tax');
  edit(dir, 'src/index.js', 'const total = calcTotal(items);', 'const total = calcTotal(items) * 1.08;');
  commit(dir, 'feat: add sales tax');

  git(dir, 'switch', '-q', 'main');
  return dir;
}
