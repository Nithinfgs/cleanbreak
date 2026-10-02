import { git } from './git.js';

/**
 * @typedef {{n: number, text: string}} Line
 * @typedef {{status: 'A'|'M'|'D'|'R', path: string, oldPath: string|null, added: Line[], removed: Line[]}} FileChange
 */

/**
 * Parse `git diff -U0 -M` output.
 * @param {string} text
 * @returns {FileChange[]}
 */
export function parseDiff(text) {
  /** @type {FileChange[]} */
  const files = [];
  /** @type {FileChange|null} */
  let cur = null;
  let inHunk = false;
  let oldN = 0;
  let newN = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const s = line.slice('diff --git '.length);
      const n = (s.length - 5) / 2;
      const p = Number.isInteger(n) && s.startsWith('a/') ? s.slice(2, 2 + n) : s.replace(/^a\//, '').split(' b/')[0];
      cur = { status: 'M', path: p, oldPath: null, added: [], removed: [] };
      files.push(cur);
      inHunk = false;
      continue;
    }
    if (!cur) continue;
    if (inHunk && (line.startsWith('+') || line.startsWith('-'))) {
      if (line[0] === '+') cur.added.push({ n: newN++, text: line.slice(1) });
      else cur.removed.push({ n: oldN++, text: line.slice(1) });
      continue;
    }
    if (line.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
      if (m) {
        oldN = Number(m[1]);
        newN = Number(m[2]);
        inHunk = true;
      }
    } else if (!inHunk) {
      if (line.startsWith('rename from ')) {
        cur.status = 'R';
        cur.oldPath = line.slice('rename from '.length);
      } else if (line.startsWith('rename to ')) cur.path = line.slice('rename to '.length);
      else if (line.startsWith('new file mode')) cur.status = 'A';
      else if (line.startsWith('deleted file mode')) cur.status = 'D';
    }
  }
  return files;
}

/** Changes between two commits, with rename detection. */
export function diffRange(cwd, from, to) {
  const out = git(cwd, ['diff', '--no-color', '--no-ext-diff', '-U0', '-M', from, to]);
  return parseDiff(out);
}

/** Convert a simple glob (`**`, `*`, `?`) to a RegExp. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
