#!/usr/bin/env node
/* eslint-disable no-control-regex -- ANSI escape sequences are the point of this script */
// Renders the real output of cleanbreak on the demo repo as an animated terminal SVG.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.js';
import { buildDemo } from './demo-repo.js';

const COLORS = { 31: '#ff7b72', 32: '#7ee787', 33: '#e3b341', 36: '#79c0ff', 90: '#8b949e' };
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function spans(line) {
  let fill = null;
  let bold = false;
  let dim = false;
  let out = '';
  for (const part of line.split(/(\u001b\[\d+m)/)) {
    const m = /^\u001b\[(\d+)m$/.exec(part);
    if (m) {
      const n = Number(m[1]);
      if (n === 0) ((fill = null), (bold = false), (dim = false));
      else if (n === 1) bold = true;
      else if (n === 2) dim = true;
      else fill = COLORS[n] ?? fill;
    } else if (part) {
      const style = [fill ? `fill:${fill}` : '', bold ? 'font-weight:700' : '', dim ? 'opacity:.6' : ''].filter(Boolean).join(';');
      out += `<tspan${style ? ` style="${style}"` : ''}>${esc(part)}</tspan>`;
    }
  }
  return out;
}

const dir = buildDemo(join(mkdtempSync(join(tmpdir(), 'cleanbreak-svg-')), 'shop'));
let text = '';
main(['-C', dir, '--color', '--verify', 'node main.js'], { out: (s) => (text += s), err: () => {} });
const lines = ['\u001b[90m$\u001b[0m \u001b[1mcleanbreak --verify "node main.js"\u001b[0m', '', ...text.replace(/\n+$/, '').split('\n')];

const W = 980;
const LH = 19;
const top = 56;
const H = top + lines.length * LH + 24;
const body = lines
  .map(
    (l, i) =>
      `<text x="24" y="${top + i * LH}" class="l" style="animation-delay:${(i * 0.09).toFixed(2)}s" xml:space="preserve">${spans(l)}</text>`,
  )
  .join('\n');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="cleanbreak terminal output on a demo repository with five parallel branches">
<style>
.l{font:13px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;fill:#e6edf3;opacity:0;animation:in .25s ease-out forwards}
@keyframes in{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){.l{animation:none;opacity:1}}
</style>
<rect width="${W}" height="${H}" rx="10" fill="#0d1117"/>
<rect width="${W}" height="34" rx="10" fill="#161b22"/><rect y="24" width="${W}" height="10" fill="#161b22"/>
<circle cx="20" cy="17" r="6" fill="#ff5f56"/><circle cx="40" cy="17" r="6" fill="#ffbd2e"/><circle cx="60" cy="17" r="6" fill="#27c93f"/>
<text x="${W / 2}" y="22" text-anchor="middle" style="font:12px ui-monospace,Menlo,monospace;fill:#8b949e">shop — five parallel branches, each fine on its own</text>
${body}
</svg>
`;
const out = join(dirname(fileURLToPath(import.meta.url)), '../docs/assets/demo.svg');
writeFileSync(out, svg);
console.log(`wrote ${out} (${svg.length} bytes, ${lines.length} lines)`);
